# @itookit/device-llm 开发说明

LLM 通信层 — Provider API、SSE 流式、MCP 协议、Skill 存储、Billing/Cost、LLM 日志。**不包含**执行逻辑或会话管理。

## 目录结构

```
src/
├── constants/     ← 内置 provider/agent/connection 定义、MODEL_PRICING、pricing.json 读写
├── core/          ← LLMDriver, LLMChain, testLLMConnection
├── cost/          ← CostStore（费用累加、按 session/provider/日期查询）
├── device/        ← LLMDeviceDriver + 各 *-manager（connection/provider/mcp/skill/cost/system-prompt）
├── providers/     ← OpenAI, Responses, Anthropic, Gemini, Codex（BaseProvider + resolveProtocol）
├── runtime/       ← Codex app-server 传输（JSON-RPC framing、Node stdio、Tauri 桥）
├── skills/        ← MCPClient, MCPServerConnection
├── types/         ← 本包类型（LLMHooks 等）+ 从 @itookit/common 的兼容 re-export
└── utils/         ← SSE 流, 附件处理（base64）, NoopLLMLogger
```

LLMDeviceDriver 管理 VFS 存储路径：`/llm/.connections/` `/llm/.providers/` `/llm/.mcp/` `/llm/.skills/` `/llm/cost.seq` `/llm/pricing.json`

详情: [ioctl 命令 + Message 类型](./doc/driver-details.md)

## Billing & Cost Tracking

- `MODEL_PRICING`（`constants/providers.ts`）是编译期定价表（USD/M tokens），`/llm/pricing.json` 不存在时写入该默认值
- `CostStore`（`cost/cost-store.ts`）封装 `/llm/cost.seq` seqfile，key = `{sessionId}|{providerId}|{YYYY-MM-DD}`，同 key 自动累加
- 每次 chat 完成后 `LLMDeviceDriver` 自动调用 `CostStore.recordCost()` 记录 tokens + cost
- 查询接口：`queryBySession()`、`queryBySessionProvider()`、`queryAll({providerId, dateFrom, dateTo})`
- 定价匹配规则（`lookupPricingEntry`，定义在 `@itookit/common`）：providers 精确匹配 modelId > id/names 通配符 > default fallback

## LLM 日志

- `ILLMLogger`（`logMessage`、`logRequest`、`logResponse`）定义在 `@itookit/llm-common`，经 `@itookit/common` re-export
- `NoopLLMLogger`（`utils/llm-logger.ts`）是本包默认空实现；实际落盘由宿主注入的实现负责（如 `apps/tauri-app/src/log/tauri-llm-logger.ts` 写 `{rootDir}/var/log/llm/{label}.json`）
- 注入 `ILLMLogger` 到 `LLMDeviceDriverOptions.llmLogger` 后，消息/请求/响应头经该接口输出；`LLMDeviceOpenOptions.sessionLabel` 设置日志文件名标签（自动转义）
- `LLMHooks.onResponseHeaders` / `LLMHooks.onStreamChunk` 是日志捕获使用的 hook 槽位

## Provider 创建 & 协议解析

- `createProvider()` 四级分发：`config.protocol` > registry 按名查找 > `definition.implementation` > 兜底 OpenAIProvider
- `resolveProtocol()` 从 URL / provider 名推断 API 协议（`'anthropic-messages' | 'openai-chat' | 'openai-responses' | 'gemini-generate'`）
- Kernel 模式（`runMode === 'kernel'`）强制使用 `anthropic-messages` 协议
- `BaseProvider.resolveEndpointUrl()` 防止 baseURL 已含完整路径时重复拼接 suffix

## 思考模式

- 模型 `metadata.thinkingMode` 字段（`'auto' | 'disabled' | 'enabled'`）优先级高于调用方 `params.thinking`
- `'auto'` 显式忽略 thinking 字段（解决代理模型报错）；`'disabled'` 发送 `{type: 'disabled'}`

## Responses API（openai-responses）

- `ResponsesProvider`（`providers/responses.ts`）实现 DeepSeek / OpenAI `/responses` 协议（input items + 语义化 SSE）
- `reasoning.effort` 控制思考；`responses.defaultThinkingEnabled` 能力位（DeepSeek 默认开启思考，关闭需 `effort='none'`）
- 端点路径由 `responsesPath` 声明（如 `/responses`），`createProvider()` 按协议优先级选择

## 联网搜索（Server-side Web Search）

- 能力位：`LLMProvider.capabilities.serverSideWebSearch`（内置 provider 在 `constants/providers.ts` 声明）
- 三态决策 `resolveWebSearchStrategy`（`@itookit/common`）→ `WebSearchMode`
- 内置工具注入：Responses 追加 `{type:'web_search'}`；Gemini 追加 `{googleSearch:{}}`
- citations 提取：`responses.ts collectCitations` / `gemini.ts groundingMetadata` → 统一 `Citation[]`
- 详见 [web-search.md](../../doc/web-search.md)

## 命令

```bash
pnpm --filter @itookit/device-llm build       # tsup
pnpm --filter @itookit/device-llm typecheck
pnpm --filter @itookit/device-llm test        # vitest run
pnpm --filter @itookit/device-llm verify      # tsx scripts/verify.ts
```

## Conventions

- 所有跨包类型从 `@itookit/common` 导出
- `ConnectionMeta` 不含 apiKey，`LLMConnection` 含完整信息
- 流式响应使用 `AsyncGenerator<ChatCompletionChunk>`
- Provider 通过 `registerProvider('openai', OpenAIProvider)` 注册
- 附件 base64 展开在 `utils/attachment.ts` 的 `expandMessagesAttachments()`，由 `@itookit/kernel-adapters` 的 `LLMServiceAdapter` 在调用前执行
- `CostStore` 依赖 `engine.meta.seq` 后端能力，不存在时静默跳过
- 定价信息通过 `applyPricingToModel()` 应用，`/llm/pricing.json` 支持热更新
