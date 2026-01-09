// @file packages/vfs-assets/src/AssetsPlugin.ts

import {
  IPlugin,
  PluginMetadata,
  PluginType,
  PluginState,
  IPluginContext,
  VFSEventType
} from '../core';
import { AssetManager } from './AssetManager';

/**
 * 资产管理插件
 */
export class AssetsPlugin implements IPlugin {
  readonly metadata: PluginMetadata = {
    id: 'vfs-assets',
    name: 'Assets Management',
    version: '1.0.0',
    type: PluginType.FEATURE,
    description: 'Provides asset directory management for VFS nodes'
  };

  private _state = PluginState.REGISTERED;
  private context?: IPluginContext;
  private assetManager?: AssetManager;
  private unsubscribers: Array<() => void> = [];

  get state(): PluginState {
    return this._state;
  }

  /**
   * 获取资产管理器
   */
  getAssetManager(): AssetManager {
    if (!this.assetManager) {
      throw new Error('AssetsPlugin not activated');
    }
    return this.assetManager;
  }

  async install(context: IPluginContext): Promise<void> {
    this.context = context;
    context.log.info('Assets plugin installed');
  }

  async activate(): Promise<void> {
    if (!this.context) {
      throw new Error('Plugin not installed');
    }

    this.assetManager = new AssetManager(this.context.kernel);

    // 监听节点移动事件，同步移动资产目录
    const unsubMove = this.context.events.on(VFSEventType.NODE_MOVED, async (event) => {
      if (event.nodeId && event.data) {
        const { oldPath, newPath } = event.data as { oldPath: string; newPath: string };
        const node = await this.context!.kernel.getNode(event.nodeId);
        if (node) {
          try {
            const storage = (this.context!.kernel as any).storage;
            const tx = storage.beginTransaction(['vnodes', 'contents'], 'readwrite');
            await this.assetManager!.syncMoveAssetDirectory(node, oldPath, newPath, tx);
            await tx.commit();
          } catch (error) {
            this.context?.log.error('Failed to sync asset directory on move', error);
          }
        }
      }
    });
    this.unsubscribers.push(unsubMove);

    // 监听节点复制事件，同步复制资产目录
    const unsubCopy = this.context.events.on(VFSEventType.NODE_COPIED, async (event) => {
      if (event.nodeId && event.data) {
        const { sourceId } = event.data as { sourceId: string };
        const source = await this.context!.kernel.getNode(sourceId);
        if (source && event.path) {
          try {
            const storage = (this.context!.kernel as any).storage;
            const tx = storage.beginTransaction(['vnodes', 'contents'], 'readwrite');
            await this.assetManager!.syncCopyAssetDirectory(source, event.nodeId, event.path, tx);
            await tx.commit();
          } catch (error) {
            this.context?.log.error('Failed to sync asset directory on copy', error);
          }
        }
      }
    });
    this.unsubscribers.push(unsubCopy);

    this._state = PluginState.ACTIVATED;
    this.context.log.info('Assets plugin activated');
  }

  async deactivate(): Promise<void> {
    this.unsubscribers.forEach(unsub => unsub());
    this.unsubscribers = [];
    this.assetManager = undefined;
    this._state = PluginState.DEACTIVATED;
    this.context?.log.info('Assets plugin deactivated');
  }

  async uninstall(): Promise<void> {
    this.context?.log.info('Assets plugin uninstalled');
  }
}

export default AssetsPlugin;
