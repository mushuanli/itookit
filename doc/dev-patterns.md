# 开发模式与约定

## 新增 Provider

1. `packages/device-llm/src/constants/providers.ts` — 在 `LLM_PROVIDERS`（`Record<string, LLMProvider>`，key = provider.id）中追加 provider 定义
2. `packages/device-llm/src/providers/registry.ts` — 注册 provider 名→构造函数映射
3. 如需新 Provider 类（非 OpenAI 兼容）：`packages/device-llm/src/providers/` 新建类 → `extends BaseProvider`
4. `packages/device-llm/src/index.ts` — 导出

## 新增 Provider 内置联网搜索能力

1. `packages/device-llm/src/constants/providers.ts` — provider 定义加 `capabilities.serverSideWebSearch: true`
2. `packages/llm-common/src/llm/connection.ts` — `supportsServerSideSearch()` 确认协议支持
3. provider 实现类注入内置工具并提取 `citations`（参考 `responses.ts` / `gemini.ts`）
4. 详见 [web-search.md](./web-search.md)

## 新增 API 协议（如 openai-responses）

1. `llm-common` `ApiProtocol` 加枚举值
2. `device-llm` `resolveProtocol()` 加 URL/provider 推断；`createProvider()` 加协议→Provider 类分发
3. Provider 类实现该协议端点路径（如 `responsesPath`）

## 新增 Connection

通过 Settings UI (`packages/llm-settings-ui/src/editors/ConnectionSettingsEditor.ts`) 操作，
或直接写入 VFS `etc:/llm/.connections/<id>.json`

## 新增 Agent

1. `packages/llm-common/src/llm/agent.ts` — 更新 `AgentDefinition` 接口（如需新字段）
2. `packages/device-llm/src/constants/agents.ts` — `DEFAULT_AGENTS` 预设模板
3. `packages/llm-settings-ui/src/editors/AgentConfigEditor.ts` — 编辑器 UI
4. `packages/llm-session/src/session/agent-resolver.ts` — AgentResolver.resolve()

## 新增通用工具 (Built-in Tool)

1. `packages/tools/src/tools/<Name>/prompt.ts` — 工具 prompt
2. `packages/tools/src/tools/<Name>/<Name>Tool.ts` — `buildTool(def)` 实现
3. `packages/tools/src/index.ts` — 在 `BUILTIN_TOOLS` 数组注册

工具驱动在 `call()` 前执行输入 schema、`validateInput` 和 `checkPermissions`，权限回调更新的参数会重新校验。已知的参数/操作前提错误可抛出 `ToolInputError(code, message)`，Agent 会收到可纠正的失败结果；存储异常或可能已发生副作用的未知失败应保持普通异常。不要把任意异常包装成可重试错误。结构化 `data` 与模型文本分别受输出上限限制，超大 data 被省略。人工审批由 Durable Agent interaction 承担，工具权限回调只负责 allow/deny。

## 新增 Kernel 工具 (需运行时引用)

1. `packages/kernel-adapters/src/tool/<name>.ts` — ToolMeta + ToolDefinition + ToolHandler
2. `packages/kernel-adapters/src/runtime/create-kernel-adapters-runtime.ts` — 运行时注册
3. 如需 Durable 执行，在 `packages/kernel-adapters/src/effects/` 增加 EffectAdapter，并由 KernelAdaptersPlugin 注册

## 新增 i18n 文案

1. `packages/common/src/i18n/zh-CN.ts` — 添加 key (source of truth)
2. `packages/common/src/i18n/en.ts` — 添加相同 key (TypeScript 静态校验)
3. 组件中使用 `t('new.key')`

## 新增图标

`packages/common/src/i18n/icons.ts` — 添加新图标常量，禁止组件硬编码 emoji

## 新增 Test

- vitest, `*.test.ts` 模式
- 测试目录为 `packages/<pkg>/__tests__/` 或 `packages/<pkg>/tests/`；仅部分包有 `packages/<pkg>/vitest.config.ts`（其余走 vitest 默认配置）
- 不 mock 数据库（集成测试原则）

## 构建

| 类型 | 工具 | 命令 |
|---|---|---|
| 逻辑包 | tsup | `pnpm build` (CJS+ESM+.d.ts) |
| UI 包 | vite build | `pnpm build` (app bundle + CSS) |
| 无 build 脚本 | — | `app-core`/`app-shell` 以 TS 源码被 app 消费 |

- **tsup**：`common`/`llm-common`/`durable-kernel`/`llm-tasks`/`llm-flow`/`llm-session`/`kernel-adapters`/`device-llm`/`device-tty`/`tools`/`vfs-core`/`vfsdriver-indexeddb`/`vfsdriver-localfs`，以及 UI 包中的 `llm-settings-ui`/`ui-common`。
- **vite build**：`llm-ui`/`vfs-ui`/`mdx`/`app-settings`/`demo`。

## 代码约定

- **Ports/Adapters**: Shell 只通过 port 接口与视图通信，内部 DOM 完全封装
- **接口依赖**: 调用方类型为接口 (`IVFSManager`, `IFileSystem`)，具体实现在 bootstrap 注入
- **CSS 变量**: 唯一权威来源 `llm-ui/src/styles/variables.css`
- **函数 ≤30 行**，圈复杂度 ≤10
- **i18n 零硬编码**，图标统一从 `@itookit/common` 导入
- **Git commit**: `type(scope): description` (Conventional Commits)
