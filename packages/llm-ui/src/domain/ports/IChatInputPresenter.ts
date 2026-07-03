// @file: llm-ui/domain/ports/IChatInputPresenter.ts

import type { ExecutorOption, SkillInfo, TokenStats } from '../types';

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
    refreshAgents(agents: ExecutorOption[], validateAgentId: (id: string) => string): boolean;

    /** 重新拉取连接列表（import/save connection 后由 Shell 调用）。 */
    refreshConnections(): Promise<void>;

    /**
     * 更新 token 用量统计显示。
     *
     * 每次任务完成（`finished` 事件）后由 Shell 调用：
     * - 普通模式：字符数估算（isEstimated=true）
     * - harness 模式：AgentUsageSnapshot 精确值（isEstimated=false）
     *
     * 传 `null` 时重置为初始状态（新会话时调用）。
     */
    updateTokenStats(stats: TokenStats | null): void;

    /**
     * 显示内嵌帮助面板。
     *
     * 帮助面板出现在 ChatInput 区域内（不打断对话历史），
     * 展示键盘快捷键、slash 命令列表、@mention 用法，
     * 以及 Agent Mode（harness 可用时）相关命令。
     *
     * 可由 `?` 按钮、`/help` 命令或外部代码触发。
     */
    showHelp(): void;

    /**
     * 刷新 Skill 选择面板。
     *
     * 由 Shell 在 harness 可用时调用，传入最新的 Skill 列表
     * （含 loaded 状态）。ChatInput 负责渲染 Load/Unload 按钮。
     */
    refreshSkills(skills: SkillInfo[]): void;

    /**
     * 在输入框上方内联显示工具执行结果（不弹 Modal）。
     *
     * 用于 /exec /read /grep /glob 等直接 tool 调用：
     * - 结果以 monospace 代码块展示在 ChatInput 区域内
     * - 用户可继续输入下一条工具命令或切换回 agent 模式
     * - 发送 agent 消息时自动清除（clearToolOutput）
     */
    showToolOutput(cmd: string, output: string, success: boolean): void;

    /** 清除 inline 工具输出面板。 */
    clearToolOutput(): void;

    destroy(): void;
}
