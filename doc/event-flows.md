# 核心事件流

## Canonical AgentEvent（15 变体）

定义在 `common/src/interfaces/agent/agent-event.ts`。ILoop 协程只 yield canonical `AgentEvent`：

```
// 流式内容
stream:content  stream:thinking

// 轮次边界
round:start  round:end

// 工具执行
tool:queued  tool:running  tool:success  tool:error

// 任务生命周期
finished  error

// HITL 暂停
await_signal
```

Harness 内部的旧事件（`agent:task:start`、`agent:llm:start` 等）在 `IAgentRuntime.on()` 接口上仍然可用，但不在 ILoop 协程协议中。

---

## SessionActor 事件桥接

`SessionActor`（`llm-engine/src/core/session-actor.ts`）将 ILoop 协程的 canonical `AgentEvent` 桥接至 `SessionEventBus`。事件统一为 `SessionEvent`（`AgentEvent` | `MessageProjectionEvent` | `SessionStructuralEvent`）：

| ILoop yield | 桥接后事件 |
|---|---|
| `stream:content` | `message:updated` field=`output` |
| `stream:thinking` | `message:updated` field=`thought` |
| `tool:queued` / `tool:running` / `tool:success` / `tool:error` | canonical AgentEvent forward |
| `round:start` / `round:end` | canonical AgentEvent forward |
| `finished` | canonical AgentEvent forward |
| `error` | canonical AgentEvent forward |
| `await_signal` | 由 `drive()` 内部处理，不 emit |

---


## UI 消费链

```
TaskRunner → executeV3Agent()
  └─ drive(gen, actor, ctx)
       └─ SessionActor.emit(event)
            └─ SessionEventBus.emitSession()
                 └─ SessionEventHandler → HistoryView / StreamController
                                              ├─ createNode (message:appended)
                                              ├─ appendChunk (message:updated)
                                              └─ markDone (message:status)
```

### SessionEvent → UI

| 事件 | UI 操作 |
|---|---|
| `message:appended` | 创建 session group，渲染消息到列表 |
| `message:updated` | 流式追加文字，更新 thought，更新 metaInfo |
| `message:status` | 标记完成/失败/工具结果 |
| `finished` | 更新 token stats，停止 loading |
| `error` | 显示错误信息 |
| `regenerate_started` / `regenerate_completed` | 分支再生 |
| `branch:switched` | 切换/删除分支 |

---

## VFS 事件流

`IModuleFS extends FSEventEmitter` — 文件变更事件:
- `file:created`, `file:updated`, `file:deleted`
- `directory:created`, `directory:deleted`

`IVFSManager` 事件:
- `node:created`, `node:updated`, `node:deleted` (payload: `{ nodeIds[], moduleId }`)
- `module:mounted`, `module:unmounted`

### 消费链
```
VFSEngine (emit) → VFSManager (转发) → vfs-ui (VFSUIShell 刷新树)
                   → llm-engine (syncSkillsToHarness on change)
```

---

## HITL 事件流

```
TaskGraphReconciler → HumanTask executor → HITLQueue.push(request)
  → emit request to listener
  → UI 展示 HITL 问题 → 用户回答 → reconciler.respond(graphRunId, taskRunId, response)
  → 恢复执行
```

相关类型: `HITLRequest`, `IHITLQueue` (`common/src/interfaces/llm/mission.ts`)
实现: `llm-harness/src/services/hitl-queue.ts`

---

## Registry 事件 (SessionPool)

`RegistryEvent` (定义在 `llm-engine/src/core/types.ts`):
- `session_registered` / `session_unregistered`
- `session_status_changed`
- `pool_status_changed` (running/queued/maxConcurrent)
- `session_tty_active` / `session_hitl_active` / `session_hitl_resolved`
