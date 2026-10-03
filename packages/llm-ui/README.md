# @itookit/llm-ui

原生 DOM 聊天、历史和 Flow 展示。按需要选择公开入口：

```ts
import { createLLMFactory, type SessionViewPort } from '@itookit/llm-ui/chat';

const factory = createLLMFactory(agentService, {
  sessionManager: conversation.sessionManager,
  sessionRepository,
  commandBus: conversation.commandBus,
  kernel,
  defaultHarnessToolIds: hostToolIds,
});
```

`agentService` 接受公共 `IAgentConfigService`，无需创建 VFSAgentService；`sessionManager` 接受结构化 `SessionViewPort`（查询、事件与命令通道），可由宿主实现。提示词历史是可选的 `PromptHistoryPort`。仓储、OCR、工具授权、Skill 和特权命令由宿主接入。未传默认工具列表时，UI 不自行假定授权；真实授权由执行层校验。

聊天入口不加载设置编辑器；需要设置界面时安装可选 peer `@itookit/llm-settings-ui`，再从 `@itookit/llm-ui/settings` 导入 `createAgentEditorFactory`、`createSkillsEditorFactory` 或设置编辑器。包根保留包含两部分的兼容入口。`/startup` 用于启动菜单与 Flow 模板，`/style.css` 提供聊天样式。

`/chat` 创建正式会话编辑器时必须传入 `sessionManager`，或通过 `resolveSessionView` 延迟获取实例；缺少端口会明确报错。提示词历史通过实例上的可选 `promptHistory` 接入。只有包根入口为旧调用保留单例回退。当前 UI 仍消费 Session/Flow 契约和仓储能力，并非只依赖通用 UI 的展示组件包。

验证：`pnpm --filter @itookit/llm-ui typecheck`、`build`、`test`。
开发说明见 [AGENTS.md](./AGENTS.md)。
