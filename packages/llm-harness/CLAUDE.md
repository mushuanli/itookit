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
  while(turnNumber < maxTurns):
    1. beforeTurn middleware (budget/compression/skills/HITL)
    2. ContextManager.buildSystemPrompt() + buildMessages()
    3. LLM Call via ILLMService.chatStream() → yield stream:content
    4. Error recovery via onError middleware → retry/compress/fallback
    5. onToolCalls middleware (plan confirm → pause → yield await_signal)
    6. Execute tools (reads parallel, writes serial)
    7. afterTurn middleware (back-pressure)
    8. Build turn → log.append() → yield turn:end
```

## LLM 2.0 迁移状态

| 组件 | 状态 |
|---|---|
| `AgentLoopExecutor` | 保持（向后兼容 AgentDeviceDriver） — while-true 循环，S10 已有 ILoop 替代 |
| `HarnessLoopExecutor` | ★ 新增（S10） — AsyncGenerator ILoop 实现，可注册为 mode='harness' |
| `harness-middleware.ts` | ★ 新增（S10） — 6 个 ILoopMiddleware 工厂（budget/error-recovery/hitl/back-pressure/compression/skills），包装现有 harness 服务类 |
| `LLMServiceAdapter` | ★ ILLMService 的标准实现，`llm-engine` 通过此入口调用 LLM |
| `HITLQueue` | 保持，S10 已通过 `onToolCalls` + `ControlDirective.pause` 实现暂停协议 |
| `BudgetController` 等 | ★ S10 已适配为 `ILoopMiddleware`（见 `harness-middleware.ts`） |
| `BackPressureValidator` | 保持 — 高级 shell 验证逻辑保留；简单工具错误反馈已迁移至 `createBackPressureMiddleware`（S5） |

## Harness Call from llm-engine

S9 (2026-07-14): `HarnessAdapter` 已删除（`adapters/harness-adapter.ts` + `core/harness-context.ts`）。`IAgentRuntime` 不再通过 `HarnessAdapter` 包装——llm-engine 的 `TaskRunner` 直接通过 ILoop 路径（`executeAgentLoopTask` → `drive()`）执行。

S10 (2026-07-14): `HarnessLoopExecutor` 实现 `ILoop` 接口（AsyncGenerator），通过 `initializeLLMEngine({ executors: [new HarnessLoopExecutor(...)] })` 注册为 `mode='harness'`。它使用 ContextManager（系统 prompt + 消息管理）、BudgetController（六维预算）、四层压缩、五类错误恢复、Shell 反压等完整能力，通过 6 个 `ILoopMiddleware` 组合实现。

`createHarness().llmService`（`LLMServiceAdapter` 实例）通过 `initializeLLMEngine({ llmService })` 注入，成为 engine 侧 `LoopExecutor` / `chatExecutor` / `LiteSubAgentRouter` 的统一 LLM 入口。

详情: [关键设计 + ToolMeta + 扩展点](./doc/design-details.md)

## Conventions

- Handler 必须返回 string，异常内部 try/catch
- 添加通用工具到 `@itookit/tools`（见 packages/tools/CLAUDE.md）；harness 专属工具（需 ISkillService 等运行时依赖）才放此包
- 添加事件类型使用 canonical `AgentEvent`（from `@itookit/common`），旧 `AgentEventType` 已标记 @deprecated
