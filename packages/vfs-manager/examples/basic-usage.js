/**
 * VFSManager 基本使用示例
 */

import { getVFSManager } from '../src/VFSManager.js';

async function basicUsage() {
    // 1. 获取 VFSManager 实例
    const vfs = getVFSManager();
    
    // 2. 初始化
    await vfs.init({
        defaults: {
            modules: ['notes', 'tasks']
        }
    });
    
    // 3. 创建文件
    const note = await vfs.createFile(
        'notes',
        '/getting-started.md',
        `
# Getting Started

Welcome to VFS!

## SRS Cards
{{c1::What is VFS?}} ^clz-001

## Tasks
- [ ] @me [2024-12-31] Read documentation ^task-001

## Links
See also: [[another-note-id]]
        `.trim(),
        { contentType: 'markdown' }
    );
    
    console.log('Created note:', note.id);
    
    // 4. 读取文件
    const { content, metadata } = await vfs.read(note.id);
    
    console.log('Content:', content);
    console.log('Metadata:', metadata);
    console.log('SRS Cards:', metadata.clozes?.length);
    console.log('Tasks:', metadata.tasks?.length);
    console.log('Links:', metadata.outgoingLinks?.length);
    
    // 5. 更新文件
    await vfs.write(note.id, content + '\n\n## New Section\n{{c1::New cloze}}');
    
    // 6. 获取文件树
    const tree = await vfs.getTree('notes');
    console.log('File tree:', tree);
    
    // 7. 搜索文件
    const results = await vfs.search('notes', {
        contentType: 'markdown',
        name: 'getting'
    });
    console.log('Search results:', results.length);
    
    // 8. 统计信息
    const stats = await vfs.getStats();
    console.log('System stats:', stats);
    
    // 9. 订阅事件
    const unsubscribe = vfs.on('vnode:updated', (data) => {
        console.log('Node updated:', data.vnode.id);
    });
    
    // 10. 清理
    await vfs.shutdown();
}

// 运行示例
basicUsage().catch(console.error);
