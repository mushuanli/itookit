# CLAUDE.md — @itookit/device-llm

纯粹的 LLM 通信层。封装各 Provider 的 API 调用、统一消息格式、SSE 流式响应、MCP 协议、Skill 存储。

**不包含**：执行逻辑（→ llm-kernel）、会话管理（→ llm-engine）、持久化（→ llm-engine）。

## Commands

```bash
pnpm --filter @itookit/device-llm build       # tsup
pnpm --filter @itookit/device-llm dev         # tsup --watch
pnpm --filter @itookit/device-llm test        # vitest
pnpm --filter @itookit/device-llm verify      # ?? 验证脚本
```

## Architecture

```
src/
├── index.ts                ← 公共 API 出口
├── core/
│   ├── driver.ts           ← LLMDriver — 核心调用引擎（管理 sessions）
│   ├── chain.ts            ← LLMChain — 单个请求的完整生命周期
│   └── api.ts              ← testLLMConnection — 连接测试
├── device/
│   └── llm-device-driver.ts ← LLMDeviceDriver — IDeviceDriver 实现
├── providers/
│   ├── base.ts             ← BaseProvider — 抽象基类
│   ├── openai.ts           ← OpenAIProvider
│   ├── anthropic.ts        ← AnthropicProvider
│   ├── gemini.ts           ← GeminiProvider
│   └── registry.ts         ← registerProvider / getProvider / createProvider
├── skills/
│   ├── registry.ts         ← SkillRegistry — Skill CRUD
│   ├── mcp-client.ts       ← MCPClient — MCP 服务器连接
│   └── types.ts            ← Skill, SkillDefinition, SkillResult
├── types/
│   ├── connection.ts       ← LLMConnection, LLMProvider, LLMModel
│   ├── message.ts          ← ChatMessage, MessageContent, ToolCall, Attachment
│   ├── provider.ts         ← LLMProviderConfig, LLMClientConfig, MCPConfig
│   └── response.ts         ← ChatCompletionParams, ChatCompletionChunk, TokenUsage
├── utils/
│   ├── stream.ts           ← parseSSEStream, createCancellableStream
│   └── attachment.ts       ← processAttachment, detectMediaType, buildImageContent...
├── constants/
│   └── index.ts            ← LLM_PROVIDERS, DEFAULT_CONNECTIONS, DEFAULT_AGENTS...
└── errors.ts               ← LLMError, LLMErrorCode
```

## Key Classes

### LLMDeviceDriver

实现 `IDeviceDriver` + `ILLMManagementService`，是 VFS 设备 `/dev/llm` 的后端：

- **存储管理**：通过 VFS 管理 `LLMConnection[]`、`MCPServer[]`、`LLMSkill[]`
- **存储路径**：
  - `/llm/.connections/` — LLM 连接配置
  - `/llm/.providers/` — Provider 配置
  - `/llm/.mcp/` — MCP 服务器
  - `/llm/.skills/` — Skill 定义
- **ioctl 命令**：Settings UI 通过 `ioctl` 设备命令进行 CRUD

主要 ioctl 命令：

| 命令 | 功能 |
|---|---|
| `list-connections` | 列出连接（无 apiKey） |
| `get-full-connection` | 获取完整连接（含 apiKey） |
| `save-connection` | 保存连接 |
| `delete-connection` | 删除连接 |
| `test-connection-params` | 测试连接 |
| `list-mcp-servers` / `save-mcp-server` | MCP 管理 |
| `list-skills` / `save-skill` / `delete-skill` | Skill CRUD |

### LLMDriver

核心调用引擎，管理 Chat/MCP/Skill 三种 session：

- `createChatSession(connectionId, modelId?)` → `LLMChain`
- `createMCPSession(serverId)` → `MCPServerConnection`
- `createSkillSession(skillId)` → Skill 执行

### Provider 系统

```typescript
abstract class BaseProvider {
    abstract chat(params): Promise<ChatCompletionResponse>;
    abstract chatStream(params): AsyncGenerator<ChatCompletionChunk>;
}

registerProvider('openai', OpenAIProvider);
```

## Message Content Types

`MessageContentPart` 的 discriminated union 类型：

- `MessageContentText` — 文本
- `MessageContentImage` — 图片 (base64 or URL)
- `MessageContentAudio` — 音频
- `MessageContentVideo` — 视频
- `MessageContentFile` — 文件附件
- `MessageContentToolResult` — 工具调用结果
- `MessageContentCodeExecution` — 代码执行
- `MessageContentCitation` — 引用

## Conventions

- 所有类型也在 `@itookit/common` 中导出 — 其他包应 `import type { ChatMessage } from '@itookit/common'`
- 连接配置中 `apiKey` 敏感 — `ConnectionMeta` 不含 apiKey，`LLMConnection` 含完整信息（仅 Settings UI 使用）
- 流式响应使用 `AsyncGenerator<ChatCompletionChunk>`
- 旧路径（`/_llm/.connections`）会自动迁移到新路径（`/llm/.connections`）
