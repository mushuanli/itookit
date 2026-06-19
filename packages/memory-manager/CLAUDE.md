# CLAUDE.md — @itookit/memory-manager

工作区顶层容器 — 粘合 VFS-UI (sidebar) + Editor + BackgroundBrain。

peerDependencies: `@itookit/common`, `@itookit/mdxeditor`, `@itookit/vfs-ui`, `@itookit/vfslib`

## Architecture

```
src/
├── core/
│   ├── MemoryManager.ts   ← 主类 (粘合 VFS-UI + Editor + Brain)
│   ├── BackgroundBrain.ts ← AI 后台处理
│   └── Layout.ts          ← DOM 布局 (sidebar + editor + resizer)
└── types.ts               ← MemoryManagerConfig
```

## MemoryManager

```typescript
class MemoryManager {
    async start(initialResourceId?: string): Promise<void>;
    async openFile(nodeId: string): Promise<void>;
    async createAndOpenFile(opts): Promise<string>;
    getActiveSessionId(): string | null;
    getVFSUIShell(): VFSUIShell;
    destroy(): void;
}
```

## Config 要点

- `customEngine` — 传入自定义 IModuleFS 实现（如 SystemVFSEngine）
- `uiOptions.fileCreation` — 透传给 VFSUIShell 的即时创建配置
- `editorConfig` — 编辑器选项（readOnly/initialMode）

详情: [初始化流程 + Config](./doc/init-and-config.md)

## Conventions

- 一个实例 = 一个工作区 Tab
- 提供 `vfs` + `moduleName` 则自动装配模块 FS
- `mentionScope: ['*']` = 全局 @mention 搜索
