// @file packages/vfs-sync/src/core/ConflictResolver.ts

import { SyncConflict, SyncChange, SyncConfig, VectorClock } from '../types';
import { VectorClockUtils } from '../utils/vectorClock';
import { SYNC_TABLES } from '../constants';
import { IPluginContext } from '../../core';

export class ConflictResolver {
  constructor(
    private context: IPluginContext,
    private config: SyncConfig
  ) {}

  /**
   * 检测并处理冲突
   */
  async detectAndHandle(
    localNode: any | null,
    remoteChange: SyncChange
  ): Promise<'apply' | 'skip' | 'conflict'> {
    if (!localNode) {
      // 本地不存在，直接应用
      return 'apply';
    }

    const localVector = (localNode.metadata?._sync_vc as VectorClock) || {};
    const remoteVector = remoteChange.vectorClock || {};
    const relation = VectorClockUtils.compare(localVector, remoteVector);

    switch (relation) {
      case 'ancestor':
        // 本地更旧，应用远程
        return 'apply';
      
      case 'descendant':
        // 本地更新，跳过
        return 'skip';
      
      case 'equal':
        // 相同版本，跳过
        return 'skip';
      
      case 'concurrent':
        // 并发修改，产生冲突
        await this.createConflict(localNode, remoteChange);
        return this.autoResolve(localNode, remoteChange);
    }
  }

  /**
   * 创建冲突记录
   */
  private async createConflict(localNode: any, remoteChange: SyncChange): Promise<void> {
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
        version: localNode.metadata?._sync_v || 0,
        vectorClock: localNode.metadata?._sync_vc || {}
      },
      remoteChange,
      type: this.determineConflictType(remoteChange),
      resolved: false,
      timestamp: Date.now()
    };

    const store = this.context.kernel.storage.getCollection<SyncConflict>(SYNC_TABLES.CONFLICTS);
    await store.put(conflict);
    
    // 发送冲突事件
    this.context.events.emit({
      type: 'sync:conflict' as any,
      nodeId: remoteChange.nodeId,
      path: remoteChange.path,
      timestamp: Date.now(),
      data: conflict
    });
  }

  /**
   * 自动解决冲突
   */
  private autoResolve(localNode: any, remoteChange: SyncChange): 'apply' | 'skip' {
    switch (this.config.strategy.conflictResolution) {
      case 'server-wins':
        return 'apply';
      
      case 'client-wins':
        return 'skip';
      
      case 'newer-wins':
        return remoteChange.timestamp > localNode.modifiedAt ? 'apply' : 'skip';
      
      case 'manual':
      default:
        // 手动解决时，暂时跳过，等待用户决定
        return 'skip';
    }
  }

  /**
   * 确定冲突类型
   */
  private determineConflictType(change: SyncChange): 'content' | 'delete' | 'move' | 'metadata' {
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
        // 应用远程变更
        await this.applyRemoteChange(conflict.remoteChange, tx);
      } else if (resolution === 'merged' && mergedContent) {
        // 应用合并后的内容
        await this.context.kernel.write(conflict.nodeId, mergedContent);
      }
      // 'local' 不需要任何操作，保持现状

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

  /**
   * 应用远程变更
   */
  private async applyRemoteChange(change: SyncChange, _tx: any): Promise<void> {
    //const vnodes = tx.getCollection('vnodes');
    
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

