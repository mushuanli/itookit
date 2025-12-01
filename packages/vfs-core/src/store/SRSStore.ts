/**
 * @file vfs/store/SRSStore.ts
 * SRS 数据存储
 */

import { BaseStore } from './BaseStore.js';
import { Database } from './Database.js';
import { VFS_STORES, SRSItemData, Transaction } from './types.js';

export class SRSStore extends BaseStore {
  constructor(db: Database) {
    super(db, VFS_STORES.SRS_ITEMS);
  }

  /**
   * 保存或更新 SRS 条目
   */
  async put(item: SRSItemData, transaction?: Transaction | null): Promise<void> {
    await this.execute('readwrite', (store) => store.put(item), transaction);
  }

  /**
   * 获取单个条目
   */
  async get(nodeId: string, clozeId: string, transaction?: Transaction | null): Promise<SRSItemData | undefined> {
    // IDB 复合键查询
    return this.execute('readonly', (store) => store.get([nodeId, clozeId]), transaction);
  }

  /**
   * 获取某个文件下的所有 SRS 状态
   */
  async getAllForNode(nodeId: string): Promise<SRSItemData[]> {
    return this.db.getAllByIndex(this.storeName, 'nodeId', nodeId);
  }

  /**
   * 删除某个文件下的所有 SRS 数据 (用于文件删除清理)
   * 必须在事务中执行
   */
  async deleteForNode(nodeId: string, transaction: Transaction): Promise<void> {
     const store = transaction.getStore(this.storeName);
     const index = store.index('nodeId');
     const range = IDBKeyRange.only(nodeId);
     
     return new Promise((resolve, reject) => {
       const req = index.openCursor(range);
       req.onsuccess = () => {
         const cursor = req.result;
         if (cursor) {
           cursor.delete();
           cursor.continue();
         } else {
           resolve();
         }
       };
       req.onerror = () => reject(req.error);
     });
  }

  /**
   * 更新某个节点下所有 SRS 条目的 ModuleId (用于跨模块移动文件)
   */
  async updateModuleIdForNode(nodeId: string, newModuleId: string, transaction: Transaction): Promise<void> {
    const store = transaction.getStore(this.storeName);
    const index = store.index('nodeId');
    const range = IDBKeyRange.only(nodeId);
    
    return new Promise((resolve, reject) => {
        const req = index.openCursor(range);
        req.onsuccess = () => {
            const cursor = req.result;
            if (cursor) {
                const item = cursor.value as SRSItemData;
                if (item.moduleId !== newModuleId) {
                    item.moduleId = newModuleId;
                    cursor.update(item);
                }
                cursor.continue();
            } else {
                resolve();
            }
        };
        req.onerror = () => reject(req.error);
    });
  }

  /**
   * 获取所有到期的卡片 (全局复习模式)
   * @param moduleId 可选，仅查询特定模块
   * @param limit 限制返回数量
   */
  async getDueItems(moduleId?: string, limit: number = 50): Promise<SRSItemData[]> {
    const tx = await this.db.getTransaction(this.storeName, 'readonly');
    const store = tx.getStore(this.storeName);
    const now = Date.now();
    
    // 如果指定了 moduleId，使用复合索引优化
    if (moduleId) {
        const index = store.index('moduleId_dueAt');
        // 查询: moduleId 匹配，且 dueAt <= now
        // IDBKeyRange.bound(lower, upper)
        // 这里 lower 是 [moduleId, 0], upper 是 [moduleId, now]
        const range = IDBKeyRange.bound([moduleId, 0], [moduleId, now]);
        
        return this._scanCursor(index, range, limit);
    } else {
        // 全局查询
        const index = store.index('dueAt');
        const range = IDBKeyRange.upperBound(now);
        return this._scanCursor(index, range, limit);
    }
  }

  private _scanCursor(source: IDBIndex | IDBObjectStore, range: IDBKeyRange, limit: number): Promise<SRSItemData[]> {
      return new Promise((resolve, reject) => {
        const results: SRSItemData[] = [];
        const req = source.openCursor(range);
        req.onsuccess = () => {
            const cursor = req.result;
            if (cursor && results.length < limit) {
                results.push(cursor.value);
                cursor.continue();
            } else {
                resolve(results);
            }
        };
        req.onerror = () => reject(req.error);
    });
  }
}
