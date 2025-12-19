// @file: llm-kernel/executors/agent-executor.ts

import { IExecutor, ExecutorConfig } from '../core/interfaces';
import { IExecutionContext } from '../core/execution-context';
import { ExecutionResult, ExecutorType } from '../core/types';
import { LLMDriver, ChatMessage, LLMConnection } from '@itookit/llm-driver';

/**
 * Agent 执行器配置
 */
export interface AgentExecutorConfig extends ExecutorConfig {
    type: 'agent';
    connection: LLMConnection;
    model?: string;
    systemPrompt?: string;
    temperature?: number;
    maxTokens?: number;
    tools?: ToolDefinition[];
}

export interface ToolDefinition {
    name: string;
    description: string;
    parameters: Record<string, any>;
    handler?: (args: any, context: IExecutionContext) => Promise<any>;
}

/**
 * Agent 执行器 - 处理 LLM 调用
 */
export class AgentExecutor implements IExecutor {
    readonly type: ExecutorType = 'agent';
    
    private driver: LLMDriver;
    
    constructor(
        public readonly id: string,
        public readonly name: string,
        private config: AgentExecutorConfig
    ) {
        this.driver = new LLMDriver({
            connection: config.connection,
            model: config.model
        });
    }
    
    async execute(input: unknown, context: IExecutionContext): Promise<ExecutionResult> {
        const startTime = Date.now();
        
        // 1. 构建消息
        const messages = this.buildMessages(input, context);
        
        // 2. 发送开始事件
        context.events.emit('node:start', {
            executorId: this.id,
            executorType: this.type,
            input
        });
        
        let totalContent = '';
        let totalThinking = '';
        
        try {
            // 3. 流式调用 LLM
            const stream = await this.driver.chat.create({
                messages,
                model: this.config.model,
                stream: true,
                thinking: true,
                signal: context.signal
            });
            
            // 4. 处理流
            for await (const chunk of stream) {
                context.checkCancelled();
                
                const delta = chunk.choices[0]?.delta;
                if (!delta) continue;
                
                if (delta.thinking) {
                    totalThinking += delta.thinking;
                    context.emitThinking(delta.thinking);
                }
                
                if (delta.content) {
                    totalContent += delta.content;
                    context.emitContent(delta.content);
                }
                
                // 处理工具调用
                if (delta.tool_calls) {
                    await this.handleToolCalls(delta.tool_calls, context);
                }
            }
            
            // 5. 返回结果
            return {
                status: 'success',
                output: totalContent,
                control: { action: 'continue' },
                metadata: {
                    executorId: this.id,
                    executorType: this.type,
                    startTime,
                    endTime: Date.now(),
                    duration: Date.now() - startTime,
                    thinkingLength: totalThinking.length
                }
            };
            
        } catch (error: any) {
            context.emitError(error);
            
            return {
                status: 'failed',
                output: null,
                control: { action: 'end', reason: error.message },
                errors: [{
                    code: error.code || 'LLM_ERROR',
                    message: error.message,
                    recoverable: this.isRecoverable(error)
                }]
            };
        }
    }
    
    private buildMessages(input: unknown, context: IExecutionContext): ChatMessage[] {
        const messages: ChatMessage[] = [];
        
        // System prompt
        if (this.config.systemPrompt) {
            messages.push({ role: 'system', content: this.config.systemPrompt });
        }
        
        // 历史消息
        const history = context.variables.get<ChatMessage[]>('history') || [];
        messages.push(...history);
        
        // 当前输入
        const inputContent = typeof input === 'string' ? input : JSON.stringify(input);
        messages.push({ role: 'user', content: inputContent });
        
        return messages;
    }
    
    private async handleToolCalls(toolCalls: any[], context: IExecutionContext): Promise<void> {
        for (const call of toolCalls) {
            const tool = this.config.tools?.find(t => t.name === call.function.name);
            if (!tool?.handler) continue;
            
            context.events.emit('stream:tool_call', {
                toolName: call.function.name,
                args: call.function.arguments,
                status: 'running'
            });
            
            try {
                const args = JSON.parse(call.function.arguments);
                const result = await tool.handler(args, context);
                
                context.events.emit('stream:tool_call', {
                    toolName: call.function.name,
                    result,
                    status: 'success'
                });
            } catch (e: any) {
                context.events.emit('stream:tool_call', {
                    toolName: call.function.name,
                    error: e.message,
                    status: 'failed'
                });
            }
        }
    }
    
    private isRecoverable(error: any): boolean {
        const code = error.statusCode || error.status;
        // 5xx 错误和速率限制可重试
        return code >= 500 || code === 429;
    }
    
    validate(input: unknown): { valid: boolean; errors?: string[] } {
        if (input === null || input === undefined) {
            return { valid: false, errors: ['Input cannot be empty'] };
        }
        return { valid: true };
    }
}
