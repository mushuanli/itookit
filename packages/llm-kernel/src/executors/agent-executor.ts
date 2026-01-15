// @file: llm-kernel/executors/agent-executor.ts

import { IExecutor, ExecutorConfig } from '../core/interfaces';
import { IExecutionContext } from '../core/execution-context';
import { ExecutionResult, ExecutorType, TokenUsage } from '../core/types';
import { 
    LLMDriver, 
    ChatMessage, 
    LLMConnection,
    ChatCompletionChunk,
    ChatCompletionResponse,
    ChatCompletionParams
} from '@itookit/llm-driver';

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
    /** 是否启用思考过程 */
    enableThinking?: boolean;
    /** 思考 token 预算 */
    thinkingBudget?: number;
    /** 是否使用流式模式（默认 true） */
    stream?: boolean;
}

export interface ToolDefinition {
    name: string;
    description: string;
    parameters: Record<string, any>;
    handler?: (args: any, context: IExecutionContext) => Promise<any>;
}

/**
 * 工具调用累积器（用于流式处理）
 */
interface ToolCallAccumulator {
    index: number;
    id: string;
    type: 'function';
    function: {
        name: string;
        arguments: string;
    };
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
        
        // 3. 判断是否使用流式模式
        const useStream = this.config.stream !== false; // 默认为 true
        
