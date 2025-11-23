/**
 * @file test/vfscore.test.ts
 * VFSCore 单例和高层 API 功能测试套件
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import 'fake-indexeddb/auto';

// 导入 VFSCore 单例和所有需要的类型
import {
  VFSCore,
  VFSConfig,
  VFSErrorCode,
  PlainTextMiddleware, // [修改] PlainTextProvider -> PlainTextMiddleware
  VFSEventType,
  ContentMiddleware, // [修改] ContentProvider -> ContentMiddleware
} from '../src/index.js';
import {  VNodeType,
  VNode,
  Transaction
} from '../src/store/index.js';

// --- 自定义测试 Middleware ---
// [修改] extends ContentProvider -> extends ContentMiddleware
class TestMetadataMiddleware extends ContentMiddleware {
  readonly name = 'test-metadata-provider';
  readonly priority = 10;

  async onAfterWrite(vnode: VNode, content: string | ArrayBuffer, transaction: Transaction): Promise<Record<string, any>> {
    return {
      writeTimestamp: Date.now(),
      contentType: 'test/data',
    };
  }
}

// --- 测试主体 ---

describe.sequential('VFSCore High-Level API', () => {
  let vfsCore: VFSCore;
  
  // 在每个测试用例开始前，初始化一个新的 VFSCore 实例
  beforeEach(async () => {
    (VFSCore as any).instance = null;

    const config: VFSConfig = {
      dbName: `test_vfscore_${Date.now()}_${Math.random()}`,
      // [修改] providers -> middlewares, TestMetadataProvider -> TestMetadataMiddleware
      middlewares: [TestMetadataMiddleware]
    };

    vfsCore = VFSCore.getInstance(config);
    await vfsCore.init();
  });

  // 在每个测试用例结束后，关闭并清理
  afterEach(async () => {
    if (vfsCore) {
      await vfsCore.shutdown();
    }
    (VFSCore as any).instance = null;
  });
  
  // ... [其余所有测试用例保持不变] ...
  // 复制原文件内容即可，除了上面 beforeEach 中的改动
  // ...
    // 1. 初始化和模块管理
  describe('Initialization and Module Management', () => {
    it('should initialize successfully and create a default module', () => {
      expect(vfsCore.getModule('default')).toBeDefined();
      expect(vfsCore.getAllModules()).toHaveLength(2); // default 和 __vfs_meta__
    });

    it('should mount a new module', async () => {
      const moduleInfo = await vfsCore.mount('apps', 'For applications');
      expect(moduleInfo.name).toBe('apps');
      expect(moduleInfo.description).toBe('For applications');
      expect(vfsCore.getModule('apps')).toBeDefined();
    });

    it('should throw an error when mounting an existing module', async () => {
      await expect(vfsCore.mount('default')).rejects.toHaveProperty('code', VFSErrorCode.ALREADY_EXISTS);
    });



    it('should unmount a module and remove all its data', async () => {
      await vfsCore.mount('temp');
      await vfsCore.createFile('temp', '/a.txt', 'data');
      
      const moduleInfo = vfsCore.getModule('temp')!;
      expect(moduleInfo).toBeDefined();

      await vfsCore.unmount('temp');

      expect(vfsCore.getModule('temp')).toBeUndefined();
      
      const vfs = vfsCore.getVFS();
      await expect(vfs.stat(moduleInfo.rootNodeId)).rejects.toHaveProperty('code', VFSErrorCode.NOT_FOUND);
    });
  });

  // 2. 高级文件和目录操作
  describe('High-Level File and Directory Operations', () => {
    const module = 'default';

    it('should create a file with content and metadata', async () => {
      const path = '/my-doc.txt';
      const content = 'Hello VFSCore';
      const vnode = await vfsCore.createFile(module, path, content, { author: 'test' });
      
      expect(vnode).toBeInstanceOf(VNode);
      expect(vnode.name).toBe('my-doc.txt');
      
      const readContent = await vfsCore.read(module, path);
      expect(readContent).toBe(content);

      const stat = await vfsCore.getVFS().stat(vnode.nodeId);
      expect(stat.metadata.author).toBe('test');
    });

    it('should create a directory', async () => {
      const path = '/new-folder';
      const vnode = await vfsCore.createDirectory(module, path);
      
      expect(vnode.type).toBe(VNodeType.DIRECTORY);
      
      const tree = await vfsCore.getTree(module, '/');
      const folder = tree.find(node => node.name === 'new-folder');
      expect(folder).toBeDefined();
    });

    it('should write to an existing file', async () => {
      const path = '/update.log';
      await vfsCore.createFile(module, path, 'initial entry');
      await vfsCore.write(module, path, 'updated entry');

      const content = await vfsCore.read(module, path);
      expect(content).toBe('updated entry');
    });

    it('should delete a file', async () => {
      const path = '/to-be-deleted.tmp';
      await vfsCore.createFile(module, path);
      
      await vfsCore.delete(module, path);

      await expect(vfsCore.read(module, path)).rejects.toHaveProperty('code', VFSErrorCode.NOT_FOUND);
    });

    it('should recursively delete a directory', async () => {
      await vfsCore.createDirectory(module, '/dir-to-delete');
      await vfsCore.createFile(module, '/dir-to-delete/file.txt');

      await vfsCore.delete(module, '/dir-to-delete', true);

      await expect(vfsCore.getTree(module, '/dir-to-delete')).rejects.toHaveProperty('code', VFSErrorCode.NOT_FOUND);
    });

    it('should retrieve a directory tree', async () => {
        await vfsCore.createDirectory(module, '/music');
        await vfsCore.createFile(module, '/music/song.mp3');
        const tree = await vfsCore.getTree(module, '/music');
        expect(tree).toHaveLength(1);
        expect(tree[0].name).toBe('song.mp3');
    });
  });

  // [新增] 3. 标签系统高层 API
  describe('Tagging System High-Level API', () => {
    const module = 'default';
    const filePath = '/tagged-file.md';

    beforeEach(async () => {
      await vfsCore.createFile(module, filePath, '# My Document');
    });

    it('should add and get tags for a file using its path', async () => {
      await vfsCore.addTag(module, filePath, 'draft');
      await vfsCore.addTag(module, filePath, ' project-x '); // Test trimming

      const tags = await vfsCore.getTags(module, filePath);
      expect(tags.sort()).toEqual(['draft', 'project-x']);
    });

    it('should remove a tag from a file using its path', async () => {
      await vfsCore.addTag(module, filePath, 'draft');
      await vfsCore.addTag(module, filePath, 'final');
      
      await vfsCore.removeTag(module, filePath, 'draft');

      const tags = await vfsCore.getTags(module, filePath);
      expect(tags).toEqual(['final']);
    });

    it('should find files by tag across different modules', async () => {
      await vfsCore.mount('personal');
      await vfsCore.createFile('personal', '/todo.txt', 'buy milk');
      
      await vfsCore.addTag(module, filePath, 'important');
      await vfsCore.addTag('personal', '/todo.txt', 'important');

      const nodes = await vfsCore.findByTag('important');
      expect(nodes).toHaveLength(2);
      
      const modulesFound = nodes.map(n => n.moduleId);
      expect(modulesFound).toContain('default');
      expect(modulesFound).toContain('personal');
    });
    
    it('should get a list of all unique tags in the system', async () => {
      await vfsCore.addTag(module, filePath, 'tag1');
      await vfsCore.addTag(module, filePath, 'tag2');
      await vfsCore.createFile(module, '/another.txt');
      await vfsCore.addTag(module, '/another.txt', 'tag2'); // Duplicate tag on another file
      await vfsCore.addTag(module, '/another.txt', 'tag3');

      const allTags = await vfsCore.getAllTags();
      const tagNames = allTags.map(t => t.name).sort();

      expect(tagNames).toEqual(['tag1', 'tag2', 'tag3']);
    });
  });

  // 4. Provider 集成测试
  describe('Middleware Integration', () => { // [修改] 描述文字 Provider -> Middleware
    it('should use custom middlewares defined in config', async () => {
      const vnode = await vfsCore.createFile('default', '/data.test', 'some data');
      const stat = await vfsCore.getVFS().stat(vnode.nodeId);

      expect(stat.metadata.contentType).toBe('test/data');
      expect(stat.metadata.writeTimestamp).toBeTypeOf('number');
    });
  });
  
  // 5. 导入导出功能
  describe('Import/Export Functionality', () => {
    it('should export and import a module correctly, including tags', async () => {
        const exportModuleName = 'export-test';
        await vfsCore.mount(exportModuleName, 'A module to be exported');
        await vfsCore.createDirectory(exportModuleName, '/config');
        const file1 = await vfsCore.createFile(exportModuleName, '/config/settings.json', '{"theme":"dark"}');
        await vfsCore.createFile(exportModuleName, '/readme.md', '# Hello');

        // [新增] 添加标签
        await vfsCore.addTag(exportModuleName, '/config/settings.json', 'system-config');
        await vfsCore.addTag(exportModuleName, '/readme.md', 'documentation');

        // 1. 导出模块
        const exportedData = await vfsCore.exportModule(exportModuleName);
        
        expect(exportedData.module.name).toBe(exportModuleName);

// 验证导出数据包含 tags
const configDir = exportedData.tree.children.find((child:any) => child.name === 'config');
const readmeFile = exportedData.tree.children.find((child:any) => child.name === 'readme.md');

expect(configDir).toBeDefined();
expect(readmeFile).toBeDefined();
expect(configDir!.children[0].tags).toEqual(['system-config']); // settings.json 的标签
expect(readmeFile!.tags).toEqual(['documentation']); // readme.md 的标签

        // 2. 卸载旧模块
        await vfsCore.unmount(exportModuleName);
        expect(vfsCore.getModule(exportModuleName)).toBeUndefined();
        
        // 3. 导入数据 (将会自动挂载新模块)
        await vfsCore.importModule(exportedData);
        
        // 4. 验证数据和标签是否恢复
        const newModule = vfsCore.getModule(exportModuleName);
        expect(newModule).toBeDefined();
        
        const content = await vfsCore.read(exportModuleName, '/config/settings.json');
        expect(content).toBe('{"theme":"dark"}');

        const tags = await vfsCore.getTags(exportModuleName, '/config/settings.json');
        expect(tags).toEqual(['system-config']);

        const readmeTags = await vfsCore.getTags(exportModuleName, '/readme.md');
        expect(readmeTags).toEqual(['documentation']);
    });
  });

  // 6. 事件总线访问
  describe('EventBus Access', () => {
    it('should allow subscribing to events via getEventBus', async () => {
        const eventBus = vfsCore.getEventBus();
        const handler = vi.fn();
        const unsubscribe = eventBus.on(VFSEventType.NODE_CREATED, handler);

        await vfsCore.createFile('default', '/event-listener.txt');

        expect(handler).toHaveBeenCalledOnce();
        expect(handler).toHaveBeenCalledWith(expect.objectContaining({ type: VFSEventType.NODE_CREATED }));
        
        unsubscribe();
        await vfsCore.createFile('default', '/another.txt');
        expect(handler).toHaveBeenCalledOnce();
    });
  });

  // 7. 多模块操作测试
  describe('Multi-Module Operations', () => {
    const moduleA = 'module-a';
    const moduleB = 'module-b';
    const sharedPath = '/docs/readme.txt';

    beforeEach(async () => {
      await vfsCore.mount(moduleA);
      await vfsCore.mount(moduleB);
    });

    it('should allow same-named files in different modules with different content', async () => {
      const vnodeA = await vfsCore.createFile(moduleA, sharedPath, 'Content for Module A');
      const vnodeB = await vfsCore.createFile(moduleB, sharedPath, 'Content for Module B');
      expect(vnodeA.nodeId).not.toBe(vnodeB.nodeId);
      const contentA = await vfsCore.read(moduleA, sharedPath);
      const contentB = await vfsCore.read(moduleB, sharedPath);
      expect(contentA).toBe('Content for Module A');
      expect(contentB).toBe('Content for Module B');
    });

    it('should isolate write operations between modules', async () => {
      const initialContentA = 'Initial Content for Module A';
      const initialContentB = 'Initial Content for Module B';
      const updatedContentA = 'UPDATED Content for Module A';
      await vfsCore.createFile(moduleA, sharedPath, initialContentA);
      await vfsCore.createFile(moduleB, sharedPath, initialContentB);
      await vfsCore.write(moduleA, sharedPath, updatedContentA);
      const contentA = await vfsCore.read(moduleA, sharedPath);
      expect(contentA).toBe(updatedContentA);
      const contentB = await vfsCore.read(moduleB, sharedPath);
      expect(contentB).toBe(initialContentB);
    });

    it('should isolate delete operations between modules', async () => {
      await vfsCore.createFile(moduleA, sharedPath, 'Content A');
      await vfsCore.createFile(moduleB, sharedPath, 'Content B');
      await vfsCore.delete(moduleA, sharedPath);
      await expect(vfsCore.read(moduleA, sharedPath)).rejects.toHaveProperty('code', VFSErrorCode.NOT_FOUND);
      const contentB = await vfsCore.read(moduleB, sharedPath);
      expect(contentB).toBe('Content B');
    });

    it('should resolve paths correctly for different modules', async () => {
        const vnodeA = await vfsCore.createFile(moduleA, sharedPath);
        const vnodeB = await vfsCore.createFile(moduleB, sharedPath);
        const pathResolver = vfsCore.getVFS().pathResolver;
        const resolvedIdA = await pathResolver.resolve(moduleA, sharedPath);
        const resolvedIdB = await pathResolver.resolve(moduleB, sharedPath);
        expect(resolvedIdA).toBe(vnodeA.nodeId);
        expect(resolvedIdB).toBe(vnodeB.nodeId);
        expect(resolvedIdA).not.toBe(resolvedIdB);
    });

    it('should isolate module unmounting', async () => {
      const contentForB = 'This content should survive';
      // 1. Arrange: Create files with actual content
      await vfsCore.createFile(moduleA, sharedPath, 'This content will be deleted');
      await vfsCore.createFile(moduleB, sharedPath, contentForB);

      // 2. Act: Unmount module A
      await vfsCore.unmount(moduleA);
      expect(vfsCore.getModule(moduleA)).toBeUndefined();
      expect(vfsCore.getModule(moduleB)).toBeDefined();
      const contentB = await vfsCore.read(moduleB, sharedPath);
      expect(contentB).toBe(contentForB);
    });

    it('should handle cross-module copy via composite operations', async () => {
        const sourceContent = 'This will be copied';
        await vfsCore.createFile(moduleA, '/source.txt', sourceContent);
        const contentToCopy = await vfsCore.read(moduleA, '/source.txt');
        const copiedVNode = await vfsCore.createFile(moduleB, '/target.txt', contentToCopy);
        expect(copiedVNode.moduleId).toBe(moduleB);
        const targetContent = await vfsCore.read(moduleB, '/target.txt');
        expect(targetContent).toBe(sourceContent);
        const sourceFileExists = await vfsCore.getVFS().pathResolver.resolve(moduleA, '/source.txt');
        expect(sourceFileExists).not.toBeNull();
    });
    
    it('should throw error when importing a module that conflicts with an existing name', async () => {
        await vfsCore.createFile(moduleA, '/data.json', '{"key":"value"}');
        const exportedData = await vfsCore.exportModule(moduleA);
        exportedData.module.name = moduleB;
        await expect(vfsCore.importModule(exportedData)).rejects.toHaveProperty('code', VFSErrorCode.ALREADY_EXISTS);
    });
  });
});
