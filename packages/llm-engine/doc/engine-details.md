# llm-engine 引擎详情

## ChatEngine — Chat 持久化

```
my-session.chat               ← ChatManifest JSON
_my-session.chat/             ← 资产目录
├── manifest.json             ← RoundManifest（Round DAG 索引）
├── round-<ulid>.json         ← 单个 Round（messages + meta）
├── settings.yaml             ← ChatSessionSettings
└── flow-<id>.json            ← Flow 定义（TaskGraph 编排）
```

ChatEngine 不再扩展 IFSEngine（已废弃 v3.3）。文件 CRUD 通过 `engine.module`（IModuleFS）操作。

## SessionEvent — 事件层级

所有事件统一为 `SessionEvent` = `AgentEvent | MessageProjectionEvent | SessionStructuralEvent`。

| Canonical AgentEvent | 说明 |
|---|---|
| `stream:content` / `stream:thinking` | LLM 流式输出 |
| `tool:queued` / `tool:running` / `tool:success` / `tool:error` | 工具生命周期 |
| `round:start` / `round:end` | Round 边界 |
| `await_signal` | HITL 暂停 |
| `finished` | 任务完成（含 usage） |
| `error` | 错误 |

| MessageProjectionEvent | 说明 |
|---|---|
| `message:appended` | 新消息追加到 UI 树 |
| `message:updated` | 流式 delta 更新（field: thought/output，含 metaInfo） |
| `message:status` | 节点状态变更 |

| SessionStructuralEvent | 说明 |
|---|---|
| `branch:switched` | 分支切换 |
| `regenerate_started` / `regenerate_completed` | 重新生成 |
| `sibling:switched` | 兄弟节点切换 |
| `message:edited` / `messages:deleted` / `messages:cleared` | 消息编辑/删除 |

## ILoop 协程协议

```
drive(generator, sessionActor, loopContext)
  ├─ generator.next(signal) → yield AgentEvent → sessionActor.emit(event)
  ├─ yield await_signal → sessionActor.waitSignal()
  │   └─ 挂起（小时/天级），等待 pushSignal()
  └─ generator return → Round[]（最终结果）
```

## TaskGraph 编排

```
TaskGraphReconciler.run(graphRun)
  ├─ DependencyScheduler — Kahn 拓扑排序 + 环检测
  ├─ 事件驱动状态机推进（pending → ready → running → succeeded/failed）
  ├─ 并行调度 ready tasks
  ├─ AgentTask 通过 prepareAgentContext 组装 ContextSnapshot
  └─ 完成后 commitRound 持久化 Round
```

## Session Dependency Graph

每个 VFS 文件是一个 "session"，依赖声明在 `_<filename>/session-meta.json`。`SessionTaskGraphRunner` 将依赖树投影为 TaskGraphRun，自底向上执行。
