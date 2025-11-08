/**
 * @file: examples/module-management.js
 * 模块管理示例
 */

import { getVFSManager } from '../src/VFSManager.js';

async function moduleManagement() {
    const vfs = getVFSManager();
    await vfs.init({ defaults: { modules: [] } });
    
    // 1. 挂载新模块
    await vfs.mount('personal-notes', {
        description: 'My personal notes',
        meta: {
            owner: 'alice',
            private: true
        }
    });
    
    await vfs.mount('work-docs', {
        description: 'Work documentation',
        meta: {
            owner: 'alice',
            private: false
        }
    });
    
    // 2. 列出所有模块
    const modules = vfs.listModules();
    console.log('Modules:', modules);
    
    // 3. 在不同模块中创建文件
    await vfs.createFile('personal-notes', '/diary.md', '# My Diary');
    await vfs.createFile('work-docs', '/project-plan.md', '# Project Plan');
    
    // 4. 获取每个模块的树
    const personalTree = await vfs.getTree('personal-notes');
    const workTree = await vfs.getTree('work-docs');
    
    console.log('Personal notes:', personalTree.length, 'files');
    console.log('Work docs:', workTree.length, 'files');
    
    // 5. 导出模块
    const exportData = await vfs.exportModule('personal-notes');
    console.log('Exported data:', JSON.stringify(exportData, null, 2));
    
    // 6. 卸载模块
    await vfs.unmount('work-docs');
    console.log('Modules after unmount:', vfs.listModules());
    
    await vfs.shutdown();
}

moduleManagement().catch(console.error);
