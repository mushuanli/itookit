// @file: common/interfaces/agent/context-manager.ts
// 上下文管理器接口定义。

import type { ChatMessage } from '../llm/message';
import type { CompressionInfo } from './agent-types';

/**
 * 上下文管理器接口。
 *
 * AgentLoopExecutor 内部组件，负责：
 * 1. 动态构建系统提示词（五优先级分段）
 * 2. 管理消息历史与压缩摘要
 * 3. 四层渐进式上下文压缩
 *
 * 四层压缩策略（urgency 越高激进程度越高）：
 *   L1 HistorySnip   (urgency ≥ 0.70) — 截断大型工具输出，保留 head+tail
 *   L2 CachePrune    (urgency ≥ 0.80) — 移除低价值中间消息
 *   L3 LLMSummarize  (urgency ≥ 0.85) — 用 LLM 对旧对话生成结构化摘要
 *   L4 SlidingWindow (urgency ≥ 0.95) — 激进截断，只保留最近 N 条消息
 */
export interface IContextManager {
    /**
     * 构建系统提示词。
     *
     * 按优先级分段组装（token 预算内）：
     *   P0 CoreIdentitySection   — 不可省略
     *   P1 EnvironmentSection    — OS、CWD、时间等
     *   P2 LoadedSkillsSection   — 已加载 Skill 的指令
     *   P3 MemorySection         — CLAUDE.md 等项目记忆
     *   P4 AvailableSkillsSection — 可加载的 Skill 列表提示
     *
     * @param sessionId 当前会话 ID
     */
    buildSystemPrompt(sessionId: string): string;

    /**
     * 构建发送给 LLM 的消息列表。
     *
     * 如果上下文已被压缩，消息头部插入摘要消息。
     */
    buildMessages(sessionId: string): ChatMessage[];

    /**
     * 检查并按需执行上下文压缩。
     *
     * @param sessionId 当前会话 ID
     * @param urgency   紧迫度 [0, 1]，由上下文使用率决定
     * @returns 执行了压缩时返回 CompressionInfo，否则 null
     */
    maybeCompress(sessionId: string, urgency: number): Promise<CompressionInfo | null>;

    /**
     * 强制执行上下文压缩（413 ContextTooLarge 错误后调用）。
     */
    forceCompress(sessionId: string): Promise<CompressionInfo>;

    /**
     * 估算当前上下文的 token 用量。
     */
    estimateContextTokens(sessionId: string): number;

    /**
     * 获取上下文使用率 [0, 1]。
     *
     * 由 AgentLoopExecutor 在每轮循环开始时检查，
     * 决定是否触发 maybeCompress。
     */
    getContextUsageRatio(sessionId: string): number;
}
