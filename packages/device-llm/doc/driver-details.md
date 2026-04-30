# device-llm 驱动详情

## LLMDeviceDriver ioctl 命令

| 命令 | 功能 |
|---|---|
| `list-connections` | 列出连接（无 apiKey） |
| `get-full-connection` | 获取完整连接（含 apiKey） |
| `save-connection` | 保存连接 |
| `delete-connection` | 删除连接 |
| `test-connection-params` | 测试连接 |
| `list-mcp-servers` / `save-mcp-server` | MCP 管理 |
| `list-skills` / `save-skill` / `delete-skill` | Skill CRUD |

存储路径：`/llm/.connections/` `/llm/.providers/` `/llm/.mcp/` `/llm/.skills/`

## LLMDriver

核心调用引擎，管理三种 session：`createChatSession` → `LLMChain` / `createMCPSession` → `MCPServerConnection` / `createSkillSession` → Skill 执行

## Message Content Types

`MessageContentPart` discriminated union：
`MessageContentText` | `MessageContentImage` | `MessageContentAudio` | `MessageContentVideo` | `MessageContentFile` | `MessageContentToolResult` | `MessageContentCodeExecution` | `MessageContentCitation`
