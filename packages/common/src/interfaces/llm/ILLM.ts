/**
 * @file common/interfaces/llm/ILLM.ts
 * @description 仅保留应用层特有的配置定义。底层连接定义已移至 llmdriver。
 */

/**
 * Agent (智能体) 配置接口
 * 用于 .agent 文件的持久化数据结构
 */
export interface LLMAgentConfig {
    connectionId: string;
    modelId: string;
    systemPrompt?: string;
    maxHistoryLength?: number; // -1 表示无限
    temperature?: number;
    autoPrompts?: string[];
}
