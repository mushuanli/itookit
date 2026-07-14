# 核心事件流

## Agent 事件 (完整)

所有事件类型定义在 `common/src/interfaces/agent/agent-types.ts` (`AgentEventType`, `AgentEventPayloads`)。

### 任务生命周期
```
agent:task:start → agent:step:complete (×N) → agent:task:end
```

### LLM 调用
```
agent:llm:start → agent:stream:content / agent:stream:thinking → agent:llm:end
agent:llm:retry → agent:llm:fallback
```

### 工具执行
```
agent:tool:start → agent:tool:success / agent:tool:error / agent:tool:timeout
agent:permission:request
```

### 系统状态
```
agent:context:compressed → agent:skill:loaded
agent:budget:warning → agent:budget:exhausted
agent:backpressure:check → agent:backpressure:failed
```

### TTY
```
agent:tty:open → agent:tty:data (×N) → agent:tty:close / agent:tty:error
```

### 交互
```
agent:plan:confirm → agent:user:injected
```

---

## SessionActor 事件桥接

`SessionActor`（`llm-engine/src/core/session-actor.ts`）将 ILoop 协程的 canonical `AgentEvent` 桥接至 `SessionEventBus`。事件统一为 `SessionEvent`（= `AgentEvent` | `MessageProjectionEvent` | `SessionStructuralEvent`），不再有 `OrchestratorEvent` 翻译层：

| ILoop yield | 桥接后事件 |
|---|---|
| `stream:content` | `message:updated` field=`output` |
| `stream:thinking` | `message:updated` field=`thought` |
| `tool:queued` / `tool:running` / `tool:success` / `tool:error` | canonical AgentEvent forward |
| `turn:start` / `turn:end` | canonical AgentEvent forward |
| `finished` | canonical AgentEvent forward |
| `error` | canonical AgentEvent forward |
| `await_signal` | 由 `drive()` 内部处理，不 emit |

---


## UI 消费链

```
SessionActor (onEvent) → SessionEventBus → SessionEventHandler → HistoryView / StreamController
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
| `regenerate_started/completed` | 分支再生 |
| `branch_switched/deleted` | 切换/删除分支 |

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
MissionScheduler.checkTodo() → HITLQueue.push(request)
  → emit request to listener
  → UI 展示 HITL 问题 → 用户回答 → HITLQueue.resolve(id, response)
  → MissionScheduler 继续执行
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
