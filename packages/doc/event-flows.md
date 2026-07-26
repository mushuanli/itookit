# 跨包事件流

## Process → Conversation → UI

```text
ProcessProgram yields ProcessEvent
→ Dispatcher emits RunEventEnvelope
→ RunHandle.events()
→ ConversationRunCoordinator
→ SessionEventBus
→ HistoryView / StreamController
```

## HITL

```text
AgentProgram returns waiting(human-signal)
→ Dispatcher saves ProcessCheckpoint
→ Run status = waiting
→ UI displays request
→ RunHandle.signal(ProcessSignal)
→ Dispatcher marks Process ready
→ ProcessProgram resumes from serialized state
```

授权或结构化选择不创建新 Round。需要进入长期上下文的自然语言输入由 Conversation 创建新 Round。

## TTY

```text
shell tool output
→ ProcessEvent
→ SessionEvent projection
→ TtyController
→ read-only TtyPanel
```

TTY 输入不能从组件直接写进程 stdin，必须通过 Harness 控制面或受控 ToolPort。

## VFS

```text
VFSEngine
→ VFSManager event
→ vfs-ui adapter
→ workspace refresh
```
