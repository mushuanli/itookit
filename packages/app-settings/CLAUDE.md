# @itookit/app-settings

设置模块 — 全局配置、日志、存储、标签、数据恢复和系统 VFS 浏览。

依赖：`@itookit/common`、`@itookit/device-llm`、`@itookit/llm-ui`、`@itookit/memory-manager`。

## Architecture

```
src/
├── editors/           ← 13 个设置编辑器
│   ├── system-fs/     ← SystemVFSEngine + SystemFSExploreEditor (跨模块只读 VFS 浏览)
│   ├── Storage/Provider/Connection/Tag/Contact/MCP/Agent/Skill
│   ├── Recovery/Log/About
│   ├── Appearance     ← 浅色/深色/跟随系统 主题切换，写入 /ui/theme.json
│   └── Cost           ← 费用仪表板 (provider/time 过滤, top sessions) + MODEL_PRICING 配置
├── engine/            ← SettingsEngine + SkillsEngine (页面注册表)
├── factories/         ← settingsFactory (nodeId → editor 路由)
├── services/          ← SettingsService
└── styles/            ← settings CSS (_appearance.css, _cost.css 等)
```

## 关键点

- `settingsFactory` 按 `nodeId` 路由到对应 editor，末尾 fallback 为 placeholder
- `SystemVFSEngine` 通过复合 ID (`__mod__<name>`, `__dev__|<id>`) 跨模块遍历 VFS
- Provider/Connection/MCP/Skill editors 来自 `@itookit/llm-ui`
- `AppearanceSettingsEditor` 写入 `/ui/theme.json`，通过 `app:theme-change` 事件广播
- `CostEditor` 显示费用仪表板和价格配置，MODEL_PRICING 为单一数据源

[架构设计](./Architecture.md)
