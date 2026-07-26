# Slash Command

```text
ChatInputView
→ SlashCommandPlugin.onBeforeSend
→ SlashCommandRouter
→ SendMessageCommand
→ SessionManager.sendMessage
→ ConversationRunCoordinator
→ HarnessKernel
```

`SlashCommandPlugin` 只负责解析和分发；会话修改走 Conversation CommandBus，执行控制走 `RunHandle`。

关键文件：

| 职责 | 文件 |
| --- | --- |
| 解析与命令定义 | `src/components/input/plugins/SlashCommandPlugin.ts` |
| Shell 回调 | `src/shell/SlashCommandRouter.ts` |
| 消息发送 | `src/commands/SendMessageCommand.ts` |
| 编辑器装配 | `src/shell/LLMWorkspaceEditor.ts` |
