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
    ChatCompletionParams,
    Attachment,
    ToolCall  // 添加 ToolCall 类型导入
} from '@itookit/llm-driver';

/**
 * Agent 输入类型
 */
export interface AgentInput {
    /** 文本内容 */
    content: string;
    /** 附件列表 */
    attachments?: Attachment[];
    /** 额外元数据 */
    metadata?: Record<string, any>;
}

// 类型守卫
export function isAgentInput(input: unknown): input is AgentInput {
    return (
        typeof input === 'object' &&
        input !== null &&
        'content' in input &&
        typeof (input as any).content === 'string'
    );
}

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

    // ✅ 新增：附件支持
    /** 默认附件（每次请求都包含） */
    defaultAttachments?: Attachment[];
    /** 系统提示附件（如参考文档） */
    systemAttachments?: Attachment[];
}

export interface ToolDefinition {
    name: string;
    description: string;
    parameters: Record<string, any>;
    handler?: (args: any, context: IExecutionContext) => Promise<any>;
}

/**
 * 工具调用增量类型（用于流式处理）
 */
interface ToolCallDelta {
    index: number;
    id?: string;
    type?: string;
    function?: {
        name?: string;
        arguments?: string;
    };
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
                    // ✅ 修复：使用类型断言或显式转换
                    this.accumulateToolCall(toolCallDelta as ToolCallDelta, toolCallAccumulators);
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

        // System prompt（可带附件）
        if (this.config.systemPrompt) {
            const systemMessage: ChatMessage = {
                role: 'system',
                content: this.config.systemPrompt
            };

            if (this.config.systemAttachments?.length) {
                systemMessage.attachments = this.config.systemAttachments;
            }

            messages.push(systemMessage);
        }

        // 历史消息 - 增加类型检查
        const history = context.variables.get<ChatMessage[]>('history') || [];

        for (const msg of history) {
            messages.push(msg);
        }

        // 当前用户消息
        const userMessage = this.buildUserMessage(input, context);
        messages.push(userMessage);

        return messages;
    }

    /**
     * 构建用户消息（支持多种输入格式和附件）
     */
    private buildUserMessage(input: unknown, context: IExecutionContext): ChatMessage {
        let textContent: string;
        let inputAttachments: Attachment[] = [];

        // 解析输入
        if (this.isAgentInput(input)) {
            // AgentInput 格式
            textContent = input.content;
            inputAttachments = input.attachments || [];
        } else if (this.isChatMessage(input)) {
            // 已经是 ChatMessage
            return this.mergeAttachments(input);
        } else if (typeof input === 'string') {
            // 纯字符串
            textContent = input;
        } else {
            // 其他对象，序列化
            textContent = JSON.stringify(input);
        }

        // 从上下文获取附件
        const contextAttachments = context.variables.get<Attachment[]>('attachments') || [];

        // 合并所有附件
        const allAttachments = [
            ...(this.config.defaultAttachments || []),
            ...inputAttachments,
            ...contextAttachments
        ];

        const message: ChatMessage = {
            role: 'user',
            content: textContent
        };

        if (allAttachments.length > 0) {
            message.attachments = allAttachments;
        }

        return message;
    }

    /**
     * 合并默认附件到现有消息
     */
    private mergeAttachments(message: ChatMessage): ChatMessage {
        if (!this.config.defaultAttachments?.length) {
            return message;
        }

        return {
            ...message,
            attachments: [
                ...(this.config.defaultAttachments || []),
                ...(message.attachments || [])
            ]
        };
    }

    /**
     * 类型守卫：AgentInput
     */
    private isAgentInput(input: unknown): input is AgentInput {
        return (
            typeof input === 'object' &&
            input !== null &&
            'content' in input &&
            typeof (input as any).content === 'string'
        );
    }

    /**
     * 类型守卫：ChatMessage
     */
    private isChatMessage(input: unknown): input is ChatMessage {
        return (
            typeof input === 'object' &&
            input !== null &&
            'role' in input &&
            'content' in input
        );
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
        delta: ToolCallDelta,
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
        toolCalls: ToolCall[],
        context: IExecutionContext
    ): Promise<void> {
        for (const toolCall of toolCalls) {
            // 只处理 function 类型的工具调用
            if (toolCall.type === 'function' && toolCall.function) {
                await this.executeSingleToolCall(
                    toolCall.id,
                    toolCall.function.name,
                    toolCall.function.arguments,
                    context
                );
            } else if (toolCall.type === 'mcp' && toolCall.mcp) {
                // 处理 MCP 工具调用
                await this.executeMCPToolCall(toolCall, context);
            } else if (toolCall.type === 'computer_20241022' && toolCall.computer_use) {
                // 处理 Computer Use 工具调用
                await this.executeComputerUseAction(toolCall, context);
            }
            // 其他类型可以根据需要添加
        }
    }

    /**
     * 执行 MCP 工具调用
     */
    private async executeMCPToolCall(
        toolCall: ToolCall,
        context: IExecutionContext
    ): Promise<void> {
        if (!toolCall.mcp) return;

        const { server_name, tool_name, arguments: args } = toolCall.mcp;

        context.events.emit('stream:tool_call', {
            toolName: `${server_name}/${tool_name}`,
            toolCallId: toolCall.id,
            args,
            status: 'running',
            type: 'mcp'
        });

        // MCP 工具调用需要 MCP 客户端支持
        // 这里发出事件，由外部处理
        context.events.emit('stream:tool_call', {
            toolName: `${server_name}/${tool_name}`,
            toolCallId: toolCall.id,
            error: 'MCP tool execution not implemented in AgentExecutor',
            status: 'failed',
            type: 'mcp'
        });
    }

    /**
     * 执行 Computer Use 动作
     */
    private async executeComputerUseAction(
        toolCall: ToolCall,
        context: IExecutionContext
    ): Promise<void> {
        if (!toolCall.computer_use) return;

        context.events.emit('stream:tool_call', {
            toolName: 'computer',
            toolCallId: toolCall.id,
            args: toolCall.computer_use,
            status: 'running',
            type: 'computer_use'
        });

        // Computer Use 需要外部环境支持
        // 这里发出事件，由外部处理
        context.events.emit('stream:tool_call', {
            toolName: 'computer',
            toolCallId: toolCall.id,
            error: 'Computer Use execution not implemented in AgentExecutor',
            status: 'failed',
            type: 'computer_use'
        });
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
