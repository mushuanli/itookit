

# @itookit/llm-kernel

LLM 执行内核 - 执行器、编排器和运行时管理。

## 特性

- 🔌 **插件化架构** - 轻松扩展执行器和编排器
- 🎯 **事件驱动** - 完全解耦的事件系统
- 🚀 **多种执行器** - Agent、HTTP、Tool、Script
- 🔀 **多种编排模式** - Serial、Parallel、Router、Loop、DAG
- 💻 **多环境支持** - 浏览器、Node.js、Worker
- 🖥️ **CLI 支持** - 命令行工具和批处理
- ⚡ **Worker 支持** - 后台线程执行，不阻塞 UI

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

## 执行器类型

| 类型 | 说明 | 使用场景 |
|------|------|----------|
| `agent` | LLM Agent 执行器 | 调用 OpenAI、Anthropic 等 LLM API |
| `http` | HTTP 请求执行器 | 调用外部 REST API |
| `tool` | 工具调用执行器 | 执行预定义的工具函数 |
| `script` | 脚本执行器 | 执行 JavaScript 代码片段 |

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

### HTTP 执行器示例

```typescript
import { HttpExecutor } from '@itookit/llm-kernel';

const http = new HttpExecutor('api-call', 'API Call', {
  id: 'api-call',
  name: 'API Call',
  type: 'http',
  url: 'https://api.example.com/data',
  method: 'POST',
  headers: { 'Authorization': 'Bearer xxx' },
  bodyTemplate: '{"query": "{{input}}"}'
});
```

### Tool 执行器示例

```typescript
import { createToolExecutor } from '@itookit/llm-kernel';

const calculator = createToolExecutor({
  name: 'calculator',
  description: 'Perform calculations',
  parameters: {
    type: 'object',
    properties: {
      expression: { type: 'string' }
    },
    required: ['expression']
  },
  handler: async (args) => {
    return eval(args.expression);
  }
});
```

### Script 执行器示例

```typescript
import { createScriptExecutor } from '@itookit/llm-kernel';

const script = createScriptExecutor('transformer', `
  const data = JSON.parse(input);
  return data.map(item => item.name).join(', ');
`);
```

## 编排模式

| 模式 | 说明 | 使用场景 |
|------|------|----------|
| `serial` | 串行执行 | 步骤依赖的工作流 |
| `parallel` | 并行执行 | 独立任务并发处理 |
| `router` | 条件路由 | 根据输入选择不同处理路径 |
| `loop` | 循环执行 | 重复处理直到满足条件 |
| `dag` | 有向无环图 | 复杂依赖关系的任务编排 |

### 串行编排示例

```typescript
const workflow = {
  id: 'serial-workflow',
  name: 'Serial Workflow',
  type: 'composite',
  mode: 'serial',
  children: [
    { id: 'step1', type: 'agent', /* ... */ },
    { id: 'step2', type: 'http', /* ... */ },
    { id: 'step3', type: 'agent', /* ... */ }
  ]
};

const result = await runtime.execute(workflow, 'Start input');
```

### 并行编排示例

```typescript
const workflow = {
  id: 'parallel-workflow',
  name: 'Parallel Workflow',
  type: 'composite',
  mode: 'parallel',
  modeConfig: {
    parallel: {
      maxConcurrency: 3
    }
  },
  children: [
    { id: 'task1', type: 'agent', /* ... */ },
    { id: 'task2', type: 'agent', /* ... */ },
    { id: 'task3', type: 'agent', /* ... */ }
  ]
};
```

### 路由编排示例

```typescript
const workflow = {
  id: 'router-workflow',
  name: 'Router Workflow',
  type: 'composite',
  mode: 'router',
  modeConfig: {
    router: {
      strategy: 'rule',
      rules: [
        { condition: 'contains:code', target: 'code-agent' },
        { condition: 'contains:translate', target: 'translate-agent' }
      ]
    }
  },
  children: [
    { id: 'code-agent', type: 'agent', /* ... */ },
    { id: 'translate-agent', type: 'agent', /* ... */ },
    { id: 'default-agent', type: 'agent', /* ... */ }
  ]
};
```

### 循环编排示例

```typescript
const workflow = {
  id: 'loop-workflow',
  name: 'Loop Workflow',
  type: 'composite',
  mode: 'loop',
  modeConfig: {
    loop: {
      maxIterations: 5,
      exitCondition: 'output.includes("DONE")'
    }
  },
  children: [
    { id: 'refine-agent', type: 'agent', /* ... */ }
  ]
};
```

### DAG 编排示例

