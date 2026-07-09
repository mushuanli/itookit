# C4 - 代码级交互图 (v4.1 优化后)

## Agent 循环流程

`AgentLoopExecutor.run()` 每次迭代：

```
1. Flush pending injections（inject() 注入的 user message）
2. Budget Check（超任意维度 → BudgetExhaustedError → status:'partial'）
3. Context Compress（ratio ≥ compressionThreshold=0.75 时触发）
4. Build messages（system prompt + history + compressionSummary 前置）
5. LLM Call via ErrorRecoveryService.callWithRecovery()
6. Update usage（含 tool call 计数）

分支 A — 有 tool_calls：
  → Plan Confirm（enablePlanConfirm && turnNumber===1）
      → intercept 'agent:plan:confirm'
      → false → cancel；string → inject 重规划；true → 继续
  → Permission Check（sideEffect !== 'none'）
      → false → tool 收到 "Permission denied"
  → 读操作并行（sideEffect=none，Promise.all）
  → 写操作串行（sideEffect≠none，for 循环）
  → After-tool Back-pressure check
  → emit 'agent:step:complete' → GOTO 1

分支 B — 无 tool_calls：
  → Before-final Back-pressure check
  → 通过 → 设置 finalResponse，break
  → 失败 → inject 修正指令 → GOTO 1
```

## Session 执行双路径

| 路径 | 触发条件 | 特点 |
|---|---|---|
| Kernel 路径 | default (useHarness=false) | 单轮、自动继续、流式 |
| Harness 路径 | useHarness=true | 多轮 agent 循环、工具调用、上下文压缩、HITL |

## 引导序列图 (v4.1 更新)

`initApp()` 8 步 + LLMUIEditors 注入：

1. `createVFS()` — VFS 引擎 + 存储后端 + 模块挂载
2. `LLMDeviceDriver` — LLM 设备驱动初始化
3. `createSettingsModule()` — 设置模块
4. `VFSAgentService` — Agent 配置 VFS 持久化（实现 IConnectionReader）
5. `createHarness()` — 装配多轮 Agent 循环
5b. **LLMUIEditors 注入** — app-shell → app-settings（解耦上行依赖）
6. `setVFSContext()` — VFS 桥接
7. `syncSkillsToHarness()` — Skill 直接传递（LLMSkill=SkillDefinition）
8. `initializeLLMEngine()` — 会话管理器 + 工作区策略

## Skill 同步简化

| 优化前 | 优化后 |
|---|---|
| `llmSkillToSkillDef()` 43 行字段映射 | 直接 `saveSkill(s)` |
| LLMSkill + SkillDefinition 双体系 | LLMSkill = SkillDefinition |
| device-llm SkillRegistry 孤儿 | 已删除 |

## 事件流

Agent 事件 → HarnessAdapter → OrchestratorEvent → UI 渲染

| Agent Event | OrchestratorEvent |
|---|---|
| `agent:stream:content` | `node_update` field=`output` |
| `agent:stream:thinking` | `node_update` field=`thought` |
| `agent:tool:start` | `node_start` (新建 tool 子节点) |
| `agent:tool:success` | `node_update` metaInfo.toolResult |
| `agent:context:compressed` | `node_update` metaInfo.compressed |
| `agent:budget:warning` | `node_update` metaInfo.budgetWarning |
| `agent:tty:open/data/close` | `node_update` metaInfo.tty* |
| `agent:plan:confirm` | `node_update` metaInfo.planConfirm |
