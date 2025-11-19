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
   * [修改] 现在如果关联已存在，将静默成功（幂等性）
   */
  async add(nodeId: string, tagName: string, transaction?: Transaction | null): Promise<void> {
    const data: NodeTagData = { nodeId, tagName };

    // 如果传入了外部事务，直接使用；否则开启新事务
    const tx = transaction ? transaction : await this.db.getTransaction(this.storeName, 'readwrite');
    const store = tx.getStore(this.storeName);

    return new Promise((resolve, reject) => {
      const request = store.add(data);

      request.onsuccess = () => {
        resolve(undefined);
      };

      request.onerror = (event) => {
        const error = request.error;
        // 检查是否是唯一性约束错误
        if (error && error.name === 'ConstraintError') {
          // 关键：阻止错误冒泡，防止事务被自动中止
          event.preventDefault();
          event.stopPropagation();

          // 视为成功（幂等）
          resolve(undefined);
        } else {
          // 其他错误，让其冒泡或 reject
          reject(error);
        }
      };
    }).then(async () => {
      // 如果是我们自己开启的事务，需要等待它完成
      if (!transaction) {
        await tx.done;
      }
    });
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
          cursor.delete();
          cursor.continue();
        } else {
          resolve();
        }
      };
      cursorRequest.onerror = () => reject(cursorRequest.error);
    });
  }
}
