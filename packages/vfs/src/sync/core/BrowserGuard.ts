// @file packages/vfs-sync/src/core/BrowserGuard.ts

import { SyncState } from '../types';

type BeforeUnloadHandler = (e: BeforeUnloadEvent) => string | undefined;

export class BrowserGuard {
  private handler: BeforeUnloadHandler | null = null;
  private visibilityHandler: (() => void) | null = null;
  private getState: () => SyncState;
  private onVisibilityChange?: (hidden: boolean) => void;

  constructor(
    getState: () => SyncState,
    options?: {
      onVisibilityChange?: (hidden: boolean) => void;
    }
  ) {
    this.getState = getState;
    this.onVisibilityChange = options?.onVisibilityChange;
  }

  /**
   * 启用保护
   */
  enable(): void {
    if (typeof window === 'undefined') return;

    // 页面卸载保护
    this.handler = (e: BeforeUnloadEvent) => {
      const state = this.getState();
      
      if (state.status === 'syncing' || (state.stats.pendingChanges > 0)) {
        const message = '同步正在进行中，确定要离开吗？未同步的更改可能会丢失。';
        e.preventDefault();
        e.returnValue = message;
        return message;
      }
      return undefined;
    };

    window.addEventListener('beforeunload', this.handler);

    // 可见性变化监听
    this.visibilityHandler = () => {
      const hidden = document.hidden;
      this.onVisibilityChange?.(hidden);
    };

    document.addEventListener('visibilitychange', this.visibilityHandler);
  }

  /**
   * 禁用保护
   */
  disable(): void {
    if (typeof window === 'undefined') return;

    if (this.handler) {
      window.removeEventListener('beforeunload', this.handler);
      this.handler = null;
    }

    if (this.visibilityHandler) {
      document.removeEventListener('visibilitychange', this.visibilityHandler);
      this.visibilityHandler = null;
    }
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
}
