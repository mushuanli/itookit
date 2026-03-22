/**
 * @file common/interfaces/fs/storage/syncable-backend.ts
 * @desc 可选增强：同步支持
 *
 * 后端实现此接口表示它能高效地提供变更日志。
 * 未实现时，ISyncService 通过监听 VFS 事件构建变更日志。
 */

import type { ChangeLogEntry } from '../sync/sync';

export interface ISyncableStore {
    /** 获取自某个序列号以来的变更 */
    getChangesSince(seq: number, limit?: number): Promise<ChangeLogEntry[]>;

    /** 获取当前最新序列号 */
    getLatestSeq(): Promise<number>;

    /** 应用来自远程的变更（批量原子写入） */
    applyChanges(changes: ChangeLogEntry[]): Promise<void>;
}
