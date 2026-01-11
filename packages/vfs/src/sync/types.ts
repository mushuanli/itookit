// @file packages/vfs/sync/types.ts


export type SyncOperation = 
  | 'create' 
  | 'update' 
  | 'delete' 
  | 'move' 
  | 'copy'
  | 'tag_add'
  | 'tag_remove'
  | 'metadata_update';

export type SyncStatus = 'idle' | 'syncing' | 'paused' | 'error' | 'offline';
export type SyncPhase = 'preparing' | 'uploading' | 'downloading' | 'applying' | 'finalizing';
export type ConflictType = 'content' | 'delete' | 'move' | 'metadata';
export type ConflictResolution = 'local' | 'remote' | 'merged' | 'skipped';
export type LogStatus = 'pending' | 'syncing' | 'synced' | 'failed';

// ==================== 向量时钟 ====================

export interface VectorClock {
  [peerId: string]: number;
}

// ==================== 同步日志 ====================
/**
 * 同步日志 - 记录所有变更
 */
export interface SyncLog {
  logId?: number;                    // 自增主键
  nodeId: string;                    // 节点ID
  moduleId: string;                  // 模块ID
  operation: SyncOperation;          // 操作类型
  timestamp: number;                 // 操作时间戳
  path: string;                      // 当前路径
  previousPath?: string;             // 变更前路径（move操作）
  contentHash?: string;              // 内容SHA256哈希
  size?: number;                     // 文件大小
  metadata?: Record<string, unknown>;
  // 版本控制
  version: number;                   // 递增版本号
  vectorClock?: VectorClock;         // 向量时钟（分布式冲突检测）
  // 扩展字段用于本地状态管理，不需导出
  status?: LogStatus;
  retryCount?: number;
}

// ==================== 同步游标 ====================
/**
 * 同步游标 - 追踪同步进度
 */
export interface SyncCursor {
  peerId: string;                    // 对端标识（设备ID）
  moduleId: string;                  // 模块ID
  lastLogId: number;                 // 最后同步的日志ID
  lastSyncTime: number;              // 最后同步时间
  lastContentHash?: string;          // 最后同步的内容哈希
}

// ==================== 内容传输 ====================

/**
 * 内联内容（可序列化版本）
 */
export interface InlineContent {
  data: string;           // Base64 编码的数据
  encoding: 'base64';
  originalSize: number;
  compressed: boolean;
  compressionAlgorithm?: 'gzip' | 'brotli';
}

/**
 * 文件分片
 */
export interface FileChunk {
  chunkId: string;                   // 分片ID = contentHash + index
  contentHash: string;               // 完整文件哈希
  index: number;                     // 分片索引
  totalChunks: number;               // 总分片数
  data: ArrayBuffer;                 // 分片数据
  size: number;                      // 分片大小
  checksum: string;                  // 分片校验和
}

export interface ChunkReference {
  contentHash: string;
  nodeId: string;
  totalSize: number;
  totalChunks: number;
  missingChunks?: number[];          // 需要传输的分片索引
}

// ==================== 同步变更 ====================

export interface SyncChange {
  logId: number;
  nodeId: string;
  operation: SyncOperation;
  timestamp: number;
  path: string;
  previousPath?: string;
  contentHash?: string;
  size?: number;
  metadata?: Record<string, unknown>;
  version: number;
  
  // 冲突检测信息
  baseVersion?: number;              // 基于哪个版本修改
  vectorClock?: VectorClock;
}

// ==================== 同步包 ====================

export interface SyncPacket {
  packetId: string;
  peerId: string;
  moduleId: string;
  timestamp: number;
  
  // 元数据变更
  changes: SyncChange[];
  
  // 内容数据（使用可序列化的格式）
  inlineContents?: Record<string, InlineContent>;
  
  // 大文件分片引用
  chunkRefs?: ChunkReference[];
  
