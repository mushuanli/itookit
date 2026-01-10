// @file: app-settings/types/sync.ts

/**
 * 同步模式
 */
export type SyncMode = 
  | 'standard'      // 常规双向同步
  | 'force_push'    // 强制上传（覆盖服务器）
  | 'force_pull';   // 强制下载（覆盖本地）

/**
 * 同步方向策略
 */
export type SyncStrategy = 
  | 'manual'        // 手动触发
  | 'bidirectional' // 双向智能合并
  | 'push'          // 仅上传
  | 'pull';         // 仅下载

/**
 * 同步状态
 */
export type SyncStateType = 
  | 'idle'          // 空闲
  | 'connecting'    // 连接中
  | 'syncing'       // 同步中
  | 'success'       // 成功
  | 'error'         // 错误
  | 'offline'       // 离线
  | 'paused';       // 暂停

/**
 * 同步配置
 */
export interface SyncConfig {
  // 服务器配置
  serverUrl: string;
  username: string;
  token: string;
  
  // 同步策略
  strategy: SyncStrategy;
  autoSync: boolean;
  autoSyncInterval?: number;  // 自动同步间隔（分钟）
  
  // 传输配置
  transport?: 'http' | 'websocket' | 'auto';
  
  // 分片配置
  chunking?: {
    enabled: boolean;
    chunkSize: number;      // 分片大小（bytes）
    threshold: number;      // 启用分片的阈值
  };
  
  // 压缩配置
  compression?: {
    enabled: boolean;
    algorithm: 'gzip' | 'brotli';
    minSize: number;
  };
  
  // 过滤器
  filters?: {
    includePaths?: string[];
    excludePaths?: string[];
    maxFileSize?: number;
    excludeBinary?: boolean;
  };
  
  // 冲突解决策略
  conflictResolution?: 'server-wins' | 'client-wins' | 'newer-wins' | 'manual';
  
  // 同步的模块列表
  modules?: string[];
}

/**
 * 同步状态信息
 */
export interface SyncStatus {
  state: SyncStateType;
  lastSyncTime: number | null;
  errorMessage?: string;
  
  // 进度信息
  progress?: {
    phase: 'preparing' | 'uploading' | 'downloading' | 'applying' | 'finalizing';
    current: number;
    total: number;
    currentFile?: string;
    bytesTransferred?: number;
    bytesTotal?: number;
    speed?: number;  // bytes per second
  };
  
  // 统计信息
  stats?: {
    totalSynced: number;
    pendingChanges: number;
    conflicts: number;
    errors: number;
    uploadedFiles: number;
    downloadedFiles: number;
  };
  
  // 连接信息
  connection?: {
    type: 'http' | 'websocket';
    latency?: number;
    connected: boolean;
  };
}

/**
 * 同步冲突
 */
export interface SyncConflict {
  id: string;
  path: string;
  type: 'content' | 'delete' | 'move' | 'metadata';
  localModified: number;
  remoteModified: number;
  resolved: boolean;
  resolution?: 'local' | 'remote' | 'merged';
}

/**
 * 同步日志条目
 */
export interface SyncLogEntry {
  timestamp: number;
  level: 'info' | 'warn' | 'error' | 'success';
  message: string;
  details?: any;
}

/**
 * 同步队列项
 */
export interface SyncQueueItem {
  id: string;
  path: string;
  operation: 'upload' | 'download' | 'delete';
  size?: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress?: number;
  error?: string;
}

/**
 * 本地快照
 */
export interface LocalSnapshot {
  name: string;
  displayName: string;
  createdAt: number;
  size: number;
  description?: string;
  modules?: string[];
}
