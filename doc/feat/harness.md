# Harness Agent Loop 设计方案

> 状态：v2 定稿 | 日期：2026-06-19

---

## 1. 核心结论

**Claude Code Agent Loop 就是 Harness 的参考实现。**

两者本质相同：多轮 LLM 调用 + 工具执行 + 状态管理 + 事件流。差异只是协议和接口约定。因此：

- 以 `ClaudeCodeRunner` 作为 **`IAgentLoopStrategy` 的标准实现**（我们完全控制）
- 原 `llm-harness` (`IAgentRuntime`) 降格为 **`HarnessStrategy` 适配器**（兼容旧部署）
- `TaskRunner` 统一一条 `executeAgentLoopTask()` 入口，内部按策略分发
- **UI 只有一个开关**：`chatInput.harnessMode` toggle — 关 = 走旧 chat（单轮 kernel），开 = 走新 harness（Agent Loop）

---

## 2. 执行路径

```
chatInput.harnessMode toggle
        │
        ├─ OFF ──→ executeTask()          单轮 LLM，无工具循环（kernel 路径）
        │           LLMKernelAdapter → AgentExecutor → device-llm
        │
        └─ ON  ──→ executeAgentLoopTask() Agent Loop（harness 路径）
                    IAgentLoopStrategy
                         │
                         ├─ ClaudeCodeStrategy (默认，内置)
                         │   ClaudeCodeRunner → kernelAdapter.streamRaw()
                         │
                         └─ HarnessStrategy (可选，外部 IAgentRuntime)
                             HarnessAdapter → IAgentRuntime.run()
```

### 策略选择规则

```
executeAgentLoopTask() 内部：
  if (harnessAdapter 已注入 && !overrides.useClaudeCode)
    → HarnessStrategy   （向后兼容现有 llm-harness 部署）
  else
    → ClaudeCodeStrategy（默认，新部署）
```

用户/Agent 也可通过 `overrides.useClaudeCode = true` 显式强制走 ClaudeCodeStrategy。

---

## 3. 架构分层

```
┌──────────────────────────────────────────────────────────────┐
│  llm-ui              渲染层                                  │
│  chatInput.harnessMode toggle → ExecutionOverrides           │
│  HistoryView → content block 粒度事件处理                    │
│  StreamController (thinking 面板 + tool 节点增量)            │
├──────────────────────────────────────────────────────────────┤
│  llm-engine          协调层                                  │
│  TaskRunner                                                  │
│    ├─ executeTask()              单轮 kernel 路径            │
│    └─ executeAgentLoopTask()     Agent Loop 统一入口         │
│         IAgentLoopStrategy                                   │
│           ├─ ClaudeCodeStrategy  (主框架，我们自建)           │
│           └─ HarnessStrategy     (适配器，包装 IAgentRuntime) │
├──────────────────────────────────────────────────────────────┤
│  llm-kernel          执行引擎（两条路径均用）                 │
│  kernelAdapter.streamRaw() ← ClaudeCodeStrategy 直接调用     │
│  AgentExecutor ← executeTask() 调用                         │
├──────────────────────────────────────────────────────────────┤
│  device-llm          协议层                                  │
│  AnthropicProvider: output_config.effort + thinking          │
│  ApiProtocol 分发: openai-chat / anthropic-messages / gemini │
└──────────────────────────────────────────────────────────────┘
```

---

## 4. 接口定义

### 4.1 IAgentLoopStrategy

```typescript
// packages/llm-engine/src/session/agent-loop-strategy.ts

interface AgentLoopRequest {
    messages: ChatMessage[];
    llmParams: Omit<ChatCompletionParams, 'messages' | 'signal'>;
    maxTurns: number;
    signal?: AbortSignal;
}

interface AgentLoopResult {
    output: string;
    turns: TurnRecord[];
    totalUsage: SessionTokenUsage;
}

interface IAgentLoopStrategy {
    run(
        request: AgentLoopRequest,
        opts: { nodeId: string; sessionId: string; onEvent: (e: OrchestratorEvent) => void },
    ): Promise<AgentLoopResult>;
}
```

### 4.2 ClaudeCodeStrategy（主框架）

