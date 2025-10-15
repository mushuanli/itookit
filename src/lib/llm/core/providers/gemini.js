/**
 * @file #llm/core/providers/gemini.js
 * @description Adapter for Google Gemini API.
 */
import { BaseProvider } from './base.js';
import { LLMError } from '../errors.js';
import { processAttachment } from '../utils/file-processor.js';
// +++ 导入共享数据
import { PROVIDER_DEFAULTS } from '../../../config/llmProvider.js';

export class GeminiProvider extends BaseProvider {
    constructor(config) {
        super(config);
        this.providerName = 'gemini';
        
        // +++ Gemini 的 baseURL 比较特殊，因为它依赖模型名称
        // 我们只保存基础部分
        const defaultBaseURL = PROVIDER_DEFAULTS[this.providerName]?.baseURL;
        const providedBaseURL = config.apiBaseUrl;

        // Gemini 的 URL 格式是 BASE/MODEL:ACTION，所以我们只关心 BASE 部分
        // 这里简化处理，直接使用配置或默认值，并在请求时拼接模型
        this.apiBaseUrlPrefix = providedBaseURL || defaultBaseURL;
    }

    async _prepareContents(messages) {
        const contents = [];
        for (const message of messages) {
            // Handle tool responses
            if (message.role === 'tool') {
                contents.push({
                    role: 'user', // Gemini uses 'user' role for function responses
                    parts: [{
                        functionResponse: {
                            name: 'tool_response', // Gemini needs a function name, we can generalize
                            response: {
                                name: message.tool_call_id,
                                content: message.content,
                            }
                        }
                    }]
                });
                continue;
            }

            const geminiMsg = {
                role: message.role === 'assistant' ? 'model' : 'user',
                parts: []
            };
            const content = Array.isArray(message.content) ? message.content : [{ type: 'text', text: message.content }];
            
            for (const part of content) {
                if (part.type === 'text') {
                    geminiMsg.parts.push({ text: part.text });
                } else if (part.type === 'image_url') {
                    const { mimeType, base64 } = await processAttachment(part.image_url.url);
                    geminiMsg.parts.push({
                        inline_data: { mime_type: mimeType, data: base64 }
                    });
                }
            }
            contents.push(geminiMsg);
        }
        return contents;
    }

    _normalizeResponse(geminiResponse) {
        const candidate = geminiResponse.candidates?.[0];
        if (!candidate) {
            return {
                id: null,
                choices: [{
                    message: { role: 'assistant', content: `[Response Blocked: ${candidate?.finishReason || 'UNKNOWN'}]` },
                    finish_reason: candidate?.finishReason || 'error',
                }],
                usage: geminiResponse.usageMetadata,
            };
        }

        const firstPart = candidate.content.parts[0];

        // NEW: Normalize tool call response
        if (firstPart.functionCall) {
            return {
                id: null,
                object: 'chat.completion',
                model: this.model,
                choices: [{
                    index: 0,
                    message: {
                        role: 'assistant',
                        content: null,
                        tool_calls: [{
                            id: `call_${Date.now()}`, // Generate a temporary ID
                            type: 'function',
                            function: {
                                name: firstPart.functionCall.name,
                                arguments: JSON.stringify(firstPart.functionCall.args)
                            }
                        }]
                    },
                    finish_reason: 'tool_calls',
                }],
                usage: geminiResponse.usageMetadata,
            };
        }

        const content = candidate.content.parts.map(p => p.text).join('');
        return {
            id: null,
            object: 'chat.completion',
            model: this.model,
            choices: [{
                index: 0,
                message: { role: 'assistant', content },
                finish_reason: candidate.finishReason,
            }],
            usage: geminiResponse.usageMetadata,
        };
    }
    
    _normalizeStreamChunk(geminiChunk) {
        const text = geminiChunk.candidates?.[0]?.content?.parts?.[0]?.text || '';
        return {
            id: null,
            object: 'chat.completion.chunk',
            model: this.model,
            choices: [{
                index: 0,
                delta: { content: text },
                finish_reason: geminiChunk.candidates?.[0]?.finishReason || null
            }]
        };
    }

    async _fetchAPI(stream, body) {
        const modelForUrl = body.model || this.model;
        const action = stream ? 'streamGenerateContent' : 'generateContent';
        const url = `${this.apiBaseUrlPrefix}/${modelForUrl}:${action}?key=${this.apiKey}`;
        
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ error: { message: response.statusText }}));
            throw new LLMError(errorData.error.message, {
                cause: errorData,
                provider: this.providerName,
                statusCode: response.status,
            });
        }
        return response;
    }
    
    async create(params) {
        const contents = await this._prepareContents(params.messages);
        const body = {
            contents,
            // Translate standard tools to Gemini's format
            ...(params.tools && { tools: [{ functionDeclarations: params.tools.map(t => t.function) }] }),
            generationConfig: { ...params.options }
        };

        const response = await this._fetchAPI(false, body);
        const data = await response.json();
        return this._normalizeResponse(data);
    }
    
    async* stream(params) {
        const contents = await this._prepareContents(params.messages);
        const body = { 
            contents,
            generationConfig: {
                maxOutputTokens: params.options?.max_tokens,
                temperature: params.options?.temperature,
                topP: params.options?.top_p,
            }
        };
        
        const response = await this._fetchAPI(true, body);
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            
            buffer += decoder.decode(value, { stream: true });
            // Gemini streams an array of JSON objects. We need to parse them carefully.
            // A simple split by '},' is not robust but works for this demo.
            // A production version would use a proper streaming JSON parser.
            let boundary = buffer.lastIndexOf('}\n,');
            if (boundary === -1) boundary = buffer.lastIndexOf('}]');

            if (boundary !== -1) {
                const parsable = buffer.substring(0, boundary + 1);
                buffer = buffer.substring(boundary + 1).replace(/^,\s*/, '');
                
                try {
                  const jsonArray = JSON.parse(`[${parsable}]`);
                  for(const chunk of jsonArray) {
                      yield this._normalizeStreamChunk(chunk);
                  }
                } catch(e) {
                   console.error("Failed to parse Gemini stream chunk:", parsable);
                }
            }
        }
    }
}