/** MindOS host integration for driver-llm: configuration, VFS devices, MCP and Skills. */

// ============================================
// 核心类
// ============================================

export { LLMDriver } from '@itookit/driver-llm';
export { LLMChain } from '@itookit/driver-llm/chain';
export { testLLMConnection, testMultipleConnections } from '@itookit/driver-llm';
export type { ConnectionTestResult } from '@itookit/driver-llm';

// ============================================
// 错误处理
// ============================================

export { LLMError, LLMErrorCode } from '@itookit/driver-llm';
export type { LLMErrorDetails } from '@itookit/driver-llm';

// ============================================
// 类型定义
// ============================================

// 连接配置
export type {
    LLMConnection,
    LLMModel,
    LLMProvider,
} from '@itookit/driver-llm';

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
} from '@itookit/driver-llm';

// Provider 配置
export type {
    LLMProviderConfig,
    LLMClientConfig,
    LLMHooks,
    ProviderCapabilities,
    CodexCLIConfig,
    CodexCommandRunner,
    CodexCommandResult,
    CodexAppServerTransport,
    CodexRPCMessage
} from '@itookit/driver-llm';

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
} from '@itookit/driver-llm';

// ============================================
// Provider 系统
// ============================================

export { BaseProvider } from '@itookit/driver-llm';
export { OpenAIProvider } from '@itookit/driver-llm';
export { ResponsesProvider } from '@itookit/driver-llm';
export { AnthropicProvider } from '@itookit/driver-llm';
export { GeminiProvider } from '@itookit/driver-llm';
export { CodexProvider } from '@itookit/driver-llm';
export { AsyncEventHub, rejectPending } from '@itookit/driver-llm';
export { JsonRpcLineTransport } from '@itookit/driver-llm';

export {
    registerProvider,
    getProvider,
    createProvider,
    getRegisteredProviders,
    isProviderRegistered
} from '@itookit/driver-llm';

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
} from '@itookit/driver-llm';

export type { ProcessedAttachment } from '@itookit/driver-llm';

export {
    parseSSEStream,
    createCancellableStream,
    mergeStreams
} from '@itookit/driver-llm';

export { NoopLLMLogger } from '@itookit/driver-llm';

// ============================================
// 设备插件 (IDeviceDriver 实现)
// ============================================

export { LLMDeviceDriver, LLM_IOCTL } from './device/llm-device-driver';
export type { LLMIoctlCommand, LLMDeviceOpenOptions, IShellRunner, LLMDeviceDriverOptions } from './device/llm-device-driver';
// ILLMManagementService 统一从 @itookit/common 导入

// ============================================
// ============================================

export { registerMCPStdioHost, hasMCPStdioHost } from './skills/mcp-host-transport';
export type { MCPProcessBridge, MCPProcessBatch } from './skills/mcp-host-transport';

export type { MCPConfig, MCPServerConfig } from './skills/types';
