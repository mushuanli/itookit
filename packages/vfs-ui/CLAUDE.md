# CLAUDE.md — @itookit/vfs-ui

文件树 UI — `VFSUIShell`、`VFSService`、mention 提供者、文件类型注册。

## Commands

```bash
pnpm --filter @itookit/vfs-ui build        # vite build
pnpm --filter @itookit/vfs-ui dev          # vite dev
pnpm --filter @itookit/vfs-ui test         # vitest
```

## Architecture

```
src/
├── shell/          ← VFSUIShell (ISessionUI), Assembler (DI)
├── services/       ← VFSService, EngineAdapter, NodeMapper, FileTypeRegistry
├── ui/             ← NodeList, FileOutline, MoveToModal, items/
├── contracts/      ← VFSNodeUI, VFSUIState, UISettings, Ports
├── commands/       ← File/Bulk/Navigation CommandHandler
└── mention/        ← FileMentionSource, createVFSMentionProviders
```

详情: [组件 + Options](./doc/components.md)

## Conventions

- `createVFSUI(options, engine)` — 工厂函数，返回 `ISessionUI`
- `connectEditorLifecycle` — 连接 VFS-UI 和编辑器生命周期
- 状态管理使用 `immer` 进行不可变更新
- 所有 UI 字符串通过 `t()` 导入
