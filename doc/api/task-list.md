 非常好的想法！这样设计可以让 TaskListPlugin 同时满足**简单用户**和**高级用户**的需求。我来设计一个完整的实现方案。

## 设计方案

### 核心思路
1. **内部处理**：插件自动修改 Markdown 源码中的复选框状态
2. **外部通知**：触发事件，让高级用户可以拦截或扩展处理
3. **多实例安全**：使用 `getScopedStore()` 存储 Markdown 源码

---

## 完整实现代码
...

## 使用示例

### 场景 1：简单用户（零配置）

```typescript
const editor = createMDxEditor({
  plugins: ['task-list'], // 自动更新 Markdown
});

editor.init(container, `
- [ ] 未完成任务
- [x] 已完成任务
`);

// 用户点击复选框后，Markdown 会自动更新
setTimeout(() => {
  const plugin = editor.getRenderer()
    .getPluginManager()
    .plugins.get('interaction:task-list')?.plugin as TaskListPlugin;
  
  console.log(plugin.getMarkdown());
  // 输出：
  // - [x] 未完成任务
  // - [x] 已完成任务
}, 1000);
```

---

### 场景 2：高级用户（自定义处理）

```typescript
const editor = createMDxEditor({
  plugins: [
    ['task-list', {
      // 自定义钩子：阻止某些任务切换
      beforeTaskToggle: async (detail) => {
        if (detail.taskText.includes('重要')) {
          const confirmed = confirm('确定要修改重要任务吗？');
          return confirmed;
        }
        return true;
      },
      
      // 切换后同步到服务器
      onTaskToggled: async (result) => {
        if (result.wasUpdated) {
          await fetch('/api/save', {
            method: 'POST',
            body: JSON.stringify({
              markdown: result.updatedMarkdown,
            }),
          });
          console.log('已同步到服务器');
        }
      },
    }],
  ],
});
```

---

### 场景 3：关闭自动更新（完全自定义）

```typescript
const editor = createMDxEditor({
  plugins: [
    ['task-list', {
      autoUpdateMarkdown: false, // 禁用自动更新
      onTaskToggled: async (result) => {
        // 自己处理更新逻辑
        const customUpdated = myCustomUpdateLogic(
          result.originalMarkdown,
          result.taskText,
          result.isChecked
        );
        
        // 保存到数据库
        await saveToDatabase(customUpdated);
      },
    }],
  ],
});
```

---

## 优势总结

| 特性 | 说明 |
|------|------|
| ✅ **零配置可用** | 开箱即用，自动更新 Markdown |
| ✅ **多实例安全** | 使用 `ScopedPersistenceStore` 和 `WeakMap` |
| ✅ **精确行号追踪** | 自动匹配任务在 Markdown 中的位置 |
| ✅ **灵活扩展** | 支持 `beforeTaskToggle` 和 `onTaskToggled` 钩子 |
| ✅ **持久化存储** | 自动保存到 VFS/Adapter/Memory |
| ✅ **高级用户友好** | 可完全接管更新逻辑 |

这样设计后，TaskListPlugin 成为一个**完整的任务管理插件**，而不仅仅是事件监听器！