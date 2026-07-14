// @file: llm-engine/session/agent-loop-strategy.ts
//
// Tool executor interface — used by LiteSubAgentRouter and adapters.
//
// Note: IAgentLoopStrategy / UnifiedLoopStrategy were deleted in S11.
// Agent loop execution now goes through ILoop + LoopExecutor (executors/).

// ─── 工具执行器接口 ────────────────────────────────────────────────────────────

export interface IToolExecutor {
    execute(name: string, input: Record<string, unknown>): Promise<string>;
    /** Optional: return tool metadata for permission gating and parallel scheduling */
    getMeta?(name: string): { sideEffect: 'none' | 'local' | 'external' } | undefined;
}

/** 空实现：工具未配置时的 fallback */
export const nullToolExecutor: IToolExecutor = {
    execute: async (name: string) =>
        `[Tool "${name}" is not available in this session]`,
};
