// @file: llm-kernel/src/executors/tool-executor.ts

import { BaseExecutor } from './base-executor';
import { ExecutorConfig } from '../core/interfaces';
import { IExecutionContext } from '../core/execution-context';
import { ExecutionResult, ExecutorType } from '../core/types';

/**
 * 工具定义
 */
export interface ToolDefinition {
    /** 工具名称 */
    name: string;
    
    /** 工具描述 */
    description: string;
    
    /** 参数 Schema (JSON Schema) */
    parameters: Record<string, any>;
    
    /** 执行处理器 */
    handler: (args: any, context: IExecutionContext) => Promise<any>;
    
    /** 是否需要确认 */
    requiresConfirmation?: boolean;
    
    /** 超时时间 (ms) */
    timeout?: number;
}

/**
 * 工具执行器配置
 */
export interface ToolExecutorConfig extends ExecutorConfig {
    type: 'tool';
    
    /** 工具定义 */
    tool: ToolDefinition;
}

/**
 * 工具执行器
 * 执行预定义的工具/函数调用
 */
export class ToolExecutor extends BaseExecutor {
    readonly type: ExecutorType = 'tool' as ExecutorType;
    
    private tool: ToolDefinition;
    
    constructor(
        id: string,
        name: string,
        config: ToolExecutorConfig
    ) {
        super(id, name, config);
        this.tool = config.tool;
    }
    
    protected async doExecute(
        input: unknown,
        context: IExecutionContext
    ): Promise<ExecutionResult> {
        // 1. 解析输入参数
        const args = this.parseArgs(input);
        
        // 2. 验证参数
        const validation = this.validateArgs(args);
        if (!validation.valid) {
            return {
                status: 'failed',
                output: null,
                control: { action: 'end' },
                errors: [{
                    code: 'INVALID_ARGS',
                    message: `Invalid arguments: ${validation.errors?.join(', ')}`,
                    recoverable: false
                }]
            };
        }
        
        // 3. 发送工具调用事件
        context.events.emit('stream:tool_call', {
            toolName: this.tool.name,
            args,
            status: 'running'
        });
        
        try {
            // 4. 执行工具（带超时）
            const result = await this.executeWithTimeout(
                () => this.tool.handler(args, context),
                this.tool.timeout || 30000
            );
            
            // 5. 发送完成事件
            context.events.emit('stream:tool_call', {
                toolName: this.tool.name,
                result,
                status: 'success'
            });
            
            return {
                status: 'success',
                output: result,
                control: { action: 'continue' }
            };
            
        } catch (error: any) {
            context.events.emit('stream:tool_call', {
                toolName: this.tool.name,
                error: error.message,
                status: 'failed'
            });
            
            throw error;
        }
    }
    
    /**
     * 解析输入参数
     */
    private parseArgs(input: unknown): Record<string, any> {
        if (typeof input === 'string') {
            try {
                return JSON.parse(input);
            } catch {
                return { input };
            }
        }
        
        if (typeof input === 'object' && input !== null) {
            return input as Record<string, any>;
        }
        
        return { value: input };
    }
    
    /**
     * 验证参数
     */
    private validateArgs(args: Record<string, any>): { valid: boolean; errors?: string[] } {
        const schema = this.tool.parameters;
        const errors: string[] = [];
        
        // 检查必填字段
        const required = schema.required as string[] || [];
        for (const field of required) {
            if (args[field] === undefined || args[field] === null) {
                errors.push(`Missing required field: ${field}`);
            }
        }
        
        // 检查类型（简单实现）
        const properties = schema.properties as Record<string, any> || {};
        for (const [key, value] of Object.entries(args)) {
            const propSchema = properties[key];
            if (propSchema && propSchema.type) {
                const actualType = Array.isArray(value) ? 'array' : typeof value;
                if (propSchema.type !== actualType && propSchema.type !== 'any') {
                    errors.push(`Field ${key} should be ${propSchema.type}, got ${actualType}`);
                }
            }
        }
        
        return {
            valid: errors.length === 0,
            errors: errors.length > 0 ? errors : undefined
        };
    }
    
    /**
     * 带超时的执行
     */
    private async executeWithTimeout<T>(
        fn: () => Promise<T>,
        timeout: number
    ): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            const timeoutId = setTimeout(() => {
                reject(new Error(`Tool execution timed out after ${timeout}ms`));
            }, timeout);
            
            fn()
                .then(result => {
                    clearTimeout(timeoutId);
                    resolve(result);
                })
                .catch(error => {
                    clearTimeout(timeoutId);
                    reject(error);
                });
        });
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
}

/**
 * 创建工具执行器的便捷函数
 */
export function createToolExecutor(tool: ToolDefinition): ToolExecutor {
    return new ToolExecutor(
        `tool-${tool.name}`,
        tool.name,
        {
            id: `tool-${tool.name}`,
            name: tool.name,
            type: 'tool' as any,
            description: tool.description,
            tool
        }
    );
}
