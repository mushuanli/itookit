// @file: llm-driver/providers/anthropic.ts

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
 * Anthropic Provider
 * 
 * 特点：
 * 1. 使用不同的 API 结构
 * 2. 支持 extended thinking
 * 3. System message 单独处理
 */
export class AnthropicProvider extends BaseProvider {
    readonly name = 'anthropic';
    
    private readonly API_VERSION = '2023-06-01';
    
    constructor(config: LLMProviderConfig) {
        super(config);
        if (!this.baseURL) {
            this.baseURL = 'https://api.anthropic.com';
        }
    }
    
    async create(params: ChatCompletionParams): Promise<ChatCompletionResponse> {
        const url = `${this.baseURL}/v1/messages`;
        const body = this.buildRequestBody(params);
        
        const response = await this.fetchJSON<any>(url, {
            method: 'POST',
            headers: this.buildHeaders(),
            body: JSON.stringify(body),
            signal: params.signal
        });
        
        return this.normalizeResponse(response);
    }
    
    async *stream(params: ChatCompletionParams): AsyncGenerator<ChatCompletionChunk> {
        const url = `${this.baseURL}/v1/messages`;
        const body = this.buildRequestBody({ ...params, stream: true });
        
        const stream = await this.fetchStream(url, {
            method: 'POST',
            headers: this.buildHeaders(),
            body: JSON.stringify(body),
            signal: params.signal
        });
        
        let currentThinking = '';
        let currentContent = '';
        
        for await (const data of parseSSEStream(stream)) {
            try {
                const event = JSON.parse(data);
                const chunk = this.normalizeStreamEvent(event, currentThinking, currentContent);
                
                if (chunk) {
                    // 更新累积状态
                    if (chunk.choices[0]?.delta.thinking) {
                        currentThinking += chunk.choices[0].delta.thinking;
                    }
                    if (chunk.choices[0]?.delta.content) {
                        currentContent += chunk.choices[0].delta.content;
                    }
                    
                    yield chunk;
                }
            } catch {
                // 忽略解析错误
            }
        }
    }
    
    // ============== 请求构建 ==============
    
    protected buildHeaders(): Record<string, string> {
        return {
            ...super.buildHeaders(),
            'x-api-key': this.config.apiKey,
            'anthropic-version': this.API_VERSION
        };
    }
    
    protected buildRequestBody(params: ChatCompletionParams): Record<string, any> {
        const { systemMessage, userMessages } = this.separateMessages(params.messages);
        
        const body: Record<string, any> = {
            model: this.getModel(params),
            messages: userMessages,
            max_tokens: params.maxTokens || 4096
        };
        
        // System message
        if (systemMessage) {
            body.system = systemMessage;
        }
        
        // 基础参数
        if (params.temperature !== undefined) body.temperature = params.temperature;
        if (params.topP !== undefined) body.top_p = params.topP;
        if (params.stop !== undefined) body.stop_sequences = Array.isArray(params.stop) ? params.stop : [params.stop];
        
        // 流式
        if (params.stream) {
            body.stream = true;
        }
        
        // Extended Thinking
        if (params.thinking) {
            const budget = params.thinkingBudget || this.config.metadata?.thinkingBudget || 10000;
            body.thinking = {
                type: 'enabled',
                budget_tokens: budget
            };
        }
        
        // 工具
        if (params.tools && params.tools.length > 0) {
            body.tools = params.tools.map(tool => ({
                name: tool.function.name,
                description: tool.function.description,
                input_schema: tool.function.parameters
            }));
            
            if (params.toolChoice === 'required') {
                body.tool_choice = { type: 'any' };
            } else if (params.toolChoice === 'none') {
                body.tool_choice = { type: 'none' };
            } else if (typeof params.toolChoice === 'object') {
                body.tool_choice = { 
                    type: 'tool', 
                    name: params.toolChoice.function.name 
                };
            }
        }
        
        return body;
    }
    
    /**
     * 分离 System 消息
     */
    private separateMessages(messages: ChatMessage[]): {
        systemMessage: string | null;
        userMessages: any[];
    } {
        let systemMessage: string | null = null;
        const userMessages: any[] = [];
        
        for (const msg of messages) {
            if (msg.role === 'system') {
                // 合并多个 system 消息
                const content = typeof msg.content === 'string' 
                    ? msg.content 
                    : msg.content.map(p => p.type === 'text' ? p.text : '').join('\n');
                    
                systemMessage = systemMessage 
                    ? `${systemMessage}\n\n${content}` 
                    : content;
            } else {
                userMessages.push({
                    role: msg.role === 'assistant' ? 'assistant' : 'user',
                    content: this.convertContent(msg.content)
                });
            }
        }
        
        return { systemMessage, userMessages };
    }
    
