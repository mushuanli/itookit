// @file: llm-driver/providers/gemini.ts

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
 * Google Gemini Provider
 * 
 * 特点：
 * 1. 使用 generateContent API
 * 2. 支持 thinking mode
 * 3. 不同的消息格式
 */
export class GeminiProvider extends BaseProvider {
    readonly name = 'gemini';
    
    constructor(config: LLMProviderConfig) {
        super(config);
        if (!this.baseURL) {
            this.baseURL = 'https://generativelanguage.googleapis.com/v1beta';
        }
    }
    
    async create(params: ChatCompletionParams): Promise<ChatCompletionResponse> {
        const model = this.getModel(params);
        const url = `${this.baseURL}/models/${model}:generateContent?key=${this.config.apiKey}`;
        const body = this.buildRequestBody(params);
        
        const response = await this.fetchJSON<any>(url, {
            method: 'POST',
            headers: this.buildHeaders(),
            body: JSON.stringify(body),
            signal: params.signal
        });
        
        return this.normalizeResponse(response, model);
    }
    
    async *stream(params: ChatCompletionParams): AsyncGenerator<ChatCompletionChunk> {
        const model = this.getModel(params);
        const url = `${this.baseURL}/models/${model}:streamGenerateContent?alt=sse&key=${this.config.apiKey}`;
        const body = this.buildRequestBody(params);
        
        const stream = await this.fetchStream(url, {
            method: 'POST',
            headers: this.buildHeaders(),
            body: JSON.stringify(body),
            signal: params.signal
        });
        
        for await (const data of parseSSEStream(stream)) {
            try {
                const event = JSON.parse(data);
                const chunk = this.normalizeChunk(event, model);
                if (chunk) yield chunk;
            } catch {
                // 忽略解析错误
            }
        }
    }
    
    // ============== 请求构建 ==============
    
    protected buildHeaders(): Record<string, string> {
        return {
            'Content-Type': 'application/json'
            // API key 在 URL 中
        };
    }
    
    protected buildRequestBody(params: ChatCompletionParams): Record<string, any> {
        const { systemInstruction, contents } = this.convertMessages(params.messages);
        
        const body: Record<string, any> = {
            contents
        };
        
        // System instruction
        if (systemInstruction) {
            body.systemInstruction = { parts: [{ text: systemInstruction }] };
        }
        
        // Generation config
        const generationConfig: Record<string, any> = {};
        
        if (params.temperature !== undefined) generationConfig.temperature = params.temperature;
        if (params.maxTokens !== undefined) generationConfig.maxOutputTokens = params.maxTokens;
        if (params.topP !== undefined) generationConfig.topP = params.topP;
        if (params.stop !== undefined) {
            generationConfig.stopSequences = Array.isArray(params.stop) ? params.stop : [params.stop];
        }
        
        if (Object.keys(generationConfig).length > 0) {
            body.generationConfig = generationConfig;
        }
        
        // Thinking mode
        if (params.thinking) {
            body.generationConfig = body.generationConfig || {};
            body.generationConfig.thinkingConfig = {
                thinkingBudget: params.thinkingBudget || 8000
            };
        }
        
        // 工具
        if (params.tools && params.tools.length > 0) {
            body.tools = [{
                functionDeclarations: params.tools.map(tool => ({
                    name: tool.function.name,
                    description: tool.function.description,
                    parameters: tool.function.parameters
                }))
            }];
        }
        
        return body;
    }
    
    /**
     * 转换消息格式
     */
    private convertMessages(messages: ChatMessage[]): {
        systemInstruction: string | null;
        contents: any[];
    } {
        let systemInstruction: string | null = null;
        const contents: any[] = [];
        
        for (const msg of messages) {
            if (msg.role === 'system') {
                const text = typeof msg.content === 'string' 
                    ? msg.content 
                    : msg.content.map(p => p.type === 'text' ? p.text : '').join('\n');
                    
                systemInstruction = systemInstruction 
                    ? `${systemInstruction}\n\n${text}` 
                    : text;
            } else {
                contents.push({
                    role: msg.role === 'assistant' ? 'model' : 'user',
                    parts: this.convertParts(msg.content)
                });
            }
        }
        
        return { systemInstruction, contents };
    }
    
