/**
 * @file vfs/store/NodeTagStore.ts
 * Node-Tag 关联存储
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
   * [修改] 返回 boolean，表示是否实际插入了新记录
   * true: 成功插入 (之前不存在)
   * false: 已存在
   */
  async add(nodeId: string, tagName: string, transaction?: Transaction | null): Promise<boolean> {
    const data: NodeTagData = { nodeId, tagName };

    const tx = transaction ? transaction : await this.db.getTransaction(this.storeName, 'readwrite');
    const store = tx.getStore(this.storeName);

    return new Promise<boolean>((resolve, reject) => {
      const request = store.add(data);

      request.onsuccess = () => {
        resolve(true); // 实际增加了记录
      };

      request.onerror = (event) => {
        const error = request.error;
        if (error && error.name === 'ConstraintError') {
          event.preventDefault();
          event.stopPropagation();
          resolve(false); // 已存在，未增加记录
        } else {
          reject(error);
        }
      };
    }).then(async (result) => {
      if (!transaction) {
        await tx.done;
      }
      return result;
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

    const primaryKey = await this.promisifyRequest(index.getKey(key));

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
  async getTagsForNode(nodeId: string, transaction?: Transaction | null): Promise<string[]> {
    const results = await this.execute<NodeTagData[]>(
        'readonly',
        (store) => store.index('nodeId').getAll(nodeId),
        transaction
    );
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
