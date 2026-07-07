# CLAUDE.md — @itookit/llm-harness

多轮 Agent 循环执行器 + 内置工具 + Skill 系统 + TTY + HITL。由 `createHarness()` 装配，输出 `IAgentRuntime`。

## Architecture

```
src/
├── factory.ts            ← createHarness() — 一站式装配
├── executor/             ← AgentLoopExecutor (核心循环) + Budget + Context + ErrorRecovery + BackPressure + SubAgentRouter
├── drivers/              ← AgentDeviceDriver, ToolDeviceDriver, SkillDeviceDriver
├── tools/                ← Harness 专属工具 (load-skill, delegate-task); 通用工具已迁至 @itookit/tools
├── adapters/             ← LLMServiceAdapter (IDeviceDriver → ILLMService)
├── services/             ← HITLQueue
├── shell/                ← NodeShellRunner
```

## 核心流程

```
createHarness(): llmDriver → LLMServiceAdapter + Tool/Skill/Agent DeviceDriver → HarnessInstance

AgentLoopExecutor:
  while(true):
    1. Flush injections  2. Budget Check  3. Context Compress
    4. LLM Call  5. tool_calls? → PlanConfirm → Permission → Execute → loop
                             : → BackPressure → break/inject→loop
```

## Session Persistence（已废弃）

`executor/session-store.ts` 已删除。会话中断检测现在使用 VFS `.chat` 文件的 `meta.status` 字段。
遗留 `harness:session:*` localStorage key 的清理由 `llm-ui/src/shell/HarnessIntegration.ts` 的 `cleanupLegacyHarnessKeys()` 负责。

## Harness Call from llm-engine

llm-engine 的 `HarnessStrategy`（在 `adapters/harness-adapter.ts`）将 `IAgentRuntime` 包装为 `IAgentLoopStrategy`，通过 `initializeLLMEngine({ harnessRuntime })` 注入。

详情: [关键设计 + ToolMeta + 扩展点](./doc/design-details.md)

## Conventions

- Handler 必须返回 string，异常内部 try/catch
- 添加通用工具到 `@itookit/tools`（见 packages/tools/CLAUDE.md）；harness 专属工具（需 ISkillService 等运行时依赖）才放此包
- 添加事件类型在 `agent-types.ts` 的 `AgentEventType` + `AgentEventPayloads`
