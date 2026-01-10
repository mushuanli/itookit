// @file packages/vfs-sync/src/core/SyncStateStorage.ts

import { IPluginContext, VNodeType } from '../../core';
import { ModulesPlugin } from '../../modules';
import { SyncCursor, SyncState } from '../types';

const SYNC_MODULE_NAME = '__sync';

export class SyncStateStorage {
  private moduleReady = false;

  constructor(private context: IPluginContext) {}

  /**
   * 初始化同步模块
   */
  async initialize(): Promise<void> {
    const modulesPlugin = this.context.getPlugin<ModulesPlugin>('vfs-modules');
    if (!modulesPlugin) {
      throw new Error('ModulesPlugin is required for sync state storage');
    }

    const manager = modulesPlugin.getModuleManager();
    const existing = manager.getModule(SYNC_MODULE_NAME);

    if (!existing) {
      await manager.mount(SYNC_MODULE_NAME, {
        description: 'VFS Sync internal state storage',
        isProtected: true
      });

      // 创建目录结构
      await this.context.kernel.createNode({
        path: `/${SYNC_MODULE_NAME}/cursors`,
        type: VNodeType.DIRECTORY
      });
      await this.context.kernel.createNode({
        path: `/${SYNC_MODULE_NAME}/state`,
        type: VNodeType.DIRECTORY
      });
    }

    this.moduleReady = true;
  }

  /**
   * 保存游标
   */
  async saveCursor(cursor: SyncCursor): Promise<void> {
    this.ensureReady();
    
    const path = `/${SYNC_MODULE_NAME}/cursors/${cursor.peerId}_${cursor.moduleId}.json`;
    const content = JSON.stringify(cursor, null, 2);

    try {
      const node = await this.context.kernel.getNodeByPath(path);
      if (node) {
        await this.context.kernel.write(node.nodeId, content);
      } else {
        await this.context.kernel.createNode({
          path,
          type: VNodeType.FILE,
          content
        });
      }
    } catch (e) {
      this.context.log.error('Failed to save cursor', e);
    }
  }

  /**
   * 加载游标
   */
  async loadCursor(peerId: string, moduleId: string): Promise<SyncCursor | null> {
    this.ensureReady();
    
    const path = `/${SYNC_MODULE_NAME}/cursors/${peerId}_${moduleId}.json`;
    
    try {
      const node = await this.context.kernel.getNodeByPath(path);
      if (!node) return null;
      
      const content = await this.context.kernel.read(node.nodeId);
      if (typeof content === 'string') {
        return JSON.parse(content);
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * 保存同步状态
   */
  async saveState(peerId: string, state: SyncState): Promise<void> {
    this.ensureReady();
    
    const path = `/${SYNC_MODULE_NAME}/state/${peerId}.json`;
    const content = JSON.stringify(state, null, 2);

    try {
      const node = await this.context.kernel.getNodeByPath(path);
      if (node) {
        await this.context.kernel.write(node.nodeId, content);
      } else {
        await this.context.kernel.createNode({
          path,
          type: VNodeType.FILE,
          content
        });
      }
    } catch (e) {
      this.context.log.error('Failed to save state', e);
    }
  }

  /**
   * 加载同步状态
   */
  async loadState(peerId: string): Promise<SyncState | null> {
    this.ensureReady();
    
    const path = `/${SYNC_MODULE_NAME}/state/${peerId}.json`;
    
    try {
      const node = await this.context.kernel.getNodeByPath(path);
      if (!node) return null;
      
      const content = await this.context.kernel.read(node.nodeId);
      if (typeof content === 'string') {
        return JSON.parse(content);
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * 获取同步模块路径前缀（用于过滤）
   */
  static getSyncModulePath(): string {
    return `/${SYNC_MODULE_NAME}`;
  }

  /**
   * 检查路径是否属于同步模块
   */
  static isSyncModulePath(path: string): boolean {
    return path.startsWith(`/${SYNC_MODULE_NAME}`);
  }

  private ensureReady(): void {
    if (!this.moduleReady) {
      throw new Error('SyncStateStorage not initialized');
    }
  }
}
