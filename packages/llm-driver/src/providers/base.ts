// @file: llm-driver/providers/base.ts

import {
    LLMProviderConfig,
    ChatCompletionParams,
    ChatCompletionResponse,
    ChatCompletionChunk
} from '../types';
import { LLMError } from '../errors';

/**
 * Provider 基类
 * 
 * 职责：
 * 1. 定义统一的 API 接口
 * 2. 提供通用的请求/响应处理
 * 3. 标准化不同 Provider 的输出格式
 */
export abstract class BaseProvider {
    /** Provider 名称 */
    abstract readonly name: string;
    
    protected config: LLMProviderConfig;
    protected baseURL: string;
    protected defaultModel: string;
    
    constructor(config: LLMProviderConfig) {
        this.config = config;
        this.baseURL = this.resolveBaseURL(config);
        this.defaultModel = config.model || '';
    }
    
    /**
     * 非流式请求
     */
    abstract create(params: ChatCompletionParams): Promise<ChatCompletionResponse>;
    
    /**
     * 流式请求
     */
    abstract stream(params: ChatCompletionParams): AsyncGenerator<ChatCompletionChunk>;
    
    // ============== 通用方法 ==============
    
    /**
     * 解析 API 地址
     */
    protected resolveBaseURL(config: LLMProviderConfig): string {
        if (config.apiBaseUrl) {
            return config.apiBaseUrl.replace(/\/+$/, ''); // 移除尾部斜杠
        }
        return '';
    }
    
    /**
     * 构建请求头
     */
    protected buildHeaders(): Record<string, string> {
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            ...this.config.headers
        };
        
        return headers;
    }
    
    /**
     * 获取实际使用的模型
     */
    protected getModel(params: ChatCompletionParams): string {
        return params.model || this.defaultModel;
    }
    
    /**
     * 发送 HTTP 请求
     */
    protected async fetchJSON<T>(
        url: string,
        options: RequestInit
    ): Promise<T> {
        const response = await fetch(url, options);
        
        if (!response.ok) {
            let body: any;
            try {
                body = await response.json();
            } catch {
                body = await response.text();
            }
            throw LLMError.fromResponse(this.name, response.status, body);
        }
        
        return response.json();
    }
    
    /**
     * 发送流式请求
     */
    protected async fetchStream(
        url: string,
        options: RequestInit
    ): Promise<ReadableStream<Uint8Array>> {
        const response = await fetch(url, options);
        
        if (!response.ok) {
            let body: any;
            try {
                body = await response.json();
            } catch {
                body = await response.text();
            }
            throw LLMError.fromResponse(this.name, response.status, body);
        }
        
        if (!response.body) {
            throw new Error('Response body is null');
        }
        
        return response.body;
    }
}