```typescript
const workflow = {
  id: 'dag-workflow',
  name: 'DAG Workflow',
  type: 'composite',
  mode: 'dag',
  modeConfig: {
    dag: {
      edges: [
        { from: 'fetch', to: 'parse' },
        { from: 'parse', to: 'analyze' },
        { from: 'parse', to: 'summarize' },
        { from: 'analyze', to: 'report' },
        { from: 'summarize', to: 'report' }
      ]
    }
  },
  children: [
    { id: 'fetch', type: 'http', /* ... */ },
    { id: 'parse', type: 'script', /* ... */ },
    { id: 'analyze', type: 'agent', /* ... */ },
    { id: 'summarize', type: 'agent', /* ... */ },
    { id: 'report', type: 'agent', /* ... */ }
  ]
};
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

## CLI 运行器

在命令行环境中运行 Kernel，适用于脚本、批处理和自动化任务。

```typescript
import { CLIRunner, createCLIRunner } from '@itookit/llm-kernel';

// 创建 CLI 运行器
const cli = createCLIRunner({
  verbose: true,
  outputFormat: 'text',
  showThinking: true
});

// 单次执行
const result = await cli.run(agentConfig, 'Hello, world!');

// 交互模式
await cli.interactive(agentConfig);

// 批量执行
const results = await cli.batch(agentConfig, [
  'Question 1',
  'Question 2',
  'Question 3'
], { parallel: true, maxConcurrency: 2 });
```

### CLI 使用场景

- 📝 命令行 AI 工具
- 🔄 批量数据处理
- 🧪 自动化测试
- 🚀 CI/CD 流水线
- 📊 数据分析脚本

## Worker 支持

将 LLM 执行放到 Web Worker 中，避免阻塞主线程。

### Worker 脚本 (kernel.worker.ts)

```typescript
import { initializeKernel, initWorker } from '@itookit/llm-kernel';

async function bootstrap() {
  await initializeKernel();
  initWorker();
}

bootstrap();
```

### 主线程使用

```typescript
import { WorkerClient, createWorkerClient } from '@itookit/llm-kernel';

// 创建 Worker 客户端
const client = createWorkerClient(
  new URL('./kernel.worker.ts', import.meta.url)
);

// 等待 Worker 就绪
await client.waitReady();

// 执行任务
const result = await client.execute(agentConfig, 'Hello!', {
  onEvent: (event) => {
    if (event.type === 'stream:content') {
      console.log(event.payload.delta);
    }
  }
});

// 取消执行
client.cancel(executionId);

// 终止 Worker
client.terminate();
```

### Worker 使用场景

- 🖥️ 复杂 UI 应用中避免卡顿
- ⚡ 并行处理多个 AI 任务
- 🔒 隔离执行环境
- 📱 移动端性能优化

## 插件开发

```typescript
import { IKernelPlugin, PluginContext } from '@itookit/llm-kernel';

const myPlugin: IKernelPlugin = {
  metadata: {
    id: 'my-plugin',
    name: 'My Plugin',
    version: '1.0.0',
    description: 'A custom plugin'
  },
  
  async initialize(context: PluginContext) {
    // 注册自定义执行器
    context.registerExecutor('custom', (config) => {
      return new MyCustomExecutor(config);
    });
    
    // 注册自定义编排器
    context.registerOrchestrator('custom-flow', (config, factory) => {
      return new MyCustomOrchestrator(config, factory);
    });
    
    // 订阅事件
    context.onEvent('execution:complete', (event) => {
      context.log.info('Execution completed:', event.payload);
    });
    
    context.log.info('Plugin initialized');
  },
  
  async destroy() {
    // 清理资源
  }
};

// 使用插件
await initializeKernel({
  plugins: [myPlugin]
});
```

## 状态机

用于管理复杂的执行状态。

```typescript
import { createStateMachine } from '@itookit/llm-kernel';

const machine = createStateMachine({
  id: 'my-workflow',
  initial: 'idle',
  context: { retryCount: 0 },
  states: {
    idle: {
      on: { START: 'running' }
    },
    running: {
      on: {
        COMPLETE: 'completed',
        ERROR: 'failed',
        PAUSE: 'paused'
      }
    },
    paused: {
      on: { RESUME: 'running' }
    },
    completed: {
      on: { RESET: 'idle' }
    },
    failed: {
      on: {
        RETRY: {
          target: 'running',
          guard: (ctx) => ctx.retryCount < 3
        }
      }
    }
  }
});

// 发送事件
await machine.send('START');
console.log(machine.getState()); // 'running'
```

## 内存存储

用于执行过程中的临时数据存储。

```typescript
import { createMemoryStore, getGlobalMemoryStore } from '@itookit/llm-kernel';

