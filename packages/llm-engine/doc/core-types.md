# llm-engine — 核心类型与运行时

## 类型体系

### 三层类型

```
AgentTaskRequest (common)     ← 跨包契约: IAgentRuntime.run() 入口
    ↓ TaskRunner.submit()
TaskInput (engine)            ← 引擎内部: +sessionId, nodeId, skipUserMessage
    ↓ SessionState
SessionGroup (engine)         ← UI 消费: OrchestratorEvent.session_start payload
```

### 关键类型

**SessionGroup** (`core/types.ts:152`):
```
{ id, timestamp, role: 'user'|'assistant', content?, files?, executionRoot?,
  persistedNodeId?, siblingIndex?, siblingCount?, branchInfo?, parentUserSessionId? }
```

**ExecutionNode** (`core/types.ts:77`):
```
{ id, parentId?, executorType: 'agent'|'tool'|'http'|'script'|'composite',
  name, status: NodeStatus, startTime, endTime?,
  data: { input?, thought?, output?, toolCall?, metaInfo?, error? },
  children? }
```

**OrchestratorEvent** (`core/types.ts:338`) — 16 种事件类型:
`session_start` | `node_start` | `node_update` | `node_status` | `finished` | `error` |
`session_cleared` | `messages_deleted` | `message_edited` | `regenerate_*` |
`sibling_switch` | `branch_*`

**TaskInput** (`core/types.ts:264`):
```
{ sessionId, nodeId, text, files, agentId, overrides?,
  skipUserMessage?, parentUserNodeId?, branchInfo?, regenerateContext? }
```

## SessionState — 会话内存状态

```
SessionState
  ├── sessions: SessionGroup[]          ← 所有轮次的 user+assistant 对
  ├── addUserMessage(text, files, nodeId) → SessionGroup
  ├── createAssistantMessage(config, nodeId, branchInfo) → ExecutionNode
  ├── appendToNode(nodeId, chunk, 'thought'|'output')
  ├── updateNodeStatus(nodeId, status)
  └── getLastSession() / clone() / loadFromChatNode()
```

## TaskRunner — 双执行路径

```
submit(task) → queue → processQueue()
  ├── useHarness=true + harnessAdapter
  │     → executeHarnessTask()
  │        → AgentLoopExecutor.run() (多轮循环)
  │           → HarnessAdapter.onEvent → OrchestratorEvent → UI
  │
  └── 默认
        → executeTask()
           → LLMKernelAdapter.executeQuery() (单轮)
              → auto-continue loop (evaluate → continue/break)
                 → suppressTerminalEvents (统一在循环结束后 emit finished)
```

## 事件路由: bound vs background

```
isBound = (sessionId === boundSessionId)

bound session:
  → 所有 OrchestratorEvent 通过 eventBus.emitSession() 发到 UI
  → HistoryView 实时渲染流式内容

non-bound (background) session:
  → 不发送 UI 事件 (节省渲染)
  → 仅提升关键信号到 global bus:
      TTY open → session_tty_active
      HITL request → session_hitl_active
      HITL resolved → session_hitl_resolved
  → completed → background_task_completed
```

## 消息过滤机制

| 层级 | 机制 | 位置 |
|------|------|------|
| 持久化加载 | `role === 'system'` → 跳过 | `session-manager.ts:populateState()` |
| 转换 | 非 user/assistant 的 ChatNode → null | `converters.ts:chatNodeToSessionGroup()` |
| 任务创建 | `skipUserMessage=true` → 不 emit user session | `task-runner.ts:createUserMessage()` |
| LLM 上下文 | 末尾重复/悬空 user → 移除 | `task-runner.ts:getHistory()` |
| UI 删除 | `messages_deleted` → DOM remove | HistoryView |

## SessionManager — 公共 API

```
chat(text, files?, agentId?, overrides?)    → 发送消息
regenerate(messageId, options?)             → 重新生成
regenerateFromUser(userMessageId, text)     → 编辑后重生成
commitEdit(messageId, newContent)           → 编辑消息
deleteMessages(ids)                         → 删除消息
bindSession(sessionId, nodeId)              → 绑定 UI session
getSessionState(sessionId)                  → 获取内存状态
onSessionEvent(handler)                     → 订阅 session 事件
onGlobalEvent(handler)                      → 订阅全局事件
```

## 扩展预留

`SessionGroup` 目前 `role` 只有 `'user'|'assistant'`。如需支持 agent 自动生成 / 后台隐藏消息，需新增 `origin` 和 `visibility` 字段（详见 [设计文档](../../../doc/feat/llmsession-ex.md)）。
