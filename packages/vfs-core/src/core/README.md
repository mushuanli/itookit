# VFS Core Layer

VFS 核心层，提供虚拟文件系统的核心功能和 API。

## 架构设计

### 核心组件

1. **VFS (门面类)**
   - 系统主入口，聚合所有核心组件
   - 提供统一的文件系统 API
   - 管理事务和生命周期

2. **PathResolver (路径解析器)**
   - 处理所有路径相关操作
   - 提供路径验证、标准化、解析
   - 优化路径计算性能（批量解析）

3. **ProviderRegistry (插件注册表)**
   - 管理所有 Provider 插件
   - 编排 Provider 生命周期钩子
   - 支持扩展功能

4. **EventBus (事件总线)**
   - 发布/订阅模式
   - 解耦系统组件
   - 支持事件驱动架构

## 使用示例

### 基础使用

```typescript
import { VFS } from './vfs/core';

// 初始化
const vfs = new VFS('my_vfs_db');
await vfs.initialize();

// 创建文件
const file = await vfs.createNode({
  module: 'docs',
  path: '/hello.md',
  type: VNodeType.FILE,
  content: '# Hello World',
  metadata: { tags: ['example'] }
});

// 读取文件
const content = await vfs.read(file.nodeId);
console.log(content); // "# Hello World"

// 写入文件
await vfs.write(file.nodeId, '# Updated Content');

// 删除文件
await vfs.unlink(file.nodeId);

// 清理
vfs.destroy();
```

### 注册 Provider

```typescript
import { IProvider } from './vfs/core';

const markdownProvider: IProvider = {
  name: 'markdown',
  
  async onValidate(vnode, content) {
    if (typeof content !== 'string') {
      throw new Error('Markdown content must be string');
    }
  },
  
  async onAfterWrite(vnode, content) {
    // 提取元数据
    const wordCount = content.split(/\s+/).length;
    return { wordCount };
  }
};

vfs.registerProvider(markdownProvider);
```

### 监听事件

```typescript
import { VFSEventType } from './vfs/core';

vfs.events.on(VFSEventType.NODE_CREATED, (event) => {
  console.log('Node created:', event.path);
});

vfs.events.on(VFSEventType.NODE_UPDATED, (event) => {
  console.log('Node updated:', event.path);
});
```

## API 参考

### VFS 类

#### 初始化方法

- `initialize(): Promise<void>` - 初始化 VFS
- `destroy(): void` - 销毁 VFS 实例
- `registerProvider(provider: IProvider): void` - 注册 Provider

#### 文件操作

- `createNode(options: CreateNodeOptions): Promise<VNode>` - 创建节点
- `read(vnodeOrId: VNode | string): Promise<string | ArrayBuffer>` - 读取内容
- `write(vnodeOrId: VNode | string, content: string | ArrayBuffer): Promise<VNode>` - 写入内容
- `unlink(vnodeOrId: VNode | string, options?: UnlinkOptions): Promise<UnlinkResult>` - 删除节点
- `move(vnodeOrId: VNode | string, newPath: string): Promise<VNode>` - 移动节点
- `copy(sourceId: string, targetPath: string): Promise<CopyResult>` - 复制节点
- `readdir(vnodeOrId: VNode | string): Promise<VNode[]>` - 读取目录
- `stat(vnodeOrId: VNode | string): Promise<NodeStat>` - 获取统计信息

## 性能优化

### 批量路径解析

使用 `PathResolver.resolvePaths()` 批量解析路径，避免 N+1 查询问题：

```typescript
const nodes = await vfs.storage.getAllNodes();
const pathMap = await vfs.pathResolver.resolvePaths(nodes);
```

### 事务管理

所有修改操作都自动包裹在事务中，确保原子性：

```typescript
// 自动事务管理
await vfs.write(fileId, newContent);

// 手动事务（高级用法）
const tx = await vfs.storage.beginTransaction();
try {
  await vfs.storage.saveVNode(vnode, tx);
  await vfs.storage.saveContent(content, tx);
  await tx.done;
} catch (error) {
  // 事务自动回滚
}
```

## 错误处理

所有错误都是类型化的 `VFSError`：

```typescript
try {
  await vfs.read('non-existent-id');
} catch (error) {
  if (error instanceof VFSError) {
    switch (error.code) {
      case VFSErrorCode.NOT_FOUND:
        console.log('Node not found');
        break;
      case VFSErrorCode.INVALID_PATH:
        console.log('Invalid path');
        break;
      // ... 其他错误类型
    }
  }
}
```

## 最佳实践

1. **始终使用路径解析器**：不要手动拼接路径
2. **利用事件系统**：实现松耦合的功能扩展
3. **合理使用 Provider**：将业务逻辑封装在 Provider 中
4. **批量操作优化**：处理大量节点时使用批量方法
5. **错误处理**：捕获并处理特定的错误类型
```

现在所有核心层代码都已完成！这个实现包含了：

✅ **完整的类型定义** (types.ts)
✅ **路径解析器** (PathResolver.ts) - 包含批量优化
✅ **Provider 注册表** (ProviderRegistry.ts)
✅ **事件总线** (EventBus.ts)
✅ **VFS 核心门面类** (VFS.ts) - 包含所有文件系统操作
✅ **工具函数** (utils.ts)
✅ **导出文件** (index.ts)
✅ **文档** (README.md)

核心特性：
- 完整的 CRUD 操作
- 事务管理
- Provider 插件系统
- 事件驱动架构
- 路径解析优化（批量操作）
- 统一的错误处理
- 递归操作支持（删除、复制）