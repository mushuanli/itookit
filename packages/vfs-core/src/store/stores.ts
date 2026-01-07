/**
 * @file vfs/store/stores.ts
 * 所有具体 Store 的精简实现
 */
import { BaseStore } from './BaseStore';
import { Database } from './Database';
import { 
  VFS_STORES, VNodeData, ContentData, TagData, NodeTagData, SRSItemData, Transaction 
} from './types';

// ==================== InodeStore ====================
export class InodeStore extends BaseStore<VNodeData> {
  constructor(db: Database) {
    super(db, VFS_STORES.VNODES);
  }

  async getByPath(path: string, tx?: Transaction | null): Promise<string | null> {
    const data = await this.execute<VNodeData | undefined>(
      'readonly',
      (store) => store.index('path').get(path),
      tx
    );
    return data?.nodeId ?? null;
  }

  async getChildren(parentId: string, tx?: Transaction | null): Promise<VNodeData[]> {
    return this.getAllByIndex('parentId', parentId, tx);
  }

  async getByModule(moduleId: string): Promise<VNodeData[]> {
    return this.getAllByIndex('moduleId', moduleId);
  }

  async getModuleRoot(moduleId: string): Promise<VNodeData | null> {
    const nodes = await this.getByModule(moduleId);
    return nodes.find(n => n.parentId === null) ?? null;
  }
}

// ==================== ContentStore ====================
export class ContentStore extends BaseStore<ContentData> {
  constructor(db: Database) {
    super(db, VFS_STORES.CONTENTS);
  }

  static createRef(nodeId: string): string {
    return `content_${nodeId}`;
  }

  async getByNodeId(nodeId: string): Promise<ContentData | null> {
    const results = await this.getAllByIndex('nodeId', nodeId);
    return results[0] ?? null;
  }
}

// ==================== TagStore ====================
export class TagStore extends BaseStore<TagData> {
  constructor(db: Database) {
    super(db, VFS_STORES.TAGS);
  }

  async create(tag: Omit<TagData, 'refCount'> & { refCount?: number }, tx?: Transaction | null): Promise<void> {
    await this.execute('readwrite', (store) => store.add({ refCount: 0, ...tag }), tx);
  }

  async adjustRefCount(tagName: string, delta: number, tx: Transaction): Promise<void> {
    const store = tx.getStore(this.storeName);
    const tag = await Database.promisify<TagData>(store.get(tagName));
    
    if (tag) {
      tag.refCount = Math.max(0, (tag.refCount || 0) + delta);
      await Database.promisify(store.put(tag));
    } else if (delta > 0) {
      await Database.promisify(store.add({ name: tagName, refCount: delta, createdAt: Date.now() }));
    }
  }

  async deleteTag(tagName: string, tx?: Transaction | null): Promise<void> {
    const tag = await this.get(tagName, tx);
    if (tag?.isProtected) {
      throw new Error(`Tag '${tagName}' is protected`);
    }
    await this.delete(tagName, tx);
  }
}

// ==================== NodeTagStore ====================
export class NodeTagStore extends BaseStore<NodeTagData> {
  constructor(db: Database) {
    super(db, VFS_STORES.NODE_TAGS);
  }

  async add(nodeId: string, tagName: string, tx?: Transaction | null): Promise<boolean> {
    const transaction = tx ?? this.db.getTransaction(this.storeName, 'readwrite');
    const store = transaction.getStore(this.storeName);

    return new Promise<boolean>((resolve, reject) => {
      const request = store.add({ nodeId, tagName });
      request.onsuccess = () => resolve(true);
      request.onerror = (e) => {
        if (request.error?.name === 'ConstraintError') {
          e.preventDefault();
          e.stopPropagation();
          resolve(false);
        } else {
          reject(request.error);
        }
      };
    }).finally(async () => {
      if (!tx) await transaction.done;
    });
  }

  async remove(nodeId: string, tagName: string, tx?: Transaction | null): Promise<void> {
    const transaction = tx ?? this.db.getTransaction(this.storeName, 'readwrite');
    const store = transaction.getStore(this.storeName);
    const index = store.index('nodeId_tagName');
    
    const primaryKey = await Database.promisify(index.getKey([nodeId, tagName]));
    if (primaryKey) {
      await Database.promisify(store.delete(primaryKey));
    }
    if (!tx) await transaction.done;
  }

  async getTagsForNode(nodeId: string, tx?: Transaction | null): Promise<string[]> {
    const results = await this.getAllByIndex('nodeId', nodeId, tx);
    return results.map(r => r.tagName);
  }

  async getNodesForTag(tagName: string): Promise<string[]> {
    const results = await this.getAllByIndex('tagName', tagName);
    return results.map(r => r.nodeId);
  }

  async removeAllForNode(nodeId: string, tx: Transaction): Promise<void> {
    await this.deleteByIndex('nodeId', nodeId, tx);
  }
}

// ==================== SRSStore ====================
export class SRSStore extends BaseStore<SRSItemData, [string, string]> {
  constructor(db: Database) {
    super(db, VFS_STORES.SRS_ITEMS);
  }

  async getItem(nodeId: string, clozeId: string, tx?: Transaction | null): Promise<SRSItemData | undefined> {
    return this.get([nodeId, clozeId], tx);
  }

  async getAllForNode(nodeId: string): Promise<SRSItemData[]> {
    return this.getAllByIndex('nodeId', nodeId);
  }

  async deleteForNode(nodeId: string, tx: Transaction): Promise<void> {
    await this.deleteByIndex('nodeId', nodeId, tx);
  }

  async updateModuleIdForNode(nodeId: string, newModuleId: string, tx: Transaction): Promise<void> {
    const store = tx.getStore(this.storeName);
    const index = store.index('nodeId');
    const range = IDBKeyRange.only(nodeId);

    return new Promise((resolve, reject) => {
      const request = index.openCursor(range);
      request.onsuccess = () => {
        const cursor = request.result;
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
      request.onerror = () => reject(request.error);
    });
  }

  async getDueItems(moduleId?: string, limit = 50): Promise<SRSItemData[]> {
    const tx = this.db.getTransaction(this.storeName, 'readonly');
    const store = tx.getStore(this.storeName);
    const now = Date.now();

    if (moduleId) {
      const index = store.index('moduleId_dueAt');
      const range = IDBKeyRange.bound([moduleId, 0], [moduleId, now]);
      return this.scanCursor(index, range, limit);
    }
    
    const index = store.index('dueAt');
    const range = IDBKeyRange.upperBound(now);
    return this.scanCursor(index, range, limit);
  }
}
