// @file: device-llm/types/provider.ts

import { LLMConnection } from './connection';
import { ChatCompletionParams, ChatCompletionResponse } from './response';

// ─── MCP Types (local definition, no device-mcp dependency) ──────────────────

/** MCP 服务器连接配置 */
export interface MCPServerConfig {
    /** 服务器名称（唯一） */
    name: string;
    /** 传输类型 */
    transport: 'stdio' | 'sse' | 'websocket';
    /** 启动命令（stdio 模式） */
    command?: string;
    /** 命令参数（stdio 模式） */
    args?: string[];
    /** 服务端点 URL（sse / websocket 模式） */
    url?: string;
    /** 额外环境变量（stdio 模式） */
    env?: Record<string, string>;
}

/** MCP 客户端配置 */
export interface MCPConfig {
    /** MCP 服务器列表 */
    servers: MCPServerConfig[];
    /** 工具调用默认超时 ms */
    timeout?: number;
}

/**
 * Provider 配置（传给 BaseProvider）
 */
export interface LLMProviderConfig {
    /** Provider key */
    provider: string;
    
    /** API Key */
    apiKey: string;
    
    /** API 地址 */
    apiBaseUrl?: string;
    
    /** 默认模型 */
    model?: string;

    // ===== 能力标识 =====
    /** 是否支持思考过程 */
    supportsThinking?: boolean;
    
    /** 是否需要 Referer */
    requiresReferer?: boolean;
    
    /** 支持的模态 */
    supportedModalities?: Array<'text' | 'image' | 'audio' | 'video'>;
    
    /** 支持的特性 */
    capabilities?: ProviderCapabilities;
    
    // ===== 请求配置 =====
    
    /** 额外 HTTP 头 */
    headers?: Record<string, string>;
    
    /** 额外元数据 */
    metadata?: Record<string, any>;
    
    // ===== MCP 配置 (新增) =====
    
    mcp?: MCPConfig;
}

/**
 * Provider 能力定义
 */
export interface ProviderCapabilities {
    /** 视觉/图像理解 */
    vision?: boolean;
    /** 音频输入 */
    audioInput?: boolean;
    /** 音频输出 */
    audioOutput?: boolean;
    /** 视频理解 */
    video?: boolean;
    /** 文档/PDF 处理 */
    documents?: boolean;
    /** 工具调用 */
    tools?: boolean;
    /** 并行工具调用 */
    parallelTools?: boolean;
    /** 结构化输出 */
    structuredOutput?: boolean;
    /** JSON 模式 */
    jsonMode?: boolean;
    /** 思考/推理 */
    thinking?: boolean;
    /** 代码执行 */
    codeExecution?: boolean;
    /** 网络搜索 */
    webSearch?: boolean;
    /** Computer Use */
    computerUse?: boolean;
    /** MCP 协议 */
    mcp?: boolean;
    /** Prompt Caching */
    caching?: boolean;
    /** Batch API */
    batch?: boolean;
    /** 流式响应 */
    streaming?: boolean;
}

// MCPConfig / MCPServerConfig 已在本文件顶部定义（本地实现，无 device-mcp 依赖）。

/**
 * 生命周期钩子 - 增强版
 */
export interface LLMHooks {
    /** 请求前处理 */
    beforeRequest?: (params: ChatCompletionParams) => Promise<ChatCompletionParams>;
    
    /** 响应后处理 */
    afterResponse?: (response: ChatCompletionResponse) => Promise<ChatCompletionResponse>;
    
    /** 错误处理 */
    onError?: (error: Error, params: ChatCompletionParams) => Promise<void>;
    
    /** 流式块处理 (新增) */
    onStreamChunk?: (chunk: import('./response').ChatCompletionChunk) => void;
    
    /** 工具调用前 (新增) */
    beforeToolCall?: (toolCall: import('./message').ToolCall) => Promise<import('./message').ToolCall>;
    
    /** 工具调用后 (新增) */
    afterToolCall?: (toolCall: import('./message').ToolCall, result: any) => Promise<any>;
}

/**
 * LLMDriver 构造配置
 */
export interface LLMClientConfig {
    // ===== 方式 A: 传入连接对象 =====
    connection?: LLMConnection;
    
    // ===== 方式 B: 直接传参 =====
    provider?: string;
    apiKey?: string;
    apiBaseUrl?: string;
    model?: string;
    
    // ===== 能力开关 =====
    supportsThinking?: boolean;
    requiresReferer?: boolean;
    
    // ===== 请求配置 =====
    /** 最大重试次数 */
    maxRetries?: number;
    
    /** 重试延迟 (ms) */
    retryDelay?: number;
    
    /** 请求超时 (ms) */
    timeout?: number;
    
    /** 额外 HTTP 头 */
    headers?: Record<string, string>;
    
    // ===== 扩展 =====
    /** 生命周期钩子 */
    hooks?: LLMHooks;
    
    /** 自定义 Provider 定义 */
    customProviderDefaults?: Record<string, import('./connection').LLMProviderDefinition>;
    
    // ===== 新增配置 =====
    
    /** MCP 配置 */
    mcp?: MCPConfig;
    
    /** 默认音频配置 */
    audio?: {
        inputFormat?: string;
        outputFormat?: string;
        voice?: string;
    };
    
    /** 默认缓存配置 */
    caching?: {
        enabled?: boolean;
        ttl?: number;
    };
    
    /** 调试模式 */
    debug?: boolean;
}
