// src/services/llm/adapters/openAICompatibleAdapter.js
import { BaseAdapter } from './baseAdapter.js';

export class OpenAICompatibleAdapter extends BaseAdapter {
    _preparePayload(messages) {
        return {
            model: this.config.model,
            messages: messages,
            stream: true,
        };
    }

    async chatStream(messages, { onChunk, onDone, onError }) {
        const payload = this._preparePayload(messages);
        
        try {
            const response = await fetch(this.config.apiPath, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.config.apiKey}`,
                },
                body: JSON.stringify(payload),
            });

            if (!response.ok) {
                const errorBody = await response.text();
                throw new Error(`API Error: ${response.status} ${response.statusText} - ${errorBody}`);
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder("utf-8");

            while (true) {
                const { done, value } = await reader.read();
                if (done) {
                    onDone();
                    break;
                }
                
                const chunk = decoder.decode(value);
                const lines = chunk.split('\n').filter(line => line.trim().startsWith('data:'));
                
                for (const line of lines) {
                    const data = line.replace(/^data: /, '').trim();
                    if (data === '[DONE]') {
                        onDone();
                        return;
                    }
                    try {
                        const parsed = JSON.parse(data);
                        const delta = parsed.choices[0]?.delta;

                        if (delta) {
                            // 检查常规内容
                            const regularContent = delta.content;
                            if (regularContent) {
                                onChunk({ type: 'content', text: regularContent });
                            }

                            // **新增：检查并处理 reasoning_content**
                            const reasoningContent = delta.reasoning_content;
                            if (reasoningContent) {
                                // 将其包装在<thinking>标签中再发送
                                const wrappedContent = `<thinking>${reasoningContent}</thinking>`;
                                onChunk({ type: 'thinking', text: wrappedContent });
                            }
                        }
                    } catch (e) {
                        console.error('Error parsing stream data chunk:', data, e);
                    }
                }
            }
        } catch (error) {
            console.error("LLM Stream Error:", error);
            onError(error);
        }
    }
}