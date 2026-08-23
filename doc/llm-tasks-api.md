# @itookit/llm-tasks — API 参考

> 平台无关的 LLM Durable Program 层：把"一项 LLM 工作如何向前运行"表达为 Kernel `DurableTaskProgram`（init/reduce 状态机）。提供 `llm.chat` / `llm.agent` / `llm.plan` 三个程序、上下文组装与 Provider 消息适配。所有 API 从 `@itookit/llm-tasks` 根导出。

**依赖方向**：`llm-tasks → kernel → common`（+ `llm-common` / `vfs-core` 类型）。不依赖 `llm-session`、`llm-flow`、UI、DOM 或具体设备；所有外部能力（LLM/Tool）经 Kernel Effect 使用。

## 目录

- [入口：Program 清单](#入口program-清单)
- [程序输入：DurableProgramInput / DurableAgentInput](#程序输入)
- [核心类：ContextAssembler](#contextassembler)
- [核心类：ProviderMessageAdapter](#providermessageadapter)
- [程序模型：DurableChatProgram / DurableAgentProgram / DurablePlanProgram](#程序模型)
- [依赖收集：DependencyCollector](#依赖收集)
- [辅助函数：program-helpers](#辅助函数)
- [Task 输入构建：buildLlmTaskInput](#task-输入构建)
- [源码结构：文件与路径](#源码结构文件与路径)

---

## 入口：Program 清单

三个 Durable Program 通过 `manifest = { kind, version }` 注册进 Kernel，由 `llm-session` 的 `initializeConversationSystem()` 统一注册（`registerPrograms`）：

| Program | manifest | 职责 |
|---|---|---|
| `DurableChatProgram` | `llm.chat@1` | 单轮 LLM 对话（可带依赖绑定） |
| `DurableAgentProgram` | `llm.agent@1` | 多轮 Agent 循环（工具 + 预算 + 审批） |
| `DurablePlanProgram` | `llm.plan@1` | 结构化计划生成（输出 PlanState） |

```ts
import { DurableChatProgram, DurableAgentProgram, DurablePlanProgram } from '@itookit/llm-tasks';
kernel.registerProgram(new DurableChatProgram());
kernel.registerProgram(new DurableAgentProgram());
kernel.registerProgram(new DurablePlanProgram());
```

---

## 程序输入

### DurableProgramInput

所有 LLM 程序的公共输入：

```ts
interface DurableProgramInput {
    sessionId: string;
    roundId: string;
    messages: ChatMessage[];
    connectionId: string;
    model?: string;
    temperature?: number;
    maxTokens?: number;
    thinking?: boolean;
    reasoningEffort?: 'low' | 'medium' | 'xhigh';
    stream?: boolean;                 // false → 非流式回退
    dependencyBindings?: DurableDependencyBinding[];
}
```

### DurableAgentInput extends DurableProgramInput

```ts
interface DurableAgentInput extends DurableProgramInput {
    maxExchanges?: number;            // Agent 循环最大轮次
    workingDirectory?: string;
    approval?: 'none' | 'external' | 'all';
    tools?: ToolDefinition[];
    externalToolIds?: string[];
}
```

### DurableDependencyBinding

```ts
interface DurableDependencyBinding {
    taskId: string;                   // 依赖的 Task
    output?: string;                  // 提取字段路径（可选）
}
```

### DurableCapabilitySignal

程序在 `capabilities` 阶段声明需要的资源句柄：

```ts
interface DurableCapabilitySignal {
    llmHandleId: string;
    toolHandleId?: string;
}
```

### 输出

- `DurableChatOutput` — `{ message: ChatMessage; usage: TokenUsage }`
- `DurableAgentOutput extends DurableChatOutput` — Agent 最终消息 + usage
- `DurablePlanOutput` — `{ plan: PlanState }`（结构化计划）

---

## ContextAssembler

构建 LLM 调用的上下文（system + history + 压缩摘要 + 记忆）。

```ts
class ContextAssembler {
    constructor(deps: ContextAssemblerDeps);
    async assemble(input: AssemblyInput): Promise<AssemblyResult>;
}
```

**`ContextAssemblerDeps`**：`profileService`（`getProfile()`）、`historyService`、`memoryService`（可选，返回 `RetrievedMemoryEntry[]`）等注入依赖。

**`AssemblyResult`**：`{ messages: ChatMessage[]; retrievedMemory?: RetrievedMemoryEntry[]; … }` —— 组装好的消息序列 + 检索到的记忆条目。

**`RetrievedMemoryEntry`**：`{ content: string; … }` —— 单条记忆片段（LLM 上下文注入用）。

---

## ProviderMessageAdapter

Provider 无关的消息归一化（消息 → Anthropic/OpenAI/Gemini 格式）。

```ts
class ProviderMessageAdapter {
    validate(messages: ChatMessage[], options?: AdapterOptions): ChatMessage[];
    // … 消息格式转换方法
}
```

- `ProviderKind = 'anthropic' | 'openai' | 'generic'`
- `AdapterOptions`：`{ provider?: ProviderKind; … }`
- `ProviderMessageError`：格式校验失败抛错（`code` 标识具体规则）

---

## 程序模型

三个类均实现 Kernel `DurableTaskProgram<S, I, O>` 契约（`init` / `reduce` 返回 `Decision`）。

### DurableChatProgram（`llm.chat@1`）

状态机：`collecting`（等依赖）→ `llm`（调 LLM）→ complete。

```ts
class DurableChatProgram implements DurableTaskProgram<ChatState, DurableProgramInput, DurableChatOutput> {
    readonly manifest = { kind: 'llm.chat', version: '1' };
    init(input: DurableProgramInput): Decision<ChatState, DurableChatOutput>;
    reduce(state, event): Decision<ChatState, DurableChatOutput>;
}
```

`ChatState`：`{ input, phase: 'collecting'|'llm', dependencyOutputs, resolvedDependencyIds, capabilities? }`

### DurableAgentProgram（`llm.agent@1`）

多轮 Agent 循环：每轮 LLM → 解析 tool_calls → 授权执行 → 回馈，直到无工具调用或 `maxExchanges` 耗尽。

### DurablePlanProgram（`llm.plan@1`）

结构化计划生成，输出 `PlanState`（计划步骤 + 依赖）。

---

## 依赖收集

支持 DAG 依赖的 chat/agent 程序前置阶段：

```ts
collectDependency(binding: DurableDependencyBinding): KernelAction;      // 声明对某 Task 的等待
dependenciesReady(bindings: DurableDependencyBinding[], event: TaskInputEvent): boolean;
dependencyWait(bindings: Array<{ taskId: string }>): { type: 'all'; waits: … };  // WaitSpec
```

---

## 辅助函数

`program-helpers.ts` 提供的纯函数（供程序内部使用，部分对外导出）：

| 函数 | 用途 |
|---|---|
| `extractNodeOutput(value, output?)` | 从依赖 Task 输出提取字段（`output` 为路径） |
| `mergeDependencyOutput(base, deps)` | 合并多个依赖输出 |
| `llmEffect(request)` / `toolEffect(request)` | 构造 LLM / Tool EffectRequest |
| `capabilitySignal(event)` | 从输入事件解析 `DurableCapabilitySignal` |
| `response(event)` | 从 LLM Effect 完成事件取 `ChatCompletionResponse` |
| `responseEvents(response)` | 流式响应 → AgentEvent 序列 |
| `emit(event)` | 构造 `agent.event` KernelAction |
| `assistantMessage(value)` / `toolCalls(value)` / `toolName(call)` | 响应解析助手 |
| `roundEvent(...)` | Round 业务事件构造 |

**常量**：`CAPABILITY_SIGNAL = 'capabilities'`。

---

## Task 输入构建

```ts
buildLlmTaskInput(options: LlmTaskInputOptions): DurableAgentInput;
```

**`LlmTaskInputOptions`**：`{ sessionId, roundId, connectionId, messages, model?, maxExchanges?, tools?, dependencyBindings?, … }` —— 将上层会话数据组装为 `DurableAgentInput`。

---

## 源码结构：文件与路径

`@itookit/llm-tasks` 的公共 API 全部从 `packages/llm-tasks/src/index.ts` 根导出。包内按 **core / durable** 两层组织：

```
packages/llm-tasks/src/
├── index.ts                      根导出（唯一公共入口）
├── core/                         上下文组装 + Provider 适配（无状态）
│   ├── context-assembler.ts      ContextAssembler + ContextAssemblerDeps/AssemblyResult/RetrievedMemoryEntry
│   └── provider-message-adapter.ts  ProviderMessageAdapter + ProviderKind/AdapterOptions/ProviderMessageError
└── durable/                      Durable Program 实现（状态机）
    ├── types.ts                  DurableProgramInput/DurableAgentInput/DurableCapabilitySignal/
    │                             DurableChatOutput/DurableAgentOutput/DurableAgentState/DurableDependencyBinding
    ├── chat-program.ts           DurableChatProgram（llm.chat@1）
    ├── agent-program.ts          DurableAgentProgram（llm.agent@1）
    ├── plan-program.ts           DurablePlanProgram + DurablePlanInput/DurablePlanOutput（llm.plan@1）
    ├── program-helpers.ts        extractNodeOutput/llmEffect/toolEffect/response/emit 等纯函数
    ├── task-spec.ts              buildLlmTaskInput + LlmTaskInputOptions
    ├── dependency-collector.ts   collectDependency/dependenciesReady/dependencyWait
    └── *.test.ts                 单测（不导出）
```

**约定**：本包不持有 Session/Flow/Scheduler/CommandBus/通用 Middleware；新运行模式实现 `DurableTaskProgram` 并放入 `durable/`；所有等待必须返回 Kernel `WaitSpec`，State 必须可持久化（JSON 可序列化）。
