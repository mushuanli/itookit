
// ============================================
// 锁管理器
// ============================================

export class LockManager {
  private locks = new Map<string, Promise<void>>();
  private waitQueues = new Map<string, Array<() => void>>();

  async acquire<T>(key: string, fn: () => Promise<T>): Promise<T> {
    while (this.locks.has(key)) {
      await new Promise<void>(resolve => {
        const queue = this.waitQueues.get(key) || [];
        queue.push(resolve);
        this.waitQueues.set(key, queue);
      });
    }

    let release: () => void;
    const lockPromise = new Promise<void>(resolve => {
      release = resolve;
    });
    this.locks.set(key, lockPromise);

    try {
      return await fn();
    } finally {
      if (this.locks.get(key) === lockPromise) {
        this.locks.delete(key);
      }
      const queue = this.waitQueues.get(key);
      if (queue && queue.length > 0) {
        const next = queue.shift();
        if (queue.length === 0) {
          this.waitQueues.delete(key);
        }
        next?.();
      }
      release!();
    }
  }
}
