// @file: llm-engine/session/managers/task-queue-manager.ts

import { ExecutionTask } from '../../core/types';
import { ENGINE_DEFAULTS } from '../../core/constants';
import { EngineError, EngineErrorCode } from '../../core/errors';
import { SessionEventEmitter } from '../events/session-event-emitter';

export interface TaskQueueConfig {
    maxConcurrent?: number;
    maxQueueSize?: number;
}

/**
 * 任务队列管理器
 * 负责任务的入队、出队、优先级排序和并发控制
 */
export class TaskQueueManager {
    private taskQueue: ExecutionTask[] = [];
    private runningTasks = new Map<string, ExecutionTask>();
    private maxConcurrent: number;
    private maxQueueSize: number;

    constructor(
        private eventEmitter: SessionEventEmitter,
        config?: TaskQueueConfig
    ) {
        this.maxConcurrent = config?.maxConcurrent ?? ENGINE_DEFAULTS.MAX_CONCURRENT;
        this.maxQueueSize = config?.maxQueueSize ?? ENGINE_DEFAULTS.MAX_QUEUE_SIZE;
    }

    /**
     * 检查是否可以接受新任务
     */
    canAcceptTask(): boolean {
        return this.taskQueue.length < this.maxQueueSize;
    }

    /**
     * 入队任务（按优先级）
     */
    enqueue(task: ExecutionTask): void {
        if (!this.canAcceptTask()) {
            throw new EngineError(
                EngineErrorCode.QUOTA_EXCEEDED,
                'Task queue is full. Please wait.'
            );
        }

        const insertIndex = this.taskQueue.findIndex(t => t.priority < task.priority);
        if (insertIndex === -1) {
            this.taskQueue.push(task);
        } else {
            this.taskQueue.splice(insertIndex, 0, task);
        }

        this.emitPoolStatus();
    }

    /**
     * 出队下一个任务
     */
    dequeue(): ExecutionTask | undefined {
        return this.taskQueue.shift();
    }

    /**
     * 标记任务开始运行
     */
    markRunning(task: ExecutionTask): void {
        this.runningTasks.set(task.id, task);
        this.emitPoolStatus();
    }

    /**
     * 标记任务完成
     */
    markCompleted(taskId: string): void {
        this.runningTasks.delete(taskId);
        this.emitPoolStatus();
    }

    /**
     * 从队列中移除会话的任务
     */
    removeSessionTask(sessionId: string): boolean {
        const index = this.taskQueue.findIndex(t => t.sessionId === sessionId);
        if (index !== -1) {
            this.taskQueue.splice(index, 1);
            this.emitPoolStatus();
            return true;
        }
        return false;
    }

    /**
     * 获取会话的运行中任务
     */
    getRunningTask(taskId: string): ExecutionTask | undefined {
        return this.runningTasks.get(taskId);
    }

    /**
     * 中止运行中的任务
     */
    abortRunningTask(taskId: string): boolean {
        const task = this.runningTasks.get(taskId);
        if (task) {
            task.abortController.abort();
            this.runningTasks.delete(taskId);
            this.emitPoolStatus();
            return true;
        }
        return false;
    }

    /**
     * 检查是否有可用槽位
     */
    hasAvailableSlot(): boolean {
        return this.runningTasks.size < this.maxConcurrent;
    }

    /**
     * 检查队列是否有待处理任务
     */
    hasPendingTasks(): boolean {
        return this.taskQueue.length > 0;
    }

    /**
     * 获取池状态
     */
    getPoolStatus(): {
        running: number;
        queued: number;
        maxConcurrent: number;
        available: number;
    } {
        return {
            running: this.runningTasks.size,
            queued: this.taskQueue.length,
            maxConcurrent: this.maxConcurrent,
            available: this.maxConcurrent - this.runningTasks.size
        };
    }

    /**
     * 设置最大并发数
     */
    setMaxConcurrent(value: number): void {
        if (value < 1) {
            throw new Error('maxConcurrent must be at least 1');
        }
        const oldValue = this.maxConcurrent;
        this.maxConcurrent = value;
        console.log(`[TaskQueueManager] maxConcurrent: ${oldValue} -> ${value}`);
        this.emitPoolStatus();
    }

    /**
     * 中止所有任务
     */
    abortAll(): void {
        for (const task of this.runningTasks.values()) {
            task.abortController.abort();
        }
        this.runningTasks.clear();
        this.taskQueue = [];
        this.emitPoolStatus();
    }

    private emitPoolStatus(): void {
        this.eventEmitter.emitGlobal({
            type: 'pool_status_changed',
            payload: this.getPoolStatus()
        });
    }
}
