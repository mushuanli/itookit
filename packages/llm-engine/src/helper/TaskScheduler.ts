// @file: llm-engine/helper/TaskScheduler.ts

import { ExecutionTask } from '../core/types';

/**
 * 任务调度器选项
 */
export interface TaskSchedulerOptions {
    /** 最大并发任务数 */
    maxConcurrent?: number;
    /** 队列最大长度，0 表示无限制 */
    maxQueueSize?: number;
    /** 任务超时时间（毫秒），0 表示无超时 */
    taskTimeout?: number;
    /** 是否启用优先级调度 */
    enablePriority?: boolean;
}

/**
 * 任务状态
 */
export type TaskStatus = 'queued' | 'running' | 'completed' | 'failed' | 'aborted';

/**
 * 任务元数据
 */
export interface TaskMetadata {
    id: string;
    sessionId: string;
    status: TaskStatus;
    queuedAt: number;
    startedAt?: number;
    completedAt?: number;
    priority?: number;
}

/**
 * 调度器统计信息
 */
export interface SchedulerStats {
    queued: number;
    running: number;
    completed: number;
    failed: number;
    aborted: number;
    totalProcessed: number;
    averageWaitTime: number;
    averageExecutionTime: number;
}

/**
 * 任务调度器
 * 
 * 职责：
 * - 管理任务队列（FIFO 或优先级）
 * - 控制并发执行数量
 * - 跟踪任务状态
 * - 提供任务中止功能
 * - 收集调度统计信息
 */
export class TaskScheduler {
    private queue: ExecutionTask[] = [];
    private runningTasks = new Map<string, ExecutionTask>();
    private taskMetadata = new Map<string, TaskMetadata>();

    private options: Required<TaskSchedulerOptions>;

    // 统计数据
    private stats = {
        completed: 0,
        failed: 0,
        aborted: 0,
        totalWaitTime: 0,
        totalExecutionTime: 0
    };

    constructor(options: TaskSchedulerOptions = {}) {
        this.options = {
            maxConcurrent: options.maxConcurrent ?? 3,
            maxQueueSize: options.maxQueueSize ?? 0, // 无限制
            taskTimeout: options.taskTimeout ?? 0, // 无超时
            enablePriority: options.enablePriority ?? false
        };

        console.log('[TaskScheduler] Initialized with options:', this.options);
    }

    /**
     * 将任务加入队列
     * 
     * @param task 执行任务
     * @param priority 优先级（数字越大优先级越高）
     * @returns 是否成功入队
     */
    enqueue(task: ExecutionTask, priority: number = 0): boolean {
        // 检查队列容量
        if (this.options.maxQueueSize > 0 && this.queue.length >= this.options.maxQueueSize) {
            console.warn(`[TaskScheduler] Queue is full (${this.queue.length}/${this.options.maxQueueSize})`);
            return false;
        }

        // 记录元数据
        this.taskMetadata.set(task.id, {
            id: task.id,
            sessionId: task.sessionId,
            status: 'queued',
            queuedAt: Date.now(),
            priority: this.options.enablePriority ? priority : undefined
        });

        // 加入队列
        if (this.options.enablePriority) {
            // 优先级队列：按优先级降序插入
            const insertIndex = this.queue.findIndex(t => {
                const tMeta = this.taskMetadata.get(t.id);
                return (tMeta?.priority ?? 0) < priority;
            });

            if (insertIndex === -1) {
                this.queue.push(task);
            } else {
                this.queue.splice(insertIndex, 0, task);
            }
        } else {
            // FIFO 队列
            this.queue.push(task);
        }

        console.log(`[TaskScheduler] Task ${task.id} enqueued (queue: ${this.queue.length}, running: ${this.runningTasks.size})`);

        return true;
    }

    /**
     * 从队列中取出下一个任务
     * 
     * @returns 任务或 null
     */
    dequeue(): ExecutionTask | null {
        if (this.queue.length === 0) {
            return null;
        }

        if (!this.hasCapacity()) {
            return null;
        }

        const task = this.queue.shift()!;

        console.log(`[TaskScheduler] Task ${task.id} dequeued (queue: ${this.queue.length}, running: ${this.runningTasks.size})`);

        return task;
    }

