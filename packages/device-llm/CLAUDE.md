# @itookit/device-llm

LLM 通信层 — Provider API、SSE 流式、MCP 协议、Skill 存储、Billing/Cost、LLM 日志。**不包含**执行逻辑或会话管理。

## Architecture

```
src/
├── constants/     ← MODEL_PRICING, pricing I/O, provider/agent/connection 默认值
├── core/          ← LLMDriver, LLMChain, testLLMConnection
├── cost/          ← CostStore（费用累加、按 session/provider/日期查询）
├── device/        ← LLMDeviceDriver (IDeviceDriver 实现, /dev/llm)
├── providers/     ← OpenAI, Responses, Anthropic, Gemini（BaseProvider + resolveProtocol）
├── skills/        ← SkillRegistry, MCPClient
├── types/         ← LLMConnection, ChatMessage, TokenUsage, LLMHooks...
└── utils/         ← SSE 流, 附件处理, NoopLLMLogger
```

LLMDeviceDriver 管理 VFS 存储路径：`/llm/.connections/` `/llm/.providers/` `/llm/.mcp/` `/llm/.skills/` `/llm/cost.seq` `/llm/pricing.json`

详情: [ioctl 命令 + Message 类型](./doc/driver-details.md)

## Billing & Cost Tracking

- `MODEL_PRICING` 常量在 `constants/providers.ts` 中定义，编译期定价表（USD/M tokens），首次启动时写入 `/llm/pricing.json`
- `CostStore`（`cost/cost-store.ts`）封装 `/llm/cost.seq` seqfile，key = `{sessionId}|{providerId}|{date}`，同 key 自动累加
- 每次 chat 完成后 `LLMDeviceDriver` 自动调用 `CostStore.recordCost()` 记录 tokens + cost
- 查询接口：`queryBySession()`、`queryBySessionProvider()`、`queryAll({providerId, dateFrom, dateTo})`
- 定价匹配规则（`lookupPricingEntry`）：providers 精确匹配 modelId > names[] 通配符 > default fallback

## LLM 日志

- `ILLMLogger` 接口（`logMessage`、`logRequest`、`logResponse`）定义在 `@itookit/common`
- `NoopLLMLogger`（`utils/llm-logger.ts`）是默认空实现，Web 环境使用
- 注入 `ILLMLogger` 到 `LLMDeviceDriverOptions.llmLogger` 后，消息/请求/响应头写入 `/var/log/llm/{session}.jsonl`
- `LLMDeviceOpenOptions.sessionLabel` 设置日志文件名标签（自动转义）
- `LLMHooks.onResponseHeaders` / `LLMHooks.onStreamChunk` — 两个新 hook 槽位，用于日志捕获

## Provider 创建 & 协议解析

- `createProvider()` 四级分发：`config.protocol` > `definition.implementation` > registry 按名查找 > 兜底 OpenAIProvider
- `resolveProtocol()` 从 URL / provider 名推断 API 协议（`'anthropic-messages' | 'openai-chat' | 'openai-responses' | 'gemini-generate'`）
- Kernel 模式（`runMode === 'kernel'`）强制使用 `anthropic-messages` 协议
- `BaseProvider.resolveEndpointUrl()` 防止 baseURL 已含完整路径时重复拼接 suffix

## 思考模式

- 模型定义中新增 `thinkingMode` 字段（`'auto' | 'disabled' | 'enabled'`）
- 优先级：模型级 `thinkingMode` > 调用方 `params.thinking`
- `'auto'` 显式忽略 thinking 字段（解决代理模型报错）；`'disabled'` 发送 `{type: 'disabled'}`

## Responses API（openai-responses）

- `ResponsesProvider`（`providers/responses.ts`）实现 DeepSeek / OpenAI `/responses` 协议（input items + 语义化 SSE）
- `reasoning.effort` 思考控制；`responses.defaultThinkingEnabled` 能力位（DeepSeek 默认开启思考，关闭需 `effort='none'`）
- 端点路径 `responsesPath`（如 `/responses`），`createProvider()` 按协议优先级选择

## 联网搜索（Server-side Web Search）

- 能力位：`LLMProvider.capabilities.serverSideWebSearch`（内置 provider 在 `constants/providers.ts` 声明）
- 三态决策 `resolveWebSearchStrategy`（`@itookit/common`）→ `WebSearchMode`
- 内置工具注入：Responses 追加 `{type:'web_search'}`；Gemini 追加 `{googleSearch:{}}`
- citations 提取：`responses.ts collectCitations` / `gemini.ts groundingMetadata` → 统一 `Citation[]`
- 详见 [web-search.md](../../doc/web-search.md)

## Conventions

- 所有类型在 `@itookit/common` 中导出
- `ConnectionMeta` 不含 apiKey，`LLMConnection` 含完整信息
- 流式响应使用 `AsyncGenerator<ChatCompletionChunk>`
- Provider 通过 `registerProvider('openai', OpenAIProvider)` 注册
- 附件 blob 在 `@itookit/coreutils` 的 `LLMServiceAdapter` 中展开为 base64 后传递
- 定期清理过期模型 ID，仅保留最新版本
- `CostStore` 依赖 `engine.meta.seq` 后端能力，不存在时静默跳过
- 定价信息通过 `applyPricingToModel()` 应用，`/llm/pricing.json` 支持热更新
