# @itookit/app-settings

设置模块 — 全局配置、日志、存储、标签、联系人、数据恢复、外观和系统 VFS 浏览。

依赖（peer）：`@itookit/common`、`@itookit/device-llm`、`@itookit/vfs-core`、`@itookit/ui-common`、`@itookit/vfs-ui`、`@itookit/mdxeditor`。LLM 设置编辑器来自 `@itookit/llm-settings-ui`，经 `LLMUIEditors` 接口注入（避免上行依赖）。

## Architecture

```
src/
├── index.ts           ← createSettingsModule() + 导出
├── editors/           ← 8 个设置编辑器（本包自有）+ system-fs/ storage/ log/ 子模块
│   ├── SystemFSExploreEditor.ts  ← 跨模块只读 VFS 浏览（调试页，经 system-fs/ 组装视图）
│   ├── Storage/Tag/Contact / Recovery/Log/About
│   └── Appearance     ← 浅色/深色/跟随系统 主题切换，写入 /ui/theme.json
├── engine/            ← SettingsEngine + SkillsEngine (均为 IFileSystem 实现)
├── factories/         ← createSettingsFactory (nodeId → editor 路由)
├── services/          ← SettingsService / SnapshotService / SyncService / LabelStore
└── styles/            ← settings CSS (_appearance.css, _cost.css 等)
```

## 关键点

- `createSettingsFactory()` 先经 `resolveSettingsSlug()` 把 nodeId（VFS path 或 slug）归一为分类 slug，再按 slug 路由到对应 editor，未匹配时返回 placeholder
- `SettingsEngine` 把 `SETTINGS_PAGES` 映射为只读虚拟文件节点；`SkillsEngine` 把 `IAgentManagementService.getSkills()` 映射为可写虚拟文件节点，供 Skills 工作区列表使用
- `SystemFSExploreEditor` 经 `createSystemFileInspector()` 组装只读视图：`/dev` 挂载设备描述，`/workspaces/<name>` 挂载各工作区文件系统
- `LLMUIEditors` 注入 5 个编辑器（来自 `@itookit/llm-settings-ui`）：Provider / Connection / MCP / Cost / SystemPrompt；Skill / Agent 编辑器由 llm-ui 的 skills/agent 工作区直接使用，不经过本包
- `AppearanceSettingsEditor` 写入 `/ui/theme.json`，通过 `app:theme-change` 事件广播

运行: `pnpm --filter @itookit/app-settings build`（`dev` 为 watch 模式）

[架构设计](./Architecture.md)

系统恢复页通过 createSettingsFactory 的可选 restoreFlows 回调提供「恢复内置工作流」：只恢复缺失模板，保留已有内容。回调由 app-shell 注入 llm-ui.restoreFlowLibrary，设置包不依赖 Flow 运行器或 llm-ui。此操作与原有 Provider/Connection/Agent 强制重置分开。
