// @file: llm-engine/mission/lite-sub-agent-router.ts
//
// LiteSubAgentRouter — ILoop-based ISubAgentRouter implementation.
//
// Uses LoopExecutor (ILoop) internally instead of UnifiedLoopStrategy.
// The delegate() method creates a minimal LoopContext and drives the
// AsyncGenerator to completion manually (no HITL pause/resume for sub-agents).

import type {
    ISubAgentRouter,
    SubAgentTask,
    SubAgentResult,
    ChatMessage,
    ILLMService,
    ILoop,
    LoopContext,
    ILog,
    IToolService,
    Turn,
    Ref,
} from '@itookit/common';
import type { IToolExecutor } from '../session/agent-loop-strategy';
import { nullToolExecutor } from '../session/agent-loop-strategy';
import { createLoopExecutor } from '../executors/loop-presets';
import type { LoopPresetConfig } from '../executors/loop-presets';

// ─── No-op Log/RefStore/DraftArea for sub-agent context ─────────────

const noopRefStore = {
    create: () => '' as Ref,
    move: () => {},
    tag: () => {},
    delete: () => {},
    list: () => [] as Ref[],
};

const noopDraftArea = {
    checkpoint: async () => {},
    flush: async () => {},
    current: () => null,
    restore: async () => null,
    setCurrent: () => {},
};

function createInMemoryLog(initialMessages: ChatMessage[]): ILog {
    let messageLog: ChatMessage[] = [...initialMessages];

    return {
        fold: async () => [...messageLog],
        append: async (_ref, turn) => {
            // turn.payload is the full conversation state after this turn
            messageLog.length = 0;
            messageLog.push(...turn.payload);
            return turn.id;
        },
        refs: () => noopRefStore,
        draft: () => noopDraftArea,
        merge: async () => '' as Ref,
        rebase: async () => '' as Ref,
    };
}

// ─── IToolExecutor → IToolService adapter ───────────────────────────

function createToolServiceAdapter(
    executor: IToolExecutor,
    allowedTools?: string[],
): IToolService {
    const allowed = allowedTools ? new Set(allowedTools) : null;

    return {
        listTools: () => [],
        getToolMeta: (id) => {
            const meta = executor.getMeta?.(id);
            if (!meta) return undefined;
            return {
                id,
                name: id,
                description: '',
                sideEffect: meta.sideEffect,
                timeoutMs: 30000,
                type: 'builtin' as const,
                enabled: true,
            };
        },
        getToolDefinitions: () => [],
        invoke: async (request) => {
            if (allowed && !allowed.has(request.toolId)) {
                return {
                    toolId: request.toolId,
                    success: false,
                    output: `Tool "${request.toolId}" is not allowed for this sub-agent`,
                    durationMs: 0,
                };
            }
            try {
                const output = await executor.execute(request.toolId, request.args);
                return { toolId: request.toolId, success: true, output, durationMs: 0 };
            } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                return { toolId: request.toolId, success: false, output: msg, durationMs: 0 };
            }
        },
        invokeBatch: async (requests) => {
            const results = await Promise.all(requests.map(r => ({
                toolId: r.toolId,
                success: true as const,
                output: '',
                durationMs: 0,
            })));
            return { results, totalDurationMs: 0 };
        },
        registerTool: () => {},
        unregisterTool: () => {},
    };
}

// ─── LiteSubAgentRouter ─────────────────────────────────────────────

export class LiteSubAgentRouter implements ISubAgentRouter {
    private activeAbortController: AbortController | null = null;

    constructor(
        private readonly llmService: ILLMService,
        private readonly toolExecutor: IToolExecutor = nullToolExecutor,
        private readonly loopFactory: (config?: LoopPresetConfig) => ILoop = (config) =>
            createLoopExecutor('lite', {
                budget: { maxTurns: config?.budget?.maxTurns ?? 10 },
            }),
    ) {}

    async delegate(task: SubAgentTask): Promise<SubAgentResult> {
        this.activeAbortController = new AbortController();
        const signal = this.activeAbortController.signal;

        try {
            const systemPrompt = task.systemPrompt
                ?? 'You are a sub-agent. Complete the task precisely. Return a concise summary of your findings. Do NOT ask follow-up questions.';

            const initialMessages: ChatMessage[] = [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: task.instruction },
            ];

            // Create LoopExecutor via factory
            const executor = this.loopFactory({
                budget: { maxTurns: task.maxTurns ?? 10 },
            });

            // Wrap ILLMService to override connection/model for sub-agent
            const llmAdapter: ILLMService = {
                ...this.llmService,
                chatStream: (connectionId, params) =>
                    this.llmService.chatStream(
                        task.connectionId ?? connectionId,
                        { ...params, model: task.modelName ?? (params as any).model },
                    ),
            };

            // Build tool service from executor
            const tools = createToolServiceAdapter(
                this.toolExecutor,
                task.allowedTools,
            );

            // In-memory log that tracks message state across turns
            const log = createInMemoryLog(initialMessages);

            const ctx: LoopContext = {
                sessionId: `subagent-${Date.now()}`,
                ref: 'main',
                log,
                llm: llmAdapter,
                tools,
                middlewares: [],
                signal,
            };

            // Manually drive the AsyncGenerator to completion.
            // Sub-agents use lite preset (no HITL), so await_signal should
            // never occur. If it does, treat as an error.
            const gen = executor.run(ctx);
            let genResult = await gen.next();

            while (!genResult.done) {
                const ev = genResult.value;
                if (ev.type === 'await_signal') {
                    return {
                        success: false,
                        summary: '',
                        turns: 0,
                        tokenUsage: { input: 0, output: 0 },
                        error: 'HITL pause not supported in sub-agent execution',
                    };
                }
                genResult = await gen.next();
            }

            const turns: Turn[] = genResult.value;
            const lastTurn = turns[turns.length - 1];
            const usage = lastTurn?.result?.usage ?? lastTurn?.meta?.usage;

            const summary = lastTurn?.payload
                ?.filter(m => m.role === 'assistant')
                ?.map(m => m.content)
                ?.filter(Boolean)
                ?.join('\n') ?? '';

            return {
                success: true,
                summary,
                turns: turns.length,
                tokenUsage: {
                    input: (usage as any)?.inputTokens ?? 0,
                    output: (usage as any)?.outputTokens ?? 0,
                },
            };
        } catch (e: any) {
            return {
                success: false,
                summary: '',
                turns: 0,
                tokenUsage: { input: 0, output: 0 },
                error: e?.message ?? String(e),
            };
        } finally {
            this.activeAbortController = null;
        }
    }

    abort(): void {
        this.activeAbortController?.abort();
    }
}
