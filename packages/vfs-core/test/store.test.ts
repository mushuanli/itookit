// @file vfs/test/store.test.ts

import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import FDBFactory from 'fake-indexeddb/lib/FDBFactory';

// ========================================================================
// === 源代码定义 (为了使示例可独立运行，将所有类复制到此处) ===
// === 在你的实际项目中，你应该从相应文件导入这些类 ===
// ========================================================================

// <editor-fold desc="Source Code Definitions">

/**
 * @file vfs/store/types.ts
 */
// ... (此处粘贴你提供的所有类的代码)
/**
 * @file vfs/store/types.ts
 */

/** 数据库配置 */
export interface DatabaseConfig {
  dbName: string;
  version: number;
}

/** VFS ObjectStore 名称常量 */
export const VFS_STORES = {
  VNODES: 'vnodes',
  CONTENTS: 'vfs_contents'
} as const;

/** 事务模式 */
export type TransactionMode = 'readonly' | 'readwrite';

/** VNode 类型 */
export enum VNodeType {
  FILE = 'file',
  DIRECTORY = 'directory'
}

/** VNode 数据结构 */
export interface VNodeData {
  nodeId: string;
  parentId: string | null;
  name: string;
  type: VNodeType;
  path: string;
  moduleId: string | null;
  contentRef: string | null;
  size: number;
  createdAt: number;
  modifiedAt: number;
  metadata?: Record<string, any>;
}

/** VNode 类 */
export class VNode {
  constructor(
    public nodeId: string,
    public parentId: string | null,
    public name: string,
    public type: VNodeType,
    public path: string,
    public moduleId: string | null = null,
    public contentRef: string | null = null,
    public size: number = 0,
    public createdAt: number = Date.now(),
    public modifiedAt: number = Date.now(),
    public metadata: Record<string, any> = {}
  ) {}

  toJSON(): VNodeData {
    return {
      nodeId: this.nodeId,
      parentId: this.parentId,
      name: this.name,
      type: this.type,
      path: this.path,
      moduleId: this.moduleId,
      contentRef: this.contentRef,
      size: this.size,
      createdAt: this.createdAt,
      modifiedAt: this.modifiedAt,
      metadata: this.metadata
    };
  }

  static fromJSON(data: VNodeData): VNode {
    return new VNode(
      data.nodeId,
      data.parentId,
      data.name,
      data.type,
      data.path,
      data.moduleId,
      data.contentRef,
      data.size,
      data.createdAt,
      data.modifiedAt,
      data.metadata || {}
    );
  }
}

/** 文件内容数据结构 */
export interface ContentData {
  contentRef: string;
  nodeId: string;
  content: ArrayBuffer | string;
  size: number;
  createdAt: number;
}

/** 事务包装类 */
export class Transaction {
  constructor(private transaction: IDBTransaction) {}

  getStore(storeName: string): IDBObjectStore {
    return this.transaction.objectStore(storeName);
  }

  get done(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.transaction.oncomplete = () => resolve();
      this.transaction.onerror = () => reject(this.transaction.error);
      this.transaction.onabort = () => reject(new Error('Transaction aborted'));
    });
  }
}


/**
 * @file vfs/store/Database.ts
 */
export class Database {
  private db: IDBDatabase | null = null;
  private readonly version = 2;

  constructor(private dbName: string = 'vfs_database') {}

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.version);

      request.onerror = () => {
        console.error('Database connection failed:', request.error);
        reject(request.error);
      };

      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        const oldVersion = event.oldVersion;
        
        if (oldVersion < 1) {
          this.createVNodesStore(db);
          this.createContentsStore(db);
        }

        if (oldVersion < 2) {
          // No changes in v2 for this test
        }
      };
    });
  }

  private createVNodesStore(db: IDBDatabase): void {
    if (!db.objectStoreNames.contains(VFS_STORES.VNODES)) {
      const store = db.createObjectStore(VFS_STORES.VNODES, { keyPath: 'nodeId' });
      store.createIndex('path', 'path', { unique: true });
      store.createIndex('parentId', 'parentId', { unique: false });
      store.createIndex('moduleId', 'moduleId', { unique: false });
      store.createIndex('type', 'type', { unique: false });
    }
  }

  private createContentsStore(db: IDBDatabase): void {
    if (!db.objectStoreNames.contains(VFS_STORES.CONTENTS)) {
      const store = db.createObjectStore(VFS_STORES.CONTENTS, { keyPath: 'contentRef' });
      store.createIndex('nodeId', 'nodeId', { unique: false });
    }
  }

  disconnect(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  async getTransaction(
    storeNames: string | string[],
    mode: TransactionMode = 'readonly'
  ): Promise<Transaction> {
    if (!this.db) throw new Error('Database not connected');
    const stores = Array.isArray(storeNames) ? storeNames : [storeNames];
    const transaction = this.db.transaction(stores, mode);
    return new Transaction(transaction);
  }

  async getAll<T = any>(storeName: string): Promise<T[]> {
    const tx = await this.getTransaction(storeName, 'readonly');
    const store = tx.getStore(storeName);
    return this.promisifyRequest<T[]>(store.getAll());
  }

  async getAllByIndex<T = any>(
    storeName: string,
    indexName: string,
    query?: IDBValidKey | IDBKeyRange
  ): Promise<T[]> {
    const tx = await this.getTransaction(storeName, 'readonly');
    const store = tx.getStore(storeName);
    const index = store.index(indexName);
    return this.promisifyRequest<T[]>(query ? index.getAll(query) : index.getAll());
  }

  promisifyRequest<T>(request: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  get instance(): IDBDatabase {
    if (!this.db) throw new Error('Database not connected');
    return this.db;
  }
}

/**
 * @file vfs/store/BaseStore.ts
 */
export abstract class BaseStore {
  protected constructor(
    protected db: Database,
    protected storeName: string
  ) {}

  protected async execute<T>(
    mode: TransactionMode,
    operation: (store: IDBObjectStore) => IDBRequest<T>,
    transaction?: Transaction | null
  ): Promise<T> {
    if (transaction) {
      const store = transaction.getStore(this.storeName);
      return this.promisifyRequest(operation(store));
    } else {
      const tx = await this.db.getTransaction(this.storeName, mode);
      const store = tx.getStore(this.storeName);
      const result = await this.promisifyRequest(operation(store));
      await tx.done;
      return result;
    }
  }

  protected promisifyRequest<T>(request: IDBRequest<T>): Promise<T> {
    return this.db.promisifyRequest(request);
  }

  async delete(key: IDBValidKey, transaction?: Transaction | null): Promise<void> {
    await this.execute('readwrite', (store) => store.delete(key), transaction);
  }

  async load<T>(key: IDBValidKey): Promise<T | undefined> {
    return this.execute('readonly', (store) => store.get(key));
  }
}


/**
 * @file vfs/store/InodeStore.ts
 */
export class InodeStore extends BaseStore {
  constructor(db: Database) {
    super(db, VFS_STORES.VNODES);
  }

  async save(vnode: VNode, transaction?: Transaction | null): Promise<void> {
    const data = vnode.toJSON();
    await this.execute('readwrite', (store) => store.put(data), transaction);
  }

  async loadVNode(nodeId: string): Promise<VNode | null> {
    const data = await this.load<VNodeData>(nodeId);
    return data ? VNode.fromJSON(data) : null;
  }

  async deleteVNode(nodeId: string, transaction?: Transaction | null): Promise<void> {
    await this.delete(nodeId, transaction);
  }

  async getIdByPath(path: string): Promise<string | null> {
    const tx = await this.db.getTransaction(this.storeName, 'readonly');
    const store = tx.getStore(this.storeName);
    const index = store.index('path');
    const data = await this.promisifyRequest<VNodeData>(index.get(path));
    return data?.nodeId || null;
  }

  async getChildren(parentId: string): Promise<VNode[]> {
    const results = await this.db.getAllByIndex<VNodeData>(this.storeName, 'parentId', parentId);
    return results.map(data => VNode.fromJSON(data));
  }

  async getByModule(moduleId: string): Promise<VNode[]> {
    const results = await this.db.getAllByIndex<VNodeData>(this.storeName, 'moduleId', moduleId);
    return results.map(data => VNode.fromJSON(data));
  }

  async getModuleRoot(moduleId: string): Promise<VNode | null> {
    const nodes = await this.getByModule(moduleId);
    const root = nodes.find(node => node.parentId === null);
    return root || null;
  }

  async loadBatch(nodeIds: string[]): Promise<VNode[]> {
    const tx = await this.db.getTransaction(this.storeName, 'readonly');
    const store = tx.getStore(this.storeName);
    const results = await Promise.all(
      nodeIds.map(id => this.promisifyRequest<VNodeData>(store.get(id)))
    );
    return results.filter((data): data is VNodeData => !!data).map(data => VNode.fromJSON(data));
  }

  async getAllNodes(): Promise<VNode[]> {
    const results = await this.db.getAll<VNodeData>(this.storeName);
    return results.map(data => VNode.fromJSON(data));
  }
}

/**
 * @file vfs/store/ContentStore.ts
 */
export class ContentStore extends BaseStore {
  constructor(db: Database) {
    super(db, VFS_STORES.CONTENTS);
  }

  async save(data: ContentData, transaction?: Transaction | null): Promise<void> {
    await this.execute('readwrite', (store) => store.put(data), transaction);
  }

  async loadContent(contentRef: string): Promise<ContentData | null> {
    const data = await this.load<ContentData>(contentRef);
    return data || null;
  }

  async update(data: ContentData, transaction?: Transaction | null): Promise<void> {
    await this.save(data, transaction);
  }

  async deleteContent(contentRef: string, transaction?: Transaction | null): Promise<void> {
    await this.delete(contentRef, transaction);
  }

  async getByNodeId(nodeId: string): Promise<ContentData | null> {
    const results = await this.db.getAllByIndex<ContentData>(this.storeName, 'nodeId', nodeId);
    return results.length > 0 ? results[0] : null;
  }

  static createContentRef(nodeId: string): string {
    return `content_${nodeId}`;
  }
}

/**
 * @file vfs/store/VFSStorage.ts
 */
export class VFSStorage {
  private db: Database;
  private inodeStore!: InodeStore;
  private contentStore!: ContentStore;
  private connected = false;

  constructor(dbName: string = 'vfs_database') {
    this.db = new Database(dbName);
  }

  async connect(): Promise<void> {
    if (this.connected) return;
    await this.db.connect();
    this.inodeStore = new InodeStore(this.db);
    this.contentStore = new ContentStore(this.db);
    this.connected = true;
  }

  disconnect(): void {
    this.db.disconnect();
    this.connected = false;
  }

  async beginTransaction(
    storeNames: string | string[] = [VFS_STORES.VNODES, VFS_STORES.CONTENTS],
    mode: TransactionMode = 'readwrite'
  ): Promise<Transaction> {
    this.ensureConnected();
    return this.db.getTransaction(storeNames, mode);
  }

  async saveVNode(vnode: VNode, transaction?: Transaction): Promise<void> {
    this.ensureConnected();
    await this.inodeStore.save(vnode, transaction);
  }

  async loadVNode(nodeId: string): Promise<VNode | null> {
    this.ensureConnected();
    return this.inodeStore.loadVNode(nodeId);
  }

  async deleteVNode(nodeId: string, transaction?: Transaction): Promise<void> {
    this.ensureConnected();
    await this.inodeStore.deleteVNode(nodeId, transaction);
  }

  async getNodeIdByPath(path: string): Promise<string | null> {
    this.ensureConnected();
    return this.inodeStore.getIdByPath(path);
  }

  async getChildren(parentId: string): Promise<VNode[]> {
    this.ensureConnected();
    return this.inodeStore.getChildren(parentId);
  }

  async loadVNodes(nodeIds: string[]): Promise<VNode[]> {
    this.ensureConnected();
    return this.inodeStore.loadBatch(nodeIds);
  }

  async saveContent(data: ContentData, transaction?: Transaction): Promise<void> {
    this.ensureConnected();
    await this.contentStore.save(data, transaction);
  }

  async loadContent(contentRef: string): Promise<ContentData | null> {
    this.ensureConnected();
    return this.contentStore.loadContent(contentRef);
  }

  async updateContent(data: ContentData, transaction?: Transaction): Promise<void> {
    this.ensureConnected();
    await this.contentStore.update(data, transaction);
  }

  async deleteContent(contentRef: string, transaction?: Transaction): Promise<void> {
    this.ensureConnected();
    await this.contentStore.deleteContent(contentRef, transaction);
  }
  
  async loadAllModules(): Promise<string[]> {
    this.ensureConnected();
    const tx = await this.db.getTransaction(VFS_STORES.VNODES, 'readonly');
    const store = tx.getStore(VFS_STORES.VNODES);
    const index = store.index('moduleId');
    
    return new Promise((resolve, reject) => {
      const moduleIds = new Set<string>();
      const cursorRequest = index.openKeyCursor(null, 'nextunique');
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (cursor) {
          if (cursor.key && typeof cursor.key === 'string') {
            moduleIds.add(cursor.key);
          }
          cursor.continue();
        } else {
          resolve(Array.from(moduleIds));
        }
      };
      cursorRequest.onerror = () => reject(cursorRequest.error);
    });
  }

  async getModuleRoot(moduleId: string): Promise<VNode | null> {
    this.ensureConnected();
    return this.inodeStore.getModuleRoot(moduleId);
  }

  async getModuleNodes(moduleId: string): Promise<VNode[]> {
    this.ensureConnected();
    return this.inodeStore.getByModule(moduleId);
  }

  private ensureConnected(): void {
    if (!this.connected) {
      throw new Error('VFSStorage not connected. Call connect() first.');
    }
  }

  get database(): Database {
    return this.db;
  }
}
// </editor-fold>

