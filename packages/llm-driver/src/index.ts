// @file: llm-driver/index.ts

/**
 * @package @itookit/llm-driver
 * @description 纯粹的 LLM 通信层
 * 
 * 职责：
 * - 封装各 LLM Provider 的 API 调用
 * - 统一消息格式和响应结构
 * - 处理流式响应
 * - 提供连接测试能力
 * 
 * 不包含：
 * - 执行逻辑 (→ @itookit/llm-kernel)
 * - 会话管理 (→ @itookit/llm-engine)
 * - 持久化 (→ @itookit/llm-engine)
 * - Agent 定义 (→ @itookit/llm-engine)
 */

// ============================================
// 核心类
// ============================================

export { LLMDriver } from './core/driver';
export { LLMChain } from './core/chain';
export { testLLMConnection, testMultipleConnections } from './core/api';
export type { ConnectionTestResult } from './core/api';

// ============================================
// 错误处理
// ============================================

export { LLMError, LLMErrorCode } from './errors';
export type { LLMErrorDetails } from './errors';

// ============================================
// 类型定义
// ============================================

// 连接配置
export type {
    LLMConnection,
    LLMModel,
    LLMProviderDefinition
} from './types/connection';

// 消息
export type {
    ChatMessage,
    MessageContent,
    MessageContentPart,
    MessageContentText,
    MessageContentImage,
    MessageContentDocument,
    Role,
    ToolCall,
    ToolDefinition
} from './types/message';

// Provider 配置
export type {
    LLMProviderConfig,
    LLMClientConfig,
    LLMHooks
} from './types/provider';

// 请求/响应
export type {
    ChatCompletionParams,
    ChatCompletionResponse,
    ChatCompletionChunk
} from './types/response';

// ============================================
// Provider 系统
// ============================================

export { BaseProvider } from './providers/base';
export { OpenAIProvider } from './providers/openai';
export { AnthropicProvider } from './providers/anthropic';
export { GeminiProvider } from './providers/gemini';

export {
    registerProvider,
    getProvider,
    createProvider,
    getRegisteredProviders,
    isProviderRegistered
} from './providers/registry';

// ============================================
// 常量
// ============================================

export {
    CONST_CONFIG_VERSION,
    LLM_PROVIDER_DEFAULTS,
    LLM_DEFAULT_ID,
    LLM_DEFAULT_NAME,
    DEFAULT_TIMEOUT,
    DEFAULT_MAX_RETRIES,
    DEFAULT_RETRY_DELAY,
    getProviderDefinition,
    getModelDefinition,

    type AgentType,
    AGENT_DEFAULT_DIR,
    DEFAULT_AGENTS,
    type AgentDefinition
} from './constants';

// ============================================
// 工具函数
// ============================================

export {
    processAttachment,
    isSupportedVisionContent,
    buildImageContent
} from './utils/attachment';

export {
    parseSSEStream,
    createCancellableStream,
    mergeStreams
} from './utils/stream';
