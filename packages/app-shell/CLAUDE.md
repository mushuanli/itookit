# CLAUDE.md — @itookit/app-shell

应用启动引导 + 路由 + 策略装配。`initApp()` 是唯一顶层初始化函数。

peerDependencies: 所有 `@itookit/*` 包

## Architecture

```
src/
├── index.ts              ← initApp() + AppOptions/AppHandle
├── bootstrap.ts          ← initApp() 主函数
├── types.ts              ← AppOptions, AppHandle, WorkspaceConfig...
├── strategies/           ← WorkspaceStrategy 接口 + 3 种实现
│   ├── standard.ts       ← MDxEditor + VFSModuleEngine
│   ├── settings.ts       ← ISettingsWidget
│   └── chat.ts           ← LLMWorkspaceEditor + LLMSessionEngine
└── config/
    └── file-registry.ts  ← FILE_REGISTRY (文件类型→编辑器)
```

## 工作区策略

```typescript
interface WorkspaceStrategy {
    getFactory(): EditorFactory;
    getEngine?(moduleName: string): ISessionEngine;
}
```

详情: [启动流程 + 配置](./doc/bootstrap-details.md)

## Conventions

- `initApp()` 是唯一装配点 — 不要在外部模块直接装配 VFS/Harness/LLM
- `loadWorkspace()` 包含去重 — 并发加载同一工作区共享同一个 Promise
- 路由使用 `hashChange` + `popstate` + `NAVIGATION_EVENTS`
