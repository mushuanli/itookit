// @file: llm-harness/src/executor/agent-loop-executor.ts
// Agent loop executor — the system's core.
//
// LOOP invariant (each iteration):
//   1. Budget Check
//   2. Context Compress
//   3. Build system message + messages
//   4. LLM Call (with error recovery)
//   5. updateUsage (once per iteration)
//   6. Parse Response
//      ├─ Has tool_calls → Permission Check → Execute → BackPressure (after-tool) → Feed back → GOTO 1
//      └─ No tool_calls  → BackPressure (before-final) → Pass: exit / Fail: inject → GOTO 1

import { generateId } from '@itookit/common';
import type {
    IAgentRuntime,
    AgentTaskRequest,
    AgentTaskResult,
    AgentStatus,
    AgentSessionInfo,
    AgentEventType,
    AgentEventPayloads,
    AgentUsageSnapshot,
    ILLMService,
    IToolService,
    ISkillService,
    ISubAgentRouter,
    AgentModelRoles,
    AgentLoopConfig,
    AgentBudgetLimits,
    ChatMessage,
    ToolCall,
    TokenUsage,
} from '@itookit/common';
import { BudgetExhaustedError } from '@itookit/common';
import { BudgetController } from './budget-controller';
import { ErrorRecoveryService } from './error-recovery';
import { BackPressureValidator } from './back-pressure';
import { ContextManager } from './context-manager';
import { getToolName, getToolArgs } from '../utils/tool-call';

type NotifyHandler<E extends AgentEventType> = (payload: AgentEventPayloads[E]) => void;
type InterceptHandler<E extends AgentEventType> = (payload: AgentEventPayloads[E]) => Promise<boolean | string | undefined>;

const EMPTY_USAGE: TokenUsage = {};
const MAX_SESSIONS = 20;

interface SessionState {
    sessionId: string;
    task: AgentTaskRequest;
    status: AgentStatus;
    usage: AgentUsageSnapshot;
    createdAt: number;
}

export class AgentLoopExecutor implements IAgentRuntime {
    private sessions = new Map<string, SessionState>();
    private currentSessionId: string | null = null;
    private abortController: AbortController | null = null;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private notifyHandlers = new Map<AgentEventType, NotifyHandler<any>[]>();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private interceptHandlers = new Map<AgentEventType, InterceptHandler<any>[]>();

    private readonly contextManager: ContextManager;
    private readonly subAgentRouter: ISubAgentRouter;

    constructor(
        private readonly llm: ILLMService,
        private readonly toolService: IToolService,
        private readonly skillService: ISkillService,
        private readonly modelRoles: AgentModelRoles,
        private readonly loopConfig: AgentLoopConfig,
        private readonly budgetLimits: AgentBudgetLimits,
        subAgentRouter: ISubAgentRouter,
        maxContextTokens = 200_000,
        private readonly costModel?: { perInputToken: number; perOutputToken: number },
    ) {
        this.contextManager = new ContextManager(
            llm,
            skillService,
            maxContextTokens,
            loopConfig.systemPromptBudgetTokens,
            modelRoles.summarizer,
        );
        this.subAgentRouter = subAgentRouter;
    }

    // ── IAgentRuntime ──

