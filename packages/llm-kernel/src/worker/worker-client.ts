// @file: llm-kernel/worker/worker-client.ts

import { ExecutorConfig } from '../core/interfaces';
import { ExecutionResult } from '../core/types';
import { KernelEvent } from '../core/event-bus';
import type { WorkerMessage, WorkerResponse } from './worker-adapter';

/**
 * 执行选项
 */
export interface WorkerExecuteOptions {
    /** 初始变量 */
    variables?: Record<string, any>;
    
    /** 事件回调 */
    onEvent?: (event: KernelEvent) => void;
    
    /** 超时时间 (ms) */
    timeout?: number;
}

/**
 * 待处理请求
 */
interface PendingRequest {
    resolve: (result: ExecutionResult) => void;
    reject: (error: Error) => void;
    onEvent?: (event: KernelEvent) => void;
    timeoutId?: ReturnType<typeof setTimeout>;
}

/**
 * Worker 客户端
 * 在主线程中与 Kernel Worker 通信
 * 
 * 使用示例：
 * ```typescript
 * const client = new WorkerClient(
 *     new URL('./kernel.worker.ts', import.meta.url)
 * );
 * 
 * await client.waitReady();
 * 
 * const result = await client.execute(config, input, {
 *     onEvent: (event) => {
 *         if (event.type === 'stream:content') {
 *             console.log(event.payload.delta);
 *         }
 *     }
 * });
 * ```
 */
export class WorkerClient {
    private worker: Worker;
    private pendingRequests = new Map<string, PendingRequest>();
    private isReady = false;
    private readyPromise: Promise<void>;
    private readyResolve!: () => void;
    
    constructor(workerUrl: string | URL, options?: WorkerOptions) {
        // 创建 Worker
        this.worker = new Worker(workerUrl, {
            type: 'module',
            ...options
        });
        
        // 设置 ready promise
        this.readyPromise = new Promise((resolve) => {
            this.readyResolve = resolve;
        });
        
        // 绑定消息处理
        this.worker.onmessage = this.handleMessage.bind(this);
        this.worker.onerror = this.handleError.bind(this);
        
        // 发送 ping 检查 ready 状态
        this.checkReady();
    }
    
    /**
     * 等待 Worker 就绪
     */
    async waitReady(timeout: number = 5000): Promise<boolean> {
        if (this.isReady) return true;
        
        const timeoutPromise = new Promise<boolean>((resolve) => {
            setTimeout(() => resolve(false), timeout);
        });
        
        const readyPromise = this.readyPromise.then(() => true);
        
        return Promise.race([readyPromise, timeoutPromise]);
    }
    
    /**
     * 检查 Worker 是否就绪
     */
    private async checkReady(): Promise<void> {
        const maxAttempts = 10;
        const interval = 100;
        
        for (let i = 0; i < maxAttempts; i++) {
            try {
                const isAlive = await this.ping(1000);
                if (isAlive) {
                    this.isReady = true;
                    this.readyResolve();
                    return;
                }
            } catch {
                // 继续重试
            }
            await this.sleep(interval);
        }
        
        console.warn('[WorkerClient] Worker did not respond to ping');
    }
    
    /**
     * 执行配置
     */
    async execute(
        config: ExecutorConfig,
        input: unknown,
        options?: WorkerExecuteOptions
    ): Promise<ExecutionResult> {
        if (!this.isReady) {
            const ready = await this.waitReady();
            if (!ready) {
                throw new Error('Worker is not ready');
            }
        }
        
        return new Promise((resolve, reject) => {
            const id = this.generateId();
            
            // 设置超时
            let timeoutId: ReturnType<typeof setTimeout> | undefined;
            if (options?.timeout) {
                timeoutId = setTimeout(() => {
                    this.pendingRequests.delete(id);
                    reject(new Error(`Execution timed out after ${options.timeout}ms`));
                }, options.timeout);
            }
            
            // 存储请求
            this.pendingRequests.set(id, {
                resolve,
                reject,
                onEvent: options?.onEvent,
                timeoutId
            });
            
            // 发送消息
            const message: WorkerMessage = {
                type: 'execute',
                id,
                config,
                input,
                variables: options?.variables
            };
            
            this.worker.postMessage(message);
        });
    }
    
