# @itookit/llm-kernel

LLM 执行内核 — Agent 执行器 + 事件总线 + 运行时管理。

> **S6 (2026-07-14)**: 裁剪 ~60% 死代码 — CLI、Worker、PluginManager、StateMachine、MemoryStore、5 种 Orchestrator、Script/Http/Tool Executor、validators、logger 已删除。

## 安装

```bash
pnpm add @itookit/llm-kernel
```

## 快速开始

```typescript
import {
  initializeKernel,
  getRuntime,
  AgentExecutor
} from '@itookit/llm-kernel';

// 初始化
await initializeKernel();

// 获取运行时
const runtime = getRuntime();

// 执行配置
const result = await runtime.execute(
  {
    id: 'my-agent',
    name: 'My Agent',
    type: 'agent',
    connection: { /* ... */ }
  },
  'Hello, world!'
);

console.log(result.output);
```

## 执行器

仅保留 `agent` 类型：

| 类型 | 说明 | 使用场景 |
|------|------|----------|
| `agent` | LLM Agent 执行器 | 调用 OpenAI、Anthropic 等 LLM API |

### Agent 执行器示例

```typescript
import { AgentExecutor } from '@itookit/llm-kernel';

const agent = new AgentExecutor('my-agent', 'My Agent', {
  id: 'my-agent',
  name: 'My Agent',
  type: 'agent',
  connection: {
    provider: 'openai',
    apiKey: 'sk-xxx',
    model: 'gpt-4o'
  },
  systemPrompt: 'You are a helpful assistant.'
});
```

## 事件系统

```typescript
import { getEventBus } from '@itookit/llm-kernel';

const eventBus = getEventBus();

// 订阅所有事件
eventBus.on('*', (event) => {
  console.log(`[${event.type}]`, event.payload);
});

// 订阅特定事件
eventBus.on('stream:content', (event) => {
  process.stdout.write(event.payload.delta);
});

// 订阅节点事件
eventBus.on('node:complete', (event) => {
  console.log(`Node ${event.nodeId} completed:`, event.payload.status);
});
```

### 事件类型

| 事件 | 说明 |
|------|------|
| `execution:start` | 执行开始 |
| `execution:progress` | 执行进度更新 |
| `execution:complete` | 执行完成 |
| `execution:error` | 执行错误 |
| `execution:cancel` | 执行取消 |
| `node:start` | 节点开始 |
| `node:update` | 节点更新 |
| `node:complete` | 节点完成 |
| `node:error` | 节点错误 |
| `stream:thinking` | 思考过程流 |
| `stream:content` | 内容流 |
| `stream:tool_call` | 工具调用 |
| `state:changed` | 状态变更 |

## 工具函数

### ID 生成

```typescript
import {
  generateUUID,
  generateExecutionId,
  generateNodeId,
  generateShortId
} from '@itookit/llm-kernel';

const uuid = generateUUID();           // 'a1b2c3d4-...'
const execId = generateExecutionId();  // 'exec-lxyz123-abc'
const nodeId = generateNodeId();       // 'node-lxyz123-abc'
const shortId = generateShortId(6);    // 'abc123'
```

## API 参考

### 核心类

| 类 | 说明 |
|------|------|
| `ExecutionRuntime` | 执行运行时，Kernel 主入口 |
| `EventBus` | 事件总线 |
| `ExecutionContext` | 执行上下文 |

### 执行器

| 类 | 说明 |
|------|------|
| `BaseExecutor` | 执行器基类 |
| `AgentExecutor` | LLM Agent 执行器 |

### 工厂函数

| 函数 | 说明 |
|------|------|
| `initializeKernel()` | 初始化 Kernel |
| `getRuntime()` | 获取运行时实例 |
| `getEventBus()` | 获取事件总线 |
| `getExecutorRegistry()` | 获取执行器注册表 |
| `setKernelDeviceManager()` | 设置设备管理器 |
| `getKernelDeviceManager()` | 获取设备管理器 |

## 目录结构

```
llm-kernel/
├── src/
│   ├── index.ts                 # 主入口
│   ├── core/
│   │   ├── types.ts             # 核心类型定义
│   │   ├── interfaces.ts        # 接口契约
│   │   ├── event-bus.ts         # 事件总线
│   │   ├── execution-context.ts # 执行上下文
│   │   └── device-registry.ts   # 设备注册表
│   ├── executors/
│   │   ├── index.ts             # 执行器注册表
│   │   ├── base-executor.ts     # 执行器基类
│   │   └── agent-executor.ts    # LLM Agent 执行器
│   ├── runtime/
│   │   └── execution-runtime.ts # 执行运行时
│   └── utils/
│       └── id-generator.ts      # ID 生成器
├── package.json
├── tsconfig.json
├── vite.config.ts
└── README.md
```

## 外部消费方

llm-kernel 仅被两个包使用：

| 消费者 | 导入的符号 |
|---|---|
| `llm-engine` | `ExecutorConfig`, `NodeStatus`, `ExecutionRuntime`, `getRuntime`, `ExecutionResult`, `getEventBus`, `KernelEventMap`, `initializeKernel`, `KernelInitOptions` |
| `app-shell` | `setKernelDeviceManager` |

## 设计原则

1. **无 UI 依赖** - Kernel 不依赖任何 UI 框架
2. **事件驱动** - 通过事件系统解耦各组件
3. **类型安全** - 完整的 TypeScript 类型定义
4. **最小化** - 仅保留被外部消费的代码

## 常见问题

### Q: 如何监听流式输出？

```typescript
const eventBus = getEventBus();

eventBus.on('stream:content', (event) => {
  process.stdout.write(event.payload.delta);
});

eventBus.on('stream:thinking', (event) => {
  console.log('[Thinking]', event.payload.delta);
});
```

### Q: 如何取消正在执行的任务？

```typescript
const runtime = getRuntime();

// 执行时获取 executionId
const executionId = generateExecutionId();
const result = await runtime.execute(config, input, {
  variables: { _executionId: executionId }
});

// 在其他地方取消
runtime.cancel(executionId);
```

## License

MIT
