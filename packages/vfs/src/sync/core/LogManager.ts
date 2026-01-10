// @file packages/vfs-sync/src/core/LogManager.ts

import { IPluginContext } from '../../core';
import { SyncLog, SyncOperation } from '../types';
import { SYNC_TABLES } from '../constants';

export class LogManager {
  constructor(
    private context: IPluginContext,
    private moduleId: string
  ) {}

  /**
   * 记录变更（包含 Coalescing 逻辑）
   */
  async recordChange(input: Partial<SyncLog>): Promise<void> {
    const store = this.context.kernel.storage;
    const tx = store.beginTransaction([SYNC_TABLES.LOGS], 'readwrite');
    const logs = tx.getCollection<SyncLog>(SYNC_TABLES.LOGS);

    try {
      // 1. 查找针对该 NodeID 的 Pending 记录
      const pendingOps = await logs.getAllByIndex('nodeId', input.nodeId!);
      const existing = pendingOps.find(op => op.status === 'pending');

      if (existing && existing.logId !== undefined) {
        // 策略: Create + Delete = 移除记录
        if (existing.operation === 'create' && input.operation === 'delete') {
          await logs.delete(existing.logId);
          await tx.commit();
          return;
        }

        // 策略: Update + Update = 更新时间戳
        if (existing.operation === 'update' && input.operation === 'update') {
          existing.timestamp = input.timestamp!;
          await logs.put(existing);
          await tx.commit();
          return;
        }

        // 策略: Create + Update = Create (更新时间戳)
        if (existing.operation === 'create' && input.operation === 'update') {
          existing.timestamp = input.timestamp!;
          await logs.put(existing);
          await tx.commit();
          return;
        }

        // === 策略 4: Delete + Create ===
        // 删除后又创建同名文件，VFS会生成新的nodeId，所以不会走进这个逻辑分支
      }

      // 2. 插入新记录
      const newLog: SyncLog = {
        moduleId: this.moduleId,
        nodeId: input.nodeId!,
        operation: input.operation as SyncOperation,
        path: input.path!,
        timestamp: input.timestamp || Date.now(),
        previousPath: input.previousPath,
        version: 0, // 后续 PacketBuilder 会填充
        status: 'pending',
        retryCount: 0
      };

      await logs.put(newLog);
      await tx.commit();
    } catch (e) {
      await tx.abort();
      this.context.log.error('Failed to record log', e);
      throw e;
    }
  }

  async getPendingLogs(limit: number): Promise<SyncLog[]> {
    const store = this.context.kernel.storage.getCollection<SyncLog>(SYNC_TABLES.LOGS);
    const all = await store.getAll(); // 假设这里有 Filter 能力会更好
    return all
      .filter(l => l.status === 'pending')
      .sort((a, b) => a.timestamp - b.timestamp)
      .slice(0, limit);
  }

  async markAsSynced(logIds: number[]): Promise<void> {
    const tx = this.context.kernel.storage.beginTransaction([SYNC_TABLES.LOGS], 'readwrite');
    const store = tx.getCollection<SyncLog>(SYNC_TABLES.LOGS);
    for (const id of logIds) {
      // 生产环境可以选择物理删除或标记为 synced
      await store.delete(id);
    }
    await tx.commit();
  }
}