    /**
     * 取消执行
     */
    cancel(executionId: string): void {
        const message: WorkerMessage = {
            type: 'cancel',
            executionId
        };
        this.worker.postMessage(message);
        
        // 清理待处理请求
        const pending = this.pendingRequests.get(executionId);
        if (pending) {
            if (pending.timeoutId) clearTimeout(pending.timeoutId);
            pending.reject(new Error('Execution cancelled'));
            this.pendingRequests.delete(executionId);
        }
    }
    
    /**
     * Ping Worker
     */
    ping(timeout: number = 5000): Promise<boolean> {
        return new Promise((resolve) => {
            const timeoutId = setTimeout(() => resolve(false), timeout);
            
            const handler = (event: MessageEvent<WorkerResponse>) => {
                if (event.data.type === 'pong') {
                    clearTimeout(timeoutId);
                    this.worker.removeEventListener('message', handler);
                    resolve(true);
                }
            };
            
            this.worker.addEventListener('message', handler);
            this.worker.postMessage({ type: 'ping' } as WorkerMessage);
        });
    }
    
    /**
     * 终止 Worker
     */
    terminate(): void {
        // 拒绝所有待处理请求
        for (const [id, pending] of this.pendingRequests) {
            if (pending.timeoutId) clearTimeout(pending.timeoutId);
            pending.reject(new Error('Worker terminated'));
        }
        this.pendingRequests.clear();
        
        // 终止 Worker
        this.worker.terminate();
        this.isReady = false;
    }
    
    /**
     * 获取待处理请求数
     */
    getPendingCount(): number {
        return this.pendingRequests.size;
    }
    
    /**
     * 检查 Worker 是否就绪
     */
    get ready(): boolean {
        return this.isReady;
    }
    
    /**
     * 处理 Worker 消息
     */
    private handleMessage(event: MessageEvent<WorkerResponse>): void {
        const response = event.data;
        
        switch (response.type) {
            case 'result': {
                const pending = this.pendingRequests.get(response.id);
                if (pending) {
                    if (pending.timeoutId) clearTimeout(pending.timeoutId);
                    pending.resolve(response.result);
                    this.pendingRequests.delete(response.id);
                }
                break;
            }
            
            case 'event': {
                const pending = this.pendingRequests.get(response.id);
                pending?.onEvent?.(response.event);
                break;
            }
            
            case 'error': {
                const pending = this.pendingRequests.get(response.id);
                if (pending) {
                    if (pending.timeoutId) clearTimeout(pending.timeoutId);
                    pending.reject(new Error(response.error));
                    this.pendingRequests.delete(response.id);
                }
                break;
            }
            
            case 'pong': {
                // 由 ping() 方法处理
                break;
            }
        }
    }
    
    /**
     * 处理 Worker 错误
     */
    private handleError(event: ErrorEvent): void {
        console.error('[WorkerClient] Worker error:', event.message);
        
        // 拒绝所有待处理请求
        for (const [id, pending] of this.pendingRequests) {
            if (pending.timeoutId) clearTimeout(pending.timeoutId);
            pending.reject(new Error(`Worker error: ${event.message}`));
        }
        this.pendingRequests.clear();
    }
    
    /**
     * 生成唯一 ID
     */
    private generateId(): string {
        return `exec-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }
    
    /**
     * 延迟
     */
    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

/**
 * 创建 Worker Client 的便捷函数
 */
export function createWorkerClient(
    workerUrl: string | URL,
    options?: WorkerOptions
): WorkerClient {
    return new WorkerClient(workerUrl, options);
}
