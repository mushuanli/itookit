# 跨包事件流

## Task → Conversation → UI

```text
DurableTaskProgram returns actions
→ Kernel commits state and EventJournal atomically
→ TaskHandle.events()
→ ConversationRunCoordinator
→ SessionEventBus
→ HistoryView / StreamController
```

## HITL

```text
DurableAgentProgram returns Interaction action
→ Kernel commits Task state and wait condition
→ Task status = waiting
→ UI displays request
→ TaskHandle.signal(InteractionResponse)
→ Kernel marks Task ready
→ DurableAgentProgram resumes from serialized state
```

授权或结构化选择不创建新 Round。需要进入长期上下文的自然语言输入由 Conversation 创建新 Round。

## TTY

```text
shell Effect output
→ EventEnvelope
→ SessionEvent projection
→ TtyController
→ read-only TtyPanel
```

TTY 输入不能从组件直接写进程 stdin，必须通过 Task signal 或受控 TTY capability。

## VFS

```text
VFSEngine
→ VFSManager event
→ vfs-ui adapter
→ workspace refresh
```
