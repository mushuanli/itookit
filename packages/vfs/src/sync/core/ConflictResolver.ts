// @file packages/vfs-sync/src/core/ConflictResolver.ts

import { IPluginContext, VNodeData } from '../../core';
import { SyncConflict, SyncChange, SyncConfig, VectorClock, ConflictType } from '../types';
import { compareClock, ClockRelation } from '../utils/vectorClock';
import { SYNC_TABLES } from '../constants';

export type ConflictDecision = 'apply' | 'skip' | 'conflict';

export class ConflictResolver {
  constructor(
    private context: IPluginContext,
    private config: SyncConfig
  ) {}

  /**
   * 检测并处理冲突
   */
  async detectAndHandle(
    localNode: VNodeData | null,
    remoteChange: SyncChange
  ): Promise<ConflictDecision> {
    if (!localNode) {
      // 本地不存在，直接应用
      return 'apply';
    }

    const localVector = (localNode.metadata?._sync_vc as VectorClock) || {};
    const remoteVector = remoteChange.vectorClock || {};
    const relation = compareClock(localVector, remoteVector);

    return this.decideByRelation(relation, localNode, remoteChange);
  }

  /**
   * 手动解决冲突
   */
  async resolve(
    conflictId: string,
    resolution: 'local' | 'remote' | 'merged',
    mergedContent?: ArrayBuffer
  ): Promise<void> {
    const store = this.context.kernel.storage.getCollection<SyncConflict>(SYNC_TABLES.CONFLICTS);
    const conflict = await store.get(conflictId);

    if (!conflict) {
      throw new Error(`Conflict not found: ${conflictId}`);
    }

    const tx = this.context.kernel.storage.beginTransaction(
      ['vnodes', 'contents', SYNC_TABLES.CONFLICTS],
      'readwrite'
    );

    try {
      if (resolution === 'remote') {
        await this.applyRemoteChange(conflict.remoteChange);
      } else if (resolution === 'merged' && mergedContent) {
        await this.context.kernel.write(conflict.nodeId, mergedContent);
      }

      // 更新冲突记录
      conflict.resolved = true;
      conflict.resolution = resolution;
      await tx.getCollection<SyncConflict>(SYNC_TABLES.CONFLICTS).put(conflict);

      await tx.commit();
    } catch (e) {
      await tx.abort();
      throw e;
    }
  }

  private decideByRelation(
    relation: ClockRelation,
    localNode: VNodeData,
    remoteChange: SyncChange
  ): ConflictDecision {
    switch (relation) {
      case 'ancestor':
        return 'apply';

      case 'descendant':
      case 'equal':
        return 'skip';

      case 'concurrent':
        this.createConflict(localNode, remoteChange);
        return this.autoResolve(localNode, remoteChange);
    }
  }

  private autoResolve(localNode: VNodeData, remoteChange: SyncChange): ConflictDecision {
    const strategy = this.config.strategy.conflictResolution;

    switch (strategy) {
      case 'server-wins':
        return 'apply';

      case 'client-wins':
        return 'skip';

      case 'newer-wins':
        return remoteChange.timestamp > localNode.modifiedAt ? 'apply' : 'skip';

      case 'manual':
      default:
        return 'skip';
    }
  }

  private async createConflict(localNode: VNodeData, remoteChange: SyncChange): Promise<void> {
    const conflict: SyncConflict = {
      conflictId: `conflict_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      nodeId: remoteChange.nodeId,
      path: remoteChange.path,
      localChange: {
        logId: 0,
        nodeId: localNode.nodeId,
        operation: 'update',
        timestamp: localNode.modifiedAt,
        path: localNode.path,
        version: (localNode.metadata?._sync_v as number) || 0,
        vectorClock: (localNode.metadata?._sync_vc as VectorClock) || {}
      },
      remoteChange,
      type: this.determineConflictType(remoteChange),
      resolved: false,
      timestamp: Date.now()
    };

    const store = this.context.kernel.storage.getCollection<SyncConflict>(SYNC_TABLES.CONFLICTS);
    await store.put(conflict);

    this.context.events.emit({
      type: 'sync:conflict' as any,
      nodeId: remoteChange.nodeId,
      path: remoteChange.path,
      timestamp: Date.now(),
      data: conflict
    });
  }

  private determineConflictType(change: SyncChange): ConflictType {
    switch (change.operation) {
      case 'delete':
        return 'delete';
      case 'move':
        return 'move';
      case 'metadata_update':
      case 'tag_add':
      case 'tag_remove':
        return 'metadata';
      default:
        return 'content';
    }
  }

  private async applyRemoteChange(change: SyncChange): Promise<void> {
    switch (change.operation) {
      case 'delete':
        await this.context.kernel.unlink(change.nodeId, true);
        break;
      
      case 'move':
        await this.context.kernel.move(change.nodeId, change.path);
        break;
      
      default:
        // 需要获取远程内容并应用
        // 这里假设内容已在其他地方获取
        break;
    }
  }
}