        try {
            if (useStream) {
                return await this.executeStream(messages, context, startTime);
            } else {
                return await this.executeNonStream(messages, context, startTime);
            }
        } catch (error: any) {
            return this.handleError(error, context, startTime);
        }
    }
    
    /**
     * 流式执行
     */
    private async executeStream(
        messages: ChatMessage[],
        context: IExecutionContext,
        startTime: number
    ): Promise<ExecutionResult> {
        let totalContent = '';
        let totalThinking = '';
        const toolCallAccumulators = new Map<number, ToolCallAccumulator>();
        let tokenUsage: TokenUsage | undefined;
        let finishReason: string | null = null;
        
        // 构建请求参数
        const requestParams = this.buildRequestParams(messages);
        
        // 流式调用 LLM
        const stream = await this.driver.chat.create({
            ...requestParams,
            stream: true,
            signal: context.signal
        }) as AsyncGenerator<ChatCompletionChunk>;
        
        // 处理流
        for await (const chunk of stream) {
            // 检查取消
            context.checkCancelled();
            
            // 处理 choices
            if (!chunk.choices || chunk.choices.length === 0) {
                // 最后一个 chunk 可能只有 usage 信息
                if (chunk.usage) {
                    tokenUsage = this.parseTokenUsage(chunk.usage);
                }
                continue;
            }
            
            const choice = chunk.choices[0];
            const delta = choice.delta;
            
            // 记录结束原因
            if (choice.finish_reason) {
                finishReason = choice.finish_reason;
            }
            
            if (!delta) continue;
            
            // 处理思考内容
            if (delta.thinking) {
                totalThinking += delta.thinking;
                context.emitThinking(delta.thinking);
            }
            
            // 处理正常内容
            if (delta.content) {
                totalContent += delta.content;
                context.emitContent(delta.content);
            }
            
            // 处理工具调用（流式累积）
            if (delta.tool_calls && delta.tool_calls.length > 0) {
                for (const toolCallDelta of delta.tool_calls) {
                    this.accumulateToolCall(toolCallDelta, toolCallAccumulators);
                }
            }
            
            // 提取 usage（某些 provider 在最后一个 chunk 返回）
            if (chunk.usage) {
                tokenUsage = this.parseTokenUsage(chunk.usage);
            }
        }
        
        // 执行累积的工具调用
        if (toolCallAccumulators.size > 0 && finishReason === 'tool_calls') {
            await this.executeAccumulatedToolCalls(toolCallAccumulators, context);
        }
        
        return this.buildSuccessResult({
            content: totalContent,
            thinking: totalThinking,
            tokenUsage,
            startTime,
            finishReason,
            hasToolCalls: toolCallAccumulators.size > 0
        });
    }
    
    /**
     * 非流式执行
     */
    private async executeNonStream(
        messages: ChatMessage[],
        context: IExecutionContext,
        startTime: number
    ): Promise<ExecutionResult> {
        // 构建请求参数
        const requestParams = this.buildRequestParams(messages);
        
        // 非流式调用 LLM
        const response = await this.driver.chat.create({
            ...requestParams,
            stream: false,
            signal: context.signal
        }) as ChatCompletionResponse;
        
        // 检查取消
        context.checkCancelled();
        
        // 解析响应
        const choice = response.choices[0];
        if (!choice) {
            return {
                status: 'failed',
                output: null,
                control: { action: 'end', reason: 'Empty response from LLM' },
                errors: [{
                    code: 'EMPTY_RESPONSE',
                    message: 'LLM returned empty response',
                    recoverable: true
                }]
            };
        }
        
        const message = choice.message;
        const content = message.content || '';
        const thinking = message.thinking || '';
        const finishReason = choice.finish_reason;
        
        // 发送完整内容事件（非流式模式一次性发送）
        if (thinking) {
            context.emitThinking(thinking);
        }
        if (content) {
            context.emitContent(content);
        }
        
        // 解析 token 使用
        const tokenUsage = response.usage ? this.parseTokenUsage(response.usage) : undefined;
        
        // 处理工具调用
        let hasToolCalls = false;
        if (message.tool_calls && message.tool_calls.length > 0) {
            hasToolCalls = true;
            await this.executeToolCalls(message.tool_calls, context);
        }
        
        return this.buildSuccessResult({
            content,
            thinking,
            tokenUsage,
            startTime,
            finishReason,
            hasToolCalls
        });
    }
    
    /**
     * 构建请求参数
     */
    private buildRequestParams(messages: ChatMessage[]): Omit<ChatCompletionParams, 'stream' | 'signal'> {
        const params: Omit<ChatCompletionParams, 'stream' | 'signal'> = {
            messages,
            model: this.config.model
        };
        
        // 温度
        if (this.config.temperature !== undefined) {
            params.temperature = this.config.temperature;
        }
        
        // 最大 tokens
        if (this.config.maxTokens !== undefined) {
            params.maxTokens = this.config.maxTokens;
        }
        
        // 思考过程
        if (this.config.enableThinking) {
            params.thinking = true;
            if (this.config.thinkingBudget) {
                params.thinkingBudget = this.config.thinkingBudget;
            }
        }
        
        // 工具定义
        if (this.config.tools && this.config.tools.length > 0) {
            params.tools = this.config.tools.map(tool => ({
                type: 'function' as const,
                function: {
                    name: tool.name,
                    description: tool.description,
                    parameters: tool.parameters
                }
            }));
            params.toolChoice = 'auto';
        }
        
        return params;
    }
    
    /**
     * 构建消息列表
     */
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
    
    /**
     * 解析 token 使用信息
     */
    private parseTokenUsage(usage: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
        thinking_tokens?: number;
    }): TokenUsage {
        return {
            promptTokens: usage.prompt_tokens,
            completionTokens: usage.completion_tokens,
            totalTokens: usage.total_tokens,
            thinkingTokens: usage.thinking_tokens
        };
    }
    
    /**
     * 构建成功结果
     */
    private buildSuccessResult(params: {
        content: string;
        thinking: string;
        tokenUsage?: TokenUsage;
        startTime: number;
        finishReason: string | null;
        hasToolCalls: boolean;
    }): ExecutionResult {
        const endTime = Date.now();
        
        return {
            status: 'success',
            output: params.content,
            control: { action: 'continue' },
            metadata: {
                executorId: this.id,
                executorType: this.type,
                startTime: params.startTime,
                endTime,
                duration: endTime - params.startTime,
                tokenUsage: params.tokenUsage,
                thinkingLength: params.thinking.length,
                finishReason: params.finishReason,
                hasToolCalls: params.hasToolCalls
            }
        };
    }
    
    /**
     * 处理错误
     */
    private handleError(
        error: any,
        context: IExecutionContext,
        startTime: number
    ): ExecutionResult {
        const endTime = Date.now();
        
        // 处理中止错误
        if (error.name === 'AbortError' || error.code === 'ABORTED') {
            return {
                status: 'cancelled',
                output: null,
                control: { action: 'cancel', reason: 'Execution cancelled' },
                metadata: {
                    executorId: this.id,
                    executorType: this.type,
                    startTime,
                    endTime,
                    duration: endTime - startTime
                }
            };
        }
        
        console.error('[AgentExecutor] Error:', error);
        context.emitError(error);
        
        return {
            status: 'failed',
            output: null,
            control: { action: 'end', reason: error.message },
            errors: [{
                code: error.code || 'LLM_ERROR',
                message: error.message,
                recoverable: this.isRecoverable(error)
            }],
            metadata: {
                executorId: this.id,
                executorType: this.type,
                startTime,
                endTime,
                duration: endTime - startTime
            }
        };
    }
    
    /**
     * 累积工具调用（流式处理时）
     */
    private accumulateToolCall(
        delta: {
            index: number;
            id?: string;
            type?: 'function';
            function?: {
                name?: string;
                arguments?: string;
            };
        },
        accumulators: Map<number, ToolCallAccumulator>
    ): void {
        const index = delta.index;
        
        if (!accumulators.has(index)) {
            // 初始化新的工具调用
            accumulators.set(index, {
                index,
                id: delta.id || '',
                type: 'function',
                function: {
                    name: delta.function?.name || '',
                    arguments: delta.function?.arguments || ''
                }
            });
        } else {
            // 累积到现有的工具调用
            const acc = accumulators.get(index)!;
            
            if (delta.id) {
                acc.id = delta.id;
            }
            
            if (delta.function?.name) {
                acc.function.name += delta.function.name;
            }
            
            if (delta.function?.arguments) {
                acc.function.arguments += delta.function.arguments;
            }
        }
    }
    
    /**
     * 执行累积的工具调用（流式模式）
     */
    private async executeAccumulatedToolCalls(
        accumulators: Map<number, ToolCallAccumulator>,
        context: IExecutionContext
    ): Promise<void> {
        for (const [_, toolCall] of accumulators) {
            await this.executeSingleToolCall(
                toolCall.id,
                toolCall.function.name,
                toolCall.function.arguments,
                context
            );
        }
    }
    
    /**
     * 执行工具调用（非流式模式）
     */
    private async executeToolCalls(
        toolCalls: Array<{
            id: string;
            type: 'function';
            function: {
                name: string;
                arguments: string;
            };
        }>,
        context: IExecutionContext
    ): Promise<void> {
        for (const toolCall of toolCalls) {
            await this.executeSingleToolCall(
                toolCall.id,
                toolCall.function.name,
                toolCall.function.arguments,
                context
            );
        }
    }
    
    /**
     * 执行单个工具调用
     */
    private async executeSingleToolCall(
        toolCallId: string,
        toolName: string,
        toolArguments: string,
        context: IExecutionContext
    ): Promise<void> {
        const tool = this.config.tools?.find(t => t.name === toolName);
        
        if (!tool?.handler) {
            console.warn(`[AgentExecutor] Tool handler not found: ${toolName}`);
            context.events.emit('stream:tool_call', {
                toolName,
                toolCallId,
                error: `Tool handler not found: ${toolName}`,
                status: 'failed'
            });
            return;
        }
        
        // 发送工具调用开始事件
        context.events.emit('stream:tool_call', {
            toolName,
            toolCallId,
            args: toolArguments,
            status: 'running'
        });
        
        try {
            // 解析参数
            let args: any = {};
            try {
                args = JSON.parse(toolArguments);
            } catch (parseError) {
                console.warn('[AgentExecutor] Failed to parse tool arguments:', parseError);
                // 如果解析失败，尝试使用原始字符串
                args = { rawArguments: toolArguments };
            }
            
            // 执行工具
            const result = await tool.handler(args, context);
            
            // 存储工具调用结果到上下文（供后续使用）
            context.variables.set(`tool_result_${toolCallId}`, result);
            
            // 发送工具调用完成事件
            context.events.emit('stream:tool_call', {
                toolName,
                toolCallId,
                result,
                status: 'success'
            });
            
        } catch (error: any) {
            // 发送工具调用失败事件
            context.events.emit('stream:tool_call', {
                toolName,
                toolCallId,
                error: error.message,
                status: 'failed'
            });
        }
    }
    
    /**
     * 判断错误是否可恢复
     */
    private isRecoverable(error: any): boolean {
        // LLMError 有 retryable 属性
        if (error.retryable !== undefined) {
            return error.retryable;
        }
        
        const code = error.statusCode || error.status;
        // 5xx 错误和速率限制可重试
        return code >= 500 || code === 429;
    }
    
    /**
     * 验证输入
     */
    validate(input: unknown): { valid: boolean; errors?: string[] } {
        if (input === null || input === undefined) {
            return { valid: false, errors: ['Input cannot be empty'] };
        }
        return { valid: true };
    }
    
    /**
     * 估算成本
     */
    estimate(input: unknown): { tokens?: number; duration?: number } {
        const inputStr = typeof input === 'string' ? input : JSON.stringify(input);
        
        // 粗略估算：每4个字符约1个token
        let estimatedInputTokens = Math.ceil(inputStr.length / 4);
        
        // 加上 system prompt 的 token
        if (this.config.systemPrompt) {
            estimatedInputTokens += Math.ceil(this.config.systemPrompt.length / 4);
        }
        
        return {
            tokens: estimatedInputTokens,
            duration: 5000 // 默认估算5秒
        };
    }
}
