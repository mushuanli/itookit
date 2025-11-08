// @file tests/integration/vfsmanager.test.js
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { VFSCore } from '../../src/VFSCore.js';

describe('VFSCore Integration', () => {
    let vfs;
    
    beforeEach(async () => {
        vfs = VFSCore.getInstance();
        await vfs.init({ defaults: { modules: [] } });
    });
    
    afterEach(async () => {
        await vfs.shutdown();
    });
    
    describe('Initialization', () => {
        it('should initialize successfully', () => {
            expect(vfs.initialized).toBe(true);
            expect(vfs.storage).toBeDefined();
            expect(vfs.vfs).toBeDefined();
            expect(vfs.events).toBeDefined();
        });
        
        it('should create default modules', async () => {
            const vfs2 = new VFSCore();
            await vfs2.init({
                defaults: { modules: ['notes', 'tasks'] }
            });
            
            const modules = vfs2.listModules();
            expect(modules).toContain('notes');
            expect(modules).toContain('tasks');
            
            await vfs2.shutdown();
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
            // Create
            const file = await vfs.createFile('test', '/test.md', 'Hello World');
            expect(file.id).toBeDefined();
            
            // Read
            const { content } = await vfs.read(file.id);
            expect(content).toBe('Hello World');
            
            // Update
            await vfs.write(file.id, 'Updated content');
            const { content: newContent } = await vfs.read(file.id);
            expect(newContent).toBe('Updated content');
            
            // Delete
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
            await vfs.move(file.id, '/new.md');
            
            const { content } = await vfs.read(file.id);
            expect(content).toBe('content');
        });
    });
    
    describe('Search', () => {
        beforeEach(async () => {
            await vfs.mount('test');
            await vfs.createFile('test', '/note1.md', 'content', { contentType: 'markdown' });
            await vfs.createFile('test', '/note2.md', 'content', { contentType: 'markdown' });
            await vfs.createFile('test', '/task.md', 'content', { contentType: 'task' });
        });
        
        it('should search by content type', async () => {
            const results = await vfs.search('test', { contentType: 'markdown' });
            expect(results.length).toBeGreaterThanOrEqual(2);
        });
        
        it('should search by name', async () => {
            const results = await vfs.search('test', { name: 'note' });
            expect(results.length).toBeGreaterThanOrEqual(2);
        });
    });
    
    describe('Statistics', () => {
        beforeEach(async () => {
            await vfs.mount('test');
            await vfs.createDirectory('test', '/folder');
            await vfs.createFile('test', '/file.md', 'content');
        });
        
        it('should get system stats', async () => {
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
            expect(data.nodes.length).toBeGreaterThan(0);
        });
        
        it('should import module', async () => {
            const data = await vfs.exportModule('test');
            
            await vfs.unmount('test');
            await vfs.importModule(data);
            
            const tree = await vfs.getTree('test');
            expect(tree.length).toBeGreaterThan(0);
        });
    });
});
