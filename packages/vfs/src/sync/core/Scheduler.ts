// @file packages/vfs-sync/src/core/Scheduler.ts

import { SYNC_CONSTANTS } from '../constants';

type Task = () => Promise<void>;

export class Scheduler {
  private timer: any = null;
  private isRunning = false;

  constructor(
    private task: Task,
    private delay: number = SYNC_CONSTANTS.DEFAULT_DEBOUNCE
  ) {}

  trigger() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.run();
    }, this.delay);
  }

  private async run() {
    if (this.isRunning) return; // 避免重入
    this.isRunning = true;
    try {
      await this.task();
    } catch (e) {
      console.error('[SyncScheduler] Task failed', e);
    } finally {
      this.isRunning = false;
    }
  }
  
  stop() {
    if (this.timer) clearTimeout(this.timer);
  }
}
