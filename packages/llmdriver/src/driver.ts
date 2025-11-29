// @file: llmdriver/driver.ts

import { LLMClientConfig, ChatCompletionParams, ChatCompletionResponse, ChatCompletionChunk } from './types';
import { BaseProvider } from './providers/base';
import { createProvider } from './providers/registry';
import { LLMError } from './errors';
import { DEFAULT_MAX_RETRIES, DEFAULT_RETRY_DELAY, DEFAULT_TIMEOUT } from './constants';

export class LLMDriver {
    private provider: BaseProvider;
    public config: LLMClientConfig;

    constructor(config: LLMClientConfig) {
        if (!config.provider || !config.apiKey) {
            throw new Error('LLMDriver requires provider and apiKey.');
        }
        this.config = {
            maxRetries: DEFAULT_MAX_RETRIES,
            retryDelay: DEFAULT_RETRY_DELAY,
            timeout: DEFAULT_TIMEOUT,
            ...config
        };
        this.provider = createProvider(config, config.customProviderDefaults);
    }

    public get chat() {
        return {
            create: this.createChatCompletion.bind(this)
        };
    }

    private async executeWithRetry<T>(fn: () => Promise<T>, attempt = 1): Promise<T> {
        try {
            return await fn();
        } catch (error: any) {
            const isRetryable = error instanceof LLMError && 
                               error.statusCode && error.statusCode >= 500 &&
                               attempt < (this.config.maxRetries || 3);
            
            if (isRetryable) {
                const delay = (this.config.retryDelay || 1000) * Math.pow(2, attempt - 1);
                await new Promise(resolve => setTimeout(resolve, delay));
                return this.executeWithRetry(fn, attempt + 1);
            }
            throw error;
        }
    }

    /**
     * 统一入口：处理流式和非流式
     */
    // 重载定义：根据 stream 参数返回不同类型
    public async createChatCompletion(params: ChatCompletionParams & { stream: true }): Promise<AsyncGenerator<ChatCompletionChunk>>;
    public async createChatCompletion(params: ChatCompletionParams & { stream?: false }): Promise<ChatCompletionResponse>;
    public async createChatCompletion(params: ChatCompletionParams): Promise<ChatCompletionResponse | AsyncGenerator<ChatCompletionChunk>> {
        let finalParams = { ...params };
        
        if (this.config.hooks?.beforeRequest) {
            finalParams = await this.config.hooks.beforeRequest(finalParams);
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);
        finalParams.signal = finalParams.signal || controller.signal;

        try {
            if (finalParams.stream) {
                const stream = this.provider.stream(finalParams);
                clearTimeout(timeoutId);
                return stream;
            } else {
                const executeRequest = () => this.provider.create(finalParams);
                let response = await this.executeWithRetry(executeRequest);
                clearTimeout(timeoutId);

                if (this.config.hooks?.afterResponse) {
                    response = await this.config.hooks.afterResponse(response);
                }
                return response;
            }
        } catch (error: any) {
            clearTimeout(timeoutId);
            if (this.config.hooks?.onError) {
                await this.config.hooks.onError(error, finalParams);
            }
            throw error;
        }
    }
}
