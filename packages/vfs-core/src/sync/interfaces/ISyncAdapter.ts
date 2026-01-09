// @file vfs/sync/interfaces/ISyncAdapter.ts

/**
 * 同步方向
 */
export enum SyncDirection {
  /** 本地 → 远程 */
  PUSH = 'push',
  /** 远程 → 本地 */
  PULL = 'pull',
  /** 双向同步 */
  BIDIRECTIONAL = 'bidirectional'
}


/**
 * 冲突解决策略
 */
export enum ConflictStrategy {
  /** 本地优先 */
  LOCAL_WINS = 'local_wins',
  /** 远程优先 */
  REMOTE_WINS = 'remote_wins',
  /** 最新修改优先 */
  LATEST_WINS = 'latest_wins',
  /** 手动解决 */
  MANUAL = 'manual'
}

/**
 * 同步配置
 */
export interface SyncConfig {
  /** 同步方向 */
  direction: SyncDirection;
  
  /** 同步范围 - 模块/目录过滤 */
  scope: SyncScope;
  
  /** 时间范围限制 */
  timeRange?: {
    since?: Date;
    until?: Date;
  };
  
  /** 冲突解决策略 */
  conflictResolution: ConflictStrategy;
  
  /** 同步间隔（自动同步时使用，毫秒） */
  interval?: number;
}

/**
 * 同步范围
 */
export interface SyncScope {
  /** 包含的模块（空数组表示全部） */
  modules?: string[];
  
  /** 排除的模块 */
  excludeModules?: string[];
  
  /** 包含的路径前缀 */
  includePaths?: string[];
  
  /** 排除的路径前缀 */
  excludePaths?: string[];
  
  /** 同步的集合（表级别控制） */
  collections?: string[];
  
  /** 排除的集合 */
  excludeCollections?: string[];
}

/**
 * 同步状态
 */
export interface SyncState {
  /** 最后同步时间 */
  lastSyncAt: number | null;
  
  /** 当前状态 */
  status: 'idle' | 'syncing' | 'error' | 'paused';
  
  /** 待同步变更数 */
  pendingChanges: number;
  
  /** 冲突数 */
  conflicts: number;
  
  /** 错误信息 */
  error?: string;
}

/**
 * 变更记录
 */
export interface ChangeRecord {
  /** 变更 ID */
  id: string;
  
  /** 集合名称 */
  collection: string;
  
  /** 记录主键 */
  key: unknown;
  
  /** 操作类型 */
  operation: 'create' | 'update' | 'delete';
  
  /** 变更时间戳 */
  timestamp: number;
  
  /** 变更数据 */
  data?: unknown;
  
  /** 向量时钟（用于冲突检测） */
  vectorClock: Record<string, number>;
}

/**
 * 冲突记录
 */
export interface ConflictRecord {
  /** 冲突 ID */
  id: string;
  
  /** 集合名称 */
  collection: string;
  
  /** 记录主键 */
  key: unknown;
  
  /** 本地版本 */
  localVersion: ChangeRecord;
  
  /** 远程版本 */
  remoteVersion: ChangeRecord;
  
  /** 解决时间 */
  resolvedAt?: number;
  
  /** 解决方式 */
  resolution?: 'local' | 'remote' | 'merged';
}

/**
 * 远程配置
 */
export interface RemoteConfig {
  /** 连接类型 */
  type: 'http' | 'websocket' | 'webrtc';
  
  /** 服务端点 */
  endpoint: string;
  
  /** 认证配置 */
  auth?: {
    type: 'bearer' | 'basic' | 'custom';
    token?: string;
    credentials?: { username: string; password: string };
  };
  
  /** 额外选项 */
  options?: Record<string, unknown>;
}

/**
 * 同步结果
 */
export interface SyncResult {
  /** 是否成功 */
  success: boolean;
  
  /** 推送数量 */
  pushed: number;
  
  /** 拉取数量 */
  pulled: number;
  
  /** 冲突数量 */
  conflicts: number;
  
  /** 错误列表 */
  errors: SyncError[];
  
  /** 耗时（毫秒） */
  duration: number;
}

/**
 * 同步错误
 */
export interface SyncError {
  collection: string;
  key: unknown;
  operation: string;
  message: string;
}

/**
 * 同步事件类型
 */
export type SyncEventType = 
  | 'sync:start'
  | 'sync:progress'
  | 'sync:complete'
  | 'sync:error'
  | 'sync:connected'
  | 'sync:disconnected'
  | 'conflict:detected'
  | 'conflict:resolved';

/**
 * 同步适配器接口
 */
export interface ISyncAdapter {
  /** 适配器名称 */
  readonly name: string;
  
  /** 当前状态 */
  readonly state: SyncState;

  // ==================== 生命周期 ====================
  
  /**
   * 连接到远程
   */
  connect(config: RemoteConfig): Promise<void>;
  
  /**
   * 断开连接
   */
  disconnect(): Promise<void>;

  // ==================== 同步操作 ====================
  
  /**
   * 执行同步
   */
  sync(config: SyncConfig): Promise<SyncResult>;
  
  /**
   * 推送本地变更
   */
  push(scope?: SyncScope): Promise<SyncResult>;
  
  /**
   * 拉取远程变更
   */
  pull(scope?: SyncScope): Promise<SyncResult>;

  // ==================== 变更追踪 ====================
  
  /**
   * 获取待同步变更
   */
  getPendingChanges(scope?: SyncScope): Promise<ChangeRecord[]>;
  
  /**
   * 记录本地变更
   */
  trackChange(change: Omit<ChangeRecord, 'id' | 'vectorClock'>): Promise<void>;
  
  // ==================== 冲突管理 ====================
  
  /**
   * 获取冲突列表
   */
  getConflicts(): Promise<ConflictRecord[]>;
  
  /**
   * 解决冲突
   */
  resolveConflict(
    conflictId: string, 
    resolution: 'local' | 'remote' | ConflictRecord
  ): Promise<void>;

  // ==================== 事件 ====================
  
  /**
   * 监听同步事件
   */
  on(event: SyncEventType, handler: (data: unknown) => void): () => void;
}
