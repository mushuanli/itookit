// @file packages/vfs-sync/src/core/Scheduler.ts

import { SYNC_CONSTANTS } from '../constants';

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
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private forceSyncTimer: ReturnType<typeof setTimeout> | null = null;
  private isRunning = false;
  private pendingCount = 0;
  private firstTriggerTime = 0;
  private lastSyncTime = 0;

  private readonly options: Required<SchedulerOptions>;

  constructor(
    private task: () => Promise<void>,
    options: SchedulerOptions = {}
  ) {
    this.options = {
      debounceDelay: options.debounceDelay ?? SYNC_CONSTANTS.DEFAULT_DEBOUNCE,
      maxWaitTime: options.maxWaitTime ?? 60000,
      maxPendingCount: options.maxPendingCount ?? 100,
      minSyncInterval: options.minSyncInterval ?? 5000
    };
  }

  /**
   * 触发同步（带智能调度）
   */
  trigger(): void {
    const now = Date.now();
    this.pendingCount++;

    // 记录首次触发时间（用于计算最大等待）
    if (this.firstTriggerTime === 0) {
      this.firstTriggerTime = now;
    }

    // 检查强制同步条件
    const waitTime = now - this.firstTriggerTime;
    if (this.pendingCount >= this.options.maxPendingCount || waitTime >= this.options.maxWaitTime) {
      this.forceSync();
      return;
    }

    // 重置防抖定时器
    this.clearDebounceTimer();
    this.debounceTimer = setTimeout(() => this.run(), this.options.debounceDelay);

    // 设置最大等待保护
    if (!this.forceSyncTimer) {
      this.forceSyncTimer = setTimeout(() => this.forceSync(), this.options.maxWaitTime);
    }
  }

  /**
   * 强制立即同步
   */
  forceSync(): void {
    this.clearTimers();
    this.run();
  }

  stop(): void {
    this.clearTimers();
    this.reset();
  }

  getStatus(): { isRunning: boolean; pendingCount: number } {
    return {
      isRunning: this.isRunning,
      pendingCount: this.pendingCount
    };
  }

  /**
   * 执行同步任务
   */
  private async run(): Promise<void> {
    if (this.isRunning) {
      // 正在运行，延迟重试
      setTimeout(() => this.trigger(), this.options.minSyncInterval);
      return;
    }

    const now = Date.now();
    const timeSinceLastSync = now - this.lastSyncTime;

    // 防止过于频繁
    if (this.lastSyncTime > 0 && timeSinceLastSync < this.options.minSyncInterval) {
      setTimeout(() => this.run(), this.options.minSyncInterval - timeSinceLastSync);
      return;
    }

    this.isRunning = true;
    this.reset();

    try {
      await this.task();
      this.lastSyncTime = Date.now();
    } catch (e) {
      console.error('[Scheduler] Task failed', e);
    } finally {
      this.isRunning = false;
      this.clearForceSyncTimer();
    }
  }

  private reset(): void {
    this.pendingCount = 0;
    this.firstTriggerTime = 0;
  }

  private clearTimers(): void {
    this.clearDebounceTimer();
    this.clearForceSyncTimer();
  }

  private clearDebounceTimer(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  private clearForceSyncTimer(): void {
    if (this.forceSyncTimer) {
      clearTimeout(this.forceSyncTimer);
      this.forceSyncTimer = null;
    }
  }
}
