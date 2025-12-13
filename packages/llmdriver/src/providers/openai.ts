// @file: llmdriver/providers/openai.ts

import { BaseProvider } from './base';
import { ChatCompletionParams, ChatCompletionResponse, ChatCompletionChunk } from '../types';
import { LLMError } from '../errors';
import { processAttachment } from '../utils/attachment';

export class OpenAICompatibleProvider extends BaseProvider {
    // 兼容 OpenAI 格式、DeepSeek、OpenRouter 等
    
    private async prepareMessages(messages: ChatCompletionParams['messages']) {
        // 1. 处理附件 (Base64 转换)
        const processedMessages = await Promise.all(messages.map(async (msg) => {
            // 如果是纯字符串，无需处理附件，但需保留对象结构以便后续处理字段映射
            if (typeof msg.content === 'string') return { ...msg };
            if (!Array.isArray(msg.content)) return { ...msg };

            const newContent: any[] = [];
            for (const part of msg.content) {
                if (part.type === 'text') {
                    newContent.push(part);
                } else if (part.type === 'image_url') {
                    const { mimeType, base64 } = await processAttachment(part.image_url.url);
                    newContent.push({
                        type: 'image_url',
                        image_url: { url: `data:${mimeType};base64,${base64}` }
                    });
                } else if (part.type === 'document') {
                    // OpenAI 暂不支持 document，但在 DeepSeek/Compatible 模式下可能支持
                    // 如果不支持，通常需要转为 text 或忽略
                    newContent.push(part); 
                }
            }
            return { ...msg, content: newContent };
        }));

        // 2. 处理字段映射 (Common: CamelCase -> API: SnakeCase)
        return processedMessages.map((msg: any) => {
            // 映射 toolCalls -> tool_calls
            if (msg.role === 'assistant' && msg.toolCalls) {
                msg.tool_calls = msg.toolCalls;
                delete msg.toolCalls;
            }
            // 映射 toolCallId -> tool_call_id
            if (msg.role === 'tool' && msg.toolCallId) {
                msg.tool_call_id = msg.toolCallId;
                delete msg.toolCallId;
            }
            return msg;
        });
    }

    async create(params: ChatCompletionParams): Promise<ChatCompletionResponse> {
        const body: any = {
            model: this.getModel(params),
            messages: await this.prepareMessages(params.messages),
            stream: false,
            temperature: params.temperature,
            max_tokens: params.maxTokens,
            top_p: params.topP,
            tools: params.tools,
            tool_choice: params.toolChoice
        };

        // Thinking Logic
        if (params.thinking && this.config.supportsThinking) {
             // DeepSeek uses reasoning_content (no specific request param usually needed if supported)
             // OpenAI o1 uses reasoning_effort
             if (params.reasoningEffort) body.reasoning_effort = params.reasoningEffort;
        }

        const headers = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.config.apiKey}`,
            ...this.config.headers
        };

        const response = await fetch(this.config.apiBaseUrl!, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
            signal: params.signal
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new LLMError(error.error?.message || response.statusText, {
                provider: this.config.provider,
                statusCode: response.status
            });
        }

        const data = await response.json();
        const choice = data.choices?.[0];

        return {
            choices: [{
                message: {
                    role: 'assistant',
                    content: choice?.message?.content || '',
                    thinking: choice?.message?.reasoning_content || undefined,
                    // 将 API 的 snake_case 转回 Common 的 camelCase (如果需要)
                    // 但 ChatCompletionResponse 定义里目前用的是 tool_calls (snake_case) 以匹配大多数 API 响应习惯
                    // 这里保持 types.ts 中的定义。
                    tool_calls: choice?.message?.tool_calls
                },
                finish_reason: choice?.finish_reason || 'stop'
            }],
            usage: data.usage,
            model: data.model
        };
    }

    async *stream(params: ChatCompletionParams): AsyncGenerator<ChatCompletionChunk> {
        const body: any = {
            model: this.getModel(params),
            messages: await this.prepareMessages(params.messages),
            stream: true,
            temperature: params.temperature,
            max_tokens: params.maxTokens,
            top_p: params.topP,
            tools: params.tools,
            tool_choice: params.toolChoice,
            stream_options: { include_usage: true }
        };

        const headers = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.config.apiKey}`,
            ...this.config.headers
        };

        const response = await fetch(this.config.apiBaseUrl!, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
            signal: params.signal
        });

        if (!response.ok) {
            throw new LLMError(response.statusText, { provider: this.config.provider, statusCode: response.status });
        }

        const reader = response.body?.getReader();
        if (!reader) throw new Error('Response body is null');

        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const dataStr = line.slice(6).trim();
                    if (dataStr === '[DONE]') return;
                    try {
                        const data = JSON.parse(dataStr);
                        const delta = data.choices?.[0]?.delta;
                        if (delta) {
                            yield {
                                choices: [{
                                    delta: {
                                        content: delta.content,
                                        thinking: delta.reasoning_content, // DeepSeek
                                        tool_calls: delta.tool_calls
                                    },
                                    finish_reason: data.choices[0]?.finish_reason || null
                                }]
                            };
                        }
                    } catch (e) {
                        // ignore parse errors
                    }
                }
            }
        }
    }
}
