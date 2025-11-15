/**
 * @file vfs/store/TagStore.ts
 * [新增] Tag 数据存储
 * 管理所有唯一的标签
 */

import { BaseStore } from './BaseStore.js';
import { Database } from './Database.js';
import { VFS_STORES, TagData, Transaction } from './types.js';

export class TagStore extends BaseStore {
  constructor(db: Database) {
    super(db, VFS_STORES.TAGS);
  }

  /**
   * 创建一个新标签（如果不存在）
   */
  async create(tag: TagData, transaction?: Transaction | null): Promise<void> {
    await this.execute('readwrite', (store) => store.add(tag), transaction);
  }

  /**
   * 根据名称获取标签
   */
  async get(tagName: string, transaction?: Transaction | null): Promise<TagData | undefined> {
    return this.load<TagData>(tagName, transaction);
  }

  /**
   * 获取所有标签
   */
  async getAll(): Promise<TagData[]> {
    return this.db.getAll<TagData>(this.storeName);
  }

  /**
   * 删除一个标签定义
   * 注意：这不会自动删除与节点的关联，应在更高级别的服务中处理
   */
  async deleteTag(tagName: string, transaction?: Transaction | null): Promise<void> {
    await this.delete(tagName, transaction);
  }
}