    /**
     * 标记任务为运行中
     * 
     * @param taskId 任务 ID
     */
    markRunning(taskId: string): void {
        const metadata = this.taskMetadata.get(taskId);
        if (!metadata) {
            console.warn(`[TaskScheduler] Task ${taskId} metadata not found`);
            return;
        }

        metadata.status = 'running';
        metadata.startedAt = Date.now();

        // 从队列中找到任务并移到运行集合
        const taskIndex = this.queue.findIndex(t => t.id === taskId);
        if (taskIndex !== -1) {
            const task = this.queue.splice(taskIndex, 1)[0];
            this.runningTasks.set(taskId, task);
        }

        // 设置超时（如果启用）
        if (this.options.taskTimeout > 0) {
            setTimeout(() => {
                this.checkTimeout(taskId);
            }, this.options.taskTimeout);
        }

        console.log(`[TaskScheduler] Task ${taskId} started (running: ${this.runningTasks.size})`);
    }

    /**
     * 标记任务为完成
     * 
     * @param taskId 任务 ID
     * @param status 最终状态
     */
    markCompleted(taskId: string, status: 'completed' | 'failed' | 'aborted'): void {
        const metadata = this.taskMetadata.get(taskId);
        if (!metadata) {
            console.warn(`[TaskScheduler] Task ${taskId} metadata not found`);
            return;
        }

        metadata.status = status;
        metadata.completedAt = Date.now();

        // 从运行集合中移除
        this.runningTasks.delete(taskId);

        // 更新统计
        if (status === 'completed') {
            this.stats.completed++;
        } else if (status === 'failed') {
            this.stats.failed++;
        } else if (status === 'aborted') {
            this.stats.aborted++;
        }

        // 计算等待时间和执行时间
        if (metadata.startedAt) {
            const waitTime = metadata.startedAt - metadata.queuedAt;
            const executionTime = metadata.completedAt - metadata.startedAt;

            this.stats.totalWaitTime += waitTime;
            this.stats.totalExecutionTime += executionTime;
        }

        console.log(`[TaskScheduler] Task ${taskId} ${status} (running: ${this.runningTasks.size})`);
    }

    /**
     * 中止任务
     * 
     * @param taskId 任务 ID
     * @returns 是否成功中止
     */
    abort(taskId: string): boolean {
        // 检查是否在队列中
        const queueIndex = this.queue.findIndex(t => t.id === taskId);
        if (queueIndex !== -1) {
            const task = this.queue.splice(queueIndex, 1)[0];
            task.abortController.abort();
            this.markCompleted(taskId, 'aborted');
            console.log(`[TaskScheduler] Task ${taskId} aborted from queue`);
            return true;
        }

        // 检查是否正在运行
        const runningTask = this.runningTasks.get(taskId);
        if (runningTask) {
            runningTask.abortController.abort();
            console.log(`[TaskScheduler] Task ${taskId} abort signal sent`);
            return true;
        }

        console.warn(`[TaskScheduler] Task ${taskId} not found for abort`);
        return false;
    }

    /**
     * 中止会话的所有任务
     * 
     * @param sessionId 会话 ID
     * @returns 中止的任务数量
     */
    abortSession(sessionId: string): number {
        let abortedCount = 0;

        // 中止队列中的任务
        const queuedTasks = this.queue.filter(t => t.sessionId === sessionId);
        for (const task of queuedTasks) {
            if (this.abort(task.id)) {
                abortedCount++;
            }
        }

        // 中止运行中的任务
        const runningTasks = Array.from(this.runningTasks.values()).filter(
            t => t.sessionId === sessionId
        );
        for (const task of runningTasks) {
            if (this.abort(task.id)) {
                abortedCount++;
            }
        }

        console.log(`[TaskScheduler] Aborted ${abortedCount} tasks for session ${sessionId}`);
        return abortedCount;
    }

    /**
     * 检查是否有容量接受新任务
     * 
     * @returns 是否有容量
     */
    hasCapacity(): boolean {
        return this.runningTasks.size < this.options.maxConcurrent;
    }

    /**
     * 检查是否可以接受新任务（考虑队列容量）
     * 
     * @returns 是否可以接受
     */
    canAcceptTask(): boolean {
        if (this.options.maxQueueSize === 0) {
            return true; // 无限制
        }
        return this.queue.length < this.options.maxQueueSize;
    }

    /**
     * 获取任务元数据
     * 
     * @param taskId 任务 ID
     * @returns 元数据或 undefined
     */
    getTaskMetadata(taskId: string): TaskMetadata | undefined {
        return this.taskMetadata.get(taskId);
    }

