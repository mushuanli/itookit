# CLAUDE.md — @itookit/llm-ui

Chat UI — Ports/Adapters 架构。提供 `LLMWorkspaceEditor`（Chat 主编辑器）和各类 Settings 编辑器。

peerDependency: `@itookit/mdxeditor`

## Architecture

```
src/
├── shell/         ← LLMWorkspaceEditor, SessionEventHandler
├── components/    ← ChatInputView (textarea + 插件), HistoryView (流式+TTY)
├── controllers/   ← StreamController, CollapseController, EditController
├── renderers/     ← NodeRenderer, SessionRenderer
├── plugins/       ← HarnessPlugin, SlashCommand, Mention, History, TokenMeter
├── editors/       ← Agent/Connection/Provider/MCP/Skill Settings
├── services/      ← SessionService, AgentLoader, BranchStore
└── commands/      ← SendMessageCommand, NodeCommands, BranchCommands
```

详情:
- 工厂函数 + 插件系统: [factories-and-plugins.md](./doc/factories-and-plugins.md)
- 事件处理 + 渲染管线: [event-processing.md](./doc/event-processing.md)
- Slash 命令系统: [slash-commands.md](./doc/slash-commands.md)

## Conventions

- 所有文本通过 `t()` 导入（`@itookit/common`）
- Port 接口定义在 `contracts/ports/`，视图通过 port 通信
- 流式内容通过 `StreamController` 管理增量更新
