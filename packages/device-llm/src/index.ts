// @file: device-llm/index.ts

/**
 * @package @itookit/device-llm
 * @description 纯粹的 LLM 通信层 - v2.0
 * 
 * 职责：
 * - 封装各 LLM Provider 的 API 调用
 * - 统一消息格式和响应结构
 * - 处理流式响应
 * - 提供连接测试能力
 * - 支持多模态内容 (图片、音频、视频、文档、文本附件)
 * - 支持 MCP 协议
 * - 支持技能/工具系统
 * 
 * 不包含：
 * - 执行逻辑 (→ @itookit/llm-runtime)
 * - 会话管理 (→ @itookit/llm-conversation)
 * - 持久化 (→ @itookit/llm-conversation)
 * - Agent 定义 (→ @itookit/llm-conversation)
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
    LLMProvider,
} from './types/connection';

// 消息
export type {
    ChatMessage,
    MessageContent,
    MessageContentPart,
    MessageContentText,
    MessageContentImage,
    MessageContentAudio,
    MessageContentVideo,
    MessageContentFile,
    MessageContentToolResult,
    MessageContentCodeExecution,
    MessageContentCitation,
    Role,
    ToolCall,
    ToolDefinition,
    ComputerUseAction,
    MCPToolCall,
    Attachment,
    AttachmentType            // 新增
} from './types/message';

// Provider 配置
export type {
    LLMProviderConfig,
    LLMClientConfig,
    LLMHooks,
    ProviderCapabilities,
    MCPConfig,
    MCPServerConfig
} from './types/provider';

// 请求/响应
export type {
    ChatCompletionParams,
    ChatCompletionResponse,
    ChatCompletionChunk,
    AssistantMessage,
    ToolChoice,
    ResponseFormat,
    TokenUsage,
    Citation,
    FinishReason
} from './types/response';

// ============================================
// Provider 系统
// ============================================

export { BaseProvider } from './providers/base';
export { OpenAIProvider } from './providers/openai';
export { ResponsesProvider } from './providers/responses';
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
// 技能/MCP 系统
// ============================================

export { MCPClient, MCPServerConnection } from './skills/mcp-client';
export type {
    MCPSkill,
    MCPSkillContext,
    MCPSkillResult,
} from './skills/mcp-client';

// ============================================
// 常量
// ============================================

export {
    CONST_CONFIG_VERSION,
    PROVIDERS_DIR,
    LLM_PROVIDERS,
    DEFAULT_CONNECTIONS,
    LLM_DEFAULT_ID,
    LLM_DEFAULT_NAME,
    DEFAULT_TIMEOUT,
    DEFAULT_MAX_RETRIES,
    DEFAULT_RETRY_DELAY,
    getProviderDefinition,
    getModelDefinition,

    type AgentType,
    type AgentConfig,
    type AgentDefinition,
    type InitialAgentDef,
    AGENT_DEFAULT_DIR,
    DEFAULT_AGENTS,
} from './constants/';

// ── .llm 配置格式 (parse / serialize / convert) ─────────────────────────────
export {
    parseLLMConfig,
    serializeLLMConfig,
    getProviderDefs,
    toLLMProvider,
    toConnectionDef,
    toRuntimeConnection,
    toRuntimeAgent,
    fromLLMProvider,
    fromConnectionDef,
    fromAgentDef,
    exportToLLM,
    exportBundleToLLM,
    type LLMConfigFile,
    type LLMProviderDef,
    type LLMConnectionDef,
    type LLMModelDef,
    type LLMSkillDef,
    type LLMAgentDef,
    type LLMMCPDef,
} from './constants/llm-loader';

// ============================================
// 工具函数
// ============================================

export {
    processAttachment,
    isSupportedVisionContent,
    isSupportedAudioContent,
    isSupportedVideoContent,
    isSupportedTextContent,        // 新增
    buildImageContent,
    buildAudioContent,
    buildVideoContent,
    buildFileContent,
    buildTextContent,              // 新增
    readTextSource,                // 新增
    attachmentToContentPart,
    processAttachments,
    expandMessageAttachments,      // 新增
    expandMessagesAttachments,     // 新增
    detectMediaType,
    SUPPORTED_MEDIA_TYPES
} from './utils/attachment';

export type { ProcessedAttachment } from './utils/attachment';

export {
    parseSSEStream,
    createCancellableStream,
    mergeStreams
} from './utils/stream';

export { NoopLLMLogger } from './utils/llm-logger';

// ============================================
// 设备插件 (IDeviceDriver 实现)
// ============================================

export { LLMDeviceDriver, LLM_IOCTL } from './device/llm-device-driver';
export type { LLMIoctlCommand, LLMDeviceOpenOptions, IShellRunner, LLMDeviceDriverOptions } from './device/llm-device-driver';
// ILLMManagementService 统一从 @itookit/common 导入

// ============================================
// ============================================
