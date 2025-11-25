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

    const tx = transaction ? transaction : await this.db.getTransaction(this.storeName, 'readwrite');
    const store = tx.getStore(this.storeName);

    return new Promise((resolve, reject) => {
      const request = store.add(data);

      request.onsuccess = () => {
        resolve(undefined);
      };

      request.onerror = (event) => {
        const error = request.error;
        if (error && error.name === 'ConstraintError') {
          event.preventDefault();
          event.stopPropagation();
          resolve(undefined);
        } else {
          reject(error);
        }
      };
    }).then(async () => {
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
   * [修复] 增加 transaction 参数，确保在批量操作中保持事务活性
   */
  async getTagsForNode(nodeId: string, transaction?: Transaction | null): Promise<string[]> {
    // 使用 execute 包装器，它会自动处理 "使用传入事务" 或 "创建新只读事务" 的逻辑
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
