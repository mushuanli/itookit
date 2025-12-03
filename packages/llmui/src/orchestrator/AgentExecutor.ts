// @file llm-ui/orchestrator/AgentExecutor.ts

import { 
    IExecutor, 
    ExecutorType, 
    ExecutionContext, 
    ExecutionResult, 
    LLMConnection 
} from '@itookit/common';
import { LLMDriver, ChatMessage } from '@itookit/llmdriver';

// 导入本地定义的上下文接口，确保 TS 类型检查通过
import { StreamingContext } from '../types'; 

export class AgentExecutor implements IExecutor {
    readonly id: string;
    readonly type: ExecutorType = 'atomic';
    public name: string = 'Agent';

    constructor(
        private connection: LLMConnection,
        private model: string,
        private systemPrompt?: string
    ) {
        this.id = `agent-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
    }

    /**
     * IExecutor 接口实现
     * @param input 通常是用户最新的输入 (string)
     * @param context 执行上下文，包含历史记录、文件和回调
     */
    async execute(input: unknown, context: StreamingContext): Promise<ExecutionResult> {
        // 1. 准备上下文和输入
        const history = (context.variables.get('history') as ChatMessage[]) || [];
        const userMessageContent = input as string;
        
        // 构建完整的 LLM 消息链
        const fullMessages: ChatMessage[] = [];
        
        // 插入 System Prompt
        if (this.systemPrompt) {
            fullMessages.push({ role: 'system', content: this.systemPrompt });
        }
        
        // 插入历史记录
        fullMessages.push(...history);
        
        // 插入当前用户消息 (如果 input 不为空，且历史记录里还没包含这最后一条)
        // 注意：SessionManager 的 buildMessageHistory 通常不包含尚未处理的当前 user session
        // 所以我们需要把 input 作为当前消息加入
        // 但如果 SessionManager 的实现是在调用 execute 前已经把 user session 加入了 history，这里就要小心重复
        // *本实现假设 context.history 是"过去"的历史，当前 input 是"现在"的消息*
        if (userMessageContent) {
             fullMessages.push({ role: 'user', content: userMessageContent });
        }

        // 2. 初始化 Driver
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
            // 4. 发起流式请求
            const stream = await driver.chat.create({
                messages: fullMessages,
                stream: true,
                thinking: true,
                // 这里可以透传 AbortSignal，如果 Context 支持的话
                // signal: context.signal 
            });

            // 5. 处理流
            for await (const chunk of stream) {
                // 安全检查
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
}