```typescript
// packages/llm-engine/src/session/claude-code-strategy.ts
// 现有 claude-code-runner.ts 重构为此文件，实现 IAgentLoopStrategy

class ClaudeCodeStrategy implements IAgentLoopStrategy {
    constructor(
        private kernelAdapter: LLMKernelAdapter,
        private toolExecutor: IToolExecutor,
    ) {}

    async run(request, opts): Promise<AgentLoopResult> {
        const messages = [...request.messages];

        for (let turn = 0; turn < request.maxTurns; turn++) {
            opts.onEvent({ type: 'turn:start', payload: { sessionId: opts.sessionId, turn } });

            // 1. LLM 调用（流式，解析 content blocks）
            const { assistantBlocks, usage } = await this.callLLM(
                messages, request.llmParams, request.signal, opts.onEvent, opts.nodeId,
            );

            // 2. 收集 tool_use 块
            const toolUses = assistantBlocks.filter(b => b.type === 'tool_use');

            if (toolUses.length > 0) {
                // 3. 执行工具，emit tool 事件
                const toolResults = await this.executeTools(toolUses, opts);

                // 4. 拼接 assistant + tool_result，继续下一轮
                messages.push({ role: 'assistant', content: assistantBlocks.map(toMessageContent) });
                messages.push({ role: 'user', content: toolResults.map(toToolResult) });
                continue;
            }

            // end_turn — 退出循环
            break;
        }

        return { output: extractFinalText(messages), turns, totalUsage };
    }
}
```

### 4.3 HarnessStrategy（兼容适配）

```typescript
// packages/llm-engine/src/adapters/harness-adapter.ts（在现有 HarnessAdapter 基础上扩展）

class HarnessStrategy implements IAgentLoopStrategy {
    constructor(private adapter: HarnessAdapter) {}

    async run(request, opts): Promise<AgentLoopResult> {
        // 将 AgentLoopRequest 转换为 AgentTaskRequest，委托给 IAgentRuntime
        const harnessRequest: AgentTaskRequest = {
            prompt: extractUserPrompt(request.messages),
            workingDirectory: (request as any).workingDirectory,
            sessionId: opts.sessionId,
            modelOverride: request.llmParams.model,
        };

        const { result } = await this.adapter.execute(
            harnessRequest, rootNode, opts.onEvent, request.signal,
        );

        return {
            output: result.response,
            turns: [],  // harness 不暴露 turn 级别细节
            totalUsage: mapHarnessUsage(result.usage),
        };
    }
}
```

### 4.4 TaskRunner 统一入口

```typescript
// packages/llm-engine/src/session/task-runner.ts

class TaskRunner {
    // ── 路由分发 ────────────────────────────────────────────────────────
    private processQueue(): void {
        const overrides = task.input.overrides;
        const isAgentLoop = !!overrides?.useHarness;  // toggle 控制的唯一入口

        if (isAgentLoop) {
            this.executeAgentLoopTask(task, ctx.state, ctx.runtime);
        } else {
            this.executeTask(task, ctx.state, ctx.runtime);  // 单轮 kernel 路径
        }
    }

    // ── Agent Loop 统一入口 ──────────────────────────────────────────────
    private async executeAgentLoopTask(task, state, runtime): Promise<void> {
        // 1-5. 公共 setup（与 executeTask 完全复用 setupTaskExecution）
        const { executorConfig, assistantNodeId, rootNode, accumulator, persist, finalize } =
            await this.setupTaskExecution(task, state);

        // 6. 选择策略：有 HarnessAdapter 且未强制 ClaudeCode → HarnessStrategy
        //              否则 → ClaudeCodeStrategy
        const strategy: IAgentLoopStrategy = this.selectStrategy(task.input.overrides);

        // 7. 构建 event bridge（与 executeHarnessTask 的 onEvent 逻辑完全相同）
        const onEvent = this.createAgentLoopEventBridge(
            task, state, rootNode, accumulator, persist, isBound,
        );

        // 8. 构建初始 messages
        const messages = await this.buildInitialMessages(task, state, executorConfig);
        const llmParams = this.buildLLMParams(executorConfig, task.input.overrides);

        // 9. 运行
        const result = await strategy.run(
            { messages, llmParams, maxTurns: task.input.overrides?.maxTurns ?? 50,
              signal: task.abortController.signal },
            { nodeId: rootNode.id, sessionId: task.sessionId, onEvent },
        );

        // 10. 持久化 + 事件收尾（统一）
        await this.finalizeAgentLoop(task, state, rootNode, assistantNodeId,
            accumulator, finalize, result, isBound);
    }

    private selectStrategy(overrides?: ExecutionOverrides): IAgentLoopStrategy {
        const forceClaudeCode = overrides?.useClaudeCode;
        if (this.harnessAdapter && !forceClaudeCode) {
            return new HarnessStrategy(this.harnessAdapter);
        }
        return new ClaudeCodeStrategy(
            this.kernelAdapter,
            (this as any)._toolExecutor ?? nullToolExecutor,
        );
    }
}
```