// ========================================================================
// === 测试代码开始 ===
// ========================================================================

// 在所有测试开始前，设置 fake-indexeddb
beforeAll(() => {
  global.indexedDB = new FDBFactory();
});

// 在所有测试结束后，清理
afterAll(() => {
  // @ts-ignore
  global.indexedDB = undefined;
});

describe('VFSStorage', () => {
  let storage: VFSStorage;
  let dbName: string;
  let testCounter = 0;

  // 定义一些测试用的 VNode
  const moduleA = 'module-a';
  const moduleB = 'module-b';

  const rootNode = new VNode('root-id', null, 'root', VNodeType.DIRECTORY, '/', moduleA);
  const file1Node = new VNode('file1-id', 'root-id', 'file1.txt', VNodeType.FILE, '/file1.txt', moduleA);
  const dir1Node = new VNode('dir1-id', 'root-id', 'dir1', VNodeType.DIRECTORY, '/dir1', moduleA);
  const file2Node = new VNode('file2-id', 'dir1-id', 'file2.js', VNodeType.FILE, '/dir1/file2.js', moduleA);
  const moduleBNode = new VNode('modB-root-id', null, 'modB', VNodeType.DIRECTORY, '/modB', moduleB);

  const allNodes = [rootNode, file1Node, dir1Node, file2Node, moduleBNode];

  // 在每个测试用例运行前执行
  beforeEach(async () => {
    dbName = `test-vfs-db-${testCounter++}`;
    storage = new VFSStorage(dbName);
    await storage.connect();
  });

  // 在每个测试用例运行后执行
  afterEach(async () => {
    storage.disconnect();
    // 清理数据库，确保测试隔离
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.deleteDatabase(dbName);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  });

  describe('Connection and Initialization', () => {
    it('should connect to the database and create object stores', () => {
      const dbInstance = storage.database.instance;
      expect(dbInstance).toBeDefined();
      expect(dbInstance.name).toBe(dbName);
      expect(dbInstance.objectStoreNames.contains(VFS_STORES.VNODES)).toBe(true);
      expect(dbInstance.objectStoreNames.contains(VFS_STORES.CONTENTS)).toBe(true);
    });

    it('should throw an error if trying to operate before connecting', async () => {
      const unconnectedStorage = new VFSStorage('unconnected-db');
      await expect(unconnectedStorage.loadVNode('any-id')).rejects.toThrow(
        'VFSStorage not connected. Call connect() first.'
      );
    });

    it('should handle disconnection properly', async () => {
      storage.disconnect();
      await expect(storage.loadVNode('any-id')).rejects.toThrow(
        'VFSStorage not connected. Call connect() first.'
      );
    });
  });

  describe('VNode Operations', () => {
    it('should save and load a VNode', async () => {
      await storage.saveVNode(rootNode);
      const loadedNode = await storage.loadVNode(rootNode.nodeId);
      
      expect(loadedNode).toBeInstanceOf(VNode);
      // VNode 实例比较，使用 toEqual 进行深度比较
      expect(loadedNode).toEqual(rootNode);
    });

    it('should return null when loading a non-existent VNode', async () => {
      const loadedNode = await storage.loadVNode('non-existent-id');
      expect(loadedNode).toBeNull();
    });

    it('should delete a VNode', async () => {
      await storage.saveVNode(file1Node);
      let loadedNode = await storage.loadVNode(file1Node.nodeId);
      expect(loadedNode).not.toBeNull();

      await storage.deleteVNode(file1Node.nodeId);
      loadedNode = await storage.loadVNode(file1Node.nodeId);
      expect(loadedNode).toBeNull();
    });

    it('should get a node ID by its path', async () => {
      await storage.saveVNode(file2Node);
      const nodeId = await storage.getNodeIdByPath('/dir1/file2.js');
      expect(nodeId).toBe(file2Node.nodeId);
    });

    it('should return null for a non-existent path', async () => {
      const nodeId = await storage.getNodeIdByPath('/non/existent/path.txt');
      expect(nodeId).toBeNull();
    });

    it('should get children of a directory', async () => {
      await Promise.all(allNodes.map(node => storage.saveVNode(node)));

      const children = await storage.getChildren(rootNode.nodeId);
      expect(children).toHaveLength(2);
      
      const childIds = children.map(c => c.nodeId).sort();
      expect(childIds).toEqual([dir1Node.nodeId, file1Node.nodeId].sort());
    });

    it('should return an empty array for a directory with no children', async () => {
        await storage.saveVNode(dir1Node); // dir1 has no children in this save
        const children = await storage.getChildren(dir1Node.nodeId);
        expect(children).toEqual([]);
    });

    it('should load multiple VNodes in a batch', async () => {
        await Promise.all([storage.saveVNode(rootNode), storage.saveVNode(file1Node)]);
        const nodesToLoad = [rootNode.nodeId, file1Node.nodeId, 'non-existent-id'];
        const loadedNodes = await storage.loadVNodes(nodesToLoad);

        expect(loadedNodes).toHaveLength(2);
        const loadedIds = loadedNodes.map(n => n.nodeId).sort();
        expect(loadedIds).toEqual([rootNode.nodeId, file1Node.nodeId].sort());
    });
  });

  describe('Content Operations', () => {
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    
    it('should save and load file content', async () => {
      const content = 'Hello, VFS!';
      const contentBuffer = encoder.encode(content).buffer;
      const contentRef = ContentStore.createContentRef(file1Node.nodeId);

      const contentData: ContentData = {
        contentRef,
        nodeId: file1Node.nodeId,
        content: contentBuffer,
        size: contentBuffer.byteLength,
        createdAt: Date.now(),
      };

      await storage.saveContent(contentData);
      const loadedContentData = await storage.loadContent(contentRef);
      
      expect(loadedContentData).not.toBeNull();
      expect(loadedContentData!.contentRef).toBe(contentRef);
      expect(decoder.decode(loadedContentData!.content as ArrayBuffer)).toBe(content);
    });

    it('should update file content', async () => {
        const initialContent = "initial";
        const updatedContent = "updated";
        const contentRef = ContentStore.createContentRef('update-test-id');
        
        const initialData: ContentData = {
            contentRef, nodeId: 'update-test-id', content: encoder.encode(initialContent).buffer, size: 0, createdAt: Date.now()
        };
        await storage.saveContent(initialData);

        const updatedData: ContentData = {
            contentRef, nodeId: 'update-test-id', content: encoder.encode(updatedContent).buffer, size: 0, createdAt: Date.now()
        };
        await storage.updateContent(updatedData);

        const loaded = await storage.loadContent(contentRef);
        expect(decoder.decode(loaded!.content as ArrayBuffer)).toBe(updatedContent);
    });

    it('should delete file content', async () => {
        const content = "to be deleted";
        const contentRef = ContentStore.createContentRef('delete-test-id');
        const data: ContentData = {
            contentRef, nodeId: 'delete-test-id', content: encoder.encode(content).buffer, size: 0, createdAt: Date.now()
        };
        await storage.saveContent(data);
        
        await storage.deleteContent(contentRef);
        const loaded = await storage.loadContent(contentRef);
        expect(loaded).toBeNull();
    });
  });

  describe('Module Operations', () => {
    beforeEach(async () => {
        // 在每个模块测试前，保存所有节点数据
        await Promise.all(allNodes.map(node => storage.saveVNode(node)));
    });

    it('should get the root VNode of a module', async () => {
        const moduleARoot = await storage.getModuleRoot(moduleA);
        expect(moduleARoot).not.toBeNull();
        expect(moduleARoot!.nodeId).toBe(rootNode.nodeId);

        const moduleBRoot = await storage.getModuleRoot(moduleB);
        expect(moduleBRoot).not.toBeNull();
        expect(moduleBRoot!.nodeId).toBe(moduleBNode.nodeId);
    });

    it('should get all nodes for a specific module', async () => {
        const moduleANodes = await storage.getModuleNodes(moduleA);
        expect(moduleANodes).toHaveLength(4);
        const moduleANodeIds = moduleANodes.map(n => n.nodeId).sort();
        expect(moduleANodeIds).toEqual([rootNode.nodeId, file1Node.nodeId, dir1Node.nodeId, file2Node.nodeId].sort());
    });

    it('should load all unique module IDs', async () => {
        const moduleIds = await storage.loadAllModules();
        expect(moduleIds).toHaveLength(2);
        expect(moduleIds.sort()).toEqual([moduleA, moduleB].sort());
    });
  });

  describe('Transaction Management', () => {
    it('should perform multiple operations within a single transaction', async () => {
        const tx = await storage.beginTransaction();
        
        try {
            // 在事务中保存一个节点
            await storage.saveVNode(file1Node, tx);
            
            // 在同一个事务中保存其内容
            const content = "transactional content";
            const contentData: ContentData = {
                contentRef: ContentStore.createContentRef(file1Node.nodeId),
                nodeId: file1Node.nodeId,
                content: new TextEncoder().encode(content).buffer,
                size: content.length,
                createdAt: Date.now()
            };
            await storage.saveContent(contentData, tx);
            
            // 提交事务
            await tx.done;
        } catch (e) {
            // 如果出错，测试失败
            expect(e).toBeUndefined();
        }

        // 验证事务外的结果
        const loadedNode = await storage.loadVNode(file1Node.nodeId);
        const loadedContent = await storage.loadContent(ContentStore.createContentRef(file1Node.nodeId));
        
        expect(loadedNode).not.toBeNull();
        expect(loadedNode!.nodeId).toBe(file1Node.nodeId);
        expect(loadedContent).not.toBeNull();
        expect(new TextDecoder().decode(loadedContent!.content as ArrayBuffer)).toBe("transactional content");
    });
  });
});
