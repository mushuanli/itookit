/**
 * @file test/core.test.ts
 * VFS Core 功能完整测试套件
 */

// 导入测试框架的函数
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
// 导入 fake-indexeddb 来模拟浏览器环境
import 'fake-indexeddb/auto';

// 导入 VFS 核心模块和类型
import {
  VFS,
  IVFSMiddleware, // [修改] IProvider -> IVFSMiddleware
  VFSEventType,
  VFSErrorCode,
  MiddlewareRegistry, // [修改] ProviderRegistry -> MiddlewareRegistry
  EventBus,
} from '../src/index.js';
import { VFSStorage, VNodeType, VNode } from '../src/store/index.js';

// 辅助函数，用于解决时间戳精度问题
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// --- 测试主体 ---

describe('VFS Core Functionality', () => {
  let vfs: VFS;
  let dbName: string;
  
  let storage: VFSStorage;
  let middlewares: MiddlewareRegistry; // [修改] 变量名和类型
  let events: EventBus;

  // 在每个测试用例开始前执行
  beforeEach(async () => {
    // 使用唯一的数据库名确保测试隔离
    dbName = `test_vfs_${Date.now()}_${Math.random()}`;

    storage = new VFSStorage(dbName);
    middlewares = new MiddlewareRegistry(); // [修改] 实例化 MiddlewareRegistry
    events = new EventBus();

    // [修改] 传入 middlewares
    vfs = new VFS(storage, middlewares, events);
    
    await vfs.initialize();
  });

  // 在每个测试用例结束后执行
  afterEach(async () => {
    // [修改] 增加非空检查，防止 beforeEach 失败导致此处报错
    if (vfs) {
        vfs.destroy();
    }
    // 清理 IndexedDB 数据库
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(dbName);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      request.onblocked = () => {
        console.warn('Database deletion blocked. Ensure all connections are closed.');
        resolve();
      };
    });
  });

  // ... [前面 1-3 部分测试代码保持不变] ...
  // 1. 基础 CRUD & Stat Operations
  describe('Basic CRUD & Stat Operations', () => {
    it('should create a file node correctly', async () => {
      const module = 'test';
      const path = '/hello.txt';
      const content = 'world';

      const vnode = await vfs.createNode({
        module,
        path,
        type: VNodeType.FILE,
        content,
      });

      expect(vnode).toBeInstanceOf(VNode);
      expect(vnode.name).toBe('hello.txt');
      expect(vnode.moduleId).toBe(module);
      expect(vnode.path).toBe(`/${module}${path}`);
      expect(vnode.size).toBe(content.length);

      // 使用 stat 验证
      const stat = await vfs.stat(vnode.nodeId);
      expect(stat.name).toBe('hello.txt');
      expect(stat.path).toBe(`/${module}${path}`);
    });

    it('should create a directory node', async () => {
      const vnode = await vfs.createNode({
        module: 'docs',
        path: '/guides',
        type: VNodeType.DIRECTORY,
      });

      expect(vnode.type).toBe(VNodeType.DIRECTORY);
      expect(vnode.name).toBe('guides');
      expect(vnode.size).toBe(0);
    });

    it('should read content from a file', async () => {
      const file = await vfs.createNode({
        module: 'test',
        path: '/read-me.txt',
        type: VNodeType.FILE,
        content: 'initial content',
      });

      const content = await vfs.read(file.nodeId);
      expect(content).toBe('initial content');
    });

    it('should write new content to a file', async () => {
      const file = await vfs.createNode({
        module: 'test',
        path: '/write-me.txt',
        type: VNodeType.FILE,
        content: 'old',
      });
      
      await sleep(5);

      await vfs.write(file.nodeId, 'new content');
      const updatedContent = await vfs.read(file.nodeId);
      expect(updatedContent).toBe('new content');

      const stat = await vfs.stat(file.nodeId);
      expect(stat.size).toBe('new content'.length);
      expect(stat.modifiedAt.getTime()).toBeGreaterThan(stat.createdAt.getTime());
    });

    it('should unlink (delete) a file', async () => {
      const file = await vfs.createNode({
        module: 'test',
        path: '/to-delete.txt',
        type: VNodeType.FILE,
      });
      
      const result = await vfs.unlink(file.nodeId);
      expect(result.removedNodeId).toBe(file.nodeId);
      expect(result.allRemovedIds).toContain(file.nodeId);

      await expect(vfs.stat(file.nodeId)).rejects.toHaveProperty('code', VFSErrorCode.NOT_FOUND);
    });
  });

  // 2. 目录和文件结构操作
  describe('Directory and Structure Operations', () => {
    it('should list children of a directory using readdir', async () => {
      await vfs.createNode({ module: 'fs', path: '/root', type: VNodeType.DIRECTORY });
      await vfs.createNode({ module: 'fs', path: '/root/file1.txt', type: VNodeType.FILE });
      await vfs.createNode({ module: 'fs', path: '/root/subdir', type: VNodeType.DIRECTORY });

      const rootNodeId = (await vfs.pathResolver.resolve('fs', '/root'))!;
      const children = await vfs.readdir(rootNodeId);

      expect(children).toHaveLength(2);
      const names = children.map(c => c.name).sort();
      expect(names).toEqual(['file1.txt', 'subdir']);
    });

    it('should move a file to a new location', async () => {
      const module = 'fs';
      await vfs.createNode({ module, path: '/dir', type: VNodeType.DIRECTORY });
      const file = await vfs.createNode({
        module,
        path: '/file.txt',
        type: VNodeType.FILE,
        content: 'move me',
      });

      const newPath = '/dir/moved.txt';
      const movedNode = await vfs.move(file.nodeId, newPath);
      
      expect(movedNode.name).toBe('moved.txt');
      expect(movedNode.path).toBe(`/${module}${newPath}`);

      await expect(vfs.pathResolver.resolve(module, '/file.txt')).resolves.toBeNull();
      const newContent = await vfs.read(movedNode.nodeId);
      expect(newContent).toBe('move me');
    });

    it('should copy a file to a new location', async () => {
      const module = 'fs';
      const sourceFile = await vfs.createNode({
        module,
        path: '/source.txt',
        type: VNodeType.FILE,
        content: 'copy content',
      });
      const targetPath = '/copy.txt';

      const result = await vfs.copy(sourceFile.nodeId, targetPath);
      
      const sourceContent = await vfs.read(sourceFile.nodeId);
      expect(sourceContent).toBe('copy content');

      const targetContent = await vfs.read(result.targetId);
      expect(targetContent).toBe('copy content');
      
      expect(result.targetId).not.toBe(sourceFile.nodeId);
    });

    it('should recursively unlink a directory', async () => {
      const module = 'fs';
      await vfs.createNode({ module, path: '/deep', type: VNodeType.DIRECTORY });
      await vfs.createNode({ module, path: '/deep/file.txt', type: VNodeType.FILE });

      const dirId = (await vfs.pathResolver.resolve(module, '/deep'))!;
      const result = await vfs.unlink(dirId, { recursive: true });

      expect(result.allRemovedIds).toHaveLength(2);
      await expect(vfs.stat(dirId)).rejects.toHaveProperty('code', VFSErrorCode.NOT_FOUND);
    });
  });

  // 3. 错误处理
  describe('Error Handling', () => {
    it('should throw ALREADY_EXISTS when creating a node at an existing path', async () => {
      const options = { module: 'err', path: '/test.txt', type: VNodeType.FILE as VNodeType };
      await vfs.createNode(options);
      await expect(vfs.createNode(options)).rejects.toHaveProperty('code', VFSErrorCode.ALREADY_EXISTS);
    });

    it('should throw NOT_FOUND when reading a non-existent node', async () => {
      await expect(vfs.read('non-existent-id')).rejects.toHaveProperty('code', VFSErrorCode.NOT_FOUND);
    });

    it('should throw INVALID_OPERATION when unlinking a non-empty directory without recursive flag', async () => {
      const module = 'err';
      const dir = await vfs.createNode({ module, path: '/dir', type: VNodeType.DIRECTORY });
      await vfs.createNode({ module, path: '/dir/file.txt', type: VNodeType.FILE });
      
      await expect(vfs.unlink(dir.nodeId)).rejects.toHaveProperty('code', VFSErrorCode.INVALID_OPERATION);
    });
  });

  // 4. Middleware 系统 (原 Provider System)
  describe('Middleware System', () => { // [修改] 描述文字
    it('should run middleware hooks on write and modify content/metadata', async () => {
      // [修改] 接口名 IProvider -> IVFSMiddleware
      const mockMiddleware: IVFSMiddleware = {
        name: 'mock-middleware',
        // [注意] 这里的 mock 实现依然兼容，虽然类型定义中有 transaction 参数
        onValidate: vi.fn().mockResolvedValue(undefined),
        onBeforeWrite: vi.fn(async (vnode, content) => `[MODIFIED] ${content}`),
        onAfterWrite: vi.fn(async (vnode, content) => ({ fromProvider: true, contentHash: 'xyz' })),
      };

      // [修改] registerProvider -> registerMiddleware
      vfs.registerMiddleware(mockMiddleware);

      const file = await vfs.createNode({
        module: 'provider',
        path: '/test.txt',
        type: VNodeType.FILE,
        content: 'original'
      });
      
      expect(mockMiddleware.onValidate).toHaveBeenCalledTimes(1);
      expect(mockMiddleware.onBeforeWrite).toHaveBeenCalledTimes(1);
      expect(mockMiddleware.onAfterWrite).toHaveBeenCalledTimes(1);

      const modifiedContent = await vfs.read(file.nodeId);
      expect(modifiedContent).toBe('[MODIFIED] original');

      const stat = await vfs.stat(file.nodeId);
      expect(stat.metadata.fromProvider).toBe(true);
      expect(stat.metadata.contentHash).toBe('xyz');
    });
  });

  // ... [Event Bus 和 Tagging System 测试代码保持不变] ...
  // 5. 事件总线
  describe('Event Bus', () => {
    it('should emit a NODE_CREATED event when a node is created', async () => {
      const eventHandler = vi.fn();
      vfs.events.on(VFSEventType.NODE_CREATED, eventHandler);

      const file = await vfs.createNode({
        module: 'events',
        path: '/event-test.txt',
        type: VNodeType.FILE
      });

      expect(eventHandler).toHaveBeenCalledTimes(1);
      expect(eventHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: VFSEventType.NODE_CREATED,
          nodeId: file.nodeId,
          path: file.path,
        })
      );
    });

    it('should emit NODE_DELETED event on unlink', async () => {
      const eventHandler = vi.fn();
      vfs.events.on(VFSEventType.NODE_DELETED, eventHandler);

      const file = await vfs.createNode({
        module: 'events',
        path: '/delete-event.txt',
        type: VNodeType.FILE
      });

      await vfs.unlink(file.nodeId);

      expect(eventHandler).toHaveBeenCalledTimes(1);
      expect(eventHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: VFSEventType.NODE_DELETED,
          nodeId: file.nodeId,
        })
      );
    });
  });
  
  // 6. 标签系统
  describe('Tagging System', () => {
    let fileNode: VNode;
    let dirNode: VNode;
    const module = 'tags';

    beforeEach(async () => {
        fileNode = await vfs.createNode({ module, path: '/document.txt', type: VNodeType.FILE });
        dirNode = await vfs.createNode({ module, path: '/photos', type: VNodeType.DIRECTORY });
    });

    it('should add a tag to a file', async () => {
        await vfs.addTag(fileNode.nodeId, 'important');
        const tags = await vfs.getTags(fileNode.nodeId);
        expect(tags).toEqual(['important']);
    });

    it('should add multiple tags to a directory', async () => {
        await vfs.addTag(dirNode.nodeId, 'personal');
        await vfs.addTag(dirNode.nodeId, 'archive');
        const tags = await vfs.getTags(dirNode.nodeId);
        expect(tags).toHaveLength(2);
        expect(tags.sort()).toEqual(['archive', 'personal']);
    });

    it('should not add a duplicate tag', async () => {
        await vfs.addTag(fileNode.nodeId, 'draft');
        await vfs.addTag(fileNode.nodeId, 'draft'); // Add again
        const tags = await vfs.getTags(fileNode.nodeId);
        expect(tags).toEqual(['draft']);
    });

    it('should remove a tag from a node', async () => {
        await vfs.addTag(fileNode.nodeId, 'important');
        await vfs.addTag(fileNode.nodeId, 'urgent');
        
        await vfs.removeTag(fileNode.nodeId, 'important');
        
        const tags = await vfs.getTags(fileNode.nodeId);
        expect(tags).toEqual(['urgent']);
    });

    it('should handle removing a non-existent tag gracefully', async () => {
        await vfs.addTag(fileNode.nodeId, 'important');
        await vfs.removeTag(fileNode.nodeId, 'non-existent-tag');
        const tags = await vfs.getTags(fileNode.nodeId);
        expect(tags).toEqual(['important']);
    });
    
    it('should find nodes by a specific tag', async () => {
        await vfs.addTag(fileNode.nodeId, 'work');
        await vfs.addTag(dirNode.nodeId, 'personal');
        
        const anotherFile = await vfs.createNode({ module, path: '/report.pdf', type: VNodeType.FILE });
        await vfs.addTag(anotherFile.nodeId, 'work');

        const workNodes = await vfs.findByTag('work');
        expect(workNodes).toHaveLength(2);
        const workNodeIds = workNodes.map(n => n.nodeId).sort();
        expect(workNodeIds).toEqual([fileNode.nodeId, anotherFile.nodeId].sort());

        const personalNodes = await vfs.findByTag('personal');
        expect(personalNodes).toHaveLength(1);
        expect(personalNodes[0].nodeId).toBe(dirNode.nodeId);
    });

    it('should return an empty array when finding by a non-existent tag', async () => {
        const nodes = await vfs.findByTag('non-existent-tag');
        expect(nodes).toEqual([]);
    });

    it('should remove all tag associations when a node is unlinked', async () => {
        await vfs.addTag(fileNode.nodeId, 'temp');
        await vfs.addTag(fileNode.nodeId, 'deletable');

        // Check that findByTag works before deletion
        let tempNodes = await vfs.findByTag('temp');
        expect(tempNodes).toHaveLength(1);

        // Unlink the node
        await vfs.unlink(fileNode.nodeId);

        // Check that findByTag no longer finds the node
        tempNodes = await vfs.findByTag('temp');
        expect(tempNodes).toHaveLength(0);
    });

    it('should persist tags when a node is copied', async () => {
        await vfs.addTag(fileNode.nodeId, 'template');
        await vfs.addTag(fileNode.nodeId, 'report');

        const result = await vfs.copy(fileNode.nodeId, '/document_copy.txt');
        const copiedNode = await storage.loadVNode(result.targetId);
        
        expect(copiedNode!.tags.sort()).toEqual(['report', 'template']);
    });
  });
});