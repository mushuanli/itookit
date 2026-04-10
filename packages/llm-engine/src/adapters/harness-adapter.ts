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
    AgentTaskRequest,
    AgentTaskResult,
    AgentEventPayloads,
} from '@itookit/common';
import { generateId } from '@itookit/common';
import type { OrchestratorEvent, ExecutionNode } from '../core/types';

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

        // Track child nodes (per-LLM-turn, per-tool)
        let currentLLMNodeId: string | null = null;
        // Key: callId (unique per invocation), not toolId (non-unique for parallel same-tool calls)
        const toolNodeIds = new Map<string, string>(); // callId → node id

        // Abort on signal
        const onAbort = () => this.runtime.abort();
        signal.addEventListener('abort', onAbort);

        const unsubs: Array<() => void> = [];

        // ── LLM turn start ──────────────────────────────────────────────
        unsubs.push(this.runtime.on('agent:llm:start', (p) => {
            currentLLMNodeId = `llm-${generateId()}`;
            const llmNode: ExecutionNode = {
                id: currentLLMNodeId,
                parentId: rootNode.id,
                executorId: p.model,
                executorType: 'agent',
                name: `LLM (${p.model})`,
                status: 'running',
                startTime: Date.now(),
                data: {},
            };
            onEvent({ type: 'node_start', payload: { parentId: rootNode.id, node: llmNode } });
        }));

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

        // ── LLM turn end ─────────────────────────────────────────────────
        unsubs.push(this.runtime.on('agent:llm:end', () => {
            if (currentLLMNodeId) {
                onEvent({
                    type: 'node_status',
                    payload: { nodeId: currentLLMNodeId, status: 'success' },
                });
                currentLLMNodeId = null;
            }
        }));

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