    /**
     * 获取会话的所有任务
     * 
     * @param sessionId 会话 ID
     * @returns 任务元数据列表
     */
    getSessionTasks(sessionId: string): TaskMetadata[] {
        return Array.from(this.taskMetadata.values()).filter(
            meta => meta.sessionId === sessionId
        );
    }

    /**
     * 获取调度器统计信息
     * 
     * @returns 统计信息
     */
    getStats(): SchedulerStats {
        const totalProcessed = this.stats.completed + this.stats.failed + this.stats.aborted;

        return {
            queued: this.queue.length,
            running: this.runningTasks.size,
            completed: this.stats.completed,
            failed: this.stats.failed,
            aborted: this.stats.aborted,
            totalProcessed,
            averageWaitTime: totalProcessed > 0
                ? this.stats.totalWaitTime / totalProcessed
                : 0,
            averageExecutionTime: totalProcessed > 0
                ? this.stats.totalExecutionTime / totalProcessed
                : 0
        };
    }

    /**
     * 获取队列快照
     * 
     * @returns 队列中的任务 ID 列表
     */
    getQueueSnapshot(): string[] {
        return this.queue.map(t => t.id);
    }

    /**
     * 获取运行中的任务快照
     * 
     * @returns 运行中的任务 ID 列表
     */
    getRunningSnapshot(): string[] {
        return Array.from(this.runningTasks.keys());
    }

    /**
     * 清空队列
     * 
     * @returns 清空的任务数量
     */
    clearQueue(): number {
        const count = this.queue.length;

        // 中止所有队列中的任务
        for (const task of this.queue) {
            task.abortController.abort();
            this.markCompleted(task.id, 'aborted');
        }

        this.queue = [];

        console.log(`[TaskScheduler] Queue cleared (${count} tasks aborted)`);
        return count;
    }

    /**
     * 重置统计信息
     */
    resetStats(): void {
        this.stats = {
            completed: 0,
            failed: 0,
            aborted: 0,
            totalWaitTime: 0,
            totalExecutionTime: 0
        };

        console.log('[TaskScheduler] Stats reset');
    }

    /**
     * 更新调度器选项
     * 
     * @param options 新选项
     */
    updateOptions(options: Partial<TaskSchedulerOptions>): void {
        if (options.maxConcurrent !== undefined) {
            this.options.maxConcurrent = options.maxConcurrent;
        }
        if (options.maxQueueSize !== undefined) {
            this.options.maxQueueSize = options.maxQueueSize;
        }
        if (options.taskTimeout !== undefined) {
            this.options.taskTimeout = options.taskTimeout;
        }
        if (options.enablePriority !== undefined) {
            this.options.enablePriority = options.enablePriority;
        }

        console.log('[TaskScheduler] Options updated:', this.options);
    }

    /**
     * 检查任务是否超时
     * 
     * @param taskId 任务 ID
     */
    private checkTimeout(taskId: string): void {
        const metadata = this.taskMetadata.get(taskId);
        if (!metadata || metadata.status !== 'running') {
            return; // 任务已完成或不存在
        }

        const runningTime = Date.now() - (metadata.startedAt || 0);
        if (runningTime >= this.options.taskTimeout) {
            console.warn(`[TaskScheduler] Task ${taskId} timeout (${runningTime}ms)`);
            this.abort(taskId);
        }
    }

    /**
     * 获取调度器状态摘要
     * 
     * @returns 状态摘要字符串
     */
    getStatusSummary(): string {
        const stats = this.getStats();
        return `Queue: ${stats.queued}, Running: ${stats.running}/${this.options.maxConcurrent}, ` +
            `Completed: ${stats.completed}, Failed: ${stats.failed}, Aborted: ${stats.aborted}`;
    }

    /**
     * 清理已完成任务的元数据（保留最近 N 个）
     * 
     * @param keepCount 保留数量
     */
    cleanupMetadata(keepCount: number = 100): number {
        const completedTasks = Array.from(this.taskMetadata.entries())
            .filter(([_, meta]) =>
                meta.status === 'completed' ||
                meta.status === 'failed' ||
                meta.status === 'aborted'
            )
            .sort((a, b) => (b[1].completedAt || 0) - (a[1].completedAt || 0));

        const toRemove = completedTasks.slice(keepCount);

        for (const [taskId] of toRemove) {
            this.taskMetadata.delete(taskId);
        }

        if (toRemove.length > 0) {
            console.log(`[TaskScheduler] Cleaned up ${toRemove.length} task metadata entries`);
        }

        return toRemove.length;
    }
}
