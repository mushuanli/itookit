// @file: llmdriver/types.ts
import { LLMConnection, LLMProviderDefinition } from '@itookit/common';

// 重新导出 Common 类型
export type { LLMConnection, LLMProviderDefinition };

// --- 运行时配置结构 ---

/**
 * [FIXED] LLMProviderConfig
 * 这是传给 BaseProvider 及其子类的配置对象。
 * 它继承自 LLMConnection，因此你可以直接把存数数据的 connection 对象传进去，
 * 同时它增加了 Driver 运行时特有的字段（如 headers, supportsThinking）。
 */
export interface LLMProviderConfig extends Partial<LLMConnection> {
    // 必填字段 (虽然继承自 Partial LLMConnection，但在运行时这些是必须的)
    provider: string;
    apiKey: string;
    
    // 运行时解析后的字段
    apiBaseUrl?: string; // 对应 LLMConnection.baseURL
    model?: string;
    
    // 从 LLMProviderDefinition 继承的能力开关
    supportsThinking?: boolean;
    requiresReferer?: boolean;

    // 额外的 HTTP 请求头
    headers?: Record<string, string>;
    
    // 允许任意额外参数
    [key: string]: any;
}

// --- 基础消息结构 ---

export type Role = 'system' | 'user' | 'assistant';

export interface MessageContentText {
    type: 'text';
    text: string;
}

export interface MessageContentImage {
    type: 'image_url';
    image_url: { url: string };
}

export interface MessageContentDocument {
    type: 'document';
    document: { url: string; mime_type?: string };
}

export type MessageContentPart = MessageContentText | MessageContentImage | MessageContentDocument;
export type MessageContent = string | MessageContentPart[];

export interface ChatMessage {
    role: Role;
    content: MessageContent;
    name?: string;
}

export interface ToolCall {
    id: string;
    type: 'function';
    function: {
        name: string;
        arguments: string;
    };
}

// --- 请求参数 ---

export interface ChatCompletionParams {
    messages: ChatMessage[];
    model?: string;
    stream?: boolean;
    
    /** 是否开启思考过程（如果模型支持） */
    thinking?: boolean;
    /** 思考过程的 Token 预算 (Anthropic/Gemini) */
    thinkingBudget?: number;
    /** 思考过程的努力程度 (OpenAI o1/o3) */
    reasoningEffort?: 'low' | 'medium' | 'high';
    
    temperature?: number;
    maxTokens?: number;
    topP?: number;
    tools?: any[];
    toolChoice?: any;
    
    /** AbortSignal 用于取消请求 */
    signal?: AbortSignal;
    
    /** 允许传递额外参数给底层 Provider */
    [key: string]: any;
}

// --- 响应结构 (归一化) ---

export interface ChatCompletionResponse {
    choices: Array<{
        message: {
            role: 'assistant';
            content: string;
            /** 标准化的思考内容，无论底层是 reasoning_content 还是 thinking block */
            thinking?: string;
            tool_calls?: ToolCall[];
        };
        finish_reason: string;
    }>;
    usage?: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
    };
    model: string;
}

export interface ChatCompletionChunk {
    choices: Array<{
        delta: {
            content?: string;
            thinking?: string;
            tool_calls?: any[];
        };
        finish_reason: string | null;
    }>;
}

// --- Client 配置 ---

export interface LLMHooks {
    beforeRequest?: (params: ChatCompletionParams) => Promise<ChatCompletionParams>;
    afterResponse?: (response: ChatCompletionResponse) => Promise<ChatCompletionResponse>;
    onError?: (error: Error, params: ChatCompletionParams) => Promise<void>;
}

/**
 * 传给 BaseProvider 的配置，必须包含 provider 和 apiKey
 */
export interface LLMProviderConfig {
    provider: string;
    apiKey: string;
    apiBaseUrl?: string;
    model?: string;
    
    // 能力开关
    supportsThinking?: boolean;
    requiresReferer?: boolean;
    
    // 额外的 HTTP Headers
    headers?: Record<string, string>;
    
    // 移除 [key: string]: any; 以避免索引签名冲突
    // 如果需要传递额外元数据，使用 metadata 字段
    metadata?: Record<string, any>;
}

// --- [FIXED] 用户输入的宽松配置 ---
/**
 * Driver 构造函数接收的配置。
 * provider 和 apiKey 是可选的，因为可以通过 connection 对象传入。
 */
export interface LLMClientConfig {
    /** 方式 A: 传入完整的连接对象 */
    connection?: LLMConnection;

    /** 方式 B: 直接传入参数 (如果提供了 connection，这些可选) */
    provider?: string;
    apiKey?: string;
    
    apiBaseUrl?: string;
    model?: string;

    // [FIXED] 允许在初始化 Client 时覆盖 Provider 的默认能力设置
    supportsThinking?: boolean;
    requiresReferer?: boolean;

    // 通用设置
    maxRetries?: number;
    /** 重试延迟 (ms)，默认 1000 */
    retryDelay?: number;
    /** 请求超时 (ms)，默认 60000 */
    timeout?: number;
    
    /** 生命周期钩子 */
    hooks?: LLMHooks;
    
    /** 
     * 自定义 Provider 定义。
     * 用于运行时注入不在 Common 库中的新 Provider，或覆盖默认配置。
     */
    customProviderDefaults?: Record<string, LLMProviderDefinition>;
    
    /** 文件存储适配器 (用于多模态上传) */
    storageAdapter?: any;
    headers?: Record<string, string>;
}