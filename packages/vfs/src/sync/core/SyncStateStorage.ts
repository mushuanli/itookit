// @file packages/vfs-sync/src/core/SyncStateStorage.ts

import { IPluginContext, VNodeType } from '../../core';
import { ModulesPlugin } from '../../modules';
import { SyncCursor, SyncState } from '../types';
import { SYNC_MODULE_NAME } from '../constants';

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

      await this.createDirectoryStructure();
    }

    this.moduleReady = true;
  }

  async saveCursor(cursor: SyncCursor): Promise<void> {
    this.ensureReady();
    await this.writeJson(
      `/${SYNC_MODULE_NAME}/cursors/${cursor.peerId}_${cursor.moduleId}.json`,
      cursor
    );
  }

  async loadCursor(peerId: string, moduleId: string): Promise<SyncCursor | null> {
    this.ensureReady();
    return this.readJson(`/${SYNC_MODULE_NAME}/cursors/${peerId}_${moduleId}.json`);
  }

  async saveState(peerId: string, state: SyncState): Promise<void> {
    this.ensureReady();
    await this.writeJson(`/${SYNC_MODULE_NAME}/state/${peerId}.json`, state);
  }

  async loadState(peerId: string): Promise<SyncState | null> {
    this.ensureReady();
    return this.readJson(`/${SYNC_MODULE_NAME}/state/${peerId}.json`);
  }

  static getSyncModulePath(): string {
    return `/${SYNC_MODULE_NAME}`;
  }

  static isSyncModulePath(path: string): boolean {
    return path.startsWith(`/${SYNC_MODULE_NAME}`);
  }

  private async createDirectoryStructure(): Promise<void> {
    const dirs = [
      `/${SYNC_MODULE_NAME}/cursors`,
      `/${SYNC_MODULE_NAME}/state`
    ];

    for (const dir of dirs) {
      await this.context.kernel.createNode({
        path: dir,
        type: VNodeType.DIRECTORY
      });
    }
  }

  private async writeJson(path: string, data: unknown): Promise<void> {
    const content = JSON.stringify(data, null, 2);

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
      this.context.log.error(`Failed to write ${path}`, e);
    }
  }

  private async readJson<T>(path: string): Promise<T | null> {
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

  private ensureReady(): void {
    if (!this.moduleReady) {
      throw new Error('SyncStateStorage not initialized');
    }
  }
}
