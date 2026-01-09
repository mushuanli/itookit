// @file packages/vfs-tags/src/TagsPlugin.ts

import {
  IPlugin,
  PluginMetadata,
  PluginType,
  PluginState,
  IPluginContext,
  VFSEventType,
  CollectionSchema
} from '../core';
import { TagManager } from './TagManager';
import { TAG_SCHEMAS } from './schemas';

/**
 * 标签系统插件
 */
export class TagsPlugin implements IPlugin {
  readonly metadata: PluginMetadata = {
    id: 'vfs-tags',
    name: 'Tags System',
    version: '1.0.0',
    type: PluginType.FEATURE,
    description: 'Provides tagging functionality for VFS nodes'
  };

  private _state = PluginState.REGISTERED;
  private context?: IPluginContext;
  private tagManager?: TagManager;
  private unsubscribers: Array<() => void> = [];

  get state(): PluginState {
    return this._state;
  }

  /**
   * ✅ 新增：声明需要的 Schema
   */
  getSchemas(): CollectionSchema[] {
    return TAG_SCHEMAS;
  }

  getTagManager(): TagManager {
    if (!this.tagManager) {
      throw new Error('TagsPlugin not activated');
    }
    return this.tagManager;
  }

  async install(context: IPluginContext): Promise<void> {
    this.context = context;
    // ✅ 不再需要在这里注册 Schema，已经通过 getSchemas() 预注册
    context.log.info('Tags plugin installed');
  }

  async activate(): Promise<void> {
    if (!this.context) {
      throw new Error('Plugin not installed');
    }

    // 创建标签管理器
    this.tagManager = new TagManager(this.context.kernel);

    // 监听节点删除事件，自动清理标签
    const unsubDelete = this.context.events.on(VFSEventType.NODE_DELETED, async (event) => {
      if (event.nodeId && event.data) {
        const deletedIds = (event.data as any).deletedIds as string[];
        if (deletedIds?.length) {
          await this.cleanupDeletedNodesTags(deletedIds);
        }
      }
    });
    this.unsubscribers.push(unsubDelete);

    this._state = PluginState.ACTIVATED;
    this.context.log.info('Tags system activated');
  }

  async deactivate(): Promise<void> {
    // 取消事件订阅
    this.unsubscribers.forEach(unsub => unsub());
    this.unsubscribers = [];

    this.tagManager = undefined;
    this._state = PluginState.DEACTIVATED;
    this.context?.log.info('Tags system deactivated');
  }

  async uninstall(): Promise<void> {
    this.context?.log.info('Tags system uninstalled');
  }

  /**
   * 清理已删除节点的标签
   */
  private async cleanupDeletedNodesTags(nodeIds: string[]): Promise<void> {
    if (!this.tagManager) return;

    try {
      const storage = (this.context!.kernel as any).storage;
      const tx = storage.beginTransaction(['tags', 'node_tags'], 'readwrite');

      for (const nodeId of nodeIds) {
        await this.tagManager.cleanupNodeTags(nodeId, tx);
      }

      await tx.commit();
    } catch (error) {
      this.context?.log.error('Failed to cleanup tags for deleted nodes', error);
    }
  }
}

export default TagsPlugin;