    async run(task: AgentTaskRequest): Promise<AgentTaskResult> {
        const sessionId = task.sessionId ?? `sess_${generateId()}`;
        this.currentSessionId = sessionId;
        this.abortController = new AbortController();

        const effectiveLimits = task.budgetOverride
            ? { ...this.budgetLimits, ...task.budgetOverride }
            : this.budgetLimits;

        const budgetController = new BudgetController(effectiveLimits, this.costModel);
        const usage = budgetController.createSnapshot();
        const primaryConn = task.modelOverride ?? this.modelRoles.primary;
        const recovery = new ErrorRecoveryService(this.llm, primaryConn);
        const backPressure = new BackPressureValidator(this.loopConfig.backPressureRules);
        const cwd = task.workingDirectory ?? (typeof process !== 'undefined' ? process.cwd() : '/');

        this.contextManager.initSession(sessionId, cwd, '');
        // Auto-detect and pre-load skills matching the task prompt.
        this.contextManager.autoDetectAndLoadSkills(sessionId, task.prompt);

        const state: SessionState = { sessionId, task, status: 'running', usage, createdAt: Date.now() };
        this.sessions.set(sessionId, state);
        this.trimOldSessions();

        this.emit('agent:task:start', { task });
        this.contextManager.addMessage(sessionId, { role: 'user', content: task.prompt });

        let finalResponse = '';
        let incompleteReason: string | undefined;

        try {
            // ── Main Agent Loop ──
            // eslint-disable-next-line no-constant-condition
            while (true) {
                // 1. Budget Check
                budgetController.checkOrThrow(usage);
                for (const resource of budgetController.getApproachingLimits(usage)) {
                    this.emit('agent:budget:warning', {
                        resource,
                        usedRatio: budgetController.getUsedRatios(usage)[resource] ?? 0,
                    });
                }

                // 2. Context Compress
                const usageRatio = this.contextManager.getContextUsageRatio(sessionId);
                if (usageRatio >= this.loopConfig.compressionThreshold) {
                    const info = await this.contextManager.maybeCompress(sessionId, usageRatio);
                    if (info) this.emit('agent:context:compressed', info);
                }

                // 3. Build prompt + messages
                const systemPrompt = this.contextManager.buildSystemPrompt(sessionId);
                const messages: ChatMessage[] = [
                    { role: 'system', content: systemPrompt },
                    ...this.contextManager.buildMessages(sessionId),
                ];

                // 4. LLM Call
                this.emit('agent:llm:start', { model: recovery.getCurrentConnectionId(), messageCount: messages.length });
                const toolDefs = this.toolService.getToolDefinitions();
                const response = await recovery.callWithRecovery(
                    recovery.getCurrentConnectionId(),
                    { messages, tools: toolDefs, signal: this.abortController.signal },
                    {
                        maxRetries: this.loopConfig.maxApiRetries,
                        baseDelayMs: this.loopConfig.baseRetryDelayMs,
                        maxTruncationRetries: this.loopConfig.maxTruncationRetries,
                        fallbackConnectionId: this.modelRoles.fallback,
                        onCompressionNeeded: async () => {
                            const info = await this.contextManager.forceCompress(sessionId);
                            this.emit('agent:context:compressed', info);
                        },
                        onRetry: (attempt, reason, delayMs) =>
                            this.emit('agent:llm:retry', { attempt, reason, delayMs }),
                        onFallback: (from, to, reason) =>
                            this.emit('agent:llm:fallback', { from, to, reason }),
                    },
                );

                const tokenUsage = response.usage ?? EMPTY_USAGE;
                const assistantMsg = response.choices[0]?.message;
                const responseText = assistantMsg?.content ?? '';
                const toolCalls: ToolCall[] = assistantMsg?.tool_calls ?? [];

                this.contextManager.addMessage(sessionId, {
                    role: 'assistant',
                    content: responseText,
                    tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
                });

                this.emit('agent:llm:end', {
                    model: recovery.getCurrentConnectionId(),
                    usage: tokenUsage,
                    stopReason: String(response.choices[0]?.finish_reason ?? 'end_turn'),
                });

                // 5. Update usage — ONCE per loop iteration with total tool count.
                budgetController.updateUsage(usage, tokenUsage, toolCalls.length);

                // 6. Branch
                if (toolCalls.length > 0) {
                    const toolMessages = await this.executeTools(toolCalls, cwd, sessionId);
                    for (const msg of toolMessages) {
                        this.contextManager.addMessage(sessionId, msg);
                    }

                    // Back-pressure after tool execution.
                    if (this.loopConfig.enableBackPressure) {
                        const injected = await this.runAfterToolBackPressure(toolCalls, cwd, sessionId, backPressure);
                        if (injected) continue; // LLM needs to see the validation failure
                    }

                    this.emit('agent:step:complete', {
                        step: {
                            type: 'tool_execution',
                            toolCalls: toolCalls.map((c) => ({
                                id: c.id,
                                name: getToolName(c),
                                arguments: getToolArgs(c),
                            })),
                            toolResults: toolMessages.map((r) => ({
                                callId: r.tool_call_id ?? '',
                                output: typeof r.content === 'string' ? r.content : '',
                                isError: false,
                            })),
                            timestamp: Date.now(),
                        },
                    });
                } else {
                    // No tool calls → BackPressure before final
                    if (this.loopConfig.enableBackPressure) {
                        const bpResult = await backPressure.checkBeforeFinal(cwd);
                        if (bpResult && !bpResult.passed) {
                            const payload = { ruleName: bpResult.ruleName, errors: bpResult.errorMessage };
                            this.emit('agent:backpressure:failed', payload);
                            // Allow intercept handlers to override the injected correction message.
                            const correction = await this.callInterceptors('agent:backpressure:failed', payload);
                            const message = typeof correction === 'string'
                                ? correction
                                : `Validation check "${bpResult.ruleName}" failed:\n${bpResult.errorMessage}\n\nPlease fix the issues and try again.`;
                            this.contextManager.addMessage(sessionId, { role: 'user', content: message });
                            continue;
                        }
                    }
                    finalResponse = responseText;
                    break;
                }
            }

            state.status = 'completed';
        } catch (err: unknown) {
            if (err instanceof BudgetExhaustedError) {
                this.emit('agent:budget:exhausted', { resource: err.resource, used: err.used, limit: err.limit });
                state.status = 'partial';
                incompleteReason = `Budget exhausted: ${err.resource}`;
            } else if (this.abortController?.signal.aborted) {
                state.status = 'cancelled';
                incompleteReason = 'Cancelled by user';
            } else {
                state.status = 'failed';
                incompleteReason = err instanceof Error ? err.message : String(err);
            }
        }

        const result: AgentTaskResult = {
            sessionId,
            status: state.status,
            response: finalResponse,
            usage,
            turns: usage.turns,
            incompleteReason,
        };
        this.emit('agent:task:end', { result });
        this.currentSessionId = null;
        return result;
    }

