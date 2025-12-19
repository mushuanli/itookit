// @file: llm-driver/providers/openai.ts

import { BaseProvider } from './base';
import {
    LLMProviderConfig,
    ChatCompletionParams,
    ChatCompletionResponse,
    ChatCompletionChunk,
    ChatMessage
} from '../types';
import { parseSSEStream } from '../utils/stream';

/**
 * OpenAI Compatible Provider
 * 
 * 支持：OpenAI, DeepSeek, Groq, OpenRouter, Ollama 等
 */
export class OpenAIProvider extends BaseProvider {
    readonly name = 'openai';
    
    constructor(config: LLMProviderConfig) {
        super(config);
        if (!this.baseURL) {
            this.baseURL = 'https://api.openai.com/v1';
        }
    }
    
    /**
     * 非流式请求
     */
    async create(params: ChatCompletionParams): Promise<ChatCompletionResponse> {
        const url = `${this.baseURL}/chat/completions`;
        const body = this.buildRequestBody(params);
        
        const response = await this.fetchJSON<any>(url, {
            method: 'POST',
            headers: this.buildHeaders(),
            body: JSON.stringify(body),
            signal: params.signal
        });
        
        return this.normalizeResponse(response);
    }
    
    /**
     * 流式请求
     */
    async *stream(params: ChatCompletionParams): AsyncGenerator<ChatCompletionChunk> {
        const url = `${this.baseURL}/chat/completions`;
        const body = this.buildRequestBody({ ...params, stream: true });
        
        const stream = await this.fetchStream(url, {
            method: 'POST',
            headers: this.buildHeaders(),
            body: JSON.stringify(body),
            signal: params.signal
        });
        
        for await (const data of parseSSEStream(stream)) {
            if (data === '[DONE]') break;
            
            try {
                const chunk = JSON.parse(data);
                yield this.normalizeChunk(chunk);
            } catch {
                // 忽略解析错误
            }
        }
    }
    
    // ============== 请求构建 ==============
    
    protected buildHeaders(): Record<string, string> {
        const headers = super.buildHeaders();
        headers['Authorization'] = `Bearer ${this.config.apiKey}`;
        
        // OpenRouter 需要 Referer
        if (this.config.requiresReferer) {
            headers['HTTP-Referer'] = 'https://itookit.com';
            headers['X-Title'] = 'iTookit';
        }
        
        // Organization ID
        if (this.config.metadata?.organizationId) {
            headers['OpenAI-Organization'] = this.config.metadata.organizationId;
        }
        
        return headers;
    }
    
    protected buildRequestBody(params: ChatCompletionParams): Record<string, any> {
        const body: Record<string, any> = {
            model: this.getModel(params),
            messages: this.convertMessages(params.messages),
            stream: params.stream || false
        };
        
        // 基础参数
        if (params.temperature !== undefined) body.temperature = params.temperature;
        if (params.maxTokens !== undefined) body.max_tokens = params.maxTokens;
        if (params.topP !== undefined) body.top_p = params.topP;
        if (params.stop !== undefined) body.stop = params.stop;
        if (params.frequencyPenalty !== undefined) body.frequency_penalty = params.frequencyPenalty;
        if (params.presencePenalty !== undefined) body.presence_penalty = params.presencePenalty;
        if (params.seed !== undefined) body.seed = params.seed;
        if (params.user !== undefined) body.user = params.user;
        
        // 响应格式
        if (params.responseFormat) {
            body.response_format = params.responseFormat;
        }
        
        // 工具
        if (params.tools && params.tools.length > 0) {
            body.tools = params.tools;
            if (params.toolChoice) body.tool_choice = params.toolChoice;
        }
        
        // 思考模式 (o1/o3)
        if (params.thinking && params.reasoningEffort) {
            body.reasoning_effort = params.reasoningEffort;
        }
        
        // 流式选项
        if (params.stream) {
            body.stream_options = { include_usage: true };
        }
        
        return body;
    }
    
    protected convertMessages(messages: ChatMessage[]): any[] {
        return messages.map(msg => {
            const converted: any = {
                role: msg.role,
                content: msg.content
            };
            
            if (msg.name) converted.name = msg.name;
            if (msg.tool_call_id) converted.tool_call_id = msg.tool_call_id;
            
            return converted;
        });
    }
    
    // ============== 响应标准化 ==============
    
    protected normalizeResponse(response: any): ChatCompletionResponse {
        const choice = response.choices?.[0];
        const message = choice?.message || {};
        
        // 提取思考内容 (DeepSeek R1 使用 reasoning_content)
        let thinking: string | undefined;
        if (message.reasoning_content) {
            thinking = message.reasoning_content;
        }
        
        return {
            id: response.id,
            object: response.object,
            created: response.created,
            model: response.model,
            choices: [{
                index: choice?.index || 0,
                message: {
                    role: 'assistant',
                    content: message.content || '',
                    thinking,
                    tool_calls: message.tool_calls
                },
                finish_reason: choice?.finish_reason || 'stop'
            }],
            usage: response.usage ? {
                prompt_tokens: response.usage.prompt_tokens,
                completion_tokens: response.usage.completion_tokens,
                total_tokens: response.usage.total_tokens
            } : undefined
        };
    }
    
    protected normalizeChunk(chunk: any): ChatCompletionChunk {
        const choice = chunk.choices?.[0];
        const delta = choice?.delta || {};
        
        // 处理思考内容
        let thinking: string | undefined;
        if (delta.reasoning_content) {
            thinking = delta.reasoning_content;
        }
        
        return {
            id: chunk.id,
            object: chunk.object,
            created: chunk.created,
            model: chunk.model,
            choices: [{
                index: choice?.index || 0,
                delta: {
                    role: delta.role,
                    content: delta.content,
                    thinking,
                    tool_calls: delta.tool_calls
                },
                finish_reason: choice?.finish_reason
            }],
            usage: chunk.usage
        };
    }
}
