// @file packages/vfs-sync/src/constants.ts

export const SYNC_TABLES = {
  LOGS: 'sync_logs',
  CURSORS: 'sync_cursors',
  CONFLICTS: 'sync_conflicts',
  CHUNKS: 'sync_chunks'
};

export const SYNC_CONSTANTS = {
  // 忽略自身产生的事件标记
  ORIGIN_TAG: 'vfs-sync-agent',
  // 默认分片阈值 (5MB)
  DEFAULT_CHUNK_THRESHOLD: 5 * 1024 * 1024,
  // 默认分片大小 (1MB)
  DEFAULT_CHUNK_SIZE: 1 * 1024 * 1024,
  // 默认防抖时间 (ms)
  DEFAULT_DEBOUNCE: 1000,
  // 默认批次大小
  DEFAULT_BATCH_SIZE: 50
};