---

## 5. UI 开关语义变更

### 5.1 ChatInputView — buildOverrides()

```typescript
// 变更前：useHarness 对应旧 executeHarnessTask
// 变更后：useHarness 对应新 executeAgentLoopTask（统一入口）
// 代码不需要改动，语义自然升级

if (this.config.settings.useHarness) {
    overrides.useHarness = true;                     // → executeAgentLoopTask
    if (this.config.settings.workingDirectory) {
        overrides.workingDirectory = this.config.settings.workingDirectory;
    }
}
// useClaudeCode 不在 UI 层设置，由 selectStrategy() 自动决策
```

### 5.2 开关行为对照

| harnessMode toggle | 走哪条路 | 底层策略 |
|---|---|---|
| **OFF（默认）** | `executeTask()` | 单轮 LLM，`LLMKernelAdapter` |
| **ON，无 HarnessAdapter** | `executeAgentLoopTask()` | `ClaudeCodeStrategy`（内置） |
| **ON，有 HarnessAdapter** | `executeAgentLoopTask()` | `HarnessStrategy`（外部 llm-harness） |
| **ON + `useClaudeCode=true`** | `executeAgentLoopTask()` | 强制 `ClaudeCodeStrategy` |

---

## 6. 数据流

### 6.1 Agent Loop 完整时序

```
用户输入 + harnessMode=ON
  │
  ▼ TaskRunner.executeAgentLoopTask()
  │
  ├─ setupTaskExecution()      公共 setup（与 kernel 路径共享）
  │
  ├─ selectStrategy()          选 ClaudeCodeStrategy 或 HarnessStrategy
  │
  ├─ buildInitialMessages()    构建初始 messages（含历史）
  │
  └─ strategy.run()            Agent Loop
       │
       ├─ [turn 0]
       │   ├─ kernelAdapter.streamRaw() → SSE chunks
       │   ├─ 解析 thinking_delta → emit stream:thinking chunk
       │   ├─ 解析 text_delta    → emit node_update(field='output')
       │   ├─ 解析 tool_calls    → emit tool:queued + tool:input chunks
       │   ├─ finish_reason=tool_use:
       │   │   ├─ emit tool:running
       │   │   ├─ toolExecutor.execute(name, input)
       │   │   ├─ emit tool:success / tool:error
       │   │   └─ messages.push(assistant + tool_result)
       │   └─ continue
       │
       ├─ [turn 1, 2, ...]
       │
       └─ finish_reason=end_turn → break
  │
  └─ finalizeAgentLoop()       持久化 + emit node_status:success + finished
```

### 6.2 Messages 拼接示意

```
Turn 0 初始:
  messages = [
    { role: 'user', content: "用户输入" }
  ]

Turn 0 模型返回 tool_use:
  assistant blocks = [thinking(sig=A), text("让我读文件"), tool_use(Read, id=t1)]

Turn 1 拼接后:
  messages = [
    { role: 'user', content: "用户输入" },
    { role: 'assistant', content: [
        { type: 'thinking', thinking: "...", signature: "A" },  ← signature 必须回传
        { type: 'text', text: "让我读文件" },
        { type: 'tool_use', id: "t1", name: "Read", input: {...} }
    ]},
    { role: 'user', content: [
        { type: 'tool_result', tool_use_id: "t1", content: "文件内容..." }
    ]}
  ]
```

---

## 7. OrchestratorEvent 扩展

```typescript
// 已在 llm-engine/core/types.ts 实现，供参考

type OrchestratorEvent =
    // ... 原有事件 ...

    // Agent Loop 生命周期
    | { type: 'turn:start';  payload: { sessionId: string; turn: number } }
    | { type: 'turn:end';    payload: { sessionId: string; turn: number } }

    // Content block 粒度（ClaudeCodeStrategy 发出）
    | { type: 'stream:thinking:start'; payload: { nodeId: string } }
    | { type: 'stream:thinking:stop';  payload: { nodeId: string; signature?: string } }
    | { type: 'stream:content:start';  payload: { nodeId: string } }
    | { type: 'stream:content:stop';   payload: { nodeId: string } }

    // Tool 生命周期（细化）
    | { type: 'tool:queued';  payload: { nodeId: string; name: string; toolId: string } }
    | { type: 'tool:input';   payload: { nodeId: string; toolId: string; chunk: string } }
    | { type: 'tool:running'; payload: { nodeId: string; toolId: string } }
    | { type: 'tool:success'; payload: { nodeId: string; toolId: string; result: string } }
    | { type: 'tool:error';   payload: { nodeId: string; toolId: string; error: string } };
```

