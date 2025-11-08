// @file tests/integration/providers.test.js
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { VFSCore } from '../../src/VFSCore.js';
import { VNode } from '../../src/core/VNode.js';

describe('Provider Integration', () => {
    let vfsCore;
    
    beforeEach(async () => {
        vfsCore = new VFSCore();
        await vfsCore.init({ legacyMode: false });
    });
    
    afterEach(async () => {
        await vfsCore.storage.db.disconnect();
    });
    
    describe('Markdown with all providers', () => {
        it('should process content with SRS, Tasks, Agents, and Links', async () => {
            const content = `
# Test Note

This is a test note with multiple features.

## SRS Cards
{{c1::What is VFS?}} ^clz-123
{{c1::Virtual File System}} ^clz-456

## Tasks
- [ ] @alice [2024-12-31] Complete documentation ^task-001
- [x] @bob Review code ^task-002

## AI Agents
\`\`\`agent:writer ^agent-001
prompt: Write a summary
style: technical
\`\`\`

## Links
See also: [[other-note-id]]
Embed: ![[diagram-id]]
            `.trim();
            
            const vnode = await vfsCore.vfs.createNode({
                type: 'file',
                module: 'notes',
                path: '/test.md',
                contentType: 'markdown',
                content
            });
            
            // 验证节点创建成功
            expect(vnode.id).toBeDefined();
            
            // 读取并验证元数据
            const { metadata } = await vfsCore.vfs.read(vnode.id);
            
            // 验证 SRS
            expect(metadata.clozes).toHaveLength(2);
            expect(metadata.clozes[0].id).toBe('clz-123');
            expect(metadata.totalCards).toBe(2);
            
            // 验证 Tasks
            expect(metadata.tasks).toHaveLength(2);
            expect(metadata.tasks[0].assignee).toBe('alice');
            expect(metadata.tasks[1].completed).toBe(true);
            expect(metadata.totalTasks).toBe(2);
            expect(metadata.completedTasks).toBe(1);
            
            // 验证 Agents
            expect(metadata.agents).toHaveLength(1);
            expect(metadata.agents[0].type).toBe('writer');
            expect(metadata.agents[0].id).toBe('agent-001');
            
            // 验证 Links
            expect(metadata.outgoingLinks).toHaveLength(2);
            expect(metadata.outgoingLinks[0].targetId).toBe('other-note-id');
            expect(metadata.outgoingLinks[1].type).toBe('embed');
            expect(metadata.linkCount).toBe(2);
        });
    });
    
    describe('Provider orchestration', () => {
        it('should maintain derived data consistency on updates', async () => {
            let content = '{{c1::First cloze}} ^clz-1';
            
            const vnode = await vfsCore.vfs.createNode({
                type: 'file',
                module: 'notes',
                path: '/test.md',
                contentType: 'markdown',
                content
            });
            
            // 初始状态
            let { metadata } = await vfsCore.vfs.read(vnode.id);
            expect(metadata.clozes).toHaveLength(1);
            
            // 更新：添加一个新挖空
            content = '{{c1::First cloze}} ^clz-1\n{{c1::Second cloze}} ^clz-2';
            await vfsCore.vfs.write(vnode.id, content);
            
            ({ metadata } = await vfsCore.vfs.read(vnode.id));
            expect(metadata.clozes).toHaveLength(2);
            
            // 更新：删除第一个挖空
            content = '{{c1::Second cloze}} ^clz-2';
            await vfsCore.vfs.write(vnode.id, content);
            
            ({ metadata } = await vfsCore.vfs.read(vnode.id));
            expect(metadata.clozes).toHaveLength(1);
            expect(metadata.clozes[0].id).toBe('clz-2');
        });
        
        it('should clean up all derived data on node deletion', async () => {
            const content = `
{{c1::Cloze}} ^clz-1
- [ ] Task ^task-1
[[link-target]]
            `.trim();
            
            const vnode = await vfsCore.vfs.createNode({
                type: 'file',
                module: 'notes',
                path: '/test.md',
                contentType: 'markdown',
                content
            });
            
            // 验证派生数据存在
            const { metadata } = await vfsCore.vfs.read(vnode.id);
            expect(metadata.clozes).toHaveLength(1);
            expect(metadata.tasks).toHaveLength(1);
            expect(metadata.outgoingLinks).toHaveLength(1);
            
            // 删除节点
            await vfsCore.vfs.unlink(vnode.id);
            
            // 验证派生数据被清理
            const clozes = await vfsCore.storage.db.getAllByIndex(
                'srsClozes',
                'by_nodeId',
                vnode.id
            );
            expect(clozes).toHaveLength(0);
            
            const tasks = await vfsCore.storage.db.getAllByIndex(
                'tasks',
                'by_nodeId',
                vnode.id
            );
            expect(tasks).toHaveLength(0);
            
            const links = await vfsCore.storage.db.getAllByIndex(
                'links',
                'by_sourceId',
                vnode.id
            );
            expect(links).toHaveLength(0);
        });
    });
    
    describe('Provider validation', () => {
        it('should validate SRS content', async () => {
            const invalidContent = '{{c1::}} ^clz-1'; // 空挖空
            
            const vnode = new VNode({
                type: 'file',
                module: 'notes',
                name: 'test.md',
                contentType: 'markdown',
                providers: ['srs']
            });
            
            const provider = vfsCore.registry.get('srs');
            const result = await provider.validate(vnode, invalidContent);
            
            expect(result.valid).toBe(false);
            expect(result.errors.length).toBeGreaterThan(0);
        });
        
        it('should validate Task dates', async () => {
            const invalidContent = '- [ ] Task [invalid-date]';
            
            const vnode = new VNode({
                type: 'file',
                module: 'notes',
                name: 'test.md',
                contentType: 'markdown',
                providers: ['task']
            });
            
            const provider = vfsCore.registry.get('task');
            const result = await provider.validate(vnode, invalidContent);
            
            expect(result.valid).toBe(false);
        });
    });
});
