// @file: llm-kernel/runtime/execution-runtime.ts
//
// S6c: execute() method removed — AgentExecutor (the only built-in executor)
// has been deleted. The runtime is kept as a minimal shell for cancel/event
// operations. External LLM calls now go through ILLMService directly.

import { type KernelEventBus, getEventBus } from '../core/event-bus';

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
    /** 根节点 ID（用于关联 UI 预创建的节点） */
    rootNodeId?: string;
    stream?: boolean;
}

/**
 * 执行运行时 - Kernel 的主入口
 *
 * S6c: execute() removed. The only built-in executor (AgentExecutor) was
 * deleted. LLM calls now go through ILLMService in llm-engine.
 */
export class ExecutionRuntime {
    private eventBus: KernelEventBus;
    private activeExecutions = new Map<string, AbortController>();

    constructor() {
        this.eventBus = getEventBus();
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
        return this.eventBus.onAny((payload, meta) => handler({ ...meta, payload }));
    }

    onExecutionEvent(executionId: string, handler: (event: any) => void): () => void {
        return this.eventBus.channel(executionId).onAny((payload, meta) =>
            handler({ ...meta, payload }));
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
