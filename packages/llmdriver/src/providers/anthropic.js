/**
 * @file src/providers/anthropic.js
 * @description Adapter for Anthropic Claude API.
 */
import { BaseProvider } from './base.js';
import { LLMError } from '../errors.js';
import { processAttachment } from '../utils/file-processor.js';

export class AnthropicProvider extends BaseProvider {
    constructor(config) {
        super(config);
        this.providerName = config.provider;
        this.apiBaseUrl = config.apiBaseUrl;
        this.apiVersion = '2023-06-01';
        this.supportsThinking = config.supportsThinking || false;
        this.defaultModel = this.model || 'claude-3-5-sonnet-20241022';
    }

    async _prepareMessages(messages) {
        const processedMessages = [];
        for (const message of messages) {
            if (!Array.isArray(message.content)) {
                processedMessages.push(message);
                continue;
            }

            const newContent = [];
            for (const part of message.content) {
                if (part.type === 'text') {
                    newContent.push({ type: 'text', text: part.text });
                } else if (part.type === 'image_url') {
                    const source = part.image_url.url;
                    const { mimeType, base64 } = await processAttachment(source);
                    newContent.push({
                        type: 'image',
                        source: {
                            type: 'base64',
                            media_type: mimeType,
                            data: base64
                        }
                    });
                } else if (part.type === 'document') {
                    const source = part.document?.url || part.url;
                    const { mimeType, base64 } = await processAttachment(source);
                    newContent.push({
                        type: 'document',
                        source: {
                            type: 'base64',
                            media_type: mimeType,
                            data: base64
                        }
                    });
                }
            }
            processedMessages.push({ ...message, content: newContent });
        }
        return processedMessages;
    }
    
    _transformMessages(messages) {
        const systemMessages = messages.filter(m => m.role === 'system');
        const conversationMessages = messages.filter(m => m.role !== 'system');
        const systemPrompt = systemMessages.map(m => m.content).join('\n');
        
        return {
            system: systemPrompt || undefined,
            messages: conversationMessages.map(msg => ({
                role: msg.role === 'assistant' ? 'assistant' : 'user',
                content: msg.content
            }))
        };
    }
    
    async _fetchAPI(body, signal) {
        const headers = {
            'Content-Type': 'application/json',
            'x-api-key': this.apiKey,
            'anthropic-version': this.apiVersion,
        };

        // Enable extended thinking if requested
        if (body.thinking_budget && this.supportsThinking) {
            headers['anthropic-beta'] = 'max-tokens-3-5-sonnet-2024-07-15';
        }

        const response = await fetch(this.apiBaseUrl, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
            signal,
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ 
                error: { message: response.statusText } 
            }));
            throw new LLMError(errorData.error?.message || 'Anthropic API error', {
                provider: this.providerName,
                statusCode: response.status,
            });
        }
        return response;
    }

    async create(params, signal) {
        const messages = await this._prepareMessages(params.messages);
        const transformed = this._transformMessages(messages);
        const modelToUse = params.model || this.defaultModel;
        
        /** @type {Record<string, any>} */
        const body = {
            model: modelToUse,
            max_tokens: params.maxTokens || 4096,
            ...transformed,
            stream: false,
        };

        // Add thinking support
        if (params.thinking && this.supportsThinking) {
            body.thinking = {
                type: 'enabled',
                budget_tokens: params.thinkingBudget || 10000
            };
        }
        
        if (params.temperature !== undefined) body.temperature = params.temperature;
        if (params.topP !== undefined) body.top_p = params.topP;
        if (params.tools) body.tools = this._transformTools(params.tools);
        
        Object.keys(body).forEach(key => body[key] === undefined && delete body[key]);
        
        const response = await this._fetchAPI(body, signal);
        const data = await response.json();
        
        // Transform response to OpenAI format
        const result = {
            choices: [{
                message: {
                    role: 'assistant',
                    content: data.content.find(c => c.type === 'text')?.text || ''
                },
                finish_reason: data.stop_reason
            }],
            usage: data.usage,
            model: data.model
        };

        // Add thinking if present
        const thinkingBlock = data.content.find(c => c.type === 'thinking');
        if (thinkingBlock) {
            result.choices[0].message.thinking = thinkingBlock.thinking;
        }

        return result;
    }
    
    async* stream(params, signal) {
        const messages = await this._prepareMessages(params.messages);
        const transformed = this._transformMessages(messages);
        const modelToUse = params.model || this.defaultModel;
        
        /** @type {Record<string, any>} */
        const body = {
            model: modelToUse,
            max_tokens: params.maxTokens || 4096,
            ...transformed,
            stream: true,
        };

        // Add thinking support
        if (params.thinking && this.supportsThinking) {
            body.thinking = {
                type: 'enabled',
                budget_tokens: params.thinkingBudget || 10000
            };
        }
        
        if (params.temperature !== undefined) body.temperature = params.temperature;
        if (params.topP !== undefined) body.top_p = params.topP;
        
        Object.keys(body).forEach(key => body[key] === undefined && delete body[key]);
        
        const response = await this._fetchAPI(body, signal);
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n\n');
            buffer = lines.pop() || '';

            for (const chunk of lines) {
                const parts = chunk.split('\n');
                for (const part of parts) {
                    if (part.startsWith('data: ')) {
                        try {
                            const data = JSON.parse(part.substring(6));
                            
                            if (data.type === 'content_block_start') {
                                // Thinking block started
                                if (data.content_block?.type === 'thinking') {
                                    yield { 
                                        choices: [{ 
                                            delta: { thinking_start: true } 
                                        }] 
                                    };
                                }
                            } else if (data.type === 'content_block_delta') {
                                const chunk = { choices: [{ delta: {} }] };
                                
                                if (data.delta?.type === 'thinking_delta') {
                                    chunk.choices[0].delta.thinking = data.delta.thinking;
                                } else if (data.delta?.type === 'text_delta') {
                                    chunk.choices[0].delta.content = data.delta.text;
                                }
                                
                                yield chunk;
                            } else if (data.type === 'message_stop') {
                                yield { 
                                    choices: [{ 
                                        delta: {}, 
                                        finish_reason: data.stop_reason 
                                    }] 
                                };
                            }
                        } catch (e) {
                            console.error('Failed to parse Anthropic stream chunk:', part, e);
                        }
                    }
                }
            }
        }
    }

    _transformTools(tools) {
        // Transform OpenAI tool format to Anthropic format if needed
        return tools.map(tool => ({
            name: tool.function?.name || tool.name,
            description: tool.function?.description || tool.description,
            input_schema: tool.function?.parameters || tool.parameters
        }));
    }
}
