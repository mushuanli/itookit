// @file: llmdriver/types.ts

import { 
    LLMConnection, 
    LLMModel, 
    ChatMessage, 
    MessageContent, 
    ToolCall, 
    Role,
    IExecutionContext // ✨ [新增] 导入基础接口
} from '@itookit/common';

// ==========================================
// 1. Provider 定义
// ==========================================

export interface LLMProviderDefinition {
    /** 显示名称 (e.g., "OpenAI") */
    name: string;
    /** 
     * 底层实现策略 
     * 对应 Driver 中的 Provider 类 
     */
    implementation: 'openai-compatible' | 'anthropic' | 'gemini';
    
    /** 默认 API 地址 */
    baseURL: string;
    
    /** 预设模型列表 */
    models: LLMModel[];
    
    /** 特性开关: 是否支持思维链/思考过程 */
    supportsThinking?: boolean;
    
    /** 特性开关: 是否需要 Referer 头 (如 OpenRouter) */
    requiresReferer?: boolean;
}

// ==========================================
// 2. Driver 运行时类型
// ==========================================

/**
 * LLMProviderConfig
 * 传给 BaseProvider 的配置。
 * 继承自 Partial<LLMConnection> 以复用通用字段，但强制要求 provider 和 apiKey。
 */
export interface LLMProviderConfig extends Partial<LLMConnection> {
    // 必填字段
    provider: string;
    apiKey: string;
    
    // 运行时解析后的字段
    apiBaseUrl?: string; // 对应 LLMConnection.baseURL
    model?: string;
    
    // 能力开关
    supportsThinking?: boolean;
    requiresReferer?: boolean;

    // 额外的 HTTP 请求头
    headers?: Record<string, string>;
    
    // 允许额外元数据
    [key: string]: any;
}

// ==========================================
// 3. 请求与响应 (Driver 特有)
// ==========================================

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
    
    /** 
     * 输入时允许宽泛的类型，但在发送给 API 前
     * Driver 的 BaseProvider 会处理它与 ChatMessage.toolCalls 的映射 
     */
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

/**
 * 驱动层执行上下文
 */
export interface DriverExecutionContext extends IExecutionContext {
    // IExecutionContext 已包含:
    // - executionId: string
    // - depth: number
    // - signal?: AbortSignal
    // - variables: ReadonlyMap<string, unknown>
    
    /**
     * [扩展] LLM 驱动特有的回调函数
     * 用于处理流式思考过程(Thinking)和输出
     */
    callbacks?: ExecutionCallbacks;
    
    /**
     * [扩展] 父节点 ID (用于追踪调用链)
     * 注：IExecutionContext 中有 parentId (可选)，这里可以省略或者是为了明确覆盖
     */
    parentId?: string;

    /**
     * 允许额外的驱动层元数据
     */
    [key: string]: any;
}

export interface ExecutionCallbacks {
    onThinking?: (delta: string, nodeId?: string) => void;
    onOutput?: (delta: string, nodeId?: string) => void;
}

// --- Client 配置 ---

export interface LLMHooks {
    beforeRequest?: (params: ChatCompletionParams) => Promise<ChatCompletionParams>;
    afterResponse?: (response: ChatCompletionResponse) => Promise<ChatCompletionResponse>;
    onError?: (error: Error, params: ChatCompletionParams) => Promise<void>;
}

/**
 * Driver 构造函数配置
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