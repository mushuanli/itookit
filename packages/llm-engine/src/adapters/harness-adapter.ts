// @file: llm-engine/adapters/harness-adapter.ts
//
// 将 IAgentRuntime 的事件模型桥接到 TaskRunner 期望的 OrchestratorEvent 流。
//
// 事件映射：
//   agent:llm:start         → node_start  (creates child LLM call node)
//   agent:stream:content    → node_update (field='output', chunk=delta)
//   agent:stream:thinking   → node_update (field='thought', chunk=delta)
//   agent:tool:start        → node_start  (child tool node)
//   agent:tool:success      → node_status(success) + node_update(metaInfo.toolResult)
//   agent:tool:error        → node_status(failed)
//   agent:tool:timeout      → node_status(failed)
//   agent:context:compressed→ node_update (metaInfo.compressed)
//   agent:budget:warning    → node_update (metaInfo.budgetWarning)
//   agent:budget:exhausted  → error
//   agent:skill:loaded      → node_update (metaInfo.skillLoaded)
//   agent:backpressure:failed→ node_update (metaInfo.backPressure)
//   agent:task:end          → resolved by run() return value

import type {
    IAgentRuntime,
    ISkillService,
    IToolService,
    AgentTaskRequest,
    AgentTaskResult,
    AgentEventPayloads,
} from '@itookit/common';
import { generateId } from '@itookit/common';
import type { OrchestratorEvent, ExecutionNode } from '../core/types';

/**
 * String keys used in OrchestratorEvent.payload.metaInfo for harness-specific signals.
 * Defined here (source) and imported by TaskRunner (consumer) to keep the coupling explicit.
 */
export const HARNESS_META_KEYS = {
    TTY_OPEN:      'ttyOpen',
    TTY_DATA:      'ttyData',
    TTY_CLOSE:     'ttyClose',
    HITL_REQUEST:  'hitlRequest',
    HITL_RESOLVED: 'hitlResolved',
} as const;

/** Content accumulator returned by execute(). */
export interface HarnessAccumulator {
    output: string;
    thinking: string;
}

/**
 * Adapts a single harness run() call into a stream of OrchestratorEvents.
 *
 * Note: IAgentRuntime event subscriptions are global to the runtime instance,
 * not scoped to a session. This adapter subscribes immediately before run()
 * and unsubscribes after run() resolves, so events are captured correctly
 * for sequential (non-concurrent) harness sessions.
 */
export class HarnessAdapter {
    private skillService: ISkillService | null = null;
    private toolService: IToolService | null = null;

    constructor(private readonly runtime: IAgentRuntime) {}

    /**
     * 注入 SkillService（由 initHarnessAdapter 调用，可选）。
     *
     * 注入后 Shell 可通过 getSkillService() 访问，
     * 以支持 ChatInput 中的 Skill 选择面板。
     */
    setSkillService(service: ISkillService): void {
        this.skillService = service;
    }

    /** 获取 SkillService（harness 未配置时为 null） */
    getSkillService(): ISkillService | null {
        return this.skillService;
    }

    setToolService(service: IToolService): void {
        this.toolService = service;
    }

    getToolService(): IToolService | null {
        return this.toolService;
    }

