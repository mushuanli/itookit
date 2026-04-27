# CLAUDE.md — @itookit/llm-harness

多轮 Agent 循环执行器 + 内置工具 + Skill 系统 + TTY 设备。由 `createHarness()` 工厂装配，输出 `IAgentRuntime` 供 `llm-engine` 使用。

## Commands

```bash
pnpm --filter @itookit/llm-harness build       # tsup
pnpm --filter @itookit/llm-harness dev         # tsup --watch
pnpm --filter @itookit/llm-harness test        # vitest
pnpm --filter @itookit/llm-harness typecheck   # tsc --noEmit
```

## Architecture

```
src/
├── index.ts              ← 公共 API 出口
├── factory.ts            ← createHarness() — 一站式装配
├── executor/             ← Agent 循环核心
│   ├── agent-loop-executor.ts ← AgentLoopExecutor (核心循环)
│   ├── budget-controller.ts   ← 6维预算
│   ├── context-manager.ts     ← SystemPrompt构建 + 4层压缩
│   ├── error-recovery.ts      ← 5类错误恢复
│   ├── back-pressure.ts       ← 反压验证
│   ├── sub-agent-router.ts    ← 子Agent调度（上下文防火墙）
│   └── session-store.ts       ← 会话持久化 (localStorage)
├── drivers/              ← VFS 设备驱动
│   ├── agent-device-driver.ts ← AgentDeviceDriver (装配 AgentLoopExecutor)
│   ├── tool-device-driver.ts  ← ToolDeviceDriver (内置工具注册+执行)
│   └── skill-device-driver.ts ← SkillDeviceDriver (Skill注册+加载)
├── tools/                ← 内置工具实现
│   ├── index.ts          ← BUILTIN_TOOLS 数组
│   ├── file-read.ts / file-write.ts
│   ├── shell-exec.ts
│   ├── glob-search.ts / grep-search.ts
│   ├── load-skill.ts
│   ├── delegate-task.ts
│   ├── delegate-agent.ts
│   ├── write-result.ts
│   └── human-input.ts
├── adapters/
│   └── llm-service-adapter.ts ← IDeviceDriver → ILLMService
├── services/
│   └── hitl-queue.ts    ← HITLQueue (human-in-the-loop)
├── shell/
│   └── node-shell-runner.ts ← NodeShellRunner (child_process)
├── tty/
│   ├── node-tty-driver.ts    ← NodeTTYDriver
│   └── session-manager.ts    ← TTYSessionManager
└── utils/
    └── tool-call.ts     ← getToolName / getToolArgs
```

## createHarness() 装配顺序

```
llmDriver (IDeviceDriver)
    → LLMServiceAdapter → ILLMService

ToolDeviceDriver()      ← 注册 BUILTIN_TOOLS
SkillDeviceDriver()     ← 空 Skill 注册表

AgentDeviceDriver()
    .setServices({ llm, tool, skill })
    .setTTYDriver(ttyDriver?)   ← 条件注册 TTY 工具
    .init()                      ← 自动检测连接 + 定价

→ HarnessInstance {
    runtime: IAgentRuntime,     // AgentLoopExecutor
    config: IAgentRuntimeConfig,
    toolService: IToolService,
    skillService: ISkillService,
    agentDriver, toolDriver, skillDriver,
}
```

## Agent 循环核心流程

```
while(true):
    1. Flush pending injections  (Q3: inject() 排队的用户消息)
    2. Budget Check              (6维任一超限 → BudgetExhaustedError)
    3. Context Compress          (ratio ≥ compressionThreshold=0.75)
    4. Build Messages            (system prompt + history + compressionSummary)
    5. LLM Call + ErrorRecovery
    6. 分支：
       A. tool_calls → PlanConfirm(Q1) → Permission → Execute → BackPressure → loop
       B. 无tool_calls → BackPressure(before-final) → 通过:break / 失败:inject→loop
```

## 关键设计决策

### effectiveTools = undefined

`agent-loop-executor.ts:175` — 当前**不向 LLM 发送 function-calling schema**。原因：部分代理端点收到工具 schema 返回 500。Skill 通过 system prompt 注入指令。待端点修复后恢复 `effectiveTools = toolDefs` 即可。

### Tool 执行规则（基于 sideEffect）

| sideEffect | 并行策略 | 权限检查 |
|---|---|---|
| `none` | 并行 (`Promise.all`) | 无 |
| `local` | 串行 (`for`) | `agent:permission:request` 拦截 |
| `external` | 串行 (`for`) | `agent:permission:request` 拦截 |

### 4 层上下文压缩

| 层 | 阈值 | 名称 | 操作 |
|---|---|---|---|
| L1 | ≥ 0.70 | `history_snip` | 截断 >2000 chars 消息 |
| L2 | ≥ 0.80 | `cache_prune` | 移除旧 assistant 消息 |
| L3 | ≥ 0.85 | `llm_summarize` | LLM 摘要前 60% |
| L4 | ≥ 0.95 | `sliding_window` | 仅保留最后 6 条 |

### 6 维预算

turns(100) / inputTokens(5M) / outputTokens(1M) / cost($10) / duration(1h) / toolCalls(500)

## 内置工具 ToolMeta 契约

```typescript
interface ToolMeta {
    id: string;                          // 工具名，需与 ToolDefinition.name 一致
    sideEffect: 'none' | 'local' | 'external';
    timeoutMs: number;
    type: 'builtin' | 'plugin' | 'mcp';
    enabled: boolean;
    skillLoaderArgKey?: string;          // 若设置，成功后自动标记skill已加载
}
type ToolHandler = (args, context: { cwd, signal, timeoutMs, vfs? }) => Promise<string>;
// Handler 必须返回字符串，异常必须内部 try/catch
```

## 扩展点

- **添加内置工具**：在 `tools/` 下创建文件，导出 `meta + definition + handler`，加入 `BUILTIN_TOOLS`
- **添加 Agent 事件**：在 `agent-types.ts` 的 `AgentEventType` 和 `AgentEventPayloads` 中新增
- **添加 BackPressure 规则**：`agentDriver.setLoopConfig({ backPressureRules: [...] })`
