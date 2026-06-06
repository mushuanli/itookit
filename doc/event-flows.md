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

## HarnessAdapter 事件桥接

`llm-engine/src/adapters/harness-adapter.ts` 将 Agent 事件映射为 `OrchestratorEvent`:

| Agent Event | OrchestratorEvent |
|---|---|
| `agent:stream:content` | `node_update` field=`output` |
| `agent:stream:thinking` | `node_update` field=`thought` |
| `agent:tool:start` | `node_start` (tool 子节点) |
| `agent:tool:success` | `node_update` metaInfo.toolResult → `node_status(success)` |
| `agent:tool:error/timeout` | `node_status(failed)` |
| `agent:context:compressed` | `node_update` metaInfo.compressed |
| `agent:budget:warning` | `node_update` metaInfo.budgetWarning |
| `agent:budget:exhausted` | `error` code=`BUDGET_EXHAUSTED` |
| `agent:tty:open/data/close` | `node_update` metaInfo.ttyOpen/ttyData/ttyClose |
| `agent:plan:confirm` | `node_update` metaInfo.planConfirm |

---

## UI 消费链

```
HarnessAdapter (onEvent) → SessionEventHandler → HistoryView / StreamController
                                                      ├─ createNode (node_start)
                                                      ├─ appendChunk (node_update)
                                                      └─ markDone (node_status)
```

### OrchestratorEvent → UI

| 事件 | UI 操作 |
|---|---|
| `session_start` | 创建 session group, 渲染消息列表 |
| `node_start` | 在树中创建新节点 |
| `node_update` | 流式追加文字, 更新 thought, 更新 metaInfo |
| `node_status` | 标记完成/失败/工具结果 |
| `finished` | 更新 token stats, 停止 loading |
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
