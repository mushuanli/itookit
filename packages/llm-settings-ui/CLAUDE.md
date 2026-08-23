# llm-settings-ui 开发说明

本包是 LLM 设置编辑器（Agent / Provider / Connection / MCP / Skill / Cost）+ LLM 配置导入/导出。原属 `@itookit/llm-ui` 的 `editors/`，现独立成包。

## 约束

- 只做设置/配置 UI，不依赖 llm-ui 的 chat/history/dag 组件。
- 依赖最小：`@itookit/common`（类型/工具）、`@itookit/ui-common`（BaseSettingsEditor/Modal/Toast/IEditor）、`@itookit/device-llm`（导入导出）、`@itookit/vfs-core`（EventBus）。
- 通过 `BaseSettingsEditor<T>` 基类实现各编辑器（统一生命周期/保存/校验）。

运行：

```bash
pnpm --filter @itookit/llm-settings-ui typecheck
pnpm --filter @itookit/llm-settings-ui test
```
