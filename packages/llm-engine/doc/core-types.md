# llm-engine — 核心类型与运行时

## 类型体系

### 三层事件类型

```
AgentEvent (common)            ← canonical，15 变体（stream:content / tool:queued / finished 等）
    ↓ SessionActor.emit()
MessageProjectionEvent (engine) ← UI 树投影（message:appended / message:updated / message:status）
    ↓ SessionEventBus.emitSession()
SessionStructuralEvent (engine) ← 结构变更（branch:switched / regenerate_started 等）
```

三者组成 `SessionEvent` 联合类型，消费者统一处理。

### 关键类型

**SessionGroup** (`core/types.ts`):
```
{ id, timestamp, role: 'user'|'assistant', content?, files?, executionRoot?,
  persistedNodeId?, siblingIndex?, siblingCount?, branchInfo?, parentUserSessionId?,
  origin?, historyPolicy?, roundId? }
```

**ExecutionNode** (`core/types.ts`):
```
{ id, parentId?, executorType: 'agent'|'tool'|'http'|'script'|'composite',
  name, status: NodeStatus, startTime, endTime?,
  data: { input?, thought?, output?, toolCall?, metaInfo?, error? },
  children? }
```

**SessionEvent** (`core/types.ts`) — 三层联合:
- `AgentEvent` — canonical，15 变体（从 ILoop executor yield）
- `MessageProjectionEvent` — 3 变体（`message:appended` / `message:updated` / `message:status`）
- `SessionStructuralEvent` — 7 变体（`branch:switched` / `regenerate_started` / `sibling:switched` 等）

**TaskInput** (`core/types.ts`):
```
{ sessionId, nodeId, text, files, agentId, overrides?, skipUserMessage?,
  parentUserNodeId?, branchInfo?, regenerateContext?, origin?, historyPolicy?,
  sendIntent?, roundTarget? }
```

## SessionState — 会话内存状态

```
SessionState
  ├── sessions: SessionGroup[]          ← 所有轮次的 user+assistant 对
  ├── addUserMessage(text, files, nodeId) → SessionGroup
  ├── createAssistantMessage(config, nodeId, branchInfo) → ExecutionNode
  ├── appendToNode(nodeId, chunk, 'thought'|'output')
  ├── updateNodeStatus(nodeId, status)
  └── getLastSession() / clone() / exportToMarkdown()
```

## TaskRunner — 统一执行路径

所有任务提交编译为 TaskGraph Flow，由 `TaskGraphReconciler` 调度：

```
submit(task) → queue → processQueue()
  ├─ sendIntent.execution.kind === 'flow'
  │    → executeFlowTask() → TaskGraphReconciler.run(createTaskGraphRun(flow))
  └─ 其他
       → executeV3ChatTask() → 编译为单节点 AgentTask Flow
            → TaskGraphReconciler.run()
                 → AgentTaskExecutor → executeV3Agent()
                      → ExecutorRegistry.get(mode) → drive(gen, actor, ctx)
```

不再有 `executeTask()` / `executeHarnessTask()` 分支。所有路径统一走 TaskGraph。

## 事件路由: bound vs background

```
isBound = (sessionId === boundSessionId)

bound session:
  → 所有 SessionEvent 通过 eventBus.emitSession() 发到 UI
  → HistoryView 实时渲染流式内容

non-bound (background) session:
  → 不发送流式 UI 事件（节省渲染）
  → 仅提升关键信号到 global bus:
      TTY open → session_tty_active
      HITL request → session_hitl_active
      HITL resolved → session_hitl_resolved
      Flow complete → task_graph_run_projected
  → completed → background_task_completed
```

## SessionManager — 公共 API

```
sendMessage(text, files, agentId, overrides?, origin?, historyPolicy?, sendIntent?)
regenerate(assistantId, options?)
regenerateFromUser(userMessageId, options?)
commitEdit(messageId, newContent, autoRerun?)
deleteMessage / deleteMessages(ids, options?)
bindSession(nodeId, sessionId) / unbindSession()
getSnapshot() / getSessions() / getStatus() / isGenerating()
switchToSibling(messageId, index) / switchBranch(name)
createBranch / getBranchTree / listBranches
getSessionSettings / saveSessionSettings
getAvailableAgents / getModelsForAgent
previewContext(agentId, pendingText) → ContextSnapshot
onEvent(handler) / onGlobalEvent(handler)
```

## TaskGraph 控制面

所有执行编译为 `TaskGraphRun`（DAG），由 `TaskGraphReconciler` 事件驱动调度。7 个内置 TaskKind：agent / route / transform / reduce / human / spawn / subflow。

详见主 CLAUDE.md § TaskGraph 控制面。
