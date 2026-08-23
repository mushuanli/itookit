# 核心集成链

## 普通聊天

```text
LLMWorkspaceEditor
→ SessionManager.sendMessage
→ ConversationRunCoordinator
→ SessionHandle.createTask(TaskSpec)
→ DurableChatProgram / DurableAgentProgram
→ Effect + Interaction
→ EventEnvelope
→ RoundLog + SessionEventBus
→ HistoryView
```

## DAG Flow

```text
DagWorkbench
→ immutable FlowRevision
→ flowToDag
→ DurableFlowExecutor.compile
→ TaskSpec/dependsOn
→ DurableTaskProgram per ready node
→ terminal artifacts
→ ConversationRound output
```

## 应用启动

```text
initApp
├── createVFS
├── LLMDeviceDriver
├── ChatEngine + VFSAgentService
├── Kernel + CoreutilsKernelPlugin
│   ├── Effect adapters
│   ├── resource grants
│   └── durable poller
└── initializeConversationSystem
    ├── register DurableChatProgram / DurableAgentProgram
    ├── register Flow programs and plugins
    ├── SessionManager
    └── conversation command plugins
```

所有 UI 控制通过 `TaskHandle`；所有 Task 外部访问通过资源句柄和 Effect 端口。
