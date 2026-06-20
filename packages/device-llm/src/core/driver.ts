// @file: device-llm/core/driver.ts

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
import { expandMessagesAttachments } from '../utils/attachment';
import { log } from '../utils/logger';

/**
 * LLM Driver - 统一的 LLM API 客户端
 * 
 * 职责：
 * 1. 封装各 Provider 的 API 调用
 * 2. 统一消息格式和响应结构
 * 3. 处理重试和超时
 * 4. 处理流式响应
 * 5. 自动展开 ChatMessage.attachments 为 multipart content
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
            protocol: config.connection?.protocol,
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
        
        // ✅ 简洁调用
        log.debug('LLMDriver initialized', {
            provider,
            model,
            timeout: this.config.timeout
        });
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

    /**
     * 推断当前 provider 的格式标识，用于 attachment 展开
     */
    private get providerFormat(): 'openai' | 'anthropic' | 'gemini' | undefined {
        const name = this.providerName.toLowerCase();
        if (name.includes('anthropic') || name.includes('claude')) return 'anthropic';
        if (name.includes('gemini') || name.includes('google')) return 'gemini';
        // OpenAI 及兼容实现均使用 openai 格式
        return 'openai';
    }
    
    // ============== 主入口 ==============
    
    /**
     * 创建聊天完成（支持流式和非流式）
     * 
     * 会自动将消息中的 `attachments` 字段展开为对应的 multipart content parts，
     * 使上层调用方无需手动调用 `processAttachments` 或 `expandMessageAttachments`。
     */
    async createChatCompletion(params: ChatCompletionParams & { stream: true }): Promise<AsyncGenerator<ChatCompletionChunk>>;
    async createChatCompletion(params: ChatCompletionParams & { stream?: false }): Promise<ChatCompletionResponse>;
    async createChatCompletion(params: ChatCompletionParams): Promise<ChatCompletionResponse | AsyncGenerator<ChatCompletionChunk>> {
        const requestId = Date.now().toString(36);
        
        // ✅ 简洁调用
        log.debug('Chat request', {
            requestId,
            model: params.model || this.currentModel,
            stream: !!params.stream,
            messageCount: params.messages.length
        });
        
        let finalParams = { ...params };

        // ── 自动展开 attachments ──
        const hasAttachments = finalParams.messages.some(m => m.attachments && m.attachments.length > 0);
        if (hasAttachments) {
            try {
                finalParams.messages = await expandMessagesAttachments(
                    finalParams.messages,
                    this.providerFormat,
                );
                log.debug('Attachments expanded', { requestId });
            } catch (err: any) {
                log.warn('Failed to expand attachments, sending messages as-is', {
                    requestId,
                    error: err.message,
                });
            }
        }

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
                log.debug('Stream started', { requestId });
                return this.wrapStreamWithTimeout(stream, controller, timeoutId, requestId);
            } else {
                const startTime = Date.now();
                const response = await this.executeWithRetry(
                    () => this.provider.create(finalParams),
                    requestId
                );
                clearTimeout(timeoutId);
                
                // ✅ 简洁调用
                log.info('Chat success', {
                    requestId,
                    model: response.model,
                    latency: Date.now() - startTime,
                    tokens: response.usage?.total_tokens
                });
                
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

            // 注入模型名，用于友好错误提示
            if (!llmError.model && this.currentModel) {
                llmError.model = this.currentModel;
                llmError.message = `Model '${this.currentModel}': ${llmError.message}`;
            }

            log.error('Chat failed', {
                requestId,
                code: llmError.code,
                message: llmError.message,
                model: llmError.model || this.currentModel,
            });

            if (this.config.hooks?.onError) {
                await this.config.hooks.onError(llmError, finalParams);
            }

            throw llmError;
        }
    }
    
    // ============== 重试逻辑 ==============
    
    private async executeWithRetry<T>(
        fn: () => Promise<T>,
        requestId: string,
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
                
                // ✅ 简洁调用
                log.warn('Retrying', {
                    requestId,
                    attempt,
                    maxRetries: this.config.maxRetries,
                    delay
                });
                
                await this.sleep(delay);
                return this.executeWithRetry(fn, requestId, attempt + 1);
            }
            
            throw llmError;
        }
    }
    
    // ============== 流式包装 ==============
    
    private async *wrapStreamWithTimeout(
        stream: AsyncGenerator<ChatCompletionChunk>,
        controller: AbortController,
        timeoutId: ReturnType<typeof setTimeout>,
        requestId: string
    ): AsyncGenerator<ChatCompletionChunk> {
        let chunkCount = 0;
        // Rolling inactivity timeout: reset on every chunk.
        // The initial timeoutId covers "time to first chunk";
        // after each chunk we replace it so silence also triggers abort.
        let activeTimeout = timeoutId;
        const reschedule = () => {
            clearTimeout(activeTimeout);
            activeTimeout = setTimeout(() => {
                log.warn('Stream inactivity timeout', { requestId, chunkCount });
                controller.abort();
            }, this.config.timeout);
        };
        try {
            for await (const chunk of stream) {
                reschedule();
                chunkCount++;
                yield chunk;
            }
            log.debug('Stream completed', { requestId, chunkCount });
        } finally {
            clearTimeout(activeTimeout);
        }
    }
    
    // ============== 工具方法 ==============
    
    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
