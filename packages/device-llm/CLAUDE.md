# CLAUDE.md — @itookit/device-llm

LLM 通信层 — Provider API、SSE 流式、MCP 协议、Skill 存储。**不包含**执行逻辑或会话管理。

## Commands

```bash
pnpm --filter @itookit/device-llm build       # tsup
pnpm --filter @itookit/device-llm dev         # tsup --watch
pnpm --filter @itookit/device-llm test        # vitest
```

## Architecture

```
src/
├── core/          ← LLMDriver, LLMChain, testLLMConnection
├── device/        ← LLMDeviceDriver (IDeviceDriver 实现, /dev/llm)
├── providers/     ← OpenAI, Anthropic, Gemini (BaseProvider 抽象)
├── skills/        ← SkillRegistry, MCPClient
├── types/         ← LLMConnection, ChatMessage, TokenUsage...
└── utils/         ← SSE 流解析, 附件处理
```

LLMDeviceDriver 管理 VFS 存储路径：`/llm/.connections/` `/llm/.providers/` `/llm/.mcp/` `/llm/.skills/`

详情: [ioctl 命令 + Message 类型](./doc/driver-details.md)

## Conventions

- 所有类型在 `@itookit/common` 中导出
- `ConnectionMeta` 不含 apiKey，`LLMConnection` 含完整信息
- 流式响应使用 `AsyncGenerator<ChatCompletionChunk>`
- Provider 通过 `registerProvider('openai', OpenAIProvider)` 注册
