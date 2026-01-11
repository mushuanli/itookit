// @file packages/vfs-sync/src/core/BrowserGuard.ts

import { SyncState } from '../types';

export interface BrowserGuardOptions {
  onVisibilityChange?: (hidden: boolean) => void;
}

export class BrowserGuard {
  private beforeUnloadHandler: ((e: BeforeUnloadEvent) => string | undefined) | null = null;
  private visibilityHandler: (() => void) | null = null;

  constructor(
    private getState: () => SyncState,
    private options?: BrowserGuardOptions
  ) {}

  /**
   * 启用保护
   */
  enable(): void {
    if (typeof window === 'undefined') return;

    this.setupBeforeUnloadGuard();
    this.setupVisibilityListener();
  }

  /**
   * 禁用保护
   */
  disable(): void {
    if (typeof window === 'undefined') return;

    this.removeBeforeUnloadGuard();
    this.removeVisibilityListener();
  }

  /**
   * 强制同步后再离开
   */
  async safeUnload(syncFn: () => Promise<void>): Promise<void> {
    const state = this.getState();

    if (state.stats.pendingChanges > 0) {
      try {
        await syncFn();
      } catch (e) {
        console.error('[BrowserGuard] Final sync failed', e);
      }
    }
  }

  private setupBeforeUnloadGuard(): void {
    this.beforeUnloadHandler = (e: BeforeUnloadEvent) => {
      const state = this.getState();

      if (state.status === 'syncing' || state.stats.pendingChanges > 0) {
        const message = '同步正在进行中，确定要离开吗？未同步的更改可能会丢失。';
        e.preventDefault();
        e.returnValue = message;
        return message;
      }
      return undefined;
    };

    window.addEventListener('beforeunload', this.beforeUnloadHandler);
  }

  private removeBeforeUnloadGuard(): void {
    if (this.beforeUnloadHandler) {
      window.removeEventListener('beforeunload', this.beforeUnloadHandler);
      this.beforeUnloadHandler = null;
    }
  }

  private setupVisibilityListener(): void {
    this.visibilityHandler = () => {
      this.options?.onVisibilityChange?.(document.hidden);
    };

    document.addEventListener('visibilitychange', this.visibilityHandler);
  }

  private removeVisibilityListener(): void {
    if (this.visibilityHandler) {
      document.removeEventListener('visibilitychange', this.visibilityHandler);
      this.visibilityHandler = null;
    }
  }
}
