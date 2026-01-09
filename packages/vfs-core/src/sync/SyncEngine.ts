// @file vfs/sync/SyncEngine.ts

import { 
  ISyncAdapter, 
  SyncConfig, 
  SyncScope, 
  SyncState, 
  SyncResult,
  ChangeRecord,
  ConflictRecord,
  ConflictStrategy,
  SyncDirection,
  RemoteConfig,
  SyncEventType
} from './interfaces/ISyncAdapter';
import { IStorageAdapter } from '../storage/interfaces/IStorageAdapter';

/**
 * 变更日志表 Schema
 */
export const SYNC_SCHEMA = {
  name: '_sync_changelog',
  keyPath: 'id',
  indexes: [
    { name: 'collection', keyPath: 'collection' },
    { name: 'timestamp', keyPath: 'timestamp' },
    { name: 'synced', keyPath: 'synced' }
  ]
};

/**
 * 同步状态表 Schema
 */
export const SYNC_STATE_SCHEMA = {
  name: '_sync_state',
  keyPath: 'id',
  indexes: []
};

/**
 * 同步引擎
 * 负责本地变更追踪和与远程同步
 */
export class SyncEngine {
  private localAdapter: IStorageAdapter;
  private remoteAdapter: ISyncAdapter | null = null;
  private config: SyncConfig | null = null;
  private vectorClock: Record<string, number> = {};
  private deviceId: string;
  private listeners = new Map<string, Set<(data: unknown) => void>>();

  private _state: SyncState = {
    lastSyncAt: null,
    status: 'idle',
    pendingChanges: 0,
    conflicts: 0
  };

  constructor(localAdapter: IStorageAdapter) {
    this.localAdapter = localAdapter;
    this.deviceId = this.generateDeviceId();
  }

  get state(): SyncState {
    return { ...this._state };
  }

  // ==================== 连接管理 ====================

  /**
   * 连接到远程同步服务
   */
  async connect(remoteAdapter: ISyncAdapter, remoteConfig: RemoteConfig): Promise<void> {
    this.remoteAdapter = remoteAdapter;
    await this.remoteAdapter.connect(remoteConfig);
    
    // 加载本地同步状态
    await this.loadSyncState();
    
    this.emit('sync:connected', { deviceId: this.deviceId });
  }

  /**
   * 断开远程连接
   */
  async disconnect(): Promise<void> {
    if (this.remoteAdapter) {
      await this.remoteAdapter.disconnect();
      this.remoteAdapter = null;
      this.emit('sync:disconnected', { deviceId: this.deviceId });
    }
  }

  // ==================== 配置 ====================

  configure(config: SyncConfig): void {
    this.config = config;
  }

  // ==================== 变更追踪 ====================

  /**
   * 记录本地变更
   * 应在每次数据修改后调用
   */
  async trackChange(
    collection: string,
    key: unknown,
    operation: 'create' | 'update' | 'delete',
    data?: unknown
  ): Promise<void> {
    // 检查是否在同步范围内
    if (this.config && !this.isInScope(collection, key)) {
      return;
    }

    // 更新向量时钟
    this.vectorClock[this.deviceId] = (this.vectorClock[this.deviceId] || 0) + 1;

    const change: ChangeRecord & { synced: boolean } = {
      id: this.generateId(),
      collection,
      key,
      operation,
      timestamp: Date.now(),
      data,
      vectorClock: { ...this.vectorClock },
      synced: false
    };

    // 存储变更记录
    const changelog = this.localAdapter.getCollection<ChangeRecord & { synced: boolean }>(SYNC_SCHEMA.name);
    await changelog.put(change);

    this._state.pendingChanges++;
    this.emit('change:tracked', change);
  }

  /**
   * 获取待同步变更
   */
  async getPendingChanges(scope?: SyncScope): Promise<ChangeRecord[]> {
    const changelog = this.localAdapter.getCollection<ChangeRecord & { synced: boolean }>(SYNC_SCHEMA.name);
    
    return changelog.query({
      filter: (item: unknown) => {
        const change = item as ChangeRecord & { synced: boolean };
        if (change.synced) return false;
        if (scope && !this.matchesScope(change.collection, change.key, scope)) return false;
        return true;
      }
    });
  }

