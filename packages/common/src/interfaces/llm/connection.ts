// @file: common/interfaces/llm/connection.ts

/**
 * LLM 连接配置 - 唯一定义
 * 所有包都从这里导入
 */
export interface LLMConnection {
  id: string;
  name: string;
  provider: string;
  apiKey?: string;           // ← 统一为可选，因为可能从环境变量读取
  baseURL?: string;
  model: string;
  availableModels?: Array<{ id: string; name: string }>;
  metadata?: Record<string, unknown>;
}

/**
 * LLM 模型信息
 */
export interface LLMModel {
  id: string;
  name: string;
  contextWindow?: number;
  maxOutputTokens?: number;
  supportsThinking?: boolean;
  supportsVision?: boolean;
}
