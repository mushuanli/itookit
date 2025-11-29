// @file: llmdriver/providers/gemini.ts

import { BaseProvider } from './base';
import { ChatCompletionParams, ChatCompletionResponse, ChatCompletionChunk } from '../types';
import { LLMError } from '../errors';
import { processAttachment } from '../utils/attachment';

export class GeminiProvider extends BaseProvider {

    private buildUrl(model: string, method: 'generateContent' | 'streamGenerateContent'): string {
        // BaseURL usually: https://generativelanguage.googleapis.com/v1beta/models
        const baseUrl = this.config.apiBaseUrl?.replace(/\/$/, '') || 'https://generativelanguage.googleapis.com/v1beta/models';
        return `${baseUrl}/${model}:${method}?key=${this.config.apiKey}`;
    }

    private async prepareContents(messages: ChatCompletionParams['messages']) {
        const contents: any[] = [];
        let systemInstruction: any = undefined;

        for (const msg of messages) {
            if (msg.role === 'system') {
                systemInstruction = {
                    parts: [{ text: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content) }]
                };
                continue;
            }

            const parts: any[] = [];
            if (typeof msg.content === 'string') {
                parts.push({ text: msg.content });
            } else if (Array.isArray(msg.content)) {
                for (const part of msg.content) {
                    if (part.type === 'text') {
                        parts.push({ text: part.text });
                    } else if (part.type === 'image_url') {
                        const { mimeType, base64 } = await processAttachment(part.image_url.url);
                        parts.push({
                            inline_data: {
                                mime_type: mimeType,
                                data: base64
                            }
                        });
                    }
                    // Document support varies by version, usually inline_data for PDF works
                }
            }

            contents.push({
                role: msg.role === 'assistant' ? 'model' : 'user',
                parts
            });
        }
        return { contents, systemInstruction };
    }

    async create(params: ChatCompletionParams): Promise<ChatCompletionResponse> {
        const model = this.getModel(params);
        const url = this.buildUrl(model, 'generateContent');
        const { contents, systemInstruction } = await this.prepareContents(params.messages);

        const body: any = {
            contents,
            generationConfig: {
                temperature: params.temperature,
                maxOutputTokens: params.maxTokens,
                topP: params.topP,
            }
        };

        if (systemInstruction) {
            body.systemInstruction = systemInstruction;
        }

        // Gemini Thinking Config (Experimental)
        if (params.thinking) {
            // Note: Official API spec for thinking params varies. 
            // For now, we assume using a thinking model implies thinking, 
            // or pass specific config if API supports it.
            // body.generationConfig.thinking_config = { include_thoughts: true }; 
        }

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: params.signal
        });

        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new LLMError(err.error?.message || response.statusText, {
                provider: 'gemini',
                statusCode: response.status
            });
        }

        const data = await response.json();
        const candidate = data.candidates?.[0];
        
        // Parse parts for text and thought
        let text = '';
        let thought = '';
        
        if (candidate?.content?.parts) {
            for (const part of candidate.content.parts) {
                if (part.text) text += part.text;
                // Check for thought property (might vary by API version/model)
                if (part.thought) thought += part.thought; 
            }
        }

        return {
            choices: [{
                message: {
                    role: 'assistant',
                    content: text,
                    thinking: thought || undefined
                },
                finish_reason: candidate?.finishReason?.toLowerCase() || 'stop'
            }],
            usage: data.usageMetadata ? {
                prompt_tokens: data.usageMetadata.promptTokenCount,
                completion_tokens: data.usageMetadata.candidatesTokenCount,
                total_tokens: data.usageMetadata.totalTokenCount
            } : undefined,
            model: model
        };
    }

    async *stream(params: ChatCompletionParams): AsyncGenerator<ChatCompletionChunk> {
        const model = this.getModel(params);
        const url = this.buildUrl(model, 'streamGenerateContent') + '&alt=sse'; 
        // Note: &alt=sse is supported in REST API to get standard SSE, 
        // otherwise it returns a JSON array stream which is harder to parse manually.
        // If alt=sse is not supported by your specific endpoint, we need to parse JSON objects.
        
        const { contents, systemInstruction } = await this.prepareContents(params.messages);

        const body: any = {
            contents,
            generationConfig: {
                temperature: params.temperature,
                maxOutputTokens: params.maxTokens,
                topP: params.topP,
            }
        };

        if (systemInstruction) body.systemInstruction = systemInstruction;

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: params.signal
        });

        if (!response.ok) {
            throw new LLMError(response.statusText, { provider: 'gemini', statusCode: response.status });
        }

        const reader = response.body?.getReader();
        if (!reader) throw new Error('No response body');
        
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
                    const jsonStr = line.slice(6).trim();
                    if (!jsonStr) continue;
                    
                    try {
                        const data = JSON.parse(jsonStr);
                        const candidate = data.candidates?.[0];
                        
                        const chunk: ChatCompletionChunk = { 
                            choices: [{ delta: {}, finish_reason: null }] 
                        };
                        
                        let hasContent = false;
                        if (candidate?.content?.parts) {
                            for (const part of candidate.content.parts) {
                                if (part.text) {
                                    chunk.choices[0].delta.content = part.text;
                                    hasContent = true;
                                }
                                if (part.thought) {
                                    chunk.choices[0].delta.thinking = part.thought;
                                    hasContent = true;
                                }
                            }
                        }

                        if (candidate?.finishReason) {
                            chunk.choices[0].finish_reason = candidate.finishReason.toLowerCase();
                            hasContent = true; // emit finish reason
                        }

                        if (hasContent) yield chunk;

                    } catch (e) {
                        // ignore
                    }
                }
            }
        }
    }
}
