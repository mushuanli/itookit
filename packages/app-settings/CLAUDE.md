# @itookit/app-settings

设置模块 — 全局配置、日志、存储、标签、数据恢复和系统 VFS 浏览。

依赖（peer）：`@itookit/common`、`@itookit/device-llm`、`@itookit/stdio`、`@itookit/ui-common`、`@itookit/vfs-ui`、`@itookit/mdxeditor`。LLM 设置编辑器（Provider/Connection/MCP/Skill/Cost/Agent）来自 `@itookit/llm-settings-ui`，经 `LLMUIEditors` 接口注入（避免上行依赖）。

## Architecture

```
src/
├── editors/           ← 8 个设置编辑器（本包自有）
│   ├── system-fs/     ← SystemVFSEngine + SystemFSExploreEditor (跨模块只读 VFS 浏览)
│   ├── Storage/Tag/Contact
│   ├── Recovery/Log/About
│   └── Appearance     ← 浅色/深色/跟随系统 主题切换，写入 /ui/theme.json
├── engine/            ← SettingsEngine + SkillsEngine (页面注册表)
├── factories/         ← settingsFactory (nodeId → editor 路由)
├── services/          ← SettingsService
└── styles/            ← settings CSS (_appearance.css, _cost.css 等)
```

## 关键点

- `settingsFactory` 按 `nodeId` 路由到对应 editor，末尾 fallback 为 placeholder
- `SystemVFSEngine` 通过复合 ID (`__mod__<name>`, `__dev__|<id>`) 跨模块遍历 VFS
- Provider/Connection/MCP/Skill/Cost/Agent editors 由 `@itookit/llm-settings-ui` 提供，经 `LLMUIEditors` 构造器接口注入 `settingsFactory`
- `AppearanceSettingsEditor` 写入 `/ui/theme.json`，通过 `app:theme-change` 事件广播

[架构设计](./Architecture.md)
