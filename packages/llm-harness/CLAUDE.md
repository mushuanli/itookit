# CLAUDE.md — @itookit/llm-harness

多轮 Agent 循环执行器 + 内置工具 + Skill 系统 + TTY + HITL。由 `createHarness()` 装配，输出 `IAgentRuntime` + `ILLMService`。

## Architecture

```
src/
├── factory.ts            ← createHarness() — 一站式装配
├── executor/             ← AgentLoopExecutor (while-true, 兼容旧接口)
│                           ★ HarnessLoopExecutor (AsyncGenerator ILoop)
│                           ★ harness-middleware (6 个 ILoopMiddleware 工厂)
│                           BudgetController + ContextManager + ErrorRecovery + BackPressureValidator + SubAgentRouter
├── drivers/              ← AgentDeviceDriver, ToolDeviceDriver, SkillDeviceDriver
├── tools/                ← Harness 专属工具 (load-skill, delegate-task); 通用工具已迁至 @itookit/tools
├── adapters/             ← LLMServiceAdapter (IDeviceDriver → ILLMService) ★ 保留，是 ILLMService 的标准实现
├── services/             ← HITLQueue
├── shell/                ← NodeShellRunner
```

## 核心流程

```
createHarness(): llmDriver → LLMServiceAdapter + Tool/Skill/Agent DeviceDriver → HarnessInstance
  → { runtime, config, toolService, skillService, ★ llmService, agentDriver, ... }

AgentLoopExecutor (while-true, IAgentRuntime):
  while(true):
    1. Flush injections  2. Budget Check  3. Context Compress
    4. ★ LLM Call via ILLMService  5. tool_calls? → PlanConfirm → Permission → Execute → loop
                                       : → BackPressure → break/inject→loop

HarnessLoopExecutor (AsyncGenerator, ILoop, mode='harness'):
  while(roundNumber < maxRounds):
    1. beforeTurn middleware (budget/compression/skills/HITL)
    2. ContextManager.buildSystemPrompt() + buildMessages()
    3. LLM Call via ILLMService.chatStream() → yield stream:content
    4. Error recovery via onError middleware → retry/compress/fallback
    5. onToolCalls middleware (plan confirm → pause → yield await_signal)
    6. Execute tools (reads parallel, writes serial)
    7. afterTurn middleware (back-pressure)
    8. Build round → log.append() → yield round:end
```

## LLM 2.0 迁移状态

| 组件 | 状态 |
|---|---|
| `AgentLoopExecutor` | 保持（向后兼容 AgentDeviceDriver） |
| `HarnessLoopExecutor` | AsyncGenerator ILoop 实现，`resume()` 支持 |
| `harness-middleware.ts` | 6 个 ILoopMiddleware 工厂（budget/error-recovery/hitl/back-pressure/compression/skills） |
| `LLMServiceAdapter` | ILLMService 的标准实现 |
| `HITLQueue` | 保持，通过 `onToolCalls` + `ControlDirective.pause` 实现暂停协议 |
| `BudgetController` 等 | 已适配为 `ILoopMiddleware`（见 `harness-middleware.ts`） |
| `BackPressureValidator` | 保持 — 高级 shell 验证逻辑保留 |

## Harness Call from llm-engine

`HarnessLoopExecutor` 实现 `ILoop` 接口，通过 `initializeLLMEngine({ executors: [new HarnessLoopExecutor(...)] })` 注册为 `mode='harness'`。使用 ContextManager、BudgetController（六维预算）、四层压缩、五类错误恢复、Shell 反压等完整能力，通过 6 个 `ILoopMiddleware` 组合实现。

`createHarness().llmService`（`LLMServiceAdapter` 实例）通过 `initializeLLMEngine({ llmService })` 注入，成为 engine 侧的统一 LLM 入口。

详情: [关键设计 + ToolMeta + 扩展点](./doc/design-details.md)

## Conventions

- Handler 必须返回 string，异常内部 try/catch
- 添加通用工具到 `@itookit/tools`（见 packages/tools/CLAUDE.md）；harness 专属工具（需 ISkillService 等运行时依赖）才放此包
- 添加事件类型使用 canonical `AgentEvent`（from `@itookit/common`），旧 `AgentEventType` 已标记 @deprecated
