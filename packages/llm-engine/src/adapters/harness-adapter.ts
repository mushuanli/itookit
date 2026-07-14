// @file: llm-engine/adapters/harness-adapter.ts
//
// 将 IAgentRuntime 的事件模型桥接到 SessionEvent 流。
//
// S7: onEvent 已从 OrchestratorEvent 切换为 SessionEvent。
// 内部将 agent 事件翻译为 message:updated / message:status / message:appended。

import type {
    IAgentRuntime,
    ISkillService,
    IToolService,
    AgentTaskRequest,
    AgentTaskResult,
    AgentEventPayloads,
} from '@itookit/common';
import { generateId } from '@itookit/common';
import type { SessionEvent, ExecutionNode } from '../core/types';
import { setHarnessContext, getHarnessContext } from '../core/harness-context';

/**
 * String keys used in message:updated payload.metaInfo for harness-specific signals.
 * Defined here (source) and imported by UI layer (consumer) to keep the coupling explicit.
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
 * Adapts a single harness run() call into a stream of SessionEvents.
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
        // S6c: sync to harness context
        const ctx = getHarnessContext();
        if (ctx) (ctx as any).skillService = service;
    }

    /** 获取 SkillService（harness 未配置时为 null） */
    getSkillService(): ISkillService | null {
        return this.skillService;
    }

    setToolService(service: IToolService): void {
        this.toolService = service;
        // S6c: sync to harness context
        const ctx = getHarnessContext();
        if (ctx) (ctx as any).toolService = service;
    }

    getToolService(): IToolService | null {
        return this.toolService;
    }

    /**
     * Execute a harness task.
     *
     * @param request  Task request (prompt, workingDirectory, sessionId)
     * @param rootNode Root ExecutionNode already created by TaskRunner
     * @param onEvent  Callback for SessionEvent (filtered by bound state)
     * @param signal   AbortSignal from TaskRunner's AbortController
     * @returns        Aggregated content + the final AgentTaskResult
     */
    async execute(
        request: AgentTaskRequest,
        rootNode: ExecutionNode,
        onEvent: (event: SessionEvent) => void,
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
                type: 'message:updated',
                payload: { messageId: rootNode.id, field: 'output', delta: p.delta },
            } as SessionEvent);
        }));

        unsubs.push(this.runtime.on('agent:stream:thinking', (p) => {
            accumulator.thinking += p.delta;
            onEvent({
                type: 'message:updated',
                payload: { messageId: rootNode.id, field: 'thought', delta: p.delta },
            } as SessionEvent);
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
            onEvent({
                type: 'message:appended',
                payload: { sessionGroup: toolNode as any, isExecutionRoot: true, parentId: rootNode.id },
            } as SessionEvent);
        }));

        unsubs.push(this.runtime.on('agent:tool:success', (p) => {
            const nodeId = toolNodeIds.get(p.callId) ?? `tool-${p.callId}`;
            toolNodeIds.delete(p.callId);
            onEvent({
                type: 'message:updated',
                payload: {
                    messageId: nodeId,
                    metaInfo: { toolResult: p.output, durationMs: p.durationMs },
                },
            } as SessionEvent);
            onEvent({
                type: 'message:status',
                payload: { messageId: nodeId, status: 'success' },
            } as SessionEvent);
        }));

        unsubs.push(this.runtime.on('agent:tool:error', (p) => {
            const nodeId = toolNodeIds.get(p.callId) ?? `tool-${p.callId}`;
            toolNodeIds.delete(p.callId);
            onEvent({
                type: 'message:status',
                payload: { messageId: nodeId, status: 'failed', result: { error: p.error } },
            } as SessionEvent);
        }));

        unsubs.push(this.runtime.on('agent:tool:timeout', (p) => {
            const nodeId = toolNodeIds.get(p.callId) ?? `tool-${p.callId}`;
            toolNodeIds.delete(p.callId);
            onEvent({
                type: 'message:status',
                payload: { messageId: nodeId, status: 'failed', result: { error: `Timeout after ${p.timeoutMs}ms` } },
            } as SessionEvent);
        }));

        // ── Context compression ──────────────────────────────────────────
        unsubs.push(this.runtime.on('agent:context:compressed', (p) => {
            onEvent({
                type: 'message:updated',
                payload: {
                    messageId: rootNode.id,
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
                type: 'message:updated',
                payload: {
                    messageId: rootNode.id,
                    metaInfo: { budgetWarning: { resource: p.resource, usedRatio: p.usedRatio } },
                },
            });
        }));

        unsubs.push(this.runtime.on('agent:budget:exhausted', (p) => {
            onEvent({
                type: 'error',
                error: {
                    message: `Budget exhausted: ${p.resource} (${p.used} / ${p.limit})`,
                    code: 'BUDGET_EXHAUSTED',
                },
            } as SessionEvent);
        }));

        // ── Skill loaded ─────────────────────────────────────────────────
        unsubs.push(this.runtime.on('agent:skill:loaded', (p) => {
            onEvent({
                type: 'message:updated',
                payload: {
                    messageId: rootNode.id,
                    metaInfo: { skillLoaded: { skillId: p.skillId, toolIds: p.toolIds } },
                },
            });
        }));

        // ── Back-pressure failed ─────────────────────────────────────────
        unsubs.push(this.runtime.on('agent:backpressure:failed', (p) => {
            onEvent({
                type: 'message:updated',
                payload: {
                    messageId: rootNode.id,
                    metaInfo: { backPressure: { ruleName: p.ruleName, errors: p.errors } },
                },
            });
        }));

        // ── TTY session events ────────────────────────────────────────────
        // Forward real-time TTY output so the UI can render a terminal widget.
        unsubs.push(this.runtime.on('agent:tty:open', (p) => {
            onEvent({
                type: 'message:updated',
                payload: {
                    messageId: rootNode.id,
                    metaInfo: { ttyOpen: { sessionId: p.sessionId, command: p.command, pid: p.pid } },
                },
            });
        }));

        unsubs.push(this.runtime.on('agent:tty:data', (p) => {
            onEvent({
                type: 'message:updated',
                payload: {
                    messageId: rootNode.id,
                    // ttyData carries the raw chunk; the UI TtyPanel dispatches by sessionId
                    metaInfo: { ttyData: { sessionId: p.sessionId, chunk: p.chunk } },
                },
            });
        }));

        unsubs.push(this.runtime.on('agent:tty:close', (p) => {
            onEvent({
                type: 'message:updated',
                payload: {
                    messageId: rootNode.id,
                    metaInfo: { ttyClose: { sessionId: p.sessionId, exitCode: p.exitCode } },
                },
            });
        }));

        // Q1: Plan confirm — surface planned tool calls to the UI.
        unsubs.push(this.runtime.on('agent:plan:confirm', (p) => {
            onEvent({
                type: 'message:updated',
                payload: {
                    messageId: rootNode.id,
                    metaInfo: { planConfirm: { tools: p.plannedTools, turn: p.turn } },
                },
            });
        }));

        // Q3: User injection acknowledged — notify UI.
        unsubs.push(this.runtime.on('agent:user:injected', (p) => {
            onEvent({
                type: 'message:updated',
                payload: {
                    messageId: rootNode.id,
                    metaInfo: { userInjected: { message: p.message } },
                },
            });
        }));

        // ── HITL: human input requests ───────────────────────────────────
        unsubs.push(this.runtime.on('agent:human:input', (p) => {
            onEvent({
                type: 'message:updated',
                payload: {
                    messageId: rootNode.id,
                    metaInfo: { hitlRequest: { ...p } },
                },
            });
        }));

        unsubs.push(this.runtime.on('agent:human:resolved', (p) => {
            onEvent({
                type: 'message:updated',
                payload: {
                    messageId: rootNode.id,
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
    // S6c: Also set the harness context for UI service locator access
    setHarnessContext({
        runtime,
        skillService: instance.getSkillService(),
        toolService: instance.getToolService(),
    });
    return instance;
}

export function resetHarnessAdapter(): void {
    instance = null;
}