  // ==================== 同步操作 ====================

  /**
   * 执行完整同步
   */
  async sync(config?: SyncConfig): Promise<SyncResult> {
    const syncConfig = config ?? this.config;
    if (!syncConfig) throw new Error('Sync not configured');
    if (!this.remoteAdapter) throw new Error('Remote not connected');

    this._state.status = 'syncing';
    this.emit('sync:start', { config: syncConfig });

    const startTime = Date.now();
    const result: SyncResult = {
      success: true,
      pushed: 0,
      pulled: 0,
      conflicts: 0,
      errors: [],
      duration: 0
    };

    try {
      switch (syncConfig.direction) {
        case SyncDirection.PUSH:
          result.pushed = await this.pushChanges(syncConfig.scope);
          break;
        
        case SyncDirection.PULL:
          result.pulled = await this.pullChanges(syncConfig.scope);
          break;
        
        case SyncDirection.BIDIRECTIONAL:
          // 先拉后推，减少冲突
          result.pulled = await this.pullChanges(syncConfig.scope);
          result.pushed = await this.pushChanges(syncConfig.scope);
          break;
      }

      // 处理冲突
      if (syncConfig.conflictResolution !== ConflictStrategy.MANUAL) {
        await this.autoResolveConflicts(syncConfig.conflictResolution);
      }

      result.conflicts = this._state.conflicts;
      this._state.lastSyncAt = Date.now();
      this._state.status = 'idle';
      
      await this.saveSyncState();

    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      result.success = false;
      result.errors.push({
        collection: '',
        key: null,
        operation: 'sync',
        message: errorMessage
      });
      this._state.status = 'error';
      this._state.error = errorMessage;
    }

    result.duration = Date.now() - startTime;
    this.emit('sync:complete', result);
    
    return result;
  }

  /**
   * 推送本地变更到远程
   */
  async push(scope?: SyncScope): Promise<SyncResult> {
    return this.sync({
      direction: SyncDirection.PUSH,
      scope: scope ?? this.config?.scope ?? {},
      conflictResolution: this.config?.conflictResolution ?? ConflictStrategy.LOCAL_WINS
    });
  }

  /**
   * 从远程拉取变更
   */
  async pull(scope?: SyncScope): Promise<SyncResult> {
    return this.sync({
      direction: SyncDirection.PULL,
      scope: scope ?? this.config?.scope ?? {},
      conflictResolution: this.config?.conflictResolution ?? ConflictStrategy.REMOTE_WINS
    });
  }

  // ==================== 冲突管理 ====================

  /**
   * 获取冲突列表
   */
  async getConflicts(): Promise<ConflictRecord[]> {
    const conflictStore = this.localAdapter.getCollection<ConflictRecord>('_sync_conflicts');
    return conflictStore.query({
      filter: (c: unknown) => !(c as ConflictRecord).resolvedAt
    });
  }

  /**
   * 手动解决冲突
   */
  async resolveConflict(
    conflictId: string, 
    resolution: 'local' | 'remote' | { merged: unknown }
  ): Promise<void> {
    const conflictStore = this.localAdapter.getCollection<ConflictRecord>('_sync_conflicts');
    const conflict = await conflictStore.get(conflictId);
    
    if (!conflict) throw new Error(`Conflict not found: ${conflictId}`);

    const tx = this.localAdapter.beginTransaction(
      [conflict.collection, '_sync_conflicts', SYNC_SCHEMA.name],
      'readwrite'
    );

    try {
      const dataCollection = tx.getCollection(conflict.collection);

      if (resolution === 'local') {
        // 使用本地版本，推送到远程
        await this.trackChange(
          conflict.collection,
          conflict.key,
          'update',
          conflict.localVersion.data
        );
      } else if (resolution === 'remote') {
        // 使用远程版本
        await dataCollection.put(conflict.remoteVersion.data);
      } else {
        // 使用合并后的数据
        await dataCollection.put(resolution.merged);
        await this.trackChange(
          conflict.collection,
          conflict.key,
          'update',
          resolution.merged
        );
      }

      // 标记冲突已解决
      conflict.resolvedAt = Date.now();
      conflict.resolution = resolution === 'local' ? 'local' : 
                           resolution === 'remote' ? 'remote' : 'merged';
      
      const conflictColl = tx.getCollection<ConflictRecord>('_sync_conflicts');
      await conflictColl.put(conflict);

      await tx.commit();
      this._state.conflicts--;
      
      this.emit('conflict:resolved', { conflictId, resolution: conflict.resolution });

    } catch (e) {
      await tx.abort();
      throw e;
    }
  }