    /**
     * 转换内容格式
     */
    private convertContent(content: ChatMessage['content']): any {
        if (typeof content === 'string') {
            return content;
        }
        
        return content.map(part => {
            if (part.type === 'text') {
                return { type: 'text', text: part.text };
            }
            if (part.type === 'image_url') {
                // Anthropic 使用 base64
                const url = part.image_url.url;
                if (url.startsWith('data:')) {
                    const [header, data] = url.split(',');
                    const mediaType = header.match(/data:(.*?);/)?.[1] || 'image/jpeg';
                    return {
                        type: 'image',
                        source: {
                            type: 'base64',
                            media_type: mediaType,
                            data
                        }
                    };
                }
                return {
                    type: 'image',
                    source: {
                        type: 'url',
                        url
                    }
                };
            }
            return { type: 'text', text: '' };
        });
    }
    
    // ============== 响应标准化 ==============
    
    protected normalizeResponse(response: any): ChatCompletionResponse {
        let content = '';
        let thinking = '';
        const toolCalls: any[] = [];
        
        // 处理 content blocks
        for (const block of response.content || []) {
            if (block.type === 'text') {
                content += block.text;
            } else if (block.type === 'thinking') {
                thinking += block.thinking;
            } else if (block.type === 'tool_use') {
                toolCalls.push({
                    id: block.id,
                    type: 'function',
                    function: {
                        name: block.name,
                        arguments: JSON.stringify(block.input)
                    }
                });
            }
        }
        
        return {
            id: response.id,
            model: response.model,
            choices: [{
                index: 0,
                message: {
                    role: 'assistant',
                    content,
                    thinking: thinking || undefined,
                    tool_calls: toolCalls.length > 0 ? toolCalls : undefined
                },
                finish_reason: this.mapStopReason(response.stop_reason)
            }],
            usage: response.usage ? {
                prompt_tokens: response.usage.input_tokens,
                completion_tokens: response.usage.output_tokens,
                total_tokens: response.usage.input_tokens + response.usage.output_tokens
            } : undefined
        };
    }
    
    protected normalizeStreamEvent(
        event: any,
        currentThinking: string,
        currentContent: string
    ): ChatCompletionChunk | null {
        const type = event.type;
        
        switch (type) {
            case 'message_start':
                return {
                    id: event.message?.id,
                    model: event.message?.model,
                    choices: [{
                        index: 0,
                        delta: { role: 'assistant' },
                        finish_reason: null
                    }]
                };
                
            case 'content_block_delta':
                const delta = event.delta;
                
                if (delta?.type === 'thinking_delta') {
                    return {
                        choices: [{
                            index: 0,
                            delta: { thinking: delta.thinking },
                            finish_reason: null
                        }]
                    };
                }
                
                if (delta?.type === 'text_delta') {
                    return {
                        choices: [{
                            index: 0,
                            delta: { content: delta.text },
                            finish_reason: null
                        }]
                    };
                }
                
                if (delta?.type === 'input_json_delta') {
                    // 工具调用参数增量
                    return {
                        choices: [{
                            index: 0,
                            delta: {
                                tool_calls: [{
                                    index: event.index || 0,
                                    function: { arguments: delta.partial_json }
                                }]
                            },
                            finish_reason: null
                        }]
                    };
                }
                
                return null;
                
            case 'message_delta':
                return {
                    choices: [{
                        index: 0,
                        delta: {},
                        finish_reason: this.mapStopReason(event.delta?.stop_reason)
                    }],
                    usage: event.usage ? {
                        prompt_tokens: 0,
                        completion_tokens: event.usage.output_tokens,
                        total_tokens: event.usage.output_tokens
                    } : undefined
                };
                
            case 'message_stop':
                return {
                    choices: [{
                        index: 0,
                        delta: {},
                        finish_reason: 'stop'
                    }]
                };
                
            default:
                return null;
        }
    }
    
    private mapStopReason(reason: string | null): 'stop' | 'length' | 'tool_calls' | null {
        switch (reason) {
            case 'end_turn': return 'stop';
            case 'max_tokens': return 'length';
            case 'tool_use': return 'tool_calls';
            default: return null;
        }
    }
}
