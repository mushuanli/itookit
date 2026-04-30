# CLAUDE.md — @itookit/llm-ui

Chat UI — Ports/Adapters 架构。提供 `LLMWorkspaceEditor`（Chat 主编辑器）和各类 Settings 编辑器。

peerDependency: `@itookit/mdxeditor`

## Commands

```bash
pnpm --filter @itookit/llm-ui build        # vite build
pnpm --filter @itookit/llm-ui dev          # vite dev
```

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

详情: [工厂函数 + 插件系统](./doc/factories-and-plugins.md)

## Conventions

- 所有文本通过 `t()` 导入（`@itookit/common`）
- Port 接口定义在 `contracts/ports/`，视图通过 port 通信
- 流式内容通过 `StreamController` 管理增量更新
