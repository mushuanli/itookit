# C4 - 代码级交互图

## Agent 循环流程

### AgentLoopExecutor（while-true，兼容旧接口）

```
while(true):
  1. Flush injections
  2. Budget Check（6 维）
  3. Context Compress（4 层，ratio ≥ 0.75 触发）
  4. Build messages（system prompt + history + compressionSummary）
  5. LLM Call via ErrorRecoveryService.callWithRecovery()
  6. Update usage

分支 A — 有 tool_calls：
  → Plan Confirm → Permission Check
  → 读操作并行（sideEffect=none，Promise.all）
  → 写操作串行（sideEffect≠none，for 循环）
  → After-tool Back-pressure check → GOTO 1

分支 B — 无 tool_calls：
  → Before-final Back-pressure check
  → 通过 → break
  → 失败 → inject 修正指令 → GOTO 1
```

### LoopExecutor（AsyncGenerator ILoop，mode='loop'/'loop:full'）

```
drive(gen, actor, ctx):
  generator.next(signal) → yield AgentEvent → actor.emit(event)
  1. Budget middleware (beforeExchange)
  2. Compression middleware (beforeExchange, full preset only)
  3. Build messages from log.fold() + Provider validation
  4. LLM Call via ILLMService.chatStream() → yield stream:content/thinking
  5. Error recovery middleware (onError → retry/compress/fallback)
  6. Parse tool_calls → onToolCalls middleware (plan confirm → pause)
  7. Execute tools (reads 并行, writes 串行) → yield tool:queued/running/success/error
  8. afterExchange middleware (back-pressure → inject/continue)
  9. yield round:end → checkpoint → continue or return Round[]
```

## 会话执行 — 统一 TaskGraph 路径

所有提交编译为 TaskGraphRun，由 TaskGraphReconciler 统一调度：

```
SessionManager.sendMessage()
  └─ TaskRunner.submit() → processQueue()
       ├─ sendIntent.kind === 'flow'
       │    └─ executeFlowTask()
       │         └─ TaskGraphReconciler.run(createTaskGraphRun(flow))
       └─ 其他
            └─ executeV3ChatTask()
                 └─ 编译为单节点 AgentTask Flow → TaskGraphReconciler.run()
                      └─ AgentTaskExecutor → executeV3Agent()
                           └─ ExecutorRegistry.get(mode).run(ctx) → drive(gen, actor, ctx)
```

## 引导序列图

`initApp()` 在 `app-shell/src/bootstrap.ts`：

1. `createVFS({ rootBackend, modules })` — VFS 引擎 + 模块挂载
2. `LLMDeviceDriver(vfs)` → `init()` → 注册设备节点
3. `createSettingsModule(vfs)` — 设置模块
4. `VFSAgentService(vfs, llmDriver)` — Agent 配置持久化
5. `createHarness({ llmDriver })` — 装配 Agent 循环 → `{ runtime, llmService, ... }`
6. `harness.toolDriver.setVFSContext(...)` — VFS 桥接
7. `syncSkillsToHarness(llmDriver, harness)` — Skill 同步
8. `initializeLLMEngine({ agentService, sessionEngine, llmService })` — 引擎装配
9. Workspace 策略注入 + 路由启动

## 事件流

ILoop 协程 → SessionActor → SessionEventBus → SessionEventHandler → UI

| ILoop yield | SessionEvent | UI 效果 |
|---|---|---|
| `stream:content` | `message:updated` field=`output` | 流式文字追加 |
| `stream:thinking` | `message:updated` field=`thought` | 思考过程更新 |
| `tool:queued` / `tool:running` | canonical AgentEvent forward | 创建 tool 子节点 |
| `tool:success` / `tool:error` | canonical AgentEvent forward | 更新 tool 节点状态 |
| `round:start` / `round:end` | canonical AgentEvent forward | 轮次边界标记 |
| `finished` | canonical AgentEvent forward | 完成，汇总 token 用量 |
| `error` | canonical AgentEvent forward | 错误展示 |
| `await_signal` | drive() 内部处理 | HITL 暂停，等待 Signal |

事件统一为 `SessionEvent`（`AgentEvent` | `MessageProjectionEvent` | `SessionStructuralEvent`）。
