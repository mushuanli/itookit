// @file tests/integration/vfsmanager.test.js
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { VFSCore } from '../../src/VFSCore.js';

describe('VFSCore Integration', () => {
    let vfs;
    const dbNamePrefix = `vfs-manager-test-${Date.now()}`;
    let testCounter = 0;

    beforeEach(async () => {
        const dbName = `${dbNamePrefix}-${testCounter++}`;
        vfs = new VFSCore();
        // Initialize without default modules; tests should be explicit.
        await vfs.init({ 
            storage: { dbName },
            defaults: { modules: [] }
        });
    });

    afterEach(async () => {
        if (!vfs || !vfs.initialized) return;

        const dbName = vfs.storage.db.dbName;
        await vfs.shutdown();

        // Ensure the database is completely deleted after each test
        await new Promise((resolve, reject) => {
            const deleteRequest = indexedDB.deleteDatabase(dbName);
            deleteRequest.onsuccess = () => resolve();
            deleteRequest.onerror = (e) => reject(new Error(`Failed to delete DB: ${(/** @type {IDBRequest} */ (e.target)).error}`));
            deleteRequest.onblocked = () => {
                console.warn(`Database ${dbName} deletion blocked. Forcing reload.`);
                // In a jsdom environment, this can help unblock connections.
                location.reload();
            };
        });
    });

    describe('Initialization', () => {
        it('should initialize successfully', () => {
            expect(vfs.initialized).toBe(true);
            expect(vfs.storage).toBeDefined();
            expect(vfs.vfs).toBeDefined();
            expect(vfs.events).toBeDefined();
        });

        it.only('should create default modules', async () => {
            // This test needs its own instance to check default behavior
            const vfs2 = new VFSCore();
            const dbName = `${dbNamePrefix}-defaults-${testCounter++}`;
            
            try {
                await vfs2.init({
                    storage: { dbName },
                    defaults: { modules: ['notes', 'tasks'] },
                });
        
                const modules = vfs2.listModules();
                console.log('Created modules:', modules); // 添加调试日志
        
                expect(modules).toContain('notes');
                expect(modules).toContain('tasks');
            } finally {
                if (vfs2.initialized) {
                    await vfs2.shutdown();
                }
                await new Promise(res => indexedDB.deleteDatabase(dbName).onsuccess = res);
            }
        });
    });

    describe('Module Management', () => {
        it('should mount and unmount modules', async () => {
            await vfs.mount('test-module');
            expect(vfs.listModules()).toContain('test-module');
            
            await vfs.unmount('test-module');
            expect(vfs.listModules()).not.toContain('test-module');
        });

        it('should get module info', async () => {
            const moduleInfo = await vfs.mount('test', {
                description: 'Test module'
            });
            
            expect(moduleInfo.name).toBe('test');
            expect(moduleInfo.description).toBe('Test module');
            expect(moduleInfo.rootId).toBeDefined();
        });
    });

    describe('File Operations', () => {
        beforeEach(async () => {
            await vfs.mount('test');
        });

        it('should create, read, update, and delete files', async () => {
            const file = await vfs.createFile('test', '/test.md', 'Hello World');
            expect(file.id).toBeDefined();
            
            const { content } = await vfs.read(file.id);
            expect(content).toBe('Hello World');
            
            await vfs.write(file.id, 'Updated content');
            const { content: newContent } = await vfs.read(file.id);
            expect(newContent).toBe('Updated content');
            
            await vfs.unlink(file.id);
            await expect(vfs.read(file.id)).rejects.toThrow();
        });

        it('should handle directories', async () => {
            const dir = await vfs.createDirectory('test', '/folder');
            const file = await vfs.createFile('test', '/folder/file.md', 'content');
            
            const children = await vfs.readdir(dir.id);
            expect(children).toHaveLength(1);
            expect(children[0].id).toBe(file.id);
        });

        it('should move files', async () => {
            const file = await vfs.createFile('test', '/old.md', 'content');
            const oldId = file.id;

            const movedFile = await vfs.move(file.id, '/new.md');
            expect(movedFile.name).toBe('new.md');
            expect(movedFile.id).toBe(oldId);
            
            const { content } = await vfs.read(movedFile.id);
            expect(content).toBe('content');
            await expect(vfs.storage.getNodeIdByPath('test', '/old.md')).resolves.toBeNull();
        });
    });

    describe('Search', () => {
        beforeEach(async () => {
            await vfs.mount('test');
            await vfs.createFile('test', '/note1.md', 'content', { contentType: 'markdown' });
            await vfs.createFile('test', '/note2.txt', 'content', { contentType: 'plain' });
            await vfs.createFile('test', '/task.md', 'content', { contentType: 'task' });
        });

        it('should search by content type', async () => {
            const results = await vfs.search('test', { contentType: 'markdown' });
            expect(results).toHaveLength(1);
            expect(results[0].name).toBe('note1.md');
        });

        it('should search by name', async () => {
            const results = await vfs.search('test', { name: 'note' });
            expect(results).toHaveLength(2); // note1.md and note2.txt
        });
    });

    describe('Statistics', () => {
        beforeEach(async () => {
            await vfs.mount('test');
        });

        it('should get system stats', async () => {
            await vfs.createDirectory('test', '/folder');
            await vfs.createFile('test', '/file.md', 'content');
            
            const stats = await vfs.getStats();
            
            expect(stats.totalNodes).toBeGreaterThan(0);
            expect(stats.modules.test).toBeDefined();
            expect(stats.modules.test.files).toBe(1);
            expect(stats.modules.test.directories).toBe(2); // root + folder
        });

        it('should get node stats', async () => {
            const file = await vfs.createFile(
                'test',
                '/test.md',
                '{{c1::Test}} ^clz-1'
            );
            
            const stats = await vfs.stat(file.id);
            expect(stats.providers.srs).toBeDefined();
        });
    });

    describe('Export/Import', () => {
        beforeEach(async () => {
            await vfs.mount('test');
            await vfs.createFile('test', '/file1.md', 'content 1');
            await vfs.createFile('test', '/file2.md', 'content 2');
        });

        it('should export module', async () => {
            const data = await vfs.exportModule('test');
            
            expect(data.module).toBeDefined();
            // Root node + 2 files
            expect(data.nodes.length).toBe(3); 
        });

        it('should import module', async () => {
            const data = await vfs.exportModule('test');
            
            await vfs.unmount('test');
            await vfs.importModule(data);
            
            const tree = await vfs.getTree('test');
            // Root has 2 children
            expect(tree[0].children).toHaveLength(2);
        });
    });
});