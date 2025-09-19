// src/services/llm/adapters/geminiAdapter.js
import { BaseAdapter } from './baseAdapter.js';

export class GeminiAdapter extends BaseAdapter {
    /**
     * Gemini API 的角色映射：'user' -> 'user', 'assistant' -> 'model'
     * 并且历史记录必须是 user/model 交替的。
     */
    _preparePayload(messages) {
        const contents = messages.map(msg => ({
            role: msg.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: msg.content }],
        }));
        
        return {
            contents: contents,
            // Gemini 的其他配置可以加在这里, e.g., generationConfig
        };
    }

    async chatStream(messages, { onChunk, onDone, onError }) {
        const payload = this._preparePayload(messages);
        // Gemini API 将 API Key 作为 URL 参数
        const apiUrl = `${this.config.apiPath}/v1beta/models/${this.config.model}:streamGenerateContent?key=${this.config.apiKey}`;

        try {
            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(payload),
            });

            if (!response.ok) {
                const errorBody = await response.text();
                throw new Error(`API Error: ${response.status} ${response.statusText} - ${errorBody}`);
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder("utf-8");
            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) {
                    onDone();
                    break;
                }
                
                buffer += decoder.decode(value, { stream: true });
                
                // Gemini流返回的是一个JSON数组，可能被拆分，我们需要处理它
                // 一个简单的处理方法是按换行符分割，并尝试解析每一行
                const lines = buffer.split('\n');
                buffer = lines.pop(); // 最后一行可能不完整，放回缓冲区

                for (const line of lines) {
                    if (line.trim().startsWith('[') || line.trim().startsWith(',')) {
                        // 忽略数组的开始和分隔符
                        continue;
                    }
                    if (line.trim().endsWith(']')) {
                         // 忽略数组的结束
                         continue;
                    }
                    try {
                        const parsed = JSON.parse(line);
                        const content = parsed.candidates?.[0]?.content?.parts?.[0]?.text || '';
                        if (content) {
                            // [修复] 将 onChunk(content) 修改为 onChunk({ type: 'content', text: content })
                            // 以匹配 dataService 中回调函数的期望签名。
                            onChunk({ type: 'content', text: content });
                        }
                    } catch (e) {
                        // console.warn('Skipping non-JSON line in Gemini stream:', line, e);
                    }
                }
            }
        } catch (error) {
            console.error("Gemini Stream Error:", error);
            onError(error);
        }
    }
}