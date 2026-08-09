# Slash Command

```text
ChatInputView
→ SlashCommandPlugin.onBeforeSend
→ SlashCommandRouter
→ IPrivilegedCommandService (仅特权命令)
→ App Shell composition
→ Harness SessionHandle / TaskHandle
```

`SlashCommandPlugin` 只负责解析和分发。普通会话修改走 Conversation CommandBus；特权命令通过抽象端口提交或控制 Durable Task，不直接依赖具体 Program、Effect 或平台实现。

| 命令 | 行为 |
|---|---|
| `/plan <goal>` | 提交 `llm.plan@1`，生成的计划作为持久 Interaction 展示并等待 `/approve` |
| `/exec <command>` | 提交 `coreutils.exec@1`，审批通过后才创建 `process.exec` Effect |
| `/approve` | 响应当前附着 Task 最新的 pending approval |
| `/cancel` | 取消当前附着 Task |
| `/resume` | 启动尚未开始的 Task，或向明确等待 resume Signal 的 Task 发送 Signal |

这些命令是控制面语法，不是 Skill。`coreutils` 不识别 `/exec` 文本，`llm-runtime` 也不识别 `/plan` 文本。
当前附着 Task id 记录在 Session shared key `ui.privileged.active-task`，编辑器重载后会重新附着；Task 状态本身不在 UI 中复制。

关键文件：

| 职责 | 文件 |
| --- | --- |
| 解析与命令定义 | `src/components/input/plugins/SlashCommandPlugin.ts` |
| Shell 回调 | `src/shell/SlashCommandRouter.ts` |
| 消息发送 | `src/commands/SendMessageCommand.ts` |
| 编辑器装配 | `src/shell/LLMWorkspaceEditor.ts` |
| Task 控制适配 | `src/shell/RunAttachmentController.ts` |
| 特权命令抽象端口 | `src/domain/ports/IPrivilegedCommandService.ts` |
