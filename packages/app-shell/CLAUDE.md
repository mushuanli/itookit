# CLAUDE.md — @itookit/app-shell

应用启动引导 + 路由 + 策略装配。`initApp()` 是唯一顶层初始化函数。

peerDependencies: 所有 `@itookit/*` 包

## Architecture

```
src/
├── index.ts              ← initApp() + AppOptions/AppHandle
├── bootstrap.ts          ← initApp() 主函数
├── types.ts              ← AppOptions, AppHandle, WorkspaceConfig...
├── strategies/           ← 3 种 WorkspaceStrategy 实现 (单文件)
│   ├── StandardWorkspaceStrategy  ← MDxEditor + IModuleFS
│   ├── SettingsWorkspaceStrategy   ← settings factory
│   └── ChatWorkspaceStrategy      ← LLMWorkspaceEditor + ChatEngine
└── config/
    └── file-registry.ts  ← FILE_REGISTRY (文件类型→编辑器)
```

## 工作区策略

```typescript
interface WorkspaceStrategy {
    getFactory(): EditorFactory;
    getEngine?(moduleName: string): IModuleFS | IChatEngine;
}
```

## WorkspaceConfig 速查

| 关键字段 | 说明 |
|---|---|
| `type` | `'standard'` / `'settings'` / `'chat'` / `'agent'` / `'skills'` |
| `fileCreation` | 即时创建文件配置 (label/title/content/startupFileName) |
| `aiEnabled` | chat workspace 是否启用 AI 右键菜单 |
| `showFileExtensions` | 外部文件系统挂载设为 true |

详情: [启动流程 + 配置](./doc/bootstrap-details.md)

## Conventions

- `initApp()` 是唯一装配点 — 不要在外部模块直接装配 VFS/Harness/LLM
- `loadWorkspace()` 包含去重 — 并发加载同一工作区共享同一个 Promise
- 路由使用 `hashChange` + `popstate` + `NAVIGATION_EVENTS`
