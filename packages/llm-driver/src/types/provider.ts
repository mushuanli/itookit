// @file: llm-driver/types/provider.ts

import { LLMConnection } from './connection';
import { ChatCompletionParams, ChatCompletionResponse } from './response';

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
    
    /** 是否支持思考过程 */
    supportsThinking?: boolean;
    
    /** 是否需要 Referer */
    requiresReferer?: boolean;
    
    /** 额外 HTTP 头 */
    headers?: Record<string, string>;
    
    /** 额外元数据 */
    metadata?: Record<string, any>;
}

/**
 * 生命周期钩子
 */
export interface LLMHooks {
    /** 请求前处理 */
    beforeRequest?: (params: ChatCompletionParams) => Promise<ChatCompletionParams>;
    
    /** 响应后处理 */
    afterResponse?: (response: ChatCompletionResponse) => Promise<ChatCompletionResponse>;
    
    /** 错误处理 */
    onError?: (error: Error, params: ChatCompletionParams) => Promise<void>;
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
}
