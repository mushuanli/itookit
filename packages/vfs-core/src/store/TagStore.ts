/**
 * @file vfs/store/TagStore.ts
 * Tag 数据存储
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
   * [修改] 初始化引用计数
   */
  async create(tag: Omit<TagData, 'refCount'> & { refCount?: number }, transaction?: Transaction | null): Promise<void> {
    const newTag: TagData = {
      ...tag,
      refCount: tag.refCount || 0
    };
    await this.execute('readwrite', (store) => store.add(newTag), transaction);
  }

  /**
   * [新增] 原子调整引用计数
   * 注意：必须在传入的事务上下文中执行以保证原子性
   */
  async adjustRefCount(tagName: string, delta: number, transaction: Transaction): Promise<void> {
    const store = transaction.getStore(this.storeName);
    
    // 我们必须在事务内读取-修改-写入以保证原子性
    const tag = await this.promisifyRequest<TagData>(store.get(tagName));
    
    if (tag) {
      tag.refCount = (tag.refCount || 0) + delta;
      // 防止计数为负（理论上不应发生，除非数据不一致）
      if (tag.refCount < 0) tag.refCount = 0;
      await this.promisifyRequest(store.put(tag));
    } else if (delta > 0) {
      // 罕见情况：添加标签时标签定义不存在（通常由上层逻辑预先创建）
      // 这里作为容错处理
      await this.promisifyRequest(store.add({ 
        name: tagName, 
        refCount: delta, 
        createdAt: Date.now() 
      }));
    }
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
   */
  async deleteTag(tagName: string, transaction?: Transaction | null): Promise<void> {
    // 1. 获取标签数据以检查保护状态
    const tag = await this.get(tagName, transaction);
    
    if (tag) {
        // 2. 如果受保护，抛出异常
        if (tag.isProtected) {
            throw new Error(`Permission denied: Tag '${tagName}' is protected and cannot be deleted.`);
        }
    } else {
        // 标签不存在，直接返回
        return;
    }

    // 3. 执行删除
    await this.delete(tagName, transaction);
  }
}
