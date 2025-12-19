// @file: llm-driver/core/driver.ts

import {
    LLMClientConfig,
    LLMProviderConfig,
    ChatCompletionParams,
    ChatCompletionResponse,
    ChatCompletionChunk
} from '../types';
import { BaseProvider } from '../providers/base';
import { createProvider } from '../providers/registry';
import { LLMError } from '../errors';
import { DEFAULT_MAX_RETRIES, DEFAULT_RETRY_DELAY, DEFAULT_TIMEOUT } from '../constants';

/**
 * LLM Driver - 统一的 LLM API 客户端
 * 
 * 职责：
 * 1. 封装各 Provider 的 API 调用
 * 2. 统一消息格式和响应结构
 * 3. 处理重试和超时
 * 4. 处理流式响应
 */
export class LLMDriver {
    private provider: BaseProvider;
    private config: Required<Pick<LLMClientConfig, 'maxRetries' | 'retryDelay' | 'timeout'>> & LLMClientConfig;
    
    constructor(config: LLMClientConfig) {
        // 1. 解析配置（优先使用 connection 对象）
        const provider = config.connection?.provider || config.provider;
        const apiKey = config.connection?.apiKey || config.apiKey;
        const apiBaseUrl = config.connection?.baseURL || config.apiBaseUrl;
        const model = config.connection?.model || config.model;
        
        // 2. 校验必填项
        if (!provider) {
            throw new Error('LLMDriver requires provider (either directly or via connection)');
        }
        if (!apiKey) {
            throw new Error('LLMDriver requires apiKey (either directly or via connection)');
        }
        
        // 3. 构建 Provider 配置
        const providerConfig: LLMProviderConfig = {
            provider,
            apiKey,
            apiBaseUrl,
            model,
            supportsThinking: config.supportsThinking,
            requiresReferer: config.requiresReferer,
            headers: config.headers,
            metadata: config.connection?.metadata
        };
        
        // 4. 保存配置
        this.config = {
            maxRetries: config.maxRetries ?? DEFAULT_MAX_RETRIES,
            retryDelay: config.retryDelay ?? DEFAULT_RETRY_DELAY,
            timeout: config.timeout ?? DEFAULT_TIMEOUT,
            ...config
        };
        
        // 5. 创建 Provider
        this.provider = createProvider(providerConfig, config.customProviderDefaults);
    }
    
    /**
     * Chat API
     */
    get chat() {
        return {
            create: this.createChatCompletion.bind(this)
        };
    }
    
    /**
     * 获取当前 Provider 名称
     */
    get providerName(): string {
        return this.provider.name;
    }
    
    /**
     * 获取当前模型
     */
    get currentModel(): string | undefined {
        return this.config.model || this.config.connection?.model;
    }
    
    // ============== 主入口 ==============
    
    /**
     * 创建聊天完成（支持流式和非流式）
     */
    async createChatCompletion(params: ChatCompletionParams & { stream: true }): Promise<AsyncGenerator<ChatCompletionChunk>>;
    async createChatCompletion(params: ChatCompletionParams & { stream?: false }): Promise<ChatCompletionResponse>;
    async createChatCompletion(params: ChatCompletionParams): Promise<ChatCompletionResponse | AsyncGenerator<ChatCompletionChunk>> {
        // 1. 应用请求前钩子
        let finalParams = { ...params };
        if (this.config.hooks?.beforeRequest) {
            finalParams = await this.config.hooks.beforeRequest(finalParams);
        }
        
        // 2. 设置超时
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);
        
        // 合并 signal
        if (finalParams.signal) {
            finalParams.signal.addEventListener('abort', () => controller.abort());
        }
        finalParams.signal = controller.signal;
        
        try {
            if (finalParams.stream) {
                // 流式响应
                const stream = this.provider.stream(finalParams);
                clearTimeout(timeoutId);
                return this.wrapStreamWithTimeout(stream, controller, timeoutId);
            } else {
                // 非流式响应（带重试）
                const response = await this.executeWithRetry(() => 
                    this.provider.create(finalParams)
                );
                clearTimeout(timeoutId);
                
                // 应用响应后钩子
                if (this.config.hooks?.afterResponse) {
                    return this.config.hooks.afterResponse(response);
                }
                return response;
            }
        } catch (error: any) {
            clearTimeout(timeoutId);
            
            // 转换为 LLMError
            const llmError = error instanceof LLMError 
                ? error 
                : LLMError.fromException(this.providerName, error);
            
            // 应用错误钩子
            if (this.config.hooks?.onError) {
                await this.config.hooks.onError(llmError, finalParams);
            }
            
            throw llmError;
        }
    }
    
    // ============== 重试逻辑 ==============
    
    private async executeWithRetry<T>(
        fn: () => Promise<T>,
        attempt = 1
    ): Promise<T> {
        try {
            return await fn();
        } catch (error: any) {
            const llmError = error instanceof LLMError
                ? error
                : LLMError.fromException(this.providerName, error);
            
            // 检查是否可重试
            const shouldRetry = llmError.retryable && attempt < this.config.maxRetries;
            
            if (shouldRetry) {
                // 计算延迟（指数退避）
                const delay = llmError.retryAfter || 
                    (this.config.retryDelay * Math.pow(2, attempt - 1));
                
                console.log(`[LLMDriver] Retrying in ${delay}ms (attempt ${attempt + 1}/${this.config.maxRetries})`);
                
                await this.sleep(delay);
                return this.executeWithRetry(fn, attempt + 1);
            }
            
            throw llmError;
        }
    }
    
    // ============== 流式包装 ==============
    
    private async *wrapStreamWithTimeout(
        stream: AsyncGenerator<ChatCompletionChunk>,
        _controller: AbortController,
        timeoutId: ReturnType<typeof setTimeout>
    ): AsyncGenerator<ChatCompletionChunk> {
        try {
            for await (const chunk of stream) {
                // 每次收到数据时重置超时
                clearTimeout(timeoutId);
                yield chunk;
            }
        } finally {
            clearTimeout(timeoutId);
        }
    }
    
    // ============== 工具方法 ==============
    
    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
