/**
 * @file: examples/custom-provider.js
 * 自定义 Provider 示例
 */

import { getVFSManager } from '../VFSCore.js';
import { ContentProvider } from '../src/providers/base/ContentProvider.js';

/**
 * 示例：待办事项计数 Provider
 */
class TodoCounterProvider extends ContentProvider {
    constructor(storage, eventBus) {
        super('todo-counter', {
            priority: 3,
            capabilities: ['todo-counting']
        });
        
        this.storage = storage;
        this.events = eventBus;
        this.todoRegex = /- \[([ xX])\]/g;
    }
    
    async read(vnode, options = {}) {
        const content = options.rawContent || '';
        const matches = [...content.matchAll(this.todoRegex)];
        
        const total = matches.length;
        const completed = matches.filter(m => m[1].toLowerCase() === 'x').length;
        const pending = total - completed;
        
        return {
            content: null,
            metadata: {
                todos: {
                    total,
                    completed,
                    pending,
                    completionRate: total > 0 ? (completed / total * 100).toFixed(2) + '%' : '0%'
                }
            }
        };
    }
    
    async write(vnode, content, transaction) {
        // 不修改内容，只是统计
        return {
            updatedContent: content,
            derivedData: {}
        };
    }
}

async function customProviderUsage() {
    const vfs = getVFSManager();
    
    await vfs.init();
    
    // 注册自定义 Provider
    const todoCounter = new TodoCounterProvider(vfs.storage, vfs.events);
    vfs.registerProvider(todoCounter);
    
    // 更新类型映射
    vfs.providerRegistry.mapType('todo-list', ['plain', 'todo-counter']);
    
    // 创建待办列表
    const todoList = await vfs.createFile(
        'notes',
        '/todos.md',
        `
# My Todos

- [x] Task 1
- [ ] Task 2
- [ ] Task 3
- [x] Task 4
        `.trim(),
        { contentType: 'todo-list' }
    );
    
    // 读取并查看统计
    const { metadata } = await vfs.read(todoList.id);
    
    console.log('Todo Statistics:');
    console.log('- Total:', metadata.todos.total);
    console.log('- Completed:', metadata.todos.completed);
    console.log('- Pending:', metadata.todos.pending);
    console.log('- Completion Rate:', metadata.todos.completionRate);
    
    await vfs.shutdown();
}

customProviderUsage().catch(console.error);
