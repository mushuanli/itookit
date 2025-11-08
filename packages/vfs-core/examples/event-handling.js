/**
 * @file examples/event-handling.js
 * 事件处理示例
 */

import { getVFSManager } from '../src/VFSCore.js';

async function eventHandling() {
    const vfs = getVFSManager();
    await vfs.init();
    
    // 1. 监听节点创建
    vfs.on('vnode:created', ({ vnode, derivedData }) => {
        console.log(`[EVENT] Node created: ${vnode.id}`);
        console.log(`  - Type: ${vnode.type}`);
        console.log(`  - Content Type: ${vnode.contentType}`);
        console.log(`  - Derived Data:`, derivedData);
    });
    
    // 2. 监听节点更新
    vfs.on('vnode:updated', ({ vnode, derivedData }) => {
        console.log(`[EVENT] Node updated: ${vnode.id}`);
        console.log(`  - Modified At: ${vnode.meta.modifiedAt}`);
    });
    
    // 3. 监听节点删除
    vfs.on('vnode:deleted', ({ vnode, deletedIds }) => {
        console.log(`[EVENT] Node deleted: ${vnode.id}`);
        console.log(`  - Total deleted: ${deletedIds.length}`);
    });
    
    // 4. 监听 SRS 卡片更新
    vfs.on('srs:cards-updated', ({ nodeId, added, updated, removed }) => {
        console.log(`[EVENT] SRS cards updated in ${nodeId}`);
        console.log(`  - Added: ${added}, Updated: ${updated}, Removed: ${removed}`);
    });
    
    // 5. 监听任务更新
    vfs.on('tasks:updated', ({ nodeId, added, updated, removed }) => {
        console.log(`[EVENT] Tasks updated in ${nodeId}`);
    });
    
    // 6. 监听系统就绪
    vfs.once('vfs:ready', ({ modules, providers }) => {
        console.log('[EVENT] VFS ready!');
        console.log(`  - Modules: ${modules.join(', ')}`);
        console.log(`  - Providers: ${providers.join(', ')}`);
    });
    
    // 触发一些事件
    const note = await vfs.createFile('notes', '/test.md', '{{c1::Test}} ^clz-1');
    await vfs.write(note.id, '{{c1::Test}} ^clz-1\n{{c1::New}} ^clz-2');
    await vfs.unlink(note.id);
    
    await vfs.shutdown();
}

eventHandling().catch(console.error);
