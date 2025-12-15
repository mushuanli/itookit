// @file: llmdriver/providers/anthropic.ts

import { BaseProvider } from './base';
import { ChatCompletionParams, ChatCompletionResponse, ChatCompletionChunk } from '../types';
import { LLMError } from '../errors';
import { processAttachment } from '../utils/attachment';

export class AnthropicProvider extends BaseProvider {
    private apiVersion = '2023-06-01';

    // 1. 消息预处理：提取 System Prompt，转换图片格式
    private async prepareRequest(params: ChatCompletionParams) {
        let systemPrompt: string | undefined = undefined;
        const anthropicMessages: any[] = [];

        for (const msg of params.messages) {
            if (msg.role === 'system') {
                // Anthropic 支持多个 system 消息，这里简单合并
                const content = typeof msg.content === 'string' 
                    ? msg.content 
                    : msg.content.map(c => c.type === 'text' ? c.text : '').join('\n');
                systemPrompt = systemPrompt ? `${systemPrompt}\n${content}` : content;
                continue;
            }

            const contentParts: any[] = [];
            if (typeof msg.content === 'string') {
                contentParts.push({ type: 'text', text: msg.content });
            } else if (Array.isArray(msg.content)) {
                for (const part of msg.content) {
                    if (part.type === 'text') {
                        contentParts.push({ type: 'text', text: part.text });
                    } else if (part.type === 'image_url') {
                        const { mimeType, base64 } = await processAttachment(part.image_url.url);
                        contentParts.push({
                            type: 'image',
                            source: {
                                type: 'base64',
                                media_type: mimeType,
                                data: base64
                            }
                        });
                    } else if (part.type === 'document') {
                        // Claude 支持 PDF 文档
                        const { mimeType, base64 } = await processAttachment(part.document.url);
                        contentParts.push({
                            type: 'document',
                            source: {
                                type: 'base64',
                                media_type: mimeType,
                                data: base64
                            }
                        });
                    }
                }
            }

            anthropicMessages.push({
                role: msg.role === 'assistant' ? 'assistant' : 'user',
                content: contentParts
            });
        }

        const body: any = {
            model: this.getModel(params),
            messages: anthropicMessages,
            max_tokens: params.maxTokens || 4096, // Anthropic 必需字段
            temperature: params.temperature,
            top_p: params.topP,
        };

        if (systemPrompt) {
            body.system = systemPrompt;
        }

        // Thinking Logic
        if (params.thinking && this.config.supportsThinking) {
            body.thinking = {
                type: 'enabled',
                budget_tokens: params.thinkingBudget || 1024
            };
            // 确保 max_tokens 大于 budget_tokens
            if (body.max_tokens <= body.thinking.budget_tokens) {
                body.max_tokens = body.thinking.budget_tokens + 4096;
            }
        }

        // Tools format transformation (Simplified)
        if (params.tools) {
            body.tools = params.tools.map((t: any) => ({
                name: t.function.name,
                description: t.function.description,
                input_schema: t.function.parameters
            }));
        }

        return body;
    }

    private getHeaders(isThinking: boolean) {
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            'x-api-key': this.config.apiKey,
            'anthropic-version': this.apiVersion,
            ...this.config.headers
        };
        // Thinking models might require specific beta headers
        if (isThinking) {
             // 截至目前 Claude 3.7 可能不再需要 beta header，但旧版可能需要
             // headers['anthropic-beta'] = 'output-128k-2025-02-19'; 
        }
        return headers;
    }

    async create(params: ChatCompletionParams): Promise<ChatCompletionResponse> {
        const body = await this.prepareRequest(params);
        body.stream = false;

        const response = await fetch(this.config.apiBaseUrl!, {
            method: 'POST',
            headers: this.getHeaders(!!params.thinking),
            body: JSON.stringify(body),
            signal: params.signal
        });

        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new LLMError(err.error?.message || response.statusText, {
                provider: 'anthropic',
                statusCode: response.status
            });
        }

        const data = await response.json();
        
        // 解析响应内容
        let content = '';
        let thinking = '';
        
        if (Array.isArray(data.content)) {
            data.content.forEach((block: any) => {
                if (block.type === 'text') content += block.text;
                if (block.type === 'thinking') thinking += block.thinking;
            });
        }

        return {
            choices: [{
                message: {
                    role: 'assistant',
                    content: content,
                    thinking: thinking || undefined,
                    // Tool calls mapping needs to be handled if strictly required
                },
                finish_reason: data.stop_reason
            }],
            usage: {
                prompt_tokens: data.usage?.input_tokens || 0,
                completion_tokens: data.usage?.output_tokens || 0,
                total_tokens: (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0)
            },
            model: data.model
        };
    }

    async *stream(params: ChatCompletionParams): AsyncGenerator<ChatCompletionChunk> {
        const body = await this.prepareRequest(params);
        body.stream = true;

        const response = await fetch(this.config.apiBaseUrl!, {
            method: 'POST',
            headers: this.getHeaders(!!params.thinking),
            body: JSON.stringify(body),
            signal: params.signal
        });

        if (!response.ok) {
            throw new LLMError(response.statusText, { provider: 'anthropic', statusCode: response.status });
        }

        const reader = response.body?.getReader();
        if (!reader) throw new Error('No response body');
        
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n\n'); // Anthropic SSE uses double newline
            buffer = lines.pop() || '';

            for (const line of lines) {
                const parts = line.split('\n');
                for (const part of parts) {
                    if (part.startsWith('data: ')) {
                        const dataStr = part.slice(6).trim();
                        if (dataStr === '[DONE]') return;
                        
                        try {
                            const event = JSON.parse(dataStr);
                            
                            // Handle various event types
                            if (event.type === 'content_block_start') {
                                if (event.content_block?.type === 'thinking') {
                                    // Thinking started
                                }
                            } else if (event.type === 'content_block_delta') {
                                const chunk: ChatCompletionChunk = { choices: [{ delta: {}, finish_reason: null }] };
                                
                                if (event.delta?.type === 'text_delta') {
                                    chunk.choices[0].delta.content = event.delta.text;
                                } else if (event.delta?.type === 'thinking_delta') {
                                    chunk.choices[0].delta.thinking = event.delta.thinking;
                                }
                                
                                if (chunk.choices[0].delta.content || chunk.choices[0].delta.thinking) {
                                    yield chunk;
                                }
                            } else if (event.type === 'message_delta') {
                                if (event.delta?.stop_reason) {
                                    yield {
                                        choices: [{
                                            delta: {},
                                            finish_reason: event.delta.stop_reason
                                        }]
                                    };
                                }
                            }
                        } catch (e) {
                            // ignore
                        }
                    }
                }
            }
        }
    }
}
