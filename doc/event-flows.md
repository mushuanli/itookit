# 核心事件流

> 事件层分两套：**Kernel 持久化事件**（落盘，经 `eventList`/`TaskHandle.events()` 轮询消费）与 **业务流式事件**（`agent.event` payload，流式渲染）。

## 1. Kernel 持久化事件（EventEnvelope）

所有 Task/Effect 生命周期事件写进会话事件日志（seqfile），消费方按 `sequence > after` 轮询（`session.events(after)` / `TaskHandle.events(after)`），或订阅 `onChanged` 通知。

| 事件 | 触发 |
|---|---|
| `session.created` / `session.closed` | 会话创建/关闭 |
| `task.created` / `task.started` / `task.leased` | 任务提交/启动/领取 |
| `task.signal` / `task.spawned` | capabilities 等信号 / patch-graph 子任务 |
| `task.failed` / `task.attempt.lost` | 任务失败 / worker 丢失重试 |
| `effect.leased` / `effect.succeeded` / `effect.failed` / `effect.attempt.lost` | effect 领取/成功/失败/重试 |
| `budget.configured` / `budget.consumed` | 预算设置/扣减 |
| `session.shared.set` / `session.shared.deleted` | 会话内共享状态（task 间） |
| `session.context.committed` | context commit（分支） |
| `session.message.queued` / `session.message.delivered` / `session.message.received` | 跨会话同步（outbox/inbox 消息队列） |
| `workspace.snapshot.created` / `workspace.diff.created` | 工作区快照/diff |
| `task.interaction.requested` / `task.interaction.resolved` | HITL 交互请求/解决 |
| `agent.event` | 业务层流式事件透传（见下） |

```
Kernel store.appendEvent → 事件日志 → TaskHandle.events(after) 轮询
                                        → cli RunStore.appendEvent（events.jsonl）
                                        → llm-ui 流式渲染
```

## 2. 业务流式事件（agent.event payload）

LLM 流式与程序进度经 `agent.event` 透传（`KernelAction.emit` 或 effect `context.emit`）。

| 事件 | 来源 | 用途 |
|---|---|---|
| `stream:content` / `stream:thinking` | `LlmChatEffectAdapter`（SSE chunk） | 流式正文/思考渲染 |
| `round:start` / `round:end` | `DurableAgentProgram` | 轮次边界 |
| `tool:running` / `tool:success` | `DurableAgentProgram` | 工具执行进度 |
| `finished` | `DurableAgentProgram`（含 usage） | 任务完成、token 统计 |
| `citations` | `LlmChatEffectAdapter`（终态 chunk） | 联网搜索引用（一次性，投影为 `message:citations`） |

```
LlmChatEffectAdapter.execute（流式逐块）
  → context.emit({ type:'agent.event', payload: { type:'stream:content', delta } })
    → store.appendEvent(sessionId, taskId)
      → TaskHandle.events() → UI / CLI
```

## 3. Interaction（HITL）链路

```
DurableAgentProgram.request-interaction（approval/human）
  → task.interaction.requested（事件 + interaction 入列）
  → 外部（UI/CLI）respondInteraction(interactionId, value)
  → task.interaction.resolved → 程序收到 interaction-resolved
  → interactionApproved(value) 判定 → 放行工具或拒绝重试
```

## 4. Session 事件（llm-session → UI）

`SessionEventBus` 把 durable 运行投影为会话事件供 `llm-ui` 消费：

| 事件 | UI 操作 |
|---|---|
| `message:appended` | 创建会话分组、渲染消息 |
| `message:updated` | 流式追加文字、更新 thought |
| `message:status` | 完成/失败/工具结果 |
| `finished` | token 统计、停止 loading |
| `message:citations` | 渲染联网搜索引用块 |
| `branch:switched` / 再生事件 | 分支切换/再生 |

```
ConversationRunCoordinator → RoundLog 投影 → SessionEventBus.emitSession()
  → llm-ui SessionEventHandler → HistoryView / StreamController
```

> 联网搜索的 citations 事件链与三态决策详见 [web-search.md](./web-search.md)。

## 5. 跨会话同步（outbox/inbox）

```
session A: sendCrossSession(source, target, topic, payload)
  → store.createOutboxMessage → 事件 session.message.queued
  → relayMessage → 投递到 target 的 inbox → session.message.delivered
  → target: session.inbox(after) 读取 → session.message.received
```

用于会话间的消息传递（与 session 内 `setShared/getShared` 互补：前者跨会话、后者会话内 task 间）。

## 6. VFS 事件

```
FSEventBus（vfs-core/impl/event/）：
  node:created / node:updated / node:deleted（payload {nodeIds, moduleId}）
  module:mounted / module:unmounted
  → vfs-ui（VFSUIShell 刷新树）
  → app-shell（skill 变更同步）
```

## 7. 消费方一览

| 消费方 | 事件源 | 用途 |
|---|---|---|
| `cli`（RunStore） | `session.events(after)` | events.jsonl 落盘 + 运行渲染 |
| `llm-ui` | `TaskHandle.events()` / SessionEventBus | 流式聊天渲染、DagWorkbench |
| `app-shell` | VFS FSEventBus / kernel onChanged | 树刷新、skill 同步 |
| kernel 内部 | 事件日志 | drain 推进、recover 恢复 |
