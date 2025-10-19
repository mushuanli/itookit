// #llm/core/providers/claude.js

import { BaseProvider } from './base.js';
import { LLMError } from '../errors.js';
import { processAttachment } from '../utils/file-processor.js';
// +++ 导入共享数据
import { LLM_PROVIDER_DEFAULTS } from '../../../config/configData.js';

export class ClaudeProvider extends BaseProvider {
    constructor(config) {
        super(config);
        this.providerName = 'anthropic';
        // +++ 使用新的默认值逻辑
        const defaultBaseURL = LLM_PROVIDER_DEFAULTS[this.providerName]?.baseURL;
        this.apiBaseUrl = config.apiBaseUrl || defaultBaseURL;
    }

    /**
     * 将标准消息格式转换为 Anthropic API 的格式。
     * - 将 system 角色的消息提取为顶级的 system 属性。
     * - 确保消息严格按照 user/assistant 交替。
     * - 处理并转换图像附件。
     */
    async _prepareMessages(messages) {
        let systemPrompt = '';
        const filteredMessages = [];
        let lastRole = null;

        for (const message of messages) {
            if (message.role === 'system') {
                systemPrompt = Array.isArray(message.content) ? message.content.find(p => p.type === 'text')?.text : message.content;
                continue;
            }
            
            // 确保 user/assistant 交替
            if (message.role === lastRole) {
                // 合并连续的同角色消息
                const lastMessage = filteredMessages[filteredMessages.length - 1];
                const newContent = Array.isArray(message.content) ? message.content : [{ type: 'text', text: message.content }];
                lastMessage.content.push(...newContent);
            } else {
                filteredMessages.push({ ...message });
                lastRole = message.role;
            }
        }
        
        // 转换内容格式
        const contents = [];
        for (const message of filteredMessages) {
             const contentParts = [];
             const sourceContent = Array.isArray(message.content) ? message.content : [{ type: 'text', text: message.content }];

             for(const part of sourceContent) {
                 if (part.type === 'text') {
                     contentParts.push({ type: 'text', text: part.text });
                 } else if (part.type === 'image_url') {
                     const { mimeType, base64 } = await processAttachment(part.image_url.url);
                     contentParts.push({
                         type: 'image',
                         source: { type: 'base64', media_type: mimeType, data: base64 }
                     });
                 }
             }
             contents.push({ role: message.role, content: contentParts });
        }

        return { system: systemPrompt || undefined, messages: contents };
    }

    /**
     * 将 Anthropic 的响应标准化为库的内部格式。
     */
    _normalizeResponse(claudeResponse) {
        const content = claudeResponse.content.map(block => block.text).join('');
        return {
            id: claudeResponse.id,
            object: 'chat.completion',
            model: claudeResponse.model,
            choices: [{
                index: 0,
                message: { role: 'assistant', content },
                finish_reason: claudeResponse.stop_reason,
            }],
            usage: claudeResponse.usage,
        };
    }
    
    _normalizeStreamChunk(chunk) {
        let delta = {};
        if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
            delta = { content: chunk.delta.text };
        }
        
        let finish_reason = null;
        if (chunk.type === 'message_delta') {
            finish_reason = chunk.delta.stop_reason;
        }

        return {
            id: null,
            object: 'chat.completion.chunk',
            model: this.model, // Model info not in every chunk
            choices: [{ index: 0, delta, finish_reason }]
        };
    }
    
    async _fetchAPI(body, signal) {
        const response = await fetch(this.apiBaseUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': this.apiKey,
                'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify(body),
            signal,
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ error: { message: response.statusText }}));
            throw new LLMError(errorData.error.message, {
                cause: errorData, provider: this.providerName, statusCode: response.status
            });
        }
        return response;
    }

    async create(params, signal) {
        const { system, messages } = await this._prepareMessages(params.messages);
        const body = {
            model: params.model || this.model,
            system,
            messages,
            max_tokens: params.options?.max_tokens || 4096, // Anthropic requires max_tokens
            stream: false,
            ...(params.options || {}),
        };

        const response = await this._fetchAPI(body, signal);
        const data = await response.json();
        return this._normalizeResponse(data);
    }

    async* stream(params, signal) {
        const { system, messages } = await this._prepareMessages(params.messages);
        const body = {
            model: params.model || this.model,
            system,
            messages,
            max_tokens: params.options?.max_tokens || 4096,
            stream: true,
            ...(params.options || {}),
        };

        const response = await this._fetchAPI(body, signal);
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop(); // Keep incomplete line

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const data = line.substring(6).trim();
                    try {
                        const parsed = JSON.parse(data);
                        yield this._normalizeStreamChunk(parsed);
                    } catch (e) {
                        // Ignore non-json lines like event: message_stop
                    }
                }
            }
        }
    }
}