// 创建独立存储
const store = createMemoryStore();

// 设置值（支持 TTL）
store.set('key', 'value', { ttl: 60000 });

// 获取值
const value = store.get('key');

// 带标签的存储
store.set('user:1', { name: 'Alice' }, { tags: ['user'] });
store.set('user:2', { name: 'Bob' }, { tags: ['user'] });

// 按标签查询
const users = store.getByTag('user');

// 全局存储
const globalStore = getGlobalMemoryStore();
```

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

### 验证器

```typescript
import { 
  validateExecutorConfig,
  validateInput,
  createValidator 
} from '@itookit/llm-kernel';

// 验证执行器配置
const result = validateExecutorConfig({
  id: 'my-agent',
  name: 'My Agent',
  type: 'agent'
});

if (!result.valid) {
  console.error('Validation errors:', result.errors);
}

// 验证输入
const inputResult = validateInput(userInput, {
  type: 'object',
  required: ['name', 'email'],
  properties: {
    name: { type: 'string', minLength: 1 },
    email: { type: 'string', pattern: '^.+@.+$' }
  }
});

// 链式验证器
const validator = createValidator()
  .addRequired()
  .addType('string')
  .addCustom(
    (input) => input.length >= 10,
    'Input must be at least 10 characters',
    'MIN_LENGTH'
  );

const validationResult = validator.validate(input);
```

## API 参考

### 核心类

| 类 | 说明 |
|------|------|
| `ExecutionRuntime` | 执行运行时，Kernel 主入口 |
| `EventBus` | 事件总线 |
| `ExecutionContext` | 执行上下文 |
| `StateMachine` | 状态机 |
| `MemoryStore` | 内存存储 |

### 执行器类

| 类 | 说明 |
|------|------|
| `BaseExecutor` | 执行器基类 |
| `AgentExecutor` | LLM Agent 执行器 |
| `HttpExecutor` | HTTP 请求执行器 |
| `ToolExecutor` | 工具调用执行器 |
| `ScriptExecutor` | 脚本执行器 |

### 编排器类

| 类 | 说明 |
|------|------|
| `BaseOrchestrator` | 编排器基类 |
| `SerialOrchestrator` | 串行编排器 |
| `ParallelOrchestrator` | 并行编排器 |
| `RouterOrchestrator` | 路由编排器 |
| `LoopOrchestrator` | 循环编排器 |
| `DAGOrchestrator` | DAG 编排器 |

### CLI & Worker

| 类 | 说明 |
|------|------|
| `CLIRunner` | 命令行运行器 |
| `WorkerAdapter` | Worker 端适配器 |
| `WorkerClient` | 主线程 Worker 客户端 |

### 工厂函数

| 函数 | 说明 |
|------|------|
| `initializeKernel()` | 初始化 Kernel |
| `getRuntime()` | 获取运行时实例 |
| `getEventBus()` | 获取事件总线 |
| `getExecutorRegistry()` | 获取执行器注册表 |
| `getOrchestratorRegistry()` | 获取编排器注册表 |
| `getPluginManager()` | 获取插件管理器 |
| `createCLIRunner()` | 创建 CLI 运行器 |
| `createWorkerClient()` | 创建 Worker 客户端 |
| `createMemoryStore()` | 创建内存存储 |
| `createStateMachine()` | 创建状态机 |
| `createValidator()` | 创建验证器链 |

## 目录结构

```
llm-kernel/
├── src/
│   ├── index.ts                 # 主入口
│   ├── core/
│   │   ├── types.ts             # 核心类型定义
│   │   ├── interfaces.ts        # 接口契约
│   │   ├── event-bus.ts         # 事件总线
│   │   └── execution-context.ts # 执行上下文
│   ├── executors/
│   │   ├── index.ts             # 执行器注册表
│   │   ├── base-executor.ts     # 执行器基类
│   │   ├── agent-executor.ts    # LLM Agent 执行器
│   │   ├── http-executor.ts     # HTTP 请求执行器
│   │   ├── tool-executor.ts     # 工具调用执行器
│   │   └── script-executor.ts   # 脚本执行器
│   ├── orchestrators/
│   │   ├── index.ts             # 编排器注册表
│   │   ├── base-orchestrator.ts # 编排器基类
│   │   ├── serial.ts            # 串行编排
│   │   ├── parallel.ts          # 并行编排
│   │   ├── router.ts            # 路由编排
│   │   ├── loop.ts              # 循环编排
│   │   └── dag.ts               # DAG 编排
│   ├── runtime/
│   │   ├── execution-runtime.ts # 执行运行时
│   │   ├── state-machine.ts     # 状态机
│   │   └── memory-store.ts      # 内存存储
│   ├── plugins/
│   │   ├── plugin-interface.ts  # 插件接口
│   │   └── plugin-manager.ts    # 插件管理器
│   ├── cli/
│   │   ├── index.ts             # CLI 导出
│   │   └── runner.ts            # CLI 运行器
│   ├── worker/
│   │   ├── index.ts             # Worker 导出
│   │   ├── worker-adapter.ts    # Worker 端适配器
│   │   └── worker-client.ts     # 主线程客户端
│   └── utils/
│       ├── id-generator.ts      # ID 生成器
│       └── validators.ts        # 验证器
├── package.json
├── tsconfig.json
├── vite.config.ts
└── README.md
```

## 与其他包的关系

```
┌─────────────────────────────────────────────────────────────┐
│                      应用层 (App)                           │
└─────────────────────────┬───────────────────────────────────┘
                          │
