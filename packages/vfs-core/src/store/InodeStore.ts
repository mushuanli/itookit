/**
 * @file vfs/store/InodeStore.ts
 */

import { BaseStore } from './BaseStore.js';
import { Database } from './Database.js';
import { VFS_STORES, VNode, VNodeData, Transaction } from './types.js';

/**
 * VNode 元数据存储
 * 管理文件和目录的元数据信息
 */
export class InodeStore extends BaseStore {
  constructor(db: Database) {
    super(db, VFS_STORES.VNODES);
  }

  /**
   * 保存或更新 VNode
   */
  async save(vnode: VNode, transaction?: Transaction | null): Promise<void> {
    const data = vnode.toJSON();
    await this.execute('readwrite', (store) => store.put(data), transaction);
  }

  /**
   * 加载 VNode
   */
  async loadVNode(nodeId: string, transaction?: Transaction | null): Promise<VNode | null> {
    const data = await this.load<VNodeData>(nodeId, transaction);
    return data ? VNode.fromJSON(data) : null;
  }

  /**
   * 删除 VNode
   */
  async deleteVNode(nodeId: string, transaction?: Transaction | null): Promise<void> {
    await this.delete(nodeId, transaction);
  }

  /**
   * 根据路径获取节点ID
   * [修复] 增加 transaction 参数，支持事务复用
   */
  async getIdByPath(path: string, transaction?: Transaction | null): Promise<string | null> {
    const data = await this.execute<VNodeData | undefined>(
      'readonly',
      (store) => store.index('path').get(path),
      transaction
    );
    return data?.nodeId || null;
  }

  /**
   * 获取子节点
   * [修复] 增加 transaction 参数，并使用 execute 以支持事务复用
   */
  async getChildren(parentId: string, transaction?: Transaction | null): Promise<VNode[]> {
    const results = await this.execute<VNodeData[]>(
      'readonly',
      (store) => store.index('parentId').getAll(parentId),
      transaction
    );
    return results.map(data => VNode.fromJSON(data));
  }

  /**
   * 根据模块ID获取节点
   */
  async getByModule(moduleId: string): Promise<VNode[]> {
    const results = await this.db.getAllByIndex<VNodeData>(
      this.storeName,
      'moduleId',
      moduleId
    );
    
    return results.map(data => VNode.fromJSON(data));
  }

  /**
   * 获取模块根节点
   */
  async getModuleRoot(moduleId: string): Promise<VNode | null> {
    const nodes = await this.getByModule(moduleId);
    const root = nodes.find(node => node.parentId === null);
    return root || null;
  }

  /**
   * 批量加载 VNodes（优化版）
   */
  async loadBatch(nodeIds: string[]): Promise<VNode[]> {
    const tx = await this.db.getTransaction(this.storeName, 'readonly');
    const store = tx.getStore(this.storeName);
    
    const results = await Promise.all(
      nodeIds.map(id => this.promisifyRequest<VNodeData>(store.get(id)))
    );
    
    return results
      .filter((data): data is VNodeData => data !== undefined)
      .map(data => VNode.fromJSON(data));
  }

  /**
   * 获取所有节点
   */
  async getAllNodes(): Promise<VNode[]> {
    const results = await this.db.getAll<VNodeData>(this.storeName);
    return results.map(data => VNode.fromJSON(data));
  }
}
