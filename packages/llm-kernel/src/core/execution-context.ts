// @file: llm-kernel/core/execution-context.ts

import { IScopedEventBus } from './event-bus';
import { NodeStatus, ExecutionResult } from './types';

/**
 * 执行上下文 - 执行器运行时环境
 * 完全不依赖 UI，只关心执行相关的信息
 */
export interface IExecutionContext {
    // 标识
    readonly executionId: string;
    readonly parentId?: string;
    readonly depth: number;
    
    // 中止控制
    readonly signal: AbortSignal;
    readonly abortController: AbortController;
    
    // 变量存储
    readonly variables: ContextVariables;
    
    // 结果存储
    readonly results: Map<string, ExecutionResult>;
    
    // 事件发射
    readonly events: IScopedEventBus;
    
    // 创建子上下文
    createChild(nodeId: string): IExecutionContext;
    
    // 便捷方法
    emitThinking(content: string): void;
    emitContent(content: string): void;
    emitNodeStatus(status: NodeStatus): void;
    emitError(error: Error): void;
    
    // 检查是否被取消
    checkCancelled(): void;
}

/**
 * 上下文变量存储
 */
export class ContextVariables {
    private data = new Map<string, any>();
    private parent?: ContextVariables;
    
    constructor(parent?: ContextVariables) {
        this.parent = parent;
    }
    
    get<T>(key: string): T | undefined {
        if (this.data.has(key)) {
            return this.data.get(key);
        }
        return this.parent?.get(key);
    }
    
    set<T>(key: string, value: T): void {
        this.data.set(key, value);
    }
    
    has(key: string): boolean {
        return this.data.has(key) || (this.parent?.has(key) ?? false);
    }
    
    // 合并所有层级的变量
    toObject(): Record<string, any> {
        const parentObj = this.parent?.toObject() || {};
        const selfObj = Object.fromEntries(this.data);
        return { ...parentObj, ...selfObj };
    }
}

/**
 * 执行上下文实现
 */
export class ExecutionContext implements IExecutionContext {
    readonly variables: ContextVariables;
    readonly results = new Map<string, ExecutionResult>();
    readonly abortController: AbortController;
    
    private currentNodeId?: string;
    
    constructor(
        public readonly executionId: string,
        public readonly events: IScopedEventBus,
        public readonly parentId?: string,
        public readonly depth: number = 0,
        parentVariables?: ContextVariables,
        abortController?: AbortController
    ) {
        this.variables = new ContextVariables(parentVariables);
        this.abortController = abortController || new AbortController();
    }
    
    get signal(): AbortSignal {
        return this.abortController.signal;
    }
    
    createChild(nodeId: string): IExecutionContext {
        return new ExecutionContext(
            this.executionId,
            this.events,
            nodeId,
            this.depth + 1,
            this.variables,
            this.abortController
        );
    }
    
    setCurrentNode(nodeId: string): void {
        this.currentNodeId = nodeId;
    }
    
    emitThinking(content: string): void {
        this.events.emit('stream:thinking', { delta: content }, this.currentNodeId);
    }
    
    emitContent(content: string): void {
        this.events.emit('stream:content', { delta: content }, this.currentNodeId);
    }
    
    emitNodeStatus(status: NodeStatus): void {
        this.events.emit('node:update', { status }, this.currentNodeId);
    }
    
    emitError(error: Error): void {
        this.events.emit('execution:error', {
            code: (error as any).code || 'UNKNOWN',
            message: error.message,
            stack: error.stack
        }, this.currentNodeId);
    }
    
    checkCancelled(): void {
        if (this.signal.aborted) {
            throw new CancellationError('Execution cancelled');
        }
    }
}

export class CancellationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'CancellationError';
    }
}
