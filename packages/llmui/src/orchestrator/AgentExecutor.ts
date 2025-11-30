// @file llm-ui/orchestrator/AgentExecutor.ts
import { LLMDriver, ChatMessage } from '@itookit/llmdriver';
import { LLMConnection } from '@itookit/common';

export interface ExecutorCallbacks {
    onStart: () => void;
    onThinking: (delta: string) => void;
    onOutput: (delta: string) => void;
    onSuccess: () => void;
    onFailure: (error: Error) => void;
}

export class AgentExecutor {
    constructor(
        private connection: LLMConnection,
        private model: string,
        private systemPrompt?: string
    ) {}

    async run(
        messages: ChatMessage[], 
        callbacks: ExecutorCallbacks, 
        signal?: AbortSignal
    ) {
        callbacks.onStart();

        try {
            console.log('[AgentExecutor] Creating LLMDriver with config:', {
                provider: this.connection.provider,
                model: this.model,
                hasApiKey: !!this.connection.apiKey,
                baseURL: this.connection.baseURL
            });

            const driver = new LLMDriver({
                connection: this.connection,
                provider: this.connection.provider,
                apiKey: this.connection.apiKey || '',
                model: this.model,
                supportsThinking: true // 强制开启 Thinking 能力
            });

            // 构造完整的消息历史（包含 System Prompt）
            const fullHistory: ChatMessage[] = [];
            if (this.systemPrompt) {
                fullHistory.push({ role: 'system', content: this.systemPrompt });
            }
            fullHistory.push(...messages);

            console.log('[AgentExecutor] Sending request with messages:', 
                fullHistory.map(m => ({ role: m.role, contentLength: m.content?.length }))
            );

            const stream = await driver.chat.create({
                messages: fullHistory,
                stream: true,
                thinking: true,
                signal
            });

            console.log('[AgentExecutor] Stream created, starting iteration...');

            let chunkCount = 0;
            let totalContent = '';
            let totalThinking = '';

            for await (const chunk of stream) {
                chunkCount++;
                
                if (signal?.aborted) {
                    console.log('[AgentExecutor] Aborted by signal');
                    break;
                }

                // 详细日志：打印原始 chunk 结构
                console.log(`[AgentExecutor] Chunk #${chunkCount}:`, JSON.stringify(chunk, null, 2));

                // 安全检查
                if (!chunk.choices || chunk.choices.length === 0) {
                    console.warn('[AgentExecutor] Chunk has no choices:', chunk);
                    continue;
                }

                const delta = chunk.choices[0].delta;
                
                if (!delta) {
                    console.warn('[AgentExecutor] Chunk has no delta:', chunk.choices[0]);
                    continue;
                }

                if (delta.thinking) {
                    console.log(`[AgentExecutor] Thinking delta: "${delta.thinking.substring(0, 50)}..."`);
                    totalThinking += delta.thinking;
                    callbacks.onThinking(delta.thinking);
                }
                
                if (delta.content) {
                    console.log(`[AgentExecutor] Content delta: "${delta.content.substring(0, 50)}..."`);
                    totalContent += delta.content;
                    callbacks.onOutput(delta.content);
                }

                // 检查是否有其他字段
                const knownFields = ['role', 'content', 'thinking', 'function_call', 'tool_calls'];
                const unknownFields = Object.keys(delta).filter(k => !knownFields.includes(k));
                if (unknownFields.length > 0) {
                    console.log('[AgentExecutor] Unknown delta fields:', unknownFields, delta);
                }
            }

            console.log('[AgentExecutor] Stream completed:', {
                totalChunks: chunkCount,
                totalContentLength: totalContent.length,
                totalThinkingLength: totalThinking.length
            });

            if (chunkCount === 0) {
                console.error('[AgentExecutor] WARNING: No chunks received from stream!');
            }

            if (totalContent.length === 0 && totalThinking.length === 0) {
                console.error('[AgentExecutor] WARNING: No content or thinking received!');
            }

            callbacks.onSuccess();

        } catch (error: any) {
            console.error('[AgentExecutor] Error during execution:', {
                name: error.name,
                message: error.message,
                stack: error.stack,
                response: error.response?.data
            });
            callbacks.onFailure(error);
            throw error;
        }
    }
}
