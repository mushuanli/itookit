/**
 * @file vfs/store/NodeTagStore.ts
 * [新增] Node-Tag 关联存储
 * 管理 VNode 和 Tag 之间的多对多关系
 */

import { BaseStore } from './BaseStore.js';
import { Database } from './Database.js';
import { VFS_STORES, NodeTagData, Transaction } from './types.js';

export class NodeTagStore extends BaseStore {
  constructor(db: Database) {
    super(db, VFS_STORES.NODE_TAGS);
  }

  /**
   * 为节点添加一个标签关联
   */
  async add(nodeId: string, tagName: string, transaction?: Transaction | null): Promise<void> {
    const data: NodeTagData = { nodeId, tagName };
    // 使用 add 方法，如果复合唯一索引存在，会抛出错误，防止重复
    await this.execute('readwrite', (store) => store.add(data), transaction);
  }

  /**
   * 移除节点的某个标签关联
   */
  async remove(nodeId: string, tagName: string, transaction?: Transaction | null): Promise<void> {
    const tx = transaction || await this.db.getTransaction(this.storeName, 'readwrite');
    const store = tx.getStore(this.storeName);
    const index = store.index('nodeId_tagName');
    const key = [nodeId, tagName];
    
    // 1. 通过复合索引找到主键
    const primaryKey = await this.promisifyRequest(index.getKey(key));

    // 2. 如果找到，则使用主键删除记录
    if (primaryKey) {
      await this.execute('readwrite', (s) => s.delete(primaryKey), tx);
    }
    
    if (!transaction) {
      await tx.done;
    }
  }

  /**
   * 获取一个节点的所有标签名
   */
  async getTagsForNode(nodeId: string): Promise<string[]> {
    const results = await this.db.getAllByIndex<NodeTagData>(this.storeName, 'nodeId', nodeId);
    return results.map(r => r.tagName);
  }

  /**
   * 获取拥有某个标签的所有节点ID
   */
  async getNodesForTag(tagName: string): Promise<string[]> {
    const results = await this.db.getAllByIndex<NodeTagData>(this.storeName, 'tagName', tagName);
    return results.map(r => r.nodeId);
  }
  
  /**
   * 移除一个节点的所有标签关联（在节点删除时使用）
   */
  async removeAllForNode(nodeId: string, transaction: Transaction): Promise<void> {
    const store = transaction.getStore(this.storeName);
    const index = store.index('nodeId');
    const range = IDBKeyRange.only(nodeId);

    return new Promise((resolve, reject) => {
      const cursorRequest = index.openCursor(range);
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (cursor) {
          cursor.delete(); // 删除当前记录
          cursor.continue();
        } else {
          resolve(); // 游标结束
        }
      };
      cursorRequest.onerror = () => reject(cursorRequest.error);
    });
  }
}
