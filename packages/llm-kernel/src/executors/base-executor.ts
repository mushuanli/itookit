// @file: llm-kernel/src/executors/base-executor.ts

import { IExecutor, ExecutorConfig } from '../core/interfaces';
import { IExecutionContext } from '../core/execution-context';
import { ExecutionResult, ExecutorType } from '../core/types';

/**
 * 执行器基类
 * 提供通用的执行器实现框架
 */
export abstract class BaseExecutor implements IExecutor {
    abstract readonly type: ExecutorType;
    
    constructor(
        public readonly id: string,
        public readonly name: string,
        protected config: ExecutorConfig
    ) {}
    
    /**
     * 执行入口（模板方法）
     */
    async execute(input: unknown, context: IExecutionContext): Promise<ExecutionResult> {
        const startTime = Date.now();
        
        // 1. 验证输入
        if (this.validate) {
            const validation = this.validate(input);
            if (!validation.valid) {
                return this.createFailedResult(
                    `Validation failed: ${validation.errors?.join(', ')}`,
                    startTime
                );
            }
        }
        
        // 2. 发送开始事件
        this.emitStart(context, input);
        
        try {
            // 3. 检查取消
            context.checkCancelled();
            
            // 4. 执行具体逻辑
            const result = await this.doExecute(input, context);
            
            // 5. 发送完成事件
            this.emitComplete(context, result);
            
            return {
                ...result,
                metadata: {
                    ...result.metadata,
                    executorId: this.id,
                    executorType: this.type,
                    startTime,
                    endTime: Date.now(),
                    duration: Date.now() - startTime
                }
            };
            
        } catch (error: any) {
            // 6. 处理错误
            context.emitError(error);
            
            return this.createFailedResult(error.message, startTime, error);
        }
    }
    
    /**
     * 具体执行逻辑（子类实现）
     */
    protected abstract doExecute(
        input: unknown, 
        context: IExecutionContext
    ): Promise<ExecutionResult>;
    
    /**
     * 可选：验证输入
     */
    validate?(input: unknown): { valid: boolean; errors?: string[] };
    
    /**
     * 可选：估算成本
     */
    estimate?(input: unknown): { tokens?: number; duration?: number };
    
    // ============== 辅助方法 ==============
    
    /**
     * 发送开始事件
     */
    protected emitStart(context: IExecutionContext, input: unknown): void {
        context.events.emit('node:start', {
            executorId: this.id,
            executorType: this.type,
            name: this.name,
            input
        });
    }
    
    /**
     * 发送完成事件
     */
    protected emitComplete(context: IExecutionContext, result: ExecutionResult): void {
        context.events.emit('node:complete', {
            executorId: this.id,
            status: result.status,
            output: result.output
        });
    }
    
    /**
     * 创建失败结果
     */
    protected createFailedResult(
        message: string, 
        startTime: number,
        error?: Error
    ): ExecutionResult {
        return {
            status: 'failed',
            output: null,
            control: { action: 'end', reason: message },
            errors: [{
                code: (error as any)?.code || 'EXECUTION_ERROR',
                message,
                recoverable: this.isRecoverable(error)
            }],
            metadata: {
                executorId: this.id,
                executorType: this.type,
                startTime,
                endTime: Date.now(),
                duration: Date.now() - startTime
            }
        };
    }
    
    /**
     * 创建成功结果
     */
    protected createSuccessResult(
        output: unknown,
        metadata?: Record<string, any>
    ): ExecutionResult {
        return {
            status: 'success',
            output,
            control: { action: 'continue' },
            // 修复：合并必填字段和可选字段
            metadata: metadata ? {
                executorId: this.id,
                executorType: this.type,
                startTime: Date.now(),
                ...metadata
            } : undefined
        };
    }
    
    /**
     * 判断错误是否可恢复
     */
    protected isRecoverable(error?: Error): boolean {
        if (!error) return false;
        
        const code = (error as any).statusCode || (error as any).status;
        // 5xx 错误和速率限制可重试
        return code >= 500 || code === 429;
    }
    
    /**
     * 延迟执行
     */
    protected sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
