# llm-harness 设计详情

## 关键设计决策

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

## 执行路径

### AgentLoopExecutor（while-true，兼容旧接口）

```
while(true):
  1. Flush injections  2. Budget Check  3. Context Compress
  4. LLM Call via ILLMService  5. tool_calls? → PlanConfirm → Permission → Execute → loop
```

### HarnessLoopExecutor（ILoop，AsyncGenerator）

通过 `yield AgentEvent` + `yield await_signal` 实现协程式暂停/恢复，接入 `drive()` 协议。6 个中间件通过 `beforeExchange` / `onToolCalls` / `afterExchange` / `onError` 钩子组合。

### HarnessAgentTaskExecutor（TaskExecutor）

Harness 接入 llm-engine TaskGraph 控制面的桥接点。实现 `TaskExecutor<AgentTaskConfig>`，由 `TaskGraphReconciler` 按 DAG 依赖调度执行。

## 接入 llm-engine

```
// ILLMService 注入
initializeLLMEngine({ llmService: harness.llmService })

// mode='harness' ILoop 注册
engine.registerExecutor(new HarnessLoopExecutor(...))

// TaskGraph Agent executor 注册
taskGraph.registry.register(new HarnessAgentTaskExecutor(runtime))
```

## 内置工具 ToolMeta 契约

```typescript
interface ToolMeta {
    id: string;
    sideEffect: 'none' | 'local' | 'external';
    timeoutMs: number;
    type: 'builtin' | 'plugin' | 'mcp';
    enabled: boolean;
    skillLoaderArgKey?: string;
}
type ToolHandler = (args, context: { cwd, signal, timeoutMs, vfs? }) => Promise<string>;
```

## 扩展点

- **添加内置工具**：`tools/` 下创建文件，加入 `BUILTIN_TOOLS`
- **添加 Harness 中间件**：`executor/harness-middleware.ts` 新增 `createHarness*Middleware()` 工厂
- **添加 BackPressure 规则**：`agentDriver.setLoopConfig({ backPressureRules: [...] })`
- **自定义 AgentTask 执行**：实现 `HarnessAgentTaskRuntime`，注入 `HarnessAgentTaskExecutor`
