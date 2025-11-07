/**
 * @file src/providers/openai.js
 * @description Adapter for OpenAI and OpenAI-compatible APIs.
 */
import { BaseProvider } from './base.js';
import { LLMError } from '../errors.js';
import { processAttachment } from '../utils/file-processor.js';

export class OpenAICompatibleProvider extends BaseProvider {
    constructor(config) {
        super(config);
        this.providerName = config.provider;
        this.apiBaseUrl = config.apiBaseUrl;
        this.supportsThinking = config.supportsThinking || false;
        this.defaultModel = this.model || 'gpt-4o-mini';
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
                    newContent.push(part);
                } else if (part.type === 'image_url') {
                    const source = part.image_url.url;
                    const { mimeType, base64 } = await processAttachment(source);
                    newContent.push({
                        type: 'image_url',
                        image_url: { url: `data:${mimeType};base64,${base64}` }
                    });
                } else if (part.type === 'document') {
                    // Support for documents (PDFs, etc.)
                    const source = part.document?.url || part.url;
                    const { mimeType, base64 } = await processAttachment(source);
                    if (mimeType === 'application/pdf') {
                        newContent.push({
                            type: 'document',
                            document: { 
                                url: `data:${mimeType};base64,${base64}`,
                                mime_type: mimeType 
                            }
                        });
                    }
                }
            }
            processedMessages.push({ ...message, content: newContent });
        }
        return processedMessages;
    }

    async _fetchAPI(body, signal) {
        const headers = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.apiKey}`,
        };
        
        if (this.providerName === 'openrouter') {
            headers['HTTP-Referer'] = /** @type {any} */ (this.config).referer || 'http://localhost';
            headers['X-Title'] = /** @type {any} */ (this.config).title || 'LLMCore App';
        }

        const response = await fetch(this.apiBaseUrl, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
            signal,
        });

        if (!response.ok) {
            let errorMessage = response.statusText;
            try {
                const errorData = await response.json();
                errorMessage = errorData?.error?.message || errorData?.message || JSON.stringify(errorData);
            } catch (e) {
                // Ignore JSON parsing errors
                // We already have the statusText as a fallback, which is sufficient.
                console.error("Failed to parse error response as JSON.", e);
            }

            throw new LLMError(errorMessage, {
                provider: this.providerName,
                statusCode: response.status,
            });
        }
        return response;
    }

    async create(params, signal) {
        const messages = await this._prepareMessages(params.messages);
        const modelToUse = params.model || this.defaultModel;
        
        if (!modelToUse) {
            throw new LLMError('No model specified', {
                provider: this.providerName,
                statusCode: 400
            });
        }
        
        /** @type {Record<string, any>} */
        const body = {
            model: modelToUse,
            messages,
            stream: false,
        };

        // Add thinking support for compatible models
        if (params.thinking && this.supportsThinking) {
            body.reasoning_effort = params.reasoningEffort || 'medium';
        }

        // Add optional parameters
        if (params.temperature !== undefined) body.temperature = params.temperature;
        if (params.maxTokens) body.max_tokens = params.maxTokens;
        if (params.topP !== undefined) body.top_p = params.topP;
        if (params.tools) body.tools = params.tools;
        if (params.toolChoice) body.tool_choice = params.toolChoice;
        
        const response = await this._fetchAPI(body, signal);
        const data = await response.json();

        // Extract thinking if present
        if (data.choices?.[0]?.message?.reasoning_content) {
            data.choices[0].message.thinking = data.choices[0].message.reasoning_content;
        }

        return data;
    }

    async* stream(params, signal) {
        const modelToUse = params.model || this.defaultModel;
        
        if (!modelToUse) {
            throw new LLMError('No model specified', {
                provider: this.providerName,
                statusCode: 400
            });
        }

        const messages = await this._prepareMessages(params.messages);
        /** @type {Record<string, any>} */
        const body = {
            model: modelToUse,
            messages,
            stream: true,
            stream_options: { include_usage: true }
        };

        // Add thinking support
        if (params.thinking && this.supportsThinking) {
            body.reasoning_effort = params.reasoningEffort || 'medium';
        }

        if (params.temperature !== undefined) body.temperature = params.temperature;
        if (params.maxTokens) body.max_tokens = params.maxTokens;
        if (params.topP !== undefined) body.top_p = params.topP;
        if (params.tools) body.tools = params.tools;
        if (params.toolChoice) body.tool_choice = params.toolChoice;

        const response = await this._fetchAPI(body, signal);
        const reader = response.body.getReader();
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
                    const data = line.substring(6).trim();
                    if (data === '[DONE]') return;
                    
                    try {
                        const parsedData = JSON.parse(data);
                        const delta = parsedData.choices?.[0]?.delta;
                        
                        if (!delta) continue;

                        const chunk = { choices: [{ delta: {}, finish_reason: null }] };

                        // Handle thinking content
                        if (delta.reasoning_content) {
                            chunk.choices[0].delta.thinking = delta.reasoning_content;
                        }

                        // Handle regular content
                        if (delta.content) {
                            chunk.choices[0].delta.content = delta.content;
                        }

                        // Handle tool calls
                        if (delta.tool_calls) {
                            chunk.choices[0].delta.tool_calls = delta.tool_calls;
                        }

                        // Add finish reason
                        if (parsedData.choices[0]?.finish_reason) {
                            chunk.choices[0].finish_reason = parsedData.choices[0].finish_reason;
                        }

                        // Only yield if there's actual content
                        if (delta.reasoning_content || delta.content || delta.tool_calls) {
                            yield chunk;
                        }

                    } catch (e) {
                        console.error('Failed to parse stream chunk:', data, e);
                    }
                }
            }
        }
    }
}