    abort(): void {
        this.abortController?.abort();
        this.subAgentRouter.abort();
    }

    on<E extends AgentEventType>(event: E, handler: NotifyHandler<E>): () => void {
        if (!this.notifyHandlers.has(event)) this.notifyHandlers.set(event, []);
        this.notifyHandlers.get(event)!.push(handler);
        return () => {
            const arr = this.notifyHandlers.get(event)!;
            arr.splice(arr.indexOf(handler), 1);
        };
    }

    onIntercept<E extends AgentEventType>(event: E, handler: InterceptHandler<E>): () => void {
        if (!this.interceptHandlers.has(event)) this.interceptHandlers.set(event, []);
        this.interceptHandlers.get(event)!.push(handler);
        return () => {
            const arr = this.interceptHandlers.get(event)!;
            arr.splice(arr.indexOf(handler), 1);
        };
    }

    getCurrentSession(): AgentSessionInfo | null {
        if (!this.currentSessionId) return null;
        return this.buildSessionInfo(this.currentSessionId);
    }

    listRecentSessions(limit = 10): AgentSessionInfo[] {
        return [...this.sessions.values()]
            .sort((a, b) => b.createdAt - a.createdAt)
            .slice(0, limit)
            .map((s) => this.buildSessionInfo(s.sessionId));
    }

    async resumeSession(sessionId: string): Promise<AgentTaskResult> {
        const state = this.sessions.get(sessionId);
        if (!state) throw new Error(`Session not found: ${sessionId}`);
        return this.run({ ...state.task, sessionId });
    }

    deleteSession(sessionId: string): void {
        this.sessions.delete(sessionId);
    }

    // ── Private: tool execution ──

    private async executeTools(
        toolCalls: ToolCall[],
        cwd: string,
        sessionId: string,
    ): Promise<ChatMessage[]> {
        const reads  = toolCalls.filter((c) => this.toolService.getToolMeta(getToolName(c))?.sideEffect === 'none');
        const writes = toolCalls.filter((c) => this.toolService.getToolMeta(getToolName(c))?.sideEffect !== 'none');

        const results: ChatMessage[] = [];

        // Reads in parallel
        const readResults = await Promise.all(reads.map(async (call) => {
            const name = getToolName(call);
            const args = getToolArgs(call);
            this.emit('agent:tool:start', { toolId: name, callId: call.id, args });
            const t0 = Date.now();
            const result = await this.toolService.invoke({ toolId: name, args, cwd });
            this.emit('agent:tool:success', { toolId: name, callId: call.id, output: result.output, durationMs: Date.now() - t0 });

            // Post-process skill-loader tools (identified via ToolMeta.skillLoaderArgKey,
            // not by hardcoded tool name — avoids OCP violation).
            const meta = this.toolService.getToolMeta(name);
            if (result.success && meta?.skillLoaderArgKey) {
                const skillId = args[meta.skillLoaderArgKey] as string | undefined;
                if (skillId) {
                    this.contextManager.markSkillLoaded(sessionId, skillId);
                    const skill = this.skillService.getSkill(skillId);
                    const toolIds = skill?.tools.map((t) => t.toolId) ?? [];
                    this.emit('agent:skill:loaded', { skillId, toolIds });
                }
            }

            return this.makeToolResult(call.id, result.output);
        }));
        results.push(...readResults);

        // Writes serially (permission-gated)
        for (const call of writes) {
            const name = getToolName(call);
            const args = getToolArgs(call);
            const allowed = await this.checkPermission(call);
            if (!allowed) {
                results.push(this.makeToolResult(call.id, `Permission denied for tool: ${name}`));
                continue;
            }

            this.emit('agent:tool:start', { toolId: name, callId: call.id, args });
            const t0 = Date.now();
            const result = await this.toolService.invoke({ toolId: name, args, cwd });
            this.emit('agent:tool:success', { toolId: name, callId: call.id, output: result.output, durationMs: Date.now() - t0 });
            results.push(this.makeToolResult(call.id, result.output));
        }

        return results;
    }

