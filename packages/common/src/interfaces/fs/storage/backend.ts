/**
 * @file common/interfaces/fs/storage/backend.ts
 * @desc 存储后端主接口 + 事务
 *
 * 设计决策：
 * 1. 基础后端只需实现三层 store — 门槛最低
 * 2. 可选 store 通过可选属性声明 — 渐进增强
 * 3. 事务使用闭包 API + ITransactionScope — 保证 commit/rollback 自动执行
 * 4. 类型守卫辅助上层判断后端能力
 *
 * 关键修正：
 * - runInTransaction 接收 ITransactionScope 而非 IStorageBackend
 *   避免嵌套事务语义混淆（scope 上没有 runInTransaction 方法）
 */

import type { IInodeStore } from './inode-store';
import type { IMetaStore } from './meta-store';
import type { IContentStore } from './content-store';
import type { IRecordStore } from './record-backend';
import type { IHighLevelStore } from './high-level-backend';
import type { ISyncableStore } from './syncable-backend';

/**
 * 事务作用域
 *
 * 与 IStorageBackend 的区别：
 * - 没有 runInTransaction（防止嵌套事务）
 * - 没有 init/close（生命周期归后端管理）
 * - 只暴露三层 store + 可选增强 store
 */
export interface ITransactionScope {
    readonly inodes: IInodeStore;
    readonly meta: IMetaStore;
    readonly content: IContentStore;
    readonly records?: IRecordStore;
}

/**
 * 存储后端 — 所有后端必须实现的最小接口
 */
export interface IStorageBackend {
    /** 后端名称（日志/调试用） */
    readonly name: string;

    // ── 三层 Store ──

    readonly inodes: IInodeStore;
    readonly meta: IMetaStore;
    readonly content: IContentStore;

    // ── 可选增强 Store ──

    readonly records?: IRecordStore;
    readonly highLevel?: IHighLevelStore;
    readonly syncable?: ISyncableStore;

    // ── 生命周期 ──

    init(): Promise<void>;
    close(): Promise<void>;

    // ── 事务 ──

    /**
     * 在事务中执行操作
     *
     * 后端保证事务内的所有操作要么全部成功，要么全部回滚。
     * 不支持真正事务的后端（如纯 FS），可使用 WAL 或伪事务。
     *
     * 接收 ITransactionScope 而非 IStorageBackend：
     * - 防止嵌套调用 runInTransaction
     * - scope 上无生命周期方法
     *
     * @param mode 事务模式
     * @param fn 事务体
     */
    runInTransaction<T>(
        mode: 'readonly' | 'readwrite',
        fn: (scope: ITransactionScope) => Promise<T>,
    ): Promise<T>;
}

// ═══════════════════════════════════════════════════════════════
// 类型守卫
// ═══════════════════════════════════════════════════════════════

export function hasRecordStore(
    backend: IStorageBackend,
): backend is IStorageBackend & { readonly records: IRecordStore } {
    return backend.records != null;
}

export function hasHighLevelStore(
    backend: IStorageBackend,
): backend is IStorageBackend & { readonly highLevel: IHighLevelStore } {
    return backend.highLevel != null;
}

export function hasSyncableStore(
    backend: IStorageBackend,
): backend is IStorageBackend & { readonly syncable: ISyncableStore } {
    return backend.syncable != null;
}
