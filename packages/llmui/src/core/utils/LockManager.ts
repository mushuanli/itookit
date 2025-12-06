// @file: llm-ui/core/utils/LockManager.ts
/**
 * 简单的异步锁管理器
 * 用于确保同一资源的并发操作按顺序执行 (Mutex)
 */
export class LockManager {
    private locks = new Map<string, Promise<void>>();

    async acquire<T>(key: string, fn: () => Promise<T>): Promise<T> {
        // 等待现有锁释放
        while (this.locks.has(key)) {
            await this.locks.get(key);
        }

        let release: () => void;
        const lockPromise = new Promise<void>(resolve => {
            release = resolve;
        });
        this.locks.set(key, lockPromise);

        try {
            return await fn();
        } finally {
            // 清理并释放
            // 注意：必须先 delete 再 resolve，防止 await loop 死循环
            if (this.locks.get(key) === lockPromise) {
                this.locks.delete(key);
            }
            release!();
        }
    }

    /**
     * 检查资源是否被锁定
     */
    isLocked(key: string): boolean {
        return this.locks.has(key);
    }
}
