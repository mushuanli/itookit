/**
 * @file test/core.test.ts
 * VFS Core 功能完整测试套件
 */

// 导入测试框架的函数
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
// 导入 fake-indexeddb 来模拟浏览器环境
import 'fake-indexeddb/auto';

// 导入 VFS 核心模块和类型
import { VFS,IProvider, VFSEventType, VFSErrorCode } from '../src/core/index.js';
import { VNodeType, VNode } from '../src/store/index.js';

// [新增] 辅助函数，用于解决时间戳精度问题
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// --- 测试主体 ---

describe('VFS Core Functionality', () => {
  let vfs: VFS;
  let dbName: string;

  // 在每个测试用例开始前执行
  beforeEach(async () => {
    // 使用唯一的数据库名确保测试隔离
    dbName = `test_vfs_${Date.now()}_${Math.random()}`;
    vfs = new VFS(dbName);
    await vfs.initialize();
  });

  // 在每个测试用例结束后执行
  afterEach(async () => {
    vfs.destroy();
    // 清理 IndexedDB 数据库
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(dbName);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      request.onblocked = () => {
        console.warn('Database deletion blocked. Ensure all connections are closed.');
        resolve(); // Or reject, depending on strictness
      };
    });
  });

  // 1. 基础 CRUD 和 Stat
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
      
      // [修复] 增加延迟确保时间戳更新
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

      // [修复] 修改断言方式
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

      // 验证旧路径不存在
      await expect(vfs.pathResolver.resolve(module, '/file.txt')).resolves.toBeNull();
      // 验证新路径存在且内容正确
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
      
      // 验证源文件仍然存在
      const sourceContent = await vfs.read(sourceFile.nodeId);
      expect(sourceContent).toBe('copy content');

      // 验证目标文件已创建且内容正确
      const targetContent = await vfs.read(result.targetId);
      expect(targetContent).toBe('copy content');
      
      // 验证是新节点
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
      // [修复] 修改断言方式
      await expect(vfs.createNode(options)).rejects.toHaveProperty('code', VFSErrorCode.ALREADY_EXISTS);
    });

    it('should throw NOT_FOUND when reading a non-existent node', async () => {
      // [修复] 修改断言方式
      await expect(vfs.read('non-existent-id')).rejects.toHaveProperty('code', VFSErrorCode.NOT_FOUND);
    });

    it('should throw INVALID_OPERATION when unlinking a non-empty directory without recursive flag', async () => {
      const module = 'err';
      const dir = await vfs.createNode({ module, path: '/dir', type: VNodeType.DIRECTORY });
      await vfs.createNode({ module, path: '/dir/file.txt', type: VNodeType.FILE });
      
      // [修复] 修改断言方式
      await expect(vfs.unlink(dir.nodeId)).rejects.toHaveProperty('code', VFSErrorCode.INVALID_OPERATION);
    });
  });

  // 4. Provider 系统
  describe('Provider System', () => {
    it('should run provider hooks on write and modify content/metadata', async () => {
      const mockProvider: IProvider = {
        name: 'mock-provider',
        onValidate: vi.fn().mockResolvedValue(undefined),
        onBeforeWrite: vi.fn(async (vnode, content) => `[MODIFIED] ${content}`),
        onAfterWrite: vi.fn(async (vnode, content) => ({ fromProvider: true, contentHash: 'xyz' })),
      };

      vfs.registerProvider(mockProvider);

      const file = await vfs.createNode({
        module: 'provider',
        path: '/test.txt',
        type: VNodeType.FILE,
        content: 'original'
      });
      
      // 验证钩子被调用
      expect(mockProvider.onValidate).toHaveBeenCalledTimes(1);
      expect(mockProvider.onBeforeWrite).toHaveBeenCalledTimes(1);
      expect(mockProvider.onAfterWrite).toHaveBeenCalledTimes(1);

      // 验证内容被修改
      const modifiedContent = await vfs.read(file.nodeId);
      expect(modifiedContent).toBe('[MODIFIED] original');

      // 验证元数据被添加
      const stat = await vfs.stat(file.nodeId);
      expect(stat.metadata.fromProvider).toBe(true);
      expect(stat.metadata.contentHash).toBe('xyz');
    });
  });

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
});