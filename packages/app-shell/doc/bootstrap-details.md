# app-shell 启动与装配

`initApp(options)` 是唯一顶层初始化函数，只负责 UI 装配；平台无关的 VFS / LLM / Kernel / Session 组合由 `@itookit/app-core` 的 `createApplicationRuntime()` 完成。

```text
1. options.runtime ?? await createApplicationRuntime({ ...options, backend: options.backend })
   → vfs / llmDriver / agentService / sessionRepository / flowEngine /
     sessionFiles / directoryMounts / kernel / sessionManager / commandBus
2. themeService.init(await vfs.openFileSystem('/etc'))
3. createSettingsModule(vfs, settingsSources) → settingsFactory
4. 按 WorkspaceConfig.type 建 EditorFactory 表（factories / editorFactoryMap）
5. 绑定路由（routeMap / reverseRouteMap + popstate、NAVIGATION_EVENTS.NAVIGATE）
6. loadWorkspace(wsConfig, resourceId)，managerCache 缓存 + pendingLoads 并发去重
```

`initApp` 要求 `AppOptions.backend` 或 `AppOptions.runtime` 之一；编辑器、AI 菜单和 LLM 设置编辑器经 `AppOptions.ui` 注入。

chat 工作区由 `SessionWorkbench` 承载（Session 侧栏 + 路由 + 文件上下文），其余工作区由 `Workbench` 承载，二者都用 `EditorFactory` 选择编辑器。

普通 Chat 走 `ConversationRunCoordinator` 的直接任务路径（`directTaskSpec`），不包装成单节点 DAG。文件工具的 `ToolExecutionContext.vfs`（`ToolVFSContext`）由 `kernel-adapters` 注入：有该字段时走虚拟文件系统，没有时回退到 `node:fs/promises`，浏览器环境下因此不需要真实文件系统。
