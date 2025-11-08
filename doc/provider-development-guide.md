# Provider 开发指南

## 概述

ContentProvider 是 VFS 的插件系统核心，允许开发者扩展文件内容的处理能力。

## 创建自定义 Provider

### 1. 继承 ContentProvider 基类

```javascript
import { ContentProvider } from './vfsManager/providers/base/ContentProvider.js';

class MyCustomProvider extends ContentProvider {
    constructor(storage, eventBus) {
        super('my-custom', {
            priority: 5,  // 执行优先级
            capabilities: ['custom-feature']
        });
        
        this.storage = storage;
        this.events = eventBus;
    }
}
```

### 2. 实现必需方法

#### read()
读取并增强内容元数据。

```javascript
async read(vnode, options = {}) {
    return {
        content: null,  // null 表示不修改原始内容
        metadata: {
            // 自定义元数据
        }
    };
}
```

#### write()
处理内容写入，解析并保存派生数据。

```javascript
async write(vnode, content, transaction) {
    // 1. 解析内容
    // 2. 保存派生数据
    // 3. 返回更新后的内容
    
    return {
        updatedContent: content,
        derivedData: {
            // 派生数据
        }
    };
}
```

### 3. 注册 Provider

```javascript
const vfsManager = await VFSManager.getInstance();
await vfsManager.init();

const myProvider = new MyCustomProvider(
    vfsManager.storage,
    vfsManager.events
);

vfsManager.registerProvider(myProvider);
```

## 最佳实践

1. **使用事务**：所有数据库操作都应在事务中进行
2. **发布事件**：在数据变更时发布事件通知
3. **验证输入**：实现 validate() 方法
4. **清理资源**：实现 cleanup() 方法
5. **提供统计**：实现 getStats() 方法

## 示例：创建标签 Provider

```javascript
class TagProvider extends ContentProvider {
    constructor(storage, eventBus) {
        super('tag', { priority: 4 });
        this.storage = storage;
        this.events = eventBus;
        this.tagRegex = /#([\\w-]+)/g;
    }
    
    async write(vnode, content, transaction) {
        const tags = [];
        let match;
        
        while ((match = this.tagRegex.exec(content)) !== null) {
            tags.push(match[1]);
        }
        
        // 保存标签到数据库...
        
        return {
            updatedContent: content,
            derivedData: { tags }
        };
    }
}
```