    /**
     * Execute a harness task.
     *
     * @param request  Task request (prompt, workingDirectory, sessionId)
     * @param rootNode Root ExecutionNode already created by TaskRunner
     * @param onEvent  Callback for OrchestratorEvent (filtered by bound state)
     * @param signal   AbortSignal from TaskRunner's AbortController
     * @returns        Aggregated content + the final AgentTaskResult
     */
    async execute(
        request: AgentTaskRequest,
        rootNode: ExecutionNode,
        onEvent: (event: OrchestratorEvent) => void,
        signal: AbortSignal,
    ): Promise<{ accumulator: HarnessAccumulator; result: AgentTaskResult }> {
        const accumulator: HarnessAccumulator = { output: '', thinking: '' };

        // Track tool child nodes (callId → node id; callId is unique per invocation)
        const toolNodeIds = new Map<string, string>();

        // Abort on signal
        const onAbort = () => this.runtime.abort();
        signal.addEventListener('abort', onAbort);

        const unsubs: Array<() => void> = [];

        // ── LLM turn: no child node — content goes directly to root node ─
        // LLM child nodes are intentionally not created; they cluttered the UI
        // with "LLM (default) running" entries. The root assistant node (already
        // rendered with the correct agent name) is the only visible node for chat.
        unsubs.push(this.runtime.on('agent:llm:start', () => { /* no-op */ }));

        // ── Streaming content ────────────────────────────────────────────
        unsubs.push(this.runtime.on('agent:stream:content', (p) => {
            accumulator.output += p.delta;
            onEvent({
                type: 'node_update',
                payload: { nodeId: rootNode.id, field: 'output', chunk: p.delta },
            });
        }));

        unsubs.push(this.runtime.on('agent:stream:thinking', (p) => {
            accumulator.thinking += p.delta;
            onEvent({
                type: 'node_update',
                payload: { nodeId: rootNode.id, field: 'thought', chunk: p.delta },
            });
        }));

        unsubs.push(this.runtime.on('agent:llm:end', () => { /* no-op — no child node to close */ }));

        // ── Tool execution ───────────────────────────────────────────────
        unsubs.push(this.runtime.on('agent:tool:start', (p) => {
            const toolNodeId = `tool-${generateId()}`;
            toolNodeIds.set(p.callId, toolNodeId); // use callId, not toolId (parallel same-tool safety)
            const toolNode: ExecutionNode = {
                id: toolNodeId,
                parentId: rootNode.id,
                executorId: p.toolId,
                executorType: 'tool',
                name: p.toolId,
                status: 'running',
                startTime: Date.now(),
                data: { input: p.args },
            };
            onEvent({ type: 'node_start', payload: { parentId: rootNode.id, node: toolNode } });
        }));

        unsubs.push(this.runtime.on('agent:tool:success', (p) => {
            const nodeId = toolNodeIds.get(p.callId) ?? `tool-${p.callId}`;
            toolNodeIds.delete(p.callId);
            onEvent({
                type: 'node_update',
                payload: {
                    nodeId,
                    metaInfo: { toolResult: p.output, durationMs: p.durationMs },
                },
            });
            onEvent({ type: 'node_status', payload: { nodeId, status: 'success' } });
        }));

        unsubs.push(this.runtime.on('agent:tool:error', (p) => {
            const nodeId = toolNodeIds.get(p.callId) ?? `tool-${p.callId}`;
            toolNodeIds.delete(p.callId);
            onEvent({
                type: 'node_status',
                payload: { nodeId, status: 'failed', result: { error: p.error } },
            });
        }));

        unsubs.push(this.runtime.on('agent:tool:timeout', (p) => {
            const nodeId = toolNodeIds.get(p.callId) ?? `tool-${p.callId}`;
            toolNodeIds.delete(p.callId);
            onEvent({
                type: 'node_status',
                payload: { nodeId, status: 'failed', result: { error: `Timeout after ${p.timeoutMs}ms` } },
            });
        }));

        // ── Context compression ──────────────────────────────────────────
        unsubs.push(this.runtime.on('agent:context:compressed', (p) => {
            onEvent({
                type: 'node_update',
                payload: {
                    nodeId: rootNode.id,
                    metaInfo: {
                        compressed: {
                            layer: p.layer,
                            layerName: p.layerName,
                            savedTokens: p.beforeTokens - p.afterTokens,
                        },
                    },
                },
            });
        }));

        // ── Budget warnings ──────────────────────────────────────────────
        unsubs.push(this.runtime.on('agent:budget:warning', (p) => {
            onEvent({
                type: 'node_update',
                payload: {
                    nodeId: rootNode.id,
                    metaInfo: { budgetWarning: { resource: p.resource, usedRatio: p.usedRatio } },
                },
            });
        }));

        unsubs.push(this.runtime.on('agent:budget:exhausted', (p) => {
            onEvent({
                type: 'error',
                payload: {
                    message: `Budget exhausted: ${p.resource} (${p.used} / ${p.limit})`,
                    code: 'BUDGET_EXHAUSTED',
                },
            });
        }));

        // ── Skill loaded ─────────────────────────────────────────────────
        unsubs.push(this.runtime.on('agent:skill:loaded', (p) => {
            onEvent({
                type: 'node_update',
                payload: {
                    nodeId: rootNode.id,
                    metaInfo: { skillLoaded: { skillId: p.skillId, toolIds: p.toolIds } },
                },
            });
        }));

        // ── Back-pressure failed ─────────────────────────────────────────
        unsubs.push(this.runtime.on('agent:backpressure:failed', (p) => {
            onEvent({
                type: 'node_update',
                payload: {
                    nodeId: rootNode.id,
                    metaInfo: { backPressure: { ruleName: p.ruleName, errors: p.errors } },
                },
            });
        }));

        // ── TTY session events ────────────────────────────────────────────
        // Forward real-time TTY output so the UI can render a terminal widget.
        unsubs.push(this.runtime.on('agent:tty:open', (p) => {
            onEvent({
                type: 'node_update',
                payload: {
                    nodeId: rootNode.id,
                    metaInfo: { ttyOpen: { sessionId: p.sessionId, command: p.command, pid: p.pid } },
                },
            });
        }));

        unsubs.push(this.runtime.on('agent:tty:data', (p) => {
            onEvent({
                type: 'node_update',
                payload: {
                    nodeId:   rootNode.id,
                    // ttyData carries the raw chunk; the UI TtyPanel dispatches by sessionId
                    metaInfo: { ttyData: { sessionId: p.sessionId, chunk: p.chunk } },
                },
            });
        }));

        unsubs.push(this.runtime.on('agent:tty:close', (p) => {
            onEvent({
                type: 'node_update',
                payload: {
                    nodeId: rootNode.id,
                    metaInfo: { ttyClose: { sessionId: p.sessionId, exitCode: p.exitCode } },
                },
            });
        }));

        // Q1: Plan confirm — surface planned tool calls to the UI.
        unsubs.push(this.runtime.on('agent:plan:confirm', (p) => {
            onEvent({
                type: 'node_update',
                payload: {
                    nodeId: rootNode.id,
                    metaInfo: { planConfirm: { tools: p.plannedTools, turn: p.turn } },
                },
            });
        }));

        // Q3: User injection acknowledged — notify UI.
        unsubs.push(this.runtime.on('agent:user:injected', (p) => {
            onEvent({
                type: 'node_update',
                payload: {
                    nodeId: rootNode.id,
                    metaInfo: { userInjected: { message: p.message } },
                },
            });
        }));

        // ── HITL: human input requests ───────────────────────────────────
        unsubs.push(this.runtime.on('agent:human:input', (p) => {
            onEvent({
                type: 'node_update',
                payload: {
                    nodeId: rootNode.id,
                    metaInfo: { hitlRequest: { ...p } },
                },
            });
        }));

        unsubs.push(this.runtime.on('agent:human:resolved', (p) => {
            onEvent({
                type: 'node_update',
                payload: {
                    nodeId: rootNode.id,
                    metaInfo: { hitlResolved: { ...p } },
                },
            });
        }));

        try {
            const result = await this.runtime.run(request);
            return { accumulator, result };
        } finally {
            signal.removeEventListener('abort', onAbort);
            for (const unsub of unsubs) unsub();
        }
    }

