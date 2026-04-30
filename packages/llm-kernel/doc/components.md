# llm-kernel 组件详情

## Executors

| 执行器 | 用途 | 配置 |
|---|---|---|
| `AgentExecutor` | LLM Agent | modelRoles, systemPrompt |
| `HttpExecutor` | HTTP 请求 | url, method, headers |
| `ToolExecutor` | 工具函数调用 | toolId, args |
| `ScriptExecutor` | 脚本执行 | language (python/js/bash), code |

## Orchestrators

| 编排器 | 调度策略 |
|---|---|
| `SerialOrchestrator` | 按顺序执行 |
| `ParallelOrchestrator` | 并行执行，控制并发数 |
| `RouterOrchestrator` | 条件分支选择 |
| `LoopOrchestrator` | 循环直到条件满足 |
| `DAGOrchestrator` | DAG 拓扑顺序 |

## MemoryStore

Key-value 内存存储，支持 TTL、作用域隔离：

```typescript
const store = getGlobalMemoryStore();
store.set('key', value, { ttlMs: 60000 });
```
