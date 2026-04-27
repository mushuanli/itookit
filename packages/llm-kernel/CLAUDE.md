# CLAUDE.md — @itookit/llm-kernel

执行引擎核心层。管理 Executor（执行器）和 Orchestrator（编排器），事件驱动架构，插件化扩展。**无 UI 依赖**。

## Commands

```bash
pnpm --filter @itookit/llm-kernel build       # tsup
pnpm --filter @itookit/llm-kernel dev         # tsup --watch
pnpm --filter @itookit/llm-kernel test        # vitest
pnpm --filter @itookit/llm-kernel test:coverage
pnpm --filter @itookit/llm-kernel typecheck   # tsc --noEmit
pnpm --filter @itookit/llm-kernel lint
```

## Architecture

```
src/
├── index.ts                ← 公共 API + initializeKernel()
├── core/
│   ├── types.ts            ← ExecutionTask, OrchestratorEvent, SessionRuntime...
│   ├── interfaces.ts       ← IExecutor, IOrchestrator, IRuntime...
│   ├── event-bus.ts        ← KernelEventBus
│   ├── execution-context.ts
│   └── device-registry.ts  ← setKernelDeviceManager / getKernelDeviceManager
├── executors/              ← 4 种执行器
│   ├── base-executor.ts
│   ├── agent-executor.ts   ← LLM Agent 执行
│   ├── http-executor.ts    ← HTTP 请求执行
│   ├── tool-executor.ts    ← 工具调用执行
│   └── script-executor.ts  ← 脚本执行 (Python/JS/Bash)
├── orchestrators/          ← 5 种编排器
│   ├── base-orchestrator.ts
│   ├── serial.ts           ← 串行
│   ├── parallel.ts         ← 并行
│   ├── router.ts           ← 条件路由
│   ├── loop.ts             ← 循环
│   └── dag.ts              ← DAG 依赖图
├── runtime/
│   ├── execution-runtime.ts ← ExecutionRuntime — 核心运行时
│   ├── state-machine.ts    ← 状态机
│   └── memory-store.ts     ← MemoryStore (key-value, TTL)
├── plugins/
│   ├── plugin-interface.ts ← IKernelPlugin
│   └── plugin-manager.ts   ← PluginManager
├── cli/
│   └── index.ts            ← CLIRunner — CLI 入口
├── worker/
│   └── index.ts            ← WorkerAdapter/WorkerClient
└── utils/
    ├── id-generator.ts     ← generateExecutionId, generateNodeId...
    └── validators.ts       ← validateExecutorConfig...
```

## Key Components

### Executors

| 执行器 | 用途 | 配置 |
|---|---|---|
| `AgentExecutor` | LLM Agent：消息 → LLM → 响应 | modelRoles, systemPrompt |
| `HttpExecutor` | HTTP 请求 → 响应 | url, method, headers |
| `ToolExecutor` | 工具函数调用 | toolId, args |
| `ScriptExecutor` | 脚本执行 | language (python/js/bash), code |

### Orchestrators

| 编排器 | 调度策略 |
|---|---|
| `SerialOrchestrator` | 按顺序执行 task 列表 |
| `ParallelOrchestrator` | 并行执行，控制并发数 |
| `RouterOrchestrator` | 条件分支选择 |
| `LoopOrchestrator` | 循环执行直到条件满足 |
| `DAGOrchestrator` | 按 DAG 拓扑顺序执行 |

### ExecutionRuntime

全局运行时，持有所有 Executor 和 Orchestrator 的注册表：

```typescript
const runtime = getRuntime();
runtime.registerExecutor('agent', new AgentExecutor());
const orchestrator = runtime.getOrchestrator('serial');
```

### MemoryStore

Key-value 内存存储，支持 TTL、作用域隔离：

```typescript
const store = getGlobalMemoryStore();
store.set('key', value, { ttlMs: 60000 });
const value = store.get('key');
```

## initializeKernel()

```typescript
const { runtime, pluginManager } = await initializeKernel({
    plugins: [],        // IKernelPlugin[]
    config: {},         // 全局配置
});
```

## Conventions

- 此包不依赖任何 UI 库
- Executor 和 Orchestrator 都通过注册表模式管理（类似 Strategy 模式）
- `generateExecutionId()` / `generateNodeId()` — 使用带时间戳的短 ID 格式（非 UUID）
- 此包由 `llm-engine` 的 `initializeLLMEngine()` 在启动时初始化
