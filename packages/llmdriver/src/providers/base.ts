// @file: llmdriver/providers/base.ts

import { ChatCompletionParams, ChatCompletionResponse, ChatCompletionChunk, LLMProviderConfig } from '../types';

export abstract class BaseProvider {
    protected config: LLMProviderConfig;

    constructor(config: LLMProviderConfig) {
        this.config = config;
    }

    /**
     * 发送非流式请求
     */
    abstract create(params: ChatCompletionParams): Promise<ChatCompletionResponse>;

    /**
     * 发送流式请求
     */
    abstract stream(params: ChatCompletionParams): AsyncGenerator<ChatCompletionChunk>;

    /**
     * 获取当前使用的模型 ID
     */
    protected getModel(params: ChatCompletionParams): string {
        return params.model || this.config.model || 'gpt-4o-mini'; // 默认回退
    }
}
