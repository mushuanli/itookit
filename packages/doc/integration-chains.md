# 核心集成链

## 普通聊天

```text
LLMWorkspaceEditor
→ SessionManager.sendMessage
→ ConversationRunCoordinator
→ HarnessKernel.submit("direct")
→ DirectScheduler
→ ChatProgram / AgentProgram
→ RunEventEnvelope
→ RoundLog + SessionEventBus
→ HistoryView
```

## DAG Flow

```text
DagWorkbench
→ immutable FlowRevision
→ flowToDag
→ HarnessKernel.submit("dag")
→ DagScheduler
→ DagPlugin Runtime
→ Process per ready node
→ terminal artifacts
→ ConversationRound output
```

## 应用启动

```text
initApp
├── createVFS
├── LLMDeviceDriver
├── ChatEngine + VFSAgentService
├── createHarness
│   ├── resource ports
│   ├── DirectScheduler
│   ├── DagScheduler
│   └── builtin DAG plugins
└── initializeConversationSystem
    ├── register ChatProgram / AgentProgram
    ├── SessionManager
    └── conversation command plugins
```

所有 UI 控制通过 `RunHandle`；所有 Process 外部访问通过资源端口。
