/**
 * @file common/interfaces/fs/sync/sync.ts
 * @desc 同步系统
 *
 * Sync 是建立在 VFS 之上的独立模块，不是 VFS 内核的一部分。
 * 它监听 VFS 事件 → 记录变更日志 → 异步同步到目标。
 *
 * 同步模型：
 * - 每个 syncable 挂载点可以有"同步目标"
 * - 变更通过 ChangeLog 跟踪
 * - 冲突通过 ConflictResolver 解决
 */

export interface ChangeLogEntry {
    readonly seq: number;
    readonly timestamp: number;
    readonly mountId: string;
    readonly moduleId: string;
    readonly path: string;
    readonly operation: 'create' | 'modify' | 'delete' | 'rename';
    readonly version: number;
    readonly contentHash?: string;
    readonly oldPath?: string;
    synced: boolean;
}

export interface SyncState {
    lastSyncedSeq: number;
    lastSyncedAt: number;
    status: 'idle' | 'syncing' | 'error' | 'paused';
    pendingCount: number;
    lastError?: string;
}

export interface SyncConflict {
    readonly conflictId: string;
    readonly path: string;
    readonly moduleId: string;
    readonly local: { version: number; modifiedAt: number; contentHash?: string };
    readonly remote: { version: number; modifiedAt: number; contentHash?: string };
    readonly detectedAt: number;
    resolved: boolean;
}

export type ConflictResolution = 'local' | 'remote' | 'merge' | 'skip';

export interface ConflictResolver {
    resolve(conflict: SyncConflict): Promise<ConflictResolution>;
}

export interface SyncTarget {
    readonly id: string;
    readonly sourceMountId: string;
    readonly targetMountId: string;
    readonly direction: 'push' | 'pull' | 'bidirectional';
    readonly pathFilter?: string[];
    readonly conflictResolver?: ConflictResolver;
    readonly enabled: boolean;
}

export interface SyncResult {
    targetId: string;
    startedAt: number;
    completedAt: number;
    pushed: number;
    pulled: number;
    conflicts: number;
    errors: string[];
}

export interface ISyncService {
    // ── 生命周期 ──

    /** 启动同步服务（开始监听事件） */
    start(): Promise<void>;

    /** 停止同步服务 */
    stop(): Promise<void>;

    // ── 同步目标管理 ──

    addTarget(target: Omit<SyncTarget, 'id'>): Promise<SyncTarget>;
    removeTarget(targetId: string): Promise<void>;
    listTargets(): SyncTarget[];
    enableTarget(targetId: string): Promise<void>;
    disableTarget(targetId: string): Promise<void>;

    // ── 同步操作 ──

    /** 手动触发全量同步 */
    syncAll(): Promise<SyncResult[]>;

    /** 同步特定目标 */
    syncTarget(targetId: string): Promise<SyncResult>;

    /** 获取同步状态 */
    getState(targetId: string): SyncState;

    // ── 变更日志 ──

    getPendingChanges(targetId: string, limit?: number): Promise<ChangeLogEntry[]>;

    getChangeLog(options?: {
        mountId?: string;
        moduleId?: string;
        since?: number;
        limit?: number;
    }): Promise<ChangeLogEntry[]>;

    // ── 冲突管理 ──

    getConflicts(): Promise<SyncConflict[]>;
    resolveConflict(conflictId: string, resolution: ConflictResolution): Promise<void>;

    // ── 事件 ──

    onSyncComplete(handler: (targetId: string, result: SyncResult) => void): () => void;
    onConflict(handler: (conflict: SyncConflict) => void): () => void;
    onError(handler: (error: Error, context: { targetId: string; path?: string }) => void): () => void;
}
