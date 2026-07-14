# CLAUDE.md — @itookit/llm-harness

多轮 Agent 循环执行器 + 内置工具 + Skill 系统 + TTY + HITL。由 `createHarness()` 装配，输出 `IAgentRuntime` + `ILLMService`。

## Architecture

```
src/
├── factory.ts            ← createHarness() — 一站式装配
├── executor/             ← AgentLoopExecutor (核心循环) + Budget + Context + ErrorRecovery + BackPressure + SubAgentRouter
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

AgentLoopExecutor:
  while(true):
    1. Flush injections  2. Budget Check  3. Context Compress
    4. ★ LLM Call via ILLMService  5. tool_calls? → PlanConfirm → Permission → Execute → loop
                                       : → BackPressure → break/inject→loop
```

## LLM 2.0 迁移状态

| 组件 | 状态 |
|---|---|
| `AgentLoopExecutor` | 保持 — while-true 循环，S3 协程式改造待做（AsyncGenerator 化） |
| `LLMServiceAdapter` | ★ ILLMService 的标准实现，`llm-engine` 通过此入口调用 LLM |
| `HITLQueue` | 保持，S3 后将被 `yield await_signal` 替代 |
| `BudgetController` 等 | 保持，S3 后适配为 `ILoopMiddleware` |
| `BackPressureValidator` | 保持 — 高级 shell 验证逻辑保留；简单工具错误反馈已迁移至 `createBackPressureMiddleware`（S5） |

## Harness Call from llm-engine

S9 (2026-07-14): `HarnessAdapter` 已删除（`adapters/harness-adapter.ts` + `core/harness-context.ts`）。`IAgentRuntime` 不再通过 `HarnessAdapter` 包装——llm-engine 的 `TaskRunner` 直接通过 ILoop 路径（`executeAgentLoopTask` → `drive()`）执行。

`createHarness().llmService`（`LLMServiceAdapter` 实例）通过 `initializeLLMEngine({ llmService })` 注入，成为 engine 侧 `LoopExecutor` / `chatExecutor` / `LiteSubAgentRouter` 的统一 LLM 入口。

详情: [关键设计 + ToolMeta + 扩展点](./doc/design-details.md)

## Conventions

- Handler 必须返回 string，异常内部 try/catch
- 添加通用工具到 `@itookit/tools`（见 packages/tools/CLAUDE.md）；harness 专属工具（需 ISkillService 等运行时依赖）才放此包
- 添加事件类型使用 canonical `AgentEvent`（from `@itookit/common`），旧 `AgentEventType` 已标记 @deprecated