    /**
     * Runs after-tool back-pressure rules for all tools executed in this turn.
     * Returns true if a failure was injected into context (loop should continue).
     */
    private async runAfterToolBackPressure(
        toolCalls: ToolCall[],
        cwd: string,
        sessionId: string,
        backPressure: BackPressureValidator,
    ): Promise<boolean> {
        const executedNames = [...new Set(toolCalls.map(getToolName))];
        for (const toolName of executedNames) {
            const bp = await backPressure.checkAfterTool(toolName, cwd);
            if (bp && !bp.passed) {
                const payload = { ruleName: bp.ruleName, errors: bp.errorMessage };
                this.emit('agent:backpressure:failed', payload);
                this.contextManager.addMessage(sessionId, {
                    role: 'user',
                    content: `Validation check "${bp.ruleName}" failed after ${toolName}:\n${bp.errorMessage}\n\nPlease fix the issues.`,
                });
                return true; // stop after first failure; LLM will fix and re-run
            }
        }
        return false;
    }

    private async checkPermission(call: ToolCall): Promise<boolean> {
        const handlers = this.interceptHandlers.get('agent:permission:request');
        if (!handlers || handlers.length === 0) return true;
        for (const handler of handlers) {
            const result = await handler({ toolId: getToolName(call), args: getToolArgs(call) });
            if (result === false) return false;
            if (result === true) return true;
        }
        return true;
    }

    /** Calls intercept handlers and returns the first non-undefined result. */
    private async callInterceptors<E extends AgentEventType>(
        event: E,
        payload: AgentEventPayloads[E],
    ): Promise<boolean | string | undefined> {
        const handlers = this.interceptHandlers.get(event);
        if (!handlers) return undefined;
        for (const handler of handlers) {
            const result = await handler(payload);
            if (result !== undefined) return result;
        }
        return undefined;
    }

    private makeToolResult(callId: string, output: string): ChatMessage {
        return { role: 'tool', content: output, tool_call_id: callId };
    }

    private emit<E extends AgentEventType>(event: E, payload: AgentEventPayloads[E]): void {
        for (const h of this.notifyHandlers.get(event) ?? []) h(payload);
    }

    /** Evict oldest completed/failed sessions to keep the map bounded. */
    private trimOldSessions(): void {
        if (this.sessions.size <= MAX_SESSIONS) return;
        const sorted = [...this.sessions.entries()]
            .filter(([, s]) => s.status !== 'running')
            .sort((a, b) => a[1].createdAt - b[1].createdAt);
        const toDelete = sorted.slice(0, this.sessions.size - MAX_SESSIONS);
        for (const [id] of toDelete) {
            this.sessions.delete(id);
        }
    }

    private buildSessionInfo(sessionId: string): AgentSessionInfo {
        const s = this.sessions.get(sessionId)!;
        return {
            sessionId,
            status: s.status,
            turns: s.usage.turns,
            usage: s.usage,
            loadedSkills: this.contextManager.getLoadedSkillIds(sessionId),
            isCompressed: this.contextManager.isSessionCompressed(sessionId),
            createdAt: s.createdAt,
            taskPreview: s.task.prompt.slice(0, 80),
        };
    }
}
