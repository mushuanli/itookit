// @file packages/vfs/sync/types.ts

/**
 * [新增] 同步进度详情
 */
export interface SyncProgress {
  phase: 'preparing' | 'uploading' | 'downloading' | 'applying' | 'finalizing';
  current: number;
  total: number;
  bytesTransferred: number;
  bytesTotal: number;
  // 可选：添加当前处理的文件名或速度
  currentFile?: string;
  speed?: number; // bytes per second
}

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
  isChunked?: boolean;               // 是否分片
  chunkCount?: number;               // 分片数量
  metadata?: Record<string, unknown>;
  // 版本控制
  version: number;                   // 递增版本号
  vectorClock?: VectorClock;         // 向量时钟（分布式冲突检测）
  // 扩展字段用于本地状态管理，不需导出
  status?: 'pending' | 'syncing' | 'synced' | 'failed';
  retryCount?: number;
}

export type SyncOperation = 
  | 'create' 
  | 'update' 
  | 'delete' 
  | 'move' 
  | 'copy'
  | 'tag_add'
  | 'tag_remove'
  | 'metadata_update';

/**
 * 向量时钟 - 用于分布式冲突检测
 */
export interface VectorClock {
  [peerId: string]: number;
}

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

/**
 * 同步包 - 批量传输单元
 */
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

export interface ChunkReference {
  contentHash: string;
  nodeId: string;
  totalSize: number;
  totalChunks: number;
  missingChunks?: number[];          // 需要传输的分片索引
}

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

/**
 * 同步过滤器 - 限制同步范围
 */
export interface SyncFilter {
  // 时间范围
  timeRange?: {
    from?: number;                   // 开始时间戳
    to?: number;                     // 结束时间戳
  };
  
  // 路径过滤
  paths?: {
    include?: string[];              // 包含的路径模式
    exclude?: string[];              // 排除的路径模式
  };
  
  // 文件类型过滤
  fileTypes?: {
    include?: string[];              // 包含的扩展名
    exclude?: string[];              // 排除的扩展名
  };
  
  // 大小限制
  sizeLimit?: {
    maxFileSize?: number;            // 单文件最大大小
    maxTotalSize?: number;           // 总大小限制
  };
  
  // 内容过滤
  content?: {
    excludeBinary?: boolean;         // 排除二进制文件
    excludeAssets?: boolean;         // 排除资产目录
  };
  
  // 标签过滤
  tags?: {
    include?: string[];
    exclude?: string[];
  };
}

/**
 * 冲突信息
 */
export interface SyncConflict {
  conflictId: string;
  nodeId: string;
  path: string;
  
  localChange: SyncChange;
  remoteChange: SyncChange;
  
  // 冲突类型
  type: 'content' | 'delete' | 'move' | 'metadata';
  
  // 解决状态
  resolved: boolean;
  resolution?: 'local' | 'remote' | 'merged' | 'skipped';
  
  timestamp: number;
}

/**
 * 同步状态
 */
export interface SyncState {
  status: 'idle' | 'syncing' | 'paused' | 'error' | 'offline';
  
  // 进度信息
  progress?: {
    phase: 'preparing' | 'uploading' | 'downloading' | 'applying' | 'finalizing';
    current: number;
    total: number;
    bytesTransferred: number;
    bytesTotal: number;
  };
  
  // 统计信息
  stats: {
    lastSyncTime?: number;
    totalSynced: number;
    pendingChanges: number;
    conflicts: number;
    errors: number;
  };
  
  // 错误信息
  error?: {
    code: string;
    message: string;
    retryable: boolean;
  };
}
