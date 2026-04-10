// @file: llm-ui/domain/ports/IChatInputPresenter.ts

import type { IAgentRuntime } from '@itookit/common';
import type { SkillInfo, TokenStats } from '../types';

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
        validateAgentId: (id: string) => string
    ): boolean;

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
     * 注入 AgentLoopExecutor 运行时，用于展示执行状态。
     *
     * HarnessPlugin 订阅此运行时的事件，在输入区展示：
     * - 工具执行状态（正在运行的工具名称）
     * - 预算警告（token/cost 接近上限）
     * - 上下文压缩提示
     * - 权限确认 UI（file_write 等需要用户批准的操作）
     *
     * 传 null 时停止订阅并隐藏状态条。
     */
    setHarnessRuntime(runtime: IAgentRuntime | null): void;

    destroy(): void;
}
