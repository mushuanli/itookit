import { 
    IExecutor, 
    ExecutorType, 
    ExecutionResult, 
} from '@itookit/common';
import { LLMDriver } from '../driver';
import { LLMConnection,ChatMessage, DriverExecutionContext } from '../types';
import { safeStringify, validateMessageHistory } from '../utils/input';

export class AgentExecutor implements IExecutor {
    readonly id: string;
    readonly type: ExecutorType = 'atomic';
    public name: string;

    private driver: LLMDriver;
    // ✨ [修复 1] 本地持有 systemPrompt
    private systemPrompt?: string;

    constructor(
        config: {
            id?: string;
            name?: string;
            connection: LLMConnection;
            model: string;
            systemPrompt?: string;
        }
    ) {
        this.id = config.id || `agent-${Date.now()}`;
        this.name = config.name || 'Agent';
        
        // ✨ [修复 2] 保存 systemPrompt
        this.systemPrompt = config.systemPrompt;
        
        // Driver 初始化逻辑
        this.driver = new LLMDriver({
            connection: config.connection,
            provider: config.connection.provider,
            apiKey: config.connection.apiKey || '', 
            model: config.model,
            // ✨ [修复 3] 移除 systemPrompt，因为它不在 LLMClientConfig 中
            supportsThinking: true
        });
    }

    /**
     * 执行逻辑
     * @param input 用户输入
     * @param context 上下文 (需要符合 DriverExecutionContext 结构)
     */
    async execute(input: unknown, context: DriverExecutionContext): Promise<ExecutionResult> {
        const inputStr = safeStringify(input);
        
        // 1. 获取历史记录 (解耦：不强依赖 context.variables 的具体实现)
        const historyRaw = context.variables?.get('history') || [];
        const history: ChatMessage[] = validateMessageHistory(historyRaw);
        
        // ✨ [修复 4] 构建完整的消息链
        const messages: ChatMessage[] = [];

        // A. 插入 System Prompt (如果存在)
        if (this.systemPrompt) {
            messages.push({ role: 'system', content: this.systemPrompt });
        }

        // B. 插入历史记录
        messages.push(...history);

        // C. 插入当前用户输入
        if (inputStr) {
            messages.push({ role: 'user', content: inputStr });
        }

        const { onThinking, onOutput } = context.callbacks || {};
        let totalContent = '';
        let totalThinking = '';

        try {
            const stream = await this.driver.chat.create({
                messages,
                stream: true,
                thinking: true,
                signal: context.signal
            });

            for await (const chunk of stream) {
                if (context.signal?.aborted) throw new Error('Aborted');
                
                const delta = chunk.choices[0]?.delta;
                if (!delta) continue;

                if (delta.thinking) {
                    totalThinking += delta.thinking;
                    onThinking?.(delta.thinking, context.parentId);
                }

                if (delta.content) {
                    totalContent += delta.content;
                    onOutput?.(delta.content, context.parentId);
                }
            }

            return {
                status: 'success',
                output: totalContent,
                control: { action: 'end' },
                metadata: { thinkingLength: totalThinking.length }
            };

        } catch (error: any) {
            // 这里可以做一层 LLMError 到 ExecutionResult 的转换，或者直接抛出
            throw error;
        }
    }
}