    /**
     * Register a permission approval handler.
     *
     * The handler is called whenever the harness needs user confirmation
     * for a tool call (e.g. file_write). Returns true to allow, false to deny.
     *
     * Returns an unsubscribe function.
     */
    onPermissionRequest(
        handler: (payload: AgentEventPayloads['agent:permission:request']) => Promise<boolean>,
    ): () => void {
        return this.runtime.onIntercept('agent:permission:request', handler);
    }

    /** Expose runtime for plugins that need to subscribe to events. */
    getRuntime(): IAgentRuntime {
        return this.runtime;
    }
}

// ── Singleton ────────────────────────────────────────────────────────────────

let instance: HarnessAdapter | null = null;

export function initHarnessAdapter(runtime: IAgentRuntime): HarnessAdapter {
    instance = new HarnessAdapter(runtime);
    return instance;
}

export function getHarnessAdapter(): HarnessAdapter | null {
    return instance;
}

export function resetHarnessAdapter(): void {
    instance = null;
}

// ── HarnessStrategy — 将 HarnessAdapter 适配为 IAgentLoopStrategy ────────────

import type {
    IAgentLoopStrategy,
    AgentLoopRequest,
    AgentLoopResult,
    AgentLoopContext,
} from '../session/agent-loop-strategy';

/**
 * 将现有 HarnessAdapter（llm-harness / IAgentRuntime）包装为 IAgentLoopStrategy，
 * 使其与 ClaudeCodeStrategy 使用同一调用约定，由 TaskRunner.selectStrategy() 透明分发。
 */
export class HarnessStrategy implements IAgentLoopStrategy {
    constructor(private readonly adapter: HarnessAdapter) {}

    async run(request: AgentLoopRequest, ctx: AgentLoopContext): Promise<AgentLoopResult> {
        // 从 messages 末尾提取最后一条 user 文本作为 prompt
        const prompt = this.extractUserPrompt(request.messages);
        const { nodeId, sessionId, onEvent } = ctx;

        const harnessRequest: AgentTaskRequest = {
            prompt,
            sessionId,
            modelIdOverride: request.llmParams.model,
        };

        // 构造占位 rootNode 供 HarnessAdapter 填充事件的 nodeId
        const rootNode: ExecutionNode = {
            id: nodeId,
            executorId: 'harness',
            executorType: 'agent',
            name: 'Agent',
            status: 'running',
            startTime: Date.now(),
            parentId: undefined,
            data: {},
        };

        const { result } = await this.adapter.execute(
            harnessRequest,
            rootNode,
            onEvent,
            request.signal ?? new AbortController().signal,
        );

        return {
            output: result.response ?? '',
            turns: [],  // HarnessAdapter 不暴露 turn 级别细节
            totalUsage: {
                inputTokens:       result.usage?.inputTokens  ?? 0,
                outputTokens:      result.usage?.outputTokens ?? 0,
                costUsd:           result.usage?.costUsd      ?? 0,
                contextUsageRatio: 0,
                turns:             result.usage?.turns        ?? 0,
                durationMs:        result.usage?.elapsedMs    ?? 0,
                isEstimated:       false,
            },
        };
    }

    private extractUserPrompt(messages: AgentLoopRequest['messages']): string {
        for (let i = messages.length - 1; i >= 0; i--) {
            const msg = messages[i];
            if (msg.role !== 'user') continue;
            if (typeof msg.content === 'string') return msg.content;
            if (Array.isArray(msg.content)) {
                const texts = (msg.content as any[])
                    .filter((b: any) => b.type === 'text')
                    .map((b: any) => b.text as string);
                if (texts.length > 0) return texts.join('\n');
            }
        }
        return '';
    }
}

