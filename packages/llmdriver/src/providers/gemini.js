/**
 * @file src/providers/gemini.js
 * @description Adapter for Google Gemini API.
 */
import { BaseProvider } from './base.js';
import { LLMError } from '../errors.js';
import { processAttachment } from '../utils/file-processor.js';

export class GeminiProvider extends BaseProvider {
    constructor(config) {
        super(config);
        this.providerName = config.provider;
        this.apiBaseUrl = config.apiBaseUrl;
        this.supportsThinking = config.supportsThinking || false;
        this.defaultModel = this.model || 'gemini-1.5-pro';
    }

    /**
     * Transform OpenAI-style messages to Gemini format
     */
    async _transformMessages(messages) {
        const contents = [];
        let systemPrompt = '';
        
        for (const message of messages) {
            if (message.role === 'system') {
                systemPrompt += message.content + '\n';
                continue;
            }
            
            const parts = [];
            if (typeof message.content === 'string') {
                parts.push({ text: message.content });
            } else if (Array.isArray(message.content)) {
                for (const part of message.content) {
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
                    } else if (part.type === 'document') {
                        const source = part.document?.url || part.url;
                        const { mimeType, base64 } = await processAttachment(source);
                        parts.push({
                            inline_data: {
                                mime_type: mimeType,
                                data: base64
                            }
                        });
                    }
                }
            }
            
            contents.push({
                role: message.role === 'assistant' ? 'model' : 'user',
                parts
            });
        }
        
        if (systemPrompt && contents.length > 0) {
            const firstUserContent = contents.find(c => c.role === 'user');
            if (firstUserContent) {
                firstUserContent.parts.unshift({ text: systemPrompt.trim() });
            }
        }
        
        return contents;
    }
    
    _buildURL(model, stream = false) {
        const method = stream ? 'streamGenerateContent' : 'generateContent';
        return `${this.apiBaseUrl}/${model}:${method}?key=${this.apiKey}`;
    }

    async _fetchAPI(url, body, signal) {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal,
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ 
                error: { message: response.statusText } 
            }));
            throw new LLMError(errorData.error?.message || 'Gemini API error', {
                provider: this.providerName,
                statusCode: response.status,
            });
        }
        return response;
    }
    
    async create(params, signal) {
        const model = params.model || this.defaultModel;
        const contents = await this._transformMessages(params.messages);
        
        const body = {
            contents,
            generationConfig: {}
        };

        // Add thinking support
        if (params.thinking && this.supportsThinking) {
            body.generationConfig.thought_config = {
                mode: 'THINKING',
                max_thought_tokens: params.thinkingBudget || 8000
            };
        }

        if (params.temperature !== undefined) {
            body.generationConfig.temperature = params.temperature;
        }
        if (params.maxTokens) {
            body.generationConfig.maxOutputTokens = params.maxTokens;
        }
        if (params.topP !== undefined) {
            body.generationConfig.topP = params.topP;
        }
        
        const url = this._buildURL(model, false);
        const response = await this._fetchAPI(url, body, signal);
        const data = await response.json();
        
        // Transform to OpenAI format
        const candidate = data.candidates?.[0];
        const textParts = candidate?.content?.parts?.filter(p => p.text) || [];
        const thinkingParts = candidate?.content?.parts?.filter(p => p.thought) || [];
        
        const result = {
            choices: [{
                message: {
                    role: 'assistant',
                    content: textParts.map(p => p.text).join('')
                },
                finish_reason: candidate?.finishReason?.toLowerCase()
            }],
            usage: data.usageMetadata ? {
                prompt_tokens: data.usageMetadata.promptTokenCount,
                completion_tokens: data.usageMetadata.candidatesTokenCount,
                total_tokens: data.usageMetadata.totalTokenCount
            } : undefined,
            model: model
        };

        // Add thinking if present
        if (thinkingParts.length > 0) {
            result.choices[0].message.thinking = thinkingParts.map(p => p.thought).join('');
        }

        return result;
    }

    async* stream(params, signal) {
        const model = params.model || this.defaultModel;
        const contents = await this._transformMessages(params.messages);
        
        const body = {
            contents,
            generationConfig: {}
        };

        // Add thinking support
        if (params.thinking && this.supportsThinking) {
            body.generationConfig.thought_config = {
                mode: 'THINKING',
                max_thought_tokens: params.thinkingBudget || 8000
            };
        }

        if (params.temperature !== undefined) {
            body.generationConfig.temperature = params.temperature;
        }
        if (params.maxTokens) {
            body.generationConfig.maxOutputTokens = params.maxTokens;
        }
        if (params.topP !== undefined) {
            body.generationConfig.topP = params.topP;
        }
        
        const url = this._buildURL(model, true);
        const response = await this._fetchAPI(url, body, signal);
        
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            // FIX: Use correct variable name 'chunks' not 'lines'
            const chunks = buffer.split('\n');
            buffer = chunks.pop() || '';

            for (const line of chunks) {
                if (line.trim() === '') continue;
                
                try {
                    const parsedData = JSON.parse(line);
                    const candidate = parsedData.candidates?.[0];
                    const parts = candidate?.content?.parts || [];
                    
                    const chunk = { choices: [{ delta: {}, finish_reason: null }] };
                    
                    // Handle thinking
                    const thinkingText = parts.filter(p => p.thought).map(p => p.thought).join('');
                    if (thinkingText) {
                        chunk.choices[0].delta.thinking = thinkingText;
                    }
                    
                    // Handle content
                    const contentText = parts.filter(p => p.text).map(p => p.text).join('');
                    if (contentText) {
                        chunk.choices[0].delta.content = contentText;
                    }
                    
                    // Add finish reason
                    if (candidate?.finishReason) {
                        chunk.choices[0].finish_reason = candidate.finishReason.toLowerCase();
                    }
                    
                    // Only yield if there's actual content
                    if (thinkingText || contentText) {
                        yield chunk;
                    }
                    
                } catch (e) {
                    console.error('Failed to parse Gemini stream chunk:', line, e);
                }
            }
        }
    }
}