    private convertParts(content: ChatMessage['content']): any[] {
        if (typeof content === 'string') {
            return [{ text: content }];
        }
        
        return content.map(part => {
            if (part.type === 'text') {
                return { text: part.text };
            }
            if (part.type === 'image_url') {
                const url = part.image_url.url;
                if (url.startsWith('data:')) {
                    const [header, data] = url.split(',');
                    const mimeType = header.match(/data:(.*?);/)?.[1] || 'image/jpeg';
                    return {
                        inlineData: {
                            mimeType,
                            data
                        }
                    };
                }
                return {
                    fileData: {
                        fileUri: url
                    }
                };
            }
            return { text: '' };
        });
    }
    
    // ============== 响应标准化 ==============
    
    protected normalizeResponse(response: any, model: string): ChatCompletionResponse {
        const candidate = response.candidates?.[0];
        const parts = candidate?.content?.parts || [];
        
        let content = '';
        let thinking = '';
        const toolCalls: any[] = [];
        
        for (const part of parts) {
            if (part.text) {
                content += part.text;
            }
            if (part.thought) {
                thinking += part.thought;
            }
            if (part.functionCall) {
                toolCalls.push({
                    id: `call_${Date.now()}_${toolCalls.length}`,
                    type: 'function',
                    function: {
                        name: part.functionCall.name,
                        arguments: JSON.stringify(part.functionCall.args)
                    }
                });
            }
        }
        
        return {
            id: `gemini-${Date.now()}`,
            model,
            choices: [{
                index: 0,
                message: {
                    role: 'assistant',
                    content,
                    thinking: thinking || undefined,
                    tool_calls: toolCalls.length > 0 ? toolCalls : undefined
                },
                finish_reason: this.mapFinishReason(candidate?.finishReason)
            }],
            usage: response.usageMetadata ? {
                prompt_tokens: response.usageMetadata.promptTokenCount || 0,
                completion_tokens: response.usageMetadata.candidatesTokenCount || 0,
                total_tokens: response.usageMetadata.totalTokenCount || 0,
                thinking_tokens: response.usageMetadata.thoughtsTokenCount
            } : undefined
        };
    }
    
    protected normalizeChunk(event: any, model: string): ChatCompletionChunk | null {
        const candidate = event.candidates?.[0];
        if (!candidate) return null;
        
        const parts = candidate.content?.parts || [];
        
        let content = '';
        let thinking = '';
        const toolCalls: any[] = [];
        
        for (const part of parts) {
            if (part.text) {
                content += part.text;
            }
            if (part.thought) {
                thinking += part.thought;
            }
            if (part.functionCall) {
                toolCalls.push({
                    index: toolCalls.length,
                    id: `call_${Date.now()}_${toolCalls.length}`,
                    type: 'function',
                    function: {
                        name: part.functionCall.name,
                        arguments: JSON.stringify(part.functionCall.args)
                    }
                });
            }
        }
        
        // 如果没有任何内容，跳过
        if (!content && !thinking && toolCalls.length === 0) {
            return null;
        }
        
        return {
            id: `gemini-${Date.now()}`,
            model,
            choices: [{
                index: 0,
                delta: {
                    content: content || undefined,
                    thinking: thinking || undefined,
                    tool_calls: toolCalls.length > 0 ? toolCalls : undefined
                },
                finish_reason: this.mapFinishReason(candidate.finishReason)
            }],
            usage: event.usageMetadata ? {
                prompt_tokens: event.usageMetadata.promptTokenCount || 0,
                completion_tokens: event.usageMetadata.candidatesTokenCount || 0,
                total_tokens: event.usageMetadata.totalTokenCount || 0
            } : undefined
        };
    }
    
    private mapFinishReason(reason: string | null): 'stop' | 'length' | 'tool_calls' | null {
        switch (reason) {
            case 'STOP': return 'stop';
            case 'MAX_TOKENS': return 'length';
            case 'TOOL_CODE': return 'tool_calls';
            default: return null;
        }
    }
}
