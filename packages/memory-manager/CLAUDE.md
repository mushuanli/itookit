# CLAUDE.md — @itookit/memory-manager

工作区顶层容器 — 粘合 VFS-UI (sidebar) + Editor + BackgroundBrain。

peerDependencies: `@itookit/common`, `@itookit/mdxeditor`, `@itookit/vfs-ui`, `@itookit/vfslib`

## Commands

```bash
pnpm --filter @itookit/memory-manager build   # vite build
pnpm --filter @itookit/memory-manager dev     # vite dev
```

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

详情: [初始化流程 + Config](./doc/init-and-config.md)

## Conventions

- 一个实例 = 一个工作区 Tab
- 提供 `vfs` + `moduleName` 则自动创建 `VFSModuleEngine`
- `mentionScope: ['*']` = 全局 @mention 搜索