┌─────────────────────────▼───────────────────────────────────┐
│                    @itookit/llm-engine                      │
│                  (会话管理、UI 适配、持久化)                  │
└─────────────────────────┬───────────────────────────────────┘
                          │
┌─────────────────────────▼───────────────────────────────────┐
│                   @itookit/llm-kernel                       │
│               (执行器、编排器、运行时、插件)                  │
└─────────────────────────┬───────────────────────────────────┘
                          │
┌─────────────────────────▼───────────────────────────────────┐
│                    @itookit/llm-driver                      │
│                     (LLM API 通信层)                         │
└─────────────────────────────────────────────────────────────┘
```

| 包 | 职责 | 依赖 |
|------|------|------|
| `llm-driver` | LLM API 通信 | 无 |
| `llm-kernel` | 执行与编排 | llm-driver |
| `llm-engine` | 会话与 UI | llm-kernel, llm-driver |

## 设计原则

1. **无 UI 依赖** - Kernel 不依赖任何 UI 框架
2. **事件驱动** - 通过事件系统解耦各组件
3. **插件化** - 易于扩展新的执行器和编排器
4. **可独立运行** - 支持 CLI、Worker、Node.js 等环境
5. **类型安全** - 完整的 TypeScript 类型定义

## 常见问题

### Q: 如何添加自定义执行器？

```typescript
import { getExecutorRegistry, BaseExecutor } from '@itookit/llm-kernel';

class MyExecutor extends BaseExecutor {
  readonly type = 'my-type';
  
  protected async doExecute(input, context) {
    // 实现执行逻辑
    return this.createSuccessResult(output);
  }
}

const registry = getExecutorRegistry();
registry.registerExecutor('my-type', (config) => new MyExecutor(config));
```

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

### Q: 如何在 Worker 中使用？

```typescript
// worker.ts
import { initializeKernel, initWorker } from '@itookit/llm-kernel';

await initializeKernel();
initWorker();

// main.ts
import { createWorkerClient } from '@itookit/llm-kernel';

const client = createWorkerClient(new URL('./worker.ts', import.meta.url));
await client.waitReady();

const result = await client.execute(config, input);
```

## 更新日志

### v0.1.0

- 🎉 初始版本
- ✅ 基础执行器：Agent、HTTP、Tool、Script
- ✅ 编排器：Serial、Parallel、Router、Loop、DAG
- ✅ 事件系统
- ✅ 插件系统
- ✅ CLI 运行器
- ✅ Worker 支持
- ✅ 状态机
- ✅ 内存存储

## 贡献

欢迎提交 Issue 和 Pull Request！

## License

MIT
```

---

## 确认文件创建

请确保以下文件已创建：

```bash
# 检查目录结构
tree src/

# 应该显示：
src/
├── cli/
│   ├── index.ts
│   └── runner.ts
├── core/
│   ├── event-bus.ts
│   ├── execution-context.ts
│   ├── interfaces.ts
│   └── types.ts
├── executors/
│   ├── agent-executor.ts
│   ├── base-executor.ts
│   ├── http-executor.ts
│   ├── index.ts
│   ├── script-executor.ts
│   └── tool-executor.ts
├── index.ts
├── orchestrators/
│   ├── base-orchestrator.ts
│   ├── dag.ts
│   ├── index.ts
│   ├── loop.ts
│   ├── parallel.ts
│   ├── router.ts
│   └── serial.ts
├── plugins/
│   ├── plugin-interface.ts
│   └── plugin-manager.ts
├── runtime/
│   ├── execution-runtime.ts
│   ├── memory-store.ts
│   └── state-machine.ts
├── utils/
│   ├── id-generator.ts
│   └── validators.ts
└── worker/
    ├── index.ts
    ├── worker-adapter.ts
    └── worker-client.ts
```