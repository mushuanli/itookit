// @file llm-ui/orchestrator/AgentExecutor.ts

import { 
    IExecutor, 
    ExecutorType, 
    ExecutionContext, 
    ExecutionResult, 
    LLMConnection,
    safeStringify
} from '@itookit/common';
import { LLMDriver, ChatMessage } from '@itookit/llmdriver';

// 导入本地定义的上下文接口，确保 TS 类型检查通过
import { StreamingContext } from '../../core/types'; 

export class AgentExecutor implements IExecutor {
    readonly id: string;
    readonly type: ExecutorType = 'atomic';
    public name: string = 'Agent';

    constructor(
        private connection: LLMConnection,
        private model: string,
        private systemPrompt?: string,
        // ✨ [修复 3.1] 添加 signal 参数
        private signal?: AbortSignal
    ) {
        this.id = `agent-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
    }

    /**
     * IExecutor 接口实现
     * @param input 通常是用户最新的输入 (string)
     * @param context 执行上下文，包含历史记录、文件和回调
     */
    async execute(input: unknown, context: StreamingContext): Promise<ExecutionResult> {
        // ✨ [修复 4.1] 安全的类型处理
        const userMessageContent = safeStringify(input);
        
        // ✨ [修复 4.2] 安全的 history 获取
        const history = this.safeGetHistory(context);
        
        // 构建完整的 LLM 消息链
        const fullMessages: ChatMessage[] = [];
        
        // 插入 System Prompt
        if (this.systemPrompt) {
            fullMessages.push({ role: 'system', content: this.systemPrompt });
        }
        
        // 插入历史记录
        fullMessages.push(...history);
        
        // 3. 插入当前用户消息
        // ✨ [修复] 不再检查是否重复，因为 buildMessageHistory 已经排除了最后一条用户消息
        if (userMessageContent) {
            fullMessages.push({ role: 'user', content: userMessageContent });
        }

        console.log('[AgentExecutor] Message chain length:', fullMessages.length);
        console.log('[AgentExecutor] Creating LLMDriver with model:', this.model);
        const driver = new LLMDriver({
            connection: this.connection,
            provider: this.connection.provider,
            apiKey: this.connection.apiKey || '',
            model: this.model,
            supportsThinking: true // 强制开启思考能力检测
        });

        // 3. 准备回调函数
        // 如果 Context 中没有提供回调，使用空函数防止报错
        const onThinking = context.callbacks?.onThinking || (() => {});
        const onOutput = context.callbacks?.onOutput || (() => {});

        let totalContent = '';
        let totalThinking = '';

        try {
            // ✨ [修复 3.1] 传递 signal 给 LLM 请求
            const effectiveSignal = this.signal || context.signal;
            
            const stream = await driver.chat.create({
                messages: fullMessages,
                stream: true,
                thinking: true,
                signal: effectiveSignal
            });

            // 5. 处理流
            for await (const chunk of stream) {
                // ✨ [修复 3.1] 检查是否被中断
                if (effectiveSignal?.aborted) {
                    throw new DOMException('Aborted', 'AbortError');
                }
                
                if (!chunk.choices || chunk.choices.length === 0) continue;
                
                const delta = chunk.choices[0].delta;
                if (!delta) continue;

                // 处理思考过程
                if (delta.thinking) {
                    totalThinking += delta.thinking;
                    onThinking(delta.thinking);
                }

                // 处理正文输出
                if (delta.content) {
                    totalContent += delta.content;
                    onOutput(delta.content);
                }
            }

            // 6. 返回标准执行结果
            return {
                status: 'success',
                output: totalContent, // 返回完整内容，供后续流程或非流式场景使用
                control: { action: 'end' },
                metadata: {
                    tokenUsage: 0, // 暂无 Token 统计
                    thinkingLength: totalThinking.length
                }
            };

        } catch (error: any) {
            console.error('[AgentExecutor] LLM Error:', error);
            // 抛出错误，交给 SessionManager 处理 UI 状态
            throw error;
        }
    }

    // ✨ [修复 4.2] 安全的 history 获取
    private safeGetHistory(context: StreamingContext): ChatMessage[] {
        const historyValue = context.variables.get('history');
        
        if (!historyValue) {
            return [];
        }
        
        if (!Array.isArray(historyValue)) {
            console.warn('[AgentExecutor] history is not an array:', typeof historyValue);
            return [];
        }
        
        // 验证每个消息的结构
        return historyValue.filter((msg): msg is ChatMessage => {
            return (
                msg !== null &&
                typeof msg === 'object' &&
                typeof msg.role === 'string' &&
                typeof msg.content === 'string' &&
                ['system', 'user', 'assistant'].includes(msg.role)
            );
        });
    }
}
