// @file packages/vfs-sync/src/utils/metadata.ts

import { SYNC_INTERNAL_KEYS } from '../constants';

/**
 * 过滤同步内部元数据字段
 */
export function filterSyncMetadata(
  metadata: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  if (!metadata) return undefined;

  const filtered: Record<string, unknown> = {};
  
  for (const [key, value] of Object.entries(metadata)) {
    if (!SYNC_INTERNAL_KEYS.includes(key as any)) {
      filtered[key] = value;
    }
  }

  return Object.keys(filtered).length > 0 ? filtered : undefined;
}

/**
 * 合并用户元数据与同步控制元数据
 */
export function mergeSyncMetadata(
  userMetadata: Record<string, unknown> | undefined,
  syncMetadata: Record<string, unknown>
): Record<string, unknown> {
  return {
    ...(userMetadata || {}),
    ...syncMetadata
  };
}