  // ==================== 事件系统 ====================

  on(event: SyncEventType | string, handler: (data: unknown) => void): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(handler);
    return () => this.listeners.get(event)?.delete(handler);
  }

  private emit(event: string, data: unknown): void {
    this.listeners.get(event)?.forEach(h => {
      try { h(data); } catch (e) { console.error(e); }
    });
  }

  // ==================== 私有方法 ====================

  private async pushChanges(scope: SyncScope): Promise<number> {
    if (!this.remoteAdapter) return 0;

    const changes = await this.getPendingChanges(scope);
    let pushed = 0;

    for (const change of changes) {
      try {
        await this.remoteAdapter.trackChange(change);
        
        // 标记为已同步
        const changelog = this.localAdapter.getCollection<ChangeRecord & { synced: boolean }>(SYNC_SCHEMA.name);
        await changelog.put({ ...change, synced: true });
        
        pushed++;
        this._state.pendingChanges--;
        
        this.emit('sync:progress', { 
          type: 'push',
          current: pushed, 
          total: changes.length 
        });
        
      } catch (error: unknown) {
        const err = error as { code?: string; remoteVersion?: ChangeRecord };
        if (err.code === 'CONFLICT') {
          await this.recordConflict(change, err.remoteVersion!);
        } else {
          throw error;
        }
      }
    }

    return pushed;
  }

  private async pullChanges(scope: SyncScope): Promise<number> {
    if (!this.remoteAdapter) return 0;

    const remoteChanges = await this.remoteAdapter.getPendingChanges(scope);
    let pulled = 0;

    for (const change of remoteChanges) {
      // 过滤时间范围
      if (this.config?.timeRange) {
        const { since, until } = this.config.timeRange;
        if (since && change.timestamp < since.getTime()) continue;
        if (until && change.timestamp > until.getTime()) continue;
      }

      try {
        await this.applyRemoteChange(change);
        pulled++;
        
        this.emit('sync:progress', { 
          type: 'pull',
          current: pulled, 
          total: remoteChanges.length 
        });
        
      } catch (error: unknown) {
        const err = error as { code?: string; localVersion?: ChangeRecord };
        if (err.code === 'CONFLICT') {
          await this.recordConflict(err.localVersion!, change);
        } else {
          throw error;
        }
      }
    }

    // 合并向量时钟
    for (const change of remoteChanges) {
      for (const [device, clock] of Object.entries(change.vectorClock)) {
        this.vectorClock[device] = Math.max(
          this.vectorClock[device] || 0,
          clock
        );
      }
    }

    return pulled;
  }

  private async applyRemoteChange(change: ChangeRecord): Promise<void> {
    const collection = this.localAdapter.getCollection(change.collection);

    // 检查本地是否有冲突的变更
    const localData = await collection.get(change.key);
    
    if (localData && this.hasConflict(change)) {
      const error: Error & { code?: string; localVersion?: ChangeRecord } = new Error('Conflict detected');
      error.code = 'CONFLICT';
      error.localVersion = {
        id: this.generateId(),
        collection: change.collection,
        key: change.key,
        operation: 'update',
        timestamp: Date.now(),
        data: localData,
        vectorClock: { ...this.vectorClock }
      };
      throw error;
    }

    // 应用变更
    switch (change.operation) {
      case 'create':
      case 'update':
        await collection.put(change.data);
        break;
      case 'delete':
        await collection.delete(change.key);
        break;
    }
  }

  private hasConflict(remoteChange: ChangeRecord): boolean {
    // 使用向量时钟检测并发修改
    for (const [device, remoteClock] of Object.entries(remoteChange.vectorClock)) {
      const localClock = this.vectorClock[device] || 0;
      
      // 如果本地有该设备更新的时钟，说明本地也有修改
      if (device !== this.deviceId && remoteClock < localClock) {
        return true;
      }
    }
    return false;
  }

  private async recordConflict(
    localChange: ChangeRecord, 
    remoteChange: ChangeRecord
  ): Promise<void> {
    const conflict: ConflictRecord = {
      id: this.generateId(),
      collection: localChange.collection,
      key: localChange.key,
      localVersion: localChange,
      remoteVersion: remoteChange
    };

    const conflictStore = this.localAdapter.getCollection<ConflictRecord>('_sync_conflicts');
    await conflictStore.put(conflict);
    
    this._state.conflicts++;
    this.emit('conflict:detected', conflict);
  }

  private async autoResolveConflicts(strategy: ConflictStrategy): Promise<void> {
    const conflicts = await this.getConflicts();

    for (const conflict of conflicts) {
      let resolution: 'local' | 'remote';

      switch (strategy) {
        case ConflictStrategy.LOCAL_WINS:
          resolution = 'local';
          break;
        
        case ConflictStrategy.REMOTE_WINS:
          resolution = 'remote';
          break;
        
        case ConflictStrategy.LATEST_WINS:
          resolution = conflict.localVersion.timestamp > conflict.remoteVersion.timestamp
            ? 'local'
            : 'remote';
          break;
        
        default:
          continue; // MANUAL - 跳过
      }

      await this.resolveConflict(conflict.id, resolution);
    }
  }

  private isInScope(collection: string, key: unknown): boolean {
    if (!this.config?.scope) return true;
    return this.matchesScope(collection, key, this.config.scope);
  }

  private matchesScope(collection: string, _key: unknown, scope: SyncScope): boolean {
    // 集合过滤
    if (scope.collections?.length && !scope.collections.includes(collection)) {
      return false;
    }
    if (scope.excludeCollections?.includes(collection)) {
      return false;
    }

    // TODO: 对于 VNode，可以进一步检查模块和路径
    // 这需要根据实际数据结构来实现

    return true;
  }

  private async loadSyncState(): Promise<void> {
    try {
      const stateStore = this.localAdapter.getCollection<{
        id: string;
        lastSyncAt: number | null;
        vectorClock: Record<string, number>;
        deviceId: string;
      }>(SYNC_STATE_SCHEMA.name);
      
      const state = await stateStore.get('main');
      
      if (state) {
        this._state.lastSyncAt = state.lastSyncAt;
        this.vectorClock = state.vectorClock || {};
      }
    } catch (e) {
      // 首次使用，忽略
      console.debug('No existing sync state found');
    }
  }

  private async saveSyncState(): Promise<void> {
    const stateStore = this.localAdapter.getCollection<{
      id: string;
      lastSyncAt: number | null;
      vectorClock: Record<string, number>;
      deviceId: string;
    }>(SYNC_STATE_SCHEMA.name);
    
    await stateStore.put({
      id: 'main',
      lastSyncAt: this._state.lastSyncAt,
      vectorClock: this.vectorClock,
      deviceId: this.deviceId
    });
  }

  private generateId(): string {
    return `${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }

  private generateDeviceId(): string {
    // 尝试从 localStorage 读取，确保设备 ID 持久化
    if (typeof localStorage !== 'undefined') {
      let id = localStorage.getItem('_vfs_device_id');
      if (!id) {
        id = `device_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
        localStorage.setItem('_vfs_device_id', id);
      }
      return id;
    }
    return `device_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }
}
