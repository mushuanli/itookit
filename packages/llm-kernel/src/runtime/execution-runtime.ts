// @file: llm-kernel/runtime/execution-runtime.ts

import { ExecutorConfig, IExecutorFactory } from '../core/interfaces';
import { ExecutionContext } from '../core/execution-context';
import { EventBus, getEventBus } from '../core/event-bus';
import { ExecutionResult } from '../core/types';
import { getExecutorRegistry } from '../executors';
import { generateUUID } from '@itookit/common';

/**
 * 执行配置
 */
export interface ExecutionOptions {
    /** 初始变量 */
    variables?: Record<string, any>;
    /** 超时时间 (ms) */
    timeout?: number;
    /** 外部中止信号 */
    signal?: AbortSignal;
    /** 自定义执行 ID（用于事件关联） */
    executionId?: string;
    /** ✨ [新增] 根节点 ID（用于关联 UI 预创建的节点） */
    rootNodeId?: string;
}

/**
 * 执行运行时 - Kernel 的主入口
 */
export class ExecutionRuntime {
    private eventBus: EventBus;
    private factory: IExecutorFactory;
    private activeExecutions = new Map<string, AbortController>();
    
    constructor(factory?: IExecutorFactory) {
        this.eventBus = getEventBus();
        this.factory = factory || getExecutorRegistry();
    }
    
    /**
     * 执行配置
     */
    async execute(
        config: ExecutorConfig,
        input: unknown,
        options: ExecutionOptions = {}
    ): Promise<ExecutionResult> {
        // ✅ 修复：允许外部传入 executionId
        const executionId = options.executionId 
            || options.variables?.sessionId 
            || generateUUID();
        
        const abortController = new AbortController();
        
        // 链接外部信号
        if (options.signal) {
            options.signal.addEventListener('abort', () => {
                abortController.abort();
            });
        }
        
        // 超时控制
        let timeoutId: ReturnType<typeof setTimeout> | undefined;
        if (options.timeout) {
            timeoutId = setTimeout(() => {
                abortController.abort();
            }, options.timeout);
        }
        
        this.activeExecutions.set(executionId, abortController);
        
        // 创建事件作用域
        const scopedEvents = this.eventBus.createScope(executionId);
        
        // 创建执行上下文
        const context = new ExecutionContext(
            executionId,
            scopedEvents,
            undefined,
            0,
            undefined,
            abortController
        );

        // ✨ [核心修复] 如果提供了 rootNodeId，设置当前节点 ID
        // 这样后续的 emitContent/emitThinking 就会携带这个 ID
        if (options.rootNodeId) {
            context.setCurrentNode(options.rootNodeId);
        }
        
        // 注入初始变量
        if (options.variables) {
            for (const [key, value] of Object.entries(options.variables)) {
                context.variables.set(key, value);
            }
        }
        
        try {
            // 发送执行开始事件
            scopedEvents.emit('execution:start', {
                executionId,
                config: { id: config.id, name: config.name, type: config.type }
            });
            
            // 创建并执行
            const executor = this.factory.create(config);
            const result = await executor.execute(input, context);
            
            // 发送执行完成事件
            scopedEvents.emit('execution:complete', {
                executionId,
                status: result.status,
                output: result.output
            });
            
            return result;
            
        } catch (error: any) {
            scopedEvents.emit('execution:error', {
                executionId,
                error: error.message,
                code: error.code
            });
            
            return {
                status: 'failed',
                output: null,
                control: { action: 'end', reason: error.message },
                errors: [{
                    code: error.code || 'RUNTIME_ERROR',
                    message: error.message,
                    recoverable: false
                }]
            };
            
        } finally {
            // 清理
            if (timeoutId) clearTimeout(timeoutId);
            this.activeExecutions.delete(executionId);
            this.eventBus.destroyScope(executionId);
        }
    }
    
    /**
     * 取消执行
     */
    cancel(executionId: string): boolean {
        const controller = this.activeExecutions.get(executionId);
        if (controller) {
            controller.abort();
            return true;
        }
        return false;
    }
    
    /**
     * 取消所有执行
     */
    cancelAll(): void {
        for (const controller of this.activeExecutions.values()) {
            controller.abort();
        }
        this.activeExecutions.clear();
    }
    
    /**
     * 获取活跃执行数
     */
    getActiveCount(): number {
        return this.activeExecutions.size;
    }
    
    /**
     * 订阅事件
     */
    onEvent(handler: (event: any) => void): () => void {
        return this.eventBus.on('*', handler);
    }
    
    /**
     * 订阅特定执行的事件
     */
    onExecutionEvent(executionId: string, handler: (event: any) => void): () => void {
        return this.eventBus.on('*', handler, {
            filter: (event) => event.executionId === executionId
        });
    }
}

// 便捷的全局运行时
let globalRuntime: ExecutionRuntime | null = null;

export function getRuntime(): ExecutionRuntime {
    if (!globalRuntime) {
        globalRuntime = new ExecutionRuntime();
    }
    return globalRuntime;
}
