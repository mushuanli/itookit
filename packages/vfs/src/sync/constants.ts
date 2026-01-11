// @file packages/vfs-sync/src/constants.ts

export const SYNC_TABLES = {
  LOGS: 'sync_logs',
  CURSORS: 'sync_cursors',
  CONFLICTS: 'sync_conflicts',
  CHUNKS: 'sync_chunks'
} as const;

export const SYNC_CONSTANTS = {
  // 忽略自身产生的事件标记
  ORIGIN_TAG: 'vfs-sync-agent',
  DEFAULT_CHUNK_THRESHOLD: 5 * 1024 * 1024,  // 5MB
  DEFAULT_CHUNK_SIZE: 1 * 1024 * 1024,       // 1MB
  DEFAULT_DEBOUNCE: 1000,                     // 1s
  DEFAULT_BATCH_SIZE: 50,
  DEFAULT_REQUEST_TIMEOUT: 30000,             // 30s
  DEFAULT_MAX_RETRIES: 3,
  MIN_COMPRESSION_SIZE: 1024                  // 1KB
} as const;

// 内部元数据字段（同步控制用，不传输）
export const SYNC_INTERNAL_KEYS = [
  '_sync_v',
  '_sync_vc',
  '_sync_time',
  '_sync_origin',
  '_sync_auto_created',
  '_sync_pending',
  '_local_only'
] as const;

export const SYNC_MODULE_NAME = '__sync';
