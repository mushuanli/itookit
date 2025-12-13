// @file: llmdriver/executors/agent-executor.ts

import { 
    IExecutor, 
    ExecutorType, 
    ExecutionResult, 
    LLMConnection,
    ChatMessage,
    IExecutionContext // 引入基础接口
} from '@itookit/common';
import { LLMDriver } from '../driver';
import { DriverExecutionContext } from '../types';
import { safeStringify, validateMessageHistory } from '../utils/input';

export class AgentExecutor implements IExecutor {
    readonly id: string;
    readonly type: ExecutorType = 'atomic';
    public name: string;

    private driver: LLMDriver;
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
        this.systemPrompt = config.systemPrompt;
        
        // Driver 初始化
        this.driver = new LLMDriver({
            connection: config.connection,
            provider: config.connection.provider,
            apiKey: config.connection.apiKey || '', 
            model: config.model,
            supportsThinking: true
        });
    }

    /**
     * 执行逻辑
     * [修正] 参数类型必须与 IExecutor 接口保持一致 (IExecutionContext)。
     * 在内部将其断言为 DriverExecutionContext 以访问 callbacks。
     */
    async execute(input: unknown, context: IExecutionContext): Promise<ExecutionResult> {
        // 类型断言：假设运行时环境会传入 DriverExecutionContext
        const driverContext = context as DriverExecutionContext;
        
        const inputStr = safeStringify(input);
        
        // 1. 获取历史记录 (IExecutionContext.variables 是 ReadonlyMap)
        const historyRaw = context.variables.get('history') || [];
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

        const { onThinking, onOutput } = driverContext.callbacks || {};
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
                    // 如果有 parentId，通常在 context 中，或者由 runtime 注入
                    onThinking?.(delta.thinking, driverContext.parentId);
                }

                if (delta.content) {
                    totalContent += delta.content;
                    onOutput?.(delta.content, driverContext.parentId);
                }
            }

            return {
                status: 'success',
                output: totalContent,
                control: { action: 'end' },
                metadata: { thinkingLength: totalThinking.length }
            };

        } catch (error: any) {
            // 建议：记录错误日志
            console.error(`[AgentExecutor:${this.id}] Error:`, error);
            throw error;
        }
    }
}
