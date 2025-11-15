/**
 * @file vfs/store/ContentStore.ts
 */
import { BaseStore } from './BaseStore.js';
import { Database } from './Database.js';
import { VFS_STORES, ContentData, Transaction } from './types.js';

/**
 * 文件内容存储
 * 管理文件的实际内容数据
 */
export class ContentStore extends BaseStore {
  constructor(db: Database) {
    super(db, VFS_STORES.CONTENTS);
  }

  /**
   * 保存或更新文件内容
   */
  async save(data: ContentData, transaction?: Transaction | null): Promise<void> {
    await this.execute('readwrite', (store) => store.put(data), transaction);
  }

  /**
   * 加载文件内容
   */
  async loadContent(contentRef: string): Promise<ContentData | null> {
    const data = await this.load<ContentData>(contentRef);
    return data || null;
  }

  /**
   * 更新文件内容（save 的别名，语义更清晰）
   */
  async update(data: ContentData, transaction?: Transaction | null): Promise<void> {
    await this.save(data, transaction);
  }

  /**
   * 删除文件内容
   */
  async deleteContent(contentRef: string, transaction?: Transaction | null): Promise<void> {
    await this.delete(contentRef, transaction);
  }

  /**
   * 根据 nodeId 获取内容
   */
  async getByNodeId(nodeId: string): Promise<ContentData | null> {
    const results = await this.db.getAllByIndex<ContentData>(
      this.storeName,
      'nodeId',
      nodeId
    );
    
    return results.length > 0 ? results[0] : null;
  }

  /**
   * 创建内容引用（基于 nodeId）
   */
  static createContentRef(nodeId: string): string {
    return `content_${nodeId}`;
  }
}
