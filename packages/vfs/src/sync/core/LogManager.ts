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
   * 记录变更（包含合并逻辑）
   */
  async recordChange(input: Partial<SyncLog>): Promise<void> {
    const tx = this.context.kernel.storage.beginTransaction([SYNC_TABLES.LOGS], 'readwrite');
    const logs = tx.getCollection<SyncLog>(SYNC_TABLES.LOGS);

    try {
      const existing = await this.findPendingLog(logs, input.nodeId!);

      if (existing) {
        const coalesced = this.coalesceOperations(existing, input);
        if (coalesced === 'delete') {
          await logs.delete(existing.logId!);
        } else if (coalesced === 'update') {
          existing.timestamp = input.timestamp!;
          existing.path = input.path || existing.path;
          await logs.put(existing);
        }
        // coalesced === 'skip' 时不做任何操作
        await tx.commit();
        return;
      }

      // 插入新记录
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
    const all = await store.getAllByIndex('status', 'pending');
    
    return all
      .sort((a, b) => a.timestamp - b.timestamp)
      .slice(0, limit);
  }

  async markAsSynced(logIds: number[]): Promise<void> {
    if (logIds.length === 0) return;
    
    const tx = this.context.kernel.storage.beginTransaction([SYNC_TABLES.LOGS], 'readwrite');
    const store = tx.getCollection<SyncLog>(SYNC_TABLES.LOGS);
    
    for (const id of logIds) {
      // 生产环境可以选择物理删除或标记为 synced
      await store.delete(id);
    }
    
    await tx.commit();
  }

  async markAsFailed(logIds: number[]): Promise<void> {
    if (logIds.length === 0) return;
    
    const tx = this.context.kernel.storage.beginTransaction([SYNC_TABLES.LOGS], 'readwrite');
    const store = tx.getCollection<SyncLog>(SYNC_TABLES.LOGS);
    
    for (const id of logIds) {
      const log = await store.get(id);
      if (log) {
        log.status = 'failed';
        log.retryCount = (log.retryCount || 0) + 1;
        await store.put(log);
      }
    }
    
    await tx.commit();
  }

  private async findPendingLog(
    logs: any,
    nodeId: string
  ): Promise<SyncLog | undefined> {
    const pendingOps = await logs.getAllByIndex('nodeId', nodeId);
    return pendingOps.find((op: SyncLog) => op.status === 'pending');
  }

  /**
   * 操作合并策略
   */
  private coalesceOperations(
    existing: SyncLog,
    incoming: Partial<SyncLog>
  ): 'delete' | 'update' | 'skip' {
    const existOp = existing.operation;
    const newOp = incoming.operation;

    // Create + Delete = 删除记录
    if (existOp === 'create' && newOp === 'delete') {
      return 'delete';
    }

    // Update + Update = 更新时间戳
    if (existOp === 'update' && newOp === 'update') {
      return 'update';
    }

    // Create + Update = 保持 Create，更新时间戳
    if (existOp === 'create' && newOp === 'update') {
      return 'update';
    }

    // 其他情况：跳过（保持现有记录）
    return 'skip';
  }
}