  // 压缩信息
  compression?: 'none' | 'gzip' | 'brotli';
  
  // 签名（完整性校验）
  signature?: string;
}

export interface SyncPacketResponse {
  success: boolean;
  missingChunks?: string[];
  chunkData?: ArrayBuffer;
  error?: string;
}

// ==================== 冲突 ====================

export interface SyncConflict {
  conflictId: string;
  nodeId: string;
  path: string;
  localChange: SyncChange;
  remoteChange: SyncChange;
  
  // 冲突类型
  type: ConflictType;
  
  // 解决状态
  resolved: boolean;
  resolution?: ConflictResolution;
  timestamp: number;
}

// ==================== 同步状态 ====================

export interface SyncProgress {
  phase: SyncPhase;
  current: number;
  total: number;
  bytesTransferred: number;
  bytesTotal: number;
  // 可选：添加当前处理的文件名或速度
  currentFile?: string;
  speed?: number; // bytes per second
}

export interface SyncStats {
  lastSyncTime?: number;
  totalSynced: number;
  pendingChanges: number;
  conflicts: number;
  errors: number;
}

export interface SyncError {
  code: string;
  message: string;
  retryable: boolean;
}

export interface SyncState {
  status: SyncStatus;
  progress?: SyncProgress;
  stats: SyncStats;
  error?: SyncError;
}

// ==================== 过滤器 ====================

export interface SyncFilter {
  timeRange?: {
    from?: number;
    to?: number;
  };
  paths?: {
    include?: string[];
    exclude?: string[];
  };
  fileTypes?: {
    include?: string[];
    exclude?: string[];
  };
  sizeLimit?: {
    maxFileSize?: number;
    maxTotalSize?: number;
  };
  content?: {
    excludeBinary?: boolean;
    excludeAssets?: boolean;
  };
  tags?: {
    include?: string[];
    exclude?: string[];
  };
}

// ==================== 配置 ====================

/**
 * 同步配置
 */
export interface SyncConfig {
  // 基础配置
  moduleId: string;
  peerId: string;
  serverUrl: string;
  
  // 认证
  auth: {
    type: 'jwt' | 'apikey';
    token?: string;
    refreshToken?: string;
    apiKey?: string;
  };
  
  // 传输配置
  transport: 'http' | 'websocket' | 'auto';
  
  // 分片配置
  chunking: {
    enabled: boolean;
    chunkSize: number;               // 默认 1MB
    threshold: number;               // 超过此大小启用分片，默认 5MB
  };
  
  // 压缩配置
  compression: {
    enabled: boolean;
    algorithm: 'gzip' | 'brotli';
    minSize: number;                 // 最小压缩大小，默认 1KB
  };
  
  // 同步策略
  strategy: {
    // 同步方向
    direction: 'push' | 'pull' | 'bidirectional';
    
    // 冲突解决策略
    conflictResolution: 'server-wins' | 'client-wins' | 'newer-wins' | 'manual';
    
    // 同步范围限制
    filters?: SyncFilter;
    
    // 批量大小
    batchSize: number;               // 每批次最大变更数
    maxPacketSize: number;           // 最大包大小 (bytes)
    
    // 重试策略
    maxRetries: number;
    retryDelay: number;              // 基础重试延迟 (ms)
    retryBackoff: 'linear' | 'exponential';
  };
  
  // 实时同步（WebSocket）
  realtime?: {
    enabled: boolean;
    heartbeatInterval: number;       // 心跳间隔 (ms)
    reconnectDelay: number;          // 重连延迟 (ms)
    maxReconnectAttempts: number;
  };
}

// ==================== 同步事件类型 ====================

export enum SyncEventType {
  STATE_CHANGED = 'sync:state_changed',
  CONFLICT = 'sync:conflict',
  ERROR = 'sync:error',
  CONNECTED = 'sync:connected',
  DISCONNECTED = 'sync:disconnected'
}