---

## 8. 协议层（device-llm）

同一厂商可通过 `LLMConnection.protocol` 字段指定 API 格式，无需依赖 provider 名称：

```typescript
// packages/common/src/interfaces/llm/connection.ts
type ApiProtocol = 'openai-chat' | 'anthropic-messages' | 'gemini-generate';

interface LLMConnection {
    // ...
    protocol?: ApiProtocol;  // 未设置时由 resolveProtocol() 按 URL 自动推断
}
```

`AnthropicProvider` 支持双模式 thinking：

| `ChatCompletionParams` 字段 | 映射到 API |
|---|---|
| `thinking=true` + `reasoningEffort` | `output_config.effort` + `anthropic-beta: effort-2025-11-24` |
| `thinking=true` + `thinkingBudget` | `thinking.budget_tokens` |

---

## 9. 实施清单

### 已完成 ✅

- [x] `common`: `LLMConnection.protocol` + `ApiProtocol` 类型
- [x] `device-llm`: `AnthropicProvider` 支持 `output_config.effort` + beta header
- [x] `device-llm`: `registry.ts` 按 `protocol` 分发 Provider 类
- [x] `llm-engine/core/types.ts`: `ExecutionOverrides.useClaudeCode` + 新 `OrchestratorEvent` 变体
- [x] `llm-engine`: `claude-code-runner.ts` 实现完整 Agent Loop
- [x] `llm-engine/task-runner.ts`: `executeClaudeCodeTask` + `processQueue` 路由
- [x] `llm-ui/HistoryView.ts`: 新事件处理 + `immediateTypes` 扩展

### 待完成（本次重构）

#### Step 1 — 提取 IAgentLoopStrategy 接口

- [ ] 新建 `llm-engine/src/session/agent-loop-strategy.ts`，定义 `IAgentLoopStrategy` 接口
- [ ] 重构 `claude-code-runner.ts` → `claude-code-strategy.ts`，实现接口
- [ ] `HarnessAdapter` 新增 `HarnessStrategy` 类，实现接口

#### Step 2 — TaskRunner 统一入口

- [ ] `task-runner.ts`: 删除 `executeHarnessTask` 和 `executeClaudeCodeTask`
- [ ] `task-runner.ts`: 新增 `executeAgentLoopTask()`，内部调用 `selectStrategy()`
- [ ] `processQueue()`: 路由只剩两分支：`isAgentLoop` → `executeAgentLoopTask` / else → `executeTask`

#### Step 3 — ExecutionOverrides 清理

- [ ] 删除 `useClaudeCode`（改为 `selectStrategy` 内部自动判断）
- [ ] 保留 `useHarness`（UI toggle 的唯一入口，语义升级为"启用 Agent Loop"）
- [ ] `maxTurns` 保留

#### Step 4 — ChatInputView

- [ ] 无需改动（`useHarness=true` 自然路由到 `executeAgentLoopTask`）
- [ ] 删除 `buildOverrides()` 中已无意义的 `useClaudeCode` 相关代码（如有）

---

## 10. 风险

| 风险 | 缓解 |
|------|------|
| HarnessStrategy 和 ClaudeCodeStrategy 事件格式不一致 | 统一在 `executeAgentLoopTask` 的 `onEvent` bridge 层做归一 |
| thinking signature 链断裂 | `ClaudeCodeStrategy.callLLM` 单元测试验证回传 |
| 工具执行超时阻塞循环 | 每个工具独立 timeout，超时返回 error result 继续循环 |
| HarnessAdapter 不实现 `IAgentLoopStrategy` | 用 `HarnessStrategy` 包装，不破坏 HarnessAdapter 现有接口 |

---

## 附录：术语

| 术语 | 含义 |
|------|------|
| **Agent Loop** | 多轮 LLM + 工具循环 |
| **harnessMode** | UI toggle，控制 chat 模式 vs Agent Loop 模式 |
| **ClaudeCodeStrategy** | 内置 Agent Loop 实现（主框架） |
| **HarnessStrategy** | 包装 `IAgentRuntime`（llm-harness）的兼容适配层 |
| **IAgentLoopStrategy** | 两种策略的统一接口 |
| **Content Block** | Anthropic API 输出单位：thinking / text / tool_use |
| **Thinking Signature** | Anthropic thinking 块的数字签名，后续请求必须原样回传 |
