# llm-settings-ui 开发说明

本包是 LLM 设置编辑器（Agent / Provider / Connection / MCP / Skill / Cost / SystemPrompt）+ LLM 配置导入/导出。

## 目录

```text
src/
├── index.ts                    统一导出
├── editors/
│   ├── AgentConfigEditor.ts    实现 IEditor（统一搜索 / 折叠展开）
│   ├── ProviderSettingsEditor.ts / ConnectionSettingsEditor.ts
│   ├── MCPSettingsEditor.ts / SkillSettingsEditor.ts
│   ├── CostEditor.ts / SystemPromptSettingsEditor.ts
│   ├── llm-import.ts           YAML 导入、冲突检测与执行
│   └── skill/                  Skill 导入 / 操作 / 渲染 / 支持字段
└── utils/modelBadges.ts
```

## 约束

- 只做设置/配置 UI，不依赖 llm-ui 的 chat/history/dag 组件。
- 依赖最小：`@itookit/common`（类型/工具）、`@itookit/ui-common`（BaseSettingsEditor/Modal/Toast/IEditor）、`@itookit/device-llm`（导入导出）、`@itookit/vfs-core`（EventBus）、`js-yaml`（YAML 解析）。
- 多数编辑器继承 `BaseSettingsEditor<T>` 基类（统一生命周期/保存/校验）；`AgentConfigEditor` 直接实现 `IEditor`。

运行：

```bash
pnpm --filter @itookit/llm-settings-ui typecheck
pnpm --filter @itookit/llm-settings-ui test
```
