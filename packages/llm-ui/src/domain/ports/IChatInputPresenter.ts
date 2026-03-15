// @file: llm-ui/domain/ports/IChatInputPresenter.ts

export interface IChatInputConfig {
    text: string;
    agentId: string;
    settings?: any;
}

/**
 * ChatInput 的能力接口
 * 
 * Command 层只依赖此接口，不知道 ChatInput 的 DOM 实现。
 */
export interface IChatInputPresenter {
    setLoading(loading: boolean): void;
    setConfig(config: Partial<IChatInputConfig>): void;
    getConfig(): IChatInputConfig;
    restoreInput(text: string, agentId?: string): void;
    focus(): void;
    refreshAgents(
        agents: Array<{ id: string; name: string; icon?: string; category?: string }>,
        validateAgentId: (id: string, agents: any[]) => string
    ): boolean;
    destroy(): void;
}
