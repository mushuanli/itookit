// @file packages/vfs-sync/src/core/Scheduler.ts

import { SYNC_CONSTANTS } from '../constants';

type Task = () => Promise<void>;

export interface SchedulerOptions {
  /** 防抖延迟（毫秒） */
  debounceDelay?: number;
  /** 最大等待时间（毫秒） */
  maxWaitTime?: number;
  /** 最大积压操作数 */
  maxPendingCount?: number;
  /** 最小同步间隔（毫秒） */
  minSyncInterval?: number;
}

export class Scheduler {
  private debounceTimer: any = null;
  private isRunning = false;
  private pendingCount = 0;
  private lastTriggerTime = 0;
  private lastSyncTime = 0;
  private forceSyncTimer: any = null;

  private readonly debounceDelay: number;
  private readonly maxWaitTime: number;
  private readonly maxPendingCount: number;
  private readonly minSyncInterval: number;

  constructor(private task: Task, options: SchedulerOptions = {}) {
    this.debounceDelay = options.debounceDelay ?? SYNC_CONSTANTS.DEFAULT_DEBOUNCE;
    this.maxWaitTime = options.maxWaitTime ?? 60000; // 1分钟
    this.maxPendingCount = options.maxPendingCount ?? 100;
    this.minSyncInterval = options.minSyncInterval ?? 5000; // 5秒
  }

  /**
   * 触发同步（带智能调度）
   */
  trigger(): void {
    const now = Date.now();
    this.pendingCount++;

    // 记录首次触发时间（用于计算最大等待）
    if (this.lastTriggerTime === 0) {
      this.lastTriggerTime = now;
    }

    // 检查是否需要强制同步
    const waitTime = now - this.lastTriggerTime;
    const shouldForceSync = 
      this.pendingCount >= this.maxPendingCount ||
      waitTime >= this.maxWaitTime;

    if (shouldForceSync) {
      this.forceSync();
      return;
    }

    // 设置防抖定时器
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      this.run();
    }, this.debounceDelay);

    // 设置最大等待保护定时器
    if (!this.forceSyncTimer) {
      this.forceSyncTimer = setTimeout(() => {
        this.forceSync();
      }, this.maxWaitTime);
    }
  }

  /**
   * 强制立即同步
   */
  forceSync(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.forceSyncTimer) {
      clearTimeout(this.forceSyncTimer);
      this.forceSyncTimer = null;
    }
    this.run();
  }

  /**
   * 执行同步任务
   */
  private async run(): Promise<void> {
    if (this.isRunning) {
      // 正在运行，稍后重试
      setTimeout(() => this.trigger(), this.minSyncInterval);
      return;
    }

    const now = Date.now();
    const timeSinceLastSync = now - this.lastSyncTime;

    // 防止过于频繁的同步
    if (this.lastSyncTime > 0 && timeSinceLastSync < this.minSyncInterval) {
      setTimeout(() => this.run(), this.minSyncInterval - timeSinceLastSync);
      return;
    }

    this.isRunning = true;
    this.pendingCount = 0;
    this.lastTriggerTime = 0;

    try {
      await this.task();
      this.lastSyncTime = Date.now();
    } catch (e) {
      console.error('[SyncScheduler] Task failed', e);
    } finally {
      this.isRunning = false;
      
      // 清理定时器
      if (this.forceSyncTimer) {
        clearTimeout(this.forceSyncTimer);
        this.forceSyncTimer = null;
      }
    }
  }

  /**
   * 停止调度器
   */
  stop(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.forceSyncTimer) {
      clearTimeout(this.forceSyncTimer);
      this.forceSyncTimer = null;
    }
  }

  /**
   * 获取状态
   */
  getStatus(): { isRunning: boolean; pendingCount: number } {
    return {
      isRunning: this.isRunning,
      pendingCount: this.pendingCount
    };
  }
}
