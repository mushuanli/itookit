# @itookit/app-shell

应用启动引导 + UI 路由 + UI 装配。`initApp()` 是唯一顶层初始化函数。
平台无关的 Session/Kernel 组合位于 `@itookit/app-core`（直接依赖）；app-shell 依赖它并只保留 UI/路由/编辑器装配。

peerDependencies: `@itookit/{app-settings,common,device-llm,llm-session,durable-kernel,kernel-adapters,mdxeditor,vfs-ui,vfs-core,ui-common}`

## Architecture

```
src/
├── index.ts              ← 导出 initApp() + AppOptions/AppHandle 等类型
├── bootstrap.ts          ← initApp() 主函数 + 编辑器工厂表 (factories / editorFactoryMap)
├── ThemeService.ts       ← 主题管理 (data-theme attribute + system/os 检测)
├── types.ts              ← AppOptions, AppHandle, WorkspaceConfig, AppKernelPlatform, AppUI
├── workspaces/
│   └── index.ts          ← 预定义 WorkspaceConfig 常量 (WS_SETTINGS/WS_CHAT/WS_AGENTS/WS_SKILLS/WS_FLOWS…)
├── core/
│   ├── Workbench.ts          ← 通用工作区控制器
│   ├── SessionWorkbench.ts   ← Session 侧栏 + 路由 + 文件上下文生命周期
│   └── WorkspaceController.ts
├── files/                ← 兼容 re-export（实现位于 @itookit/app-core；mount-dialog.ts 为本包实现）
│   ├── session-files.ts / session-browser.ts / session-route.ts
│   ├── directory-mounts.ts / session-attachments.ts / session-process-context.ts
│   └── tool-context.ts / workspace-paths.ts / unavailable-directory.ts / mount-dialog.ts
├── kernel/
│   └── privileged-command-service.ts
├── config/               ← file-registry.ts (FILE_REGISTRY) + templates.ts
└── styles/workspace.css
```

## 工作区策略

不再有 `WorkspaceStrategy` 类；`bootstrap.ts` 用 `EditorFactory` 表按 `WorkspaceConfig.type` 选择编辑器：

```typescript
// bootstrap.ts
const factories: Record<string, EditorFactory> = {
    standard: defaultEditorFactory, agent: defaultEditorFactory,
    settings: settingsFactory, chat: llmFactory, skills: skillsFactory, flows: flowsFactory,
};
const strategyType = wsConfig.type ?? 'standard';
const factory = factories[strategyType] ?? defaultEditorFactory;
```

`editorFactoryMap` 另行把 `FILE_REGISTRY` 的 `editorType`（`'agent'` / `'flow'`）映射到对应编辑器工厂。

## WorkspaceConfig 速查

| 关键字段 | 说明 |
|---|---|
| `type` | `'standard'` / `'settings'` / `'chat'` / `'agent'` / `'skills'` / `'flows'` |
| `fileCreation` | 即时创建文件配置 (label/title/content/startupFileName) |
| `aiEnabled` | chat workspace 是否启用 AI 右键菜单 |
| `showFileExtensions` | 外部文件系统挂载设为 true |

详情: [启动流程 + 配置](./doc/bootstrap-details.md)

## Conventions

- `initApp()` 是唯一 UI 装配点 — VFS/LLM/Kernel 由 `app-core` 的 `createApplicationRuntime()` 装配，编辑器/AI 菜单/LLM 设置编辑器经 `AppOptions.ui` 注入
- `loadWorkspace()` 包含去重 — 并发加载同一工作区共享同一个 Promise (`pendingLoads`)
- 路由基于 hash URL (`#/<slug>/<resourceId>`)，由 `history.pushState/replaceState` 写入，监听 `popstate` + `NAVIGATION_EVENTS.NAVIGATE`
- `ThemeService` 管理 `<html>` 的 `data-theme` attribute，监听 `app:theme-change` 事件，偏好持久化到 `etc:/ui/theme.json`；`AppHandle.setTheme(mode)` 切换主题

运行: `pnpm --filter @itookit/app-shell test`（vitest，另有 `test:watch`）
