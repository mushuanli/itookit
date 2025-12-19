// @file: llm-kernel/worker/worker-adapter.ts

import { ExecutionRuntime, getRuntime } from '../runtime/execution-runtime';
import { ExecutorConfig } from '../core/interfaces';
import { ExecutionResult } from '../core/types';
import { getEventBus, KernelEvent } from '../core/event-bus';

/**
 * Worker 消息类型（主线程 → Worker）
 */
export type WorkerMessage =
    | { type: 'execute'; id: string; config: ExecutorConfig; input: unknown; variables?: Record<string, any> }
    | { type: 'cancel'; executionId: string }
    | { type: 'ping' };

/**
 * Worker 响应类型（Worker → 主线程）
 */
export type WorkerResponse =
    | { type: 'result'; id: string; result: ExecutionResult }
    | { type: 'event'; id: string; event: KernelEvent }
    | { type: 'error'; id: string; error: string }
    | { type: 'pong' };

/**
 * Worker 适配器
 * 在 Web Worker 或 Node Worker 线程中运行 Kernel
 */
export class WorkerAdapter {
    private runtime: ExecutionRuntime;
    private activeExecutions = new Map<string, AbortController>();
    private postMessage: (msg: WorkerResponse) => void;
    
    constructor(postMessage: (msg: WorkerResponse) => void) {
        this.runtime = getRuntime();
        this.postMessage = postMessage;
    }
    
    /**
     * 处理来自主线程的消息
     */
    async handleMessage(message: WorkerMessage): Promise<void> {
        switch (message.type) {
            case 'execute':
                await this.handleExecute(message);
                break;
                
            case 'cancel':
                this.handleCancel(message.executionId);
                break;
                
            case 'ping':
                this.postMessage({ type: 'pong' });
                break;
        }
    }
    
    /**
     * 处理执行请求
     */
    private async handleExecute(
        message: Extract<WorkerMessage, { type: 'execute' }>
    ): Promise<void> {
        const { id, config, input, variables } = message;
        const abortController = new AbortController();
        
        this.activeExecutions.set(id, abortController);
        
        // 转发事件
        const eventBus = getEventBus();
        const unsubscribe = eventBus.on('*', (event: KernelEvent) => {
            // 只转发当前执行的事件
            if (event.executionId === id) {
                this.postMessage({ type: 'event', id, event });
            }
        });
        
        try {
            const result = await this.runtime.execute(config, input, {
                variables,
                signal: abortController.signal
            });
            
            this.postMessage({ type: 'result', id, result });
            
        } catch (error: any) {
            this.postMessage({
                type: 'error',
                id,
                error: error.message || 'Unknown error'
            });
            
        } finally {
            unsubscribe();
            this.activeExecutions.delete(id);
        }
    }
    
    /**
     * 处理取消请求
     */
    private handleCancel(executionId: string): void {
        const controller = this.activeExecutions.get(executionId);
        if (controller) {
            controller.abort();
            this.activeExecutions.delete(executionId);
        }
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
     * 清理资源
     */
    cleanup(): void {
        this.cancelAll();
    }
}

/**
 * 初始化 Worker（在 Worker 脚本中调用）
 * 
 * 使用示例：
 * ```typescript
 * // kernel.worker.ts
 * import { initializeKernel } from '@itookit/llm-kernel';
 * import { initWorker } from '@itookit/llm-kernel/worker';
 * 
 * async function bootstrap() {
 *     await initializeKernel();
 *     initWorker();
 * }
 * bootstrap();
 * ```
 */
export function initWorker(): void {
    // 检查是否在 Worker 环境中
    if (typeof self === 'undefined' || typeof self.postMessage !== 'function') {
        console.error('[Worker] Not in a Worker environment');
        return;
    }
    
    const adapter = new WorkerAdapter((msg) => {
        self.postMessage(msg);
    });
    
    // 监听消息
    self.onmessage = async (event: MessageEvent<WorkerMessage>) => {
        await adapter.handleMessage(event.data);
    };
    
    // 监听错误
    self.onerror = (error) => {
        console.error('[Worker] Unhandled error:', error);
    };
    
    console.log('[Worker] Kernel Worker initialized');
}

/**
 * 创建 Worker Adapter 的便捷函数（用于自定义 Worker 实现）
 */
export function createWorkerAdapter(
    postMessage: (msg: WorkerResponse) => void
): WorkerAdapter {
    return new WorkerAdapter(postMessage);
}
