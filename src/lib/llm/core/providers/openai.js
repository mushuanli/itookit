/**
 * @file #llm/core/providers/openai.js
 * @description Adapter for OpenAI and OpenAI-compatible APIs (DeepSeek, OpenRouter).
 */
import { BaseProvider } from './base.js';
import { LLMError } from '../errors.js';
import { processAttachment } from '../utils/file-processor.js';
// +++ 导入共享数据
import { PROVIDER_DEFAULTS } from '../../../config/llmProvider.js';

// --- 删除旧的 PROVIDER_URLS 常量 ---

export class OpenAICompatibleProvider extends BaseProvider {
    constructor(config) {
        super(config);
        this.providerName = config.provider;
        const defaultBaseURL = PROVIDER_DEFAULTS[this.providerName]?.baseURL;
        this.apiBaseUrl = config.apiBaseUrl || defaultBaseURL;

        if (!this.apiBaseUrl) {
            // 为 custom_openai_compatible 等情况抛出错误
            throw new Error(`Base URL for provider '${this.providerName}' is not defined. Please provide it in the connection settings.`);
        }
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
                        image_url: {
                            url: `data:${mimeType};base64,${base64}`
                        }
                    });
                }
            }
            processedMessages.push({ ...message, content: newContent });
        }
        return processedMessages;
    }

    async _fetchAPI(body, signal) { // +++ Add signal parameter
        const headers = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.apiKey}`,
        };
        if (this.providerName === 'openrouter') {
            headers['HTTP-Referer'] = this.config.referer || 'http://localhost:3000';
            headers['X-Title'] = this.config.title || 'LLM Fusion Kit';
        }

        const response = await fetch(this.apiBaseUrl, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
            signal, // +++ Use the signal here
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ error: { message: response.statusText } }));
            throw new LLMError(errorData.error.message, {
                cause: errorData,
                provider: this.providerName,
                statusCode: response.status,
            });
        }
        return response;
    }

    async create(params, signal) { // +++ Add signal parameter
        const messages = await this._prepareMessages(params.messages);
        const body = {
            model: params.model || this.model,
            messages,
            stream: false,
            // Conditionally add tool parameters if they exist
            ...(params.tools && { tools: params.tools }),
            ...(params.tool_choice && { tool_choice: params.tool_choice }),
            ...(params.options || {}),
        };
        
        const response = await this._fetchAPI(body, signal); // +++ Pass signal
        return response.json();
    }

    async* stream(params, signal) { // +++ Add signal parameter
            // --- SIMULATION LOGIC FOR DEMO ---
        // In a real implementation, you would not add this block.
        // Instead, you'd parse the actual stream from the provider which might contain
        // special tokens or tags (like <thinking>...</thinking>) and yield them as thinking chunks.
        if (params.include_thinking && params.tools) {
            yield { choices: [{ delta: { thinking: "User asked a question. I should check if any tools can help." } }] };
            await new Promise(res => setTimeout(res, 300)); // Simulate processing delay
            yield { choices: [{ delta: { thinking: "The `get_current_weather` tool seems relevant." } }] };
            await new Promise(res => setTimeout(res, 300));
        }
        // --- END OF SIMULATION LOGIC ---

        const messages = await this._prepareMessages(params.messages);
        const body = {
            model: params.model || this.model,
            messages,
            stream: true,
            // Conditionally add tool parameters if they exist
            ...(params.tools && { tools: params.tools }),
            ...(params.tool_choice && { tool_choice: params.tool_choice }),
            ...(params.options || {}),
        };
        
        const response = await this._fetchAPI(body, signal); // +++ Pass signal

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop(); // Keep potentially incomplete line

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const data = line.substring(6).trim();
                    if (data === '[DONE]') {
                        return;
                    }
                    try {
                        // 2. 在这里加入真实解析逻辑
                        const parsedData = JSON.parse(data);
                        
        const delta = parsedData.choices?.[0]?.delta;
        
        if (!delta) {
            continue;
        }
        
        
        let hasYielded = false;
        
        if (params.include_thinking && delta.reasoning_content) {
            yield { choices: [{ delta: { thinking: delta.reasoning_content } }] };
            hasYielded = true;
        }
        
        if (delta.content) {

            yield {
                choices: [{
                    delta: { content: delta.content },
                    finish_reason: parsedData.choices[0]?.finish_reason || null
                }]
            };
            hasYielded = true;
        }

                        // 3. 正常 yield 原始数据，或者只 yield content 部分
                    if (!hasYielded && (delta.tool_calls || delta.function_call)) {
                        yield parsedData;
                    }

                    } catch (e) {
                        console.error('Failed to parse stream chunk:', data);
                    }
                }
            }
        }
    }
}
