# CLAUDE.md — @itookit/llm-harness

多轮 Agent 循环执行器 + 内置工具 + Skill 系统 + TTY + HITL。由 `createHarness()` 装配，输出 `IAgentRuntime`。

## Architecture

```
src/
├── factory.ts            ← createHarness() — 一站式装配
├── executor/             ← AgentLoopExecutor (核心循环) + Budget + Context + ErrorRecovery + BackPressure + SubAgentRouter
├── drivers/              ← AgentDeviceDriver, ToolDeviceDriver, SkillDeviceDriver
├── tools/                ← 内置工具 (file-*, shell-exec, glob/grep, load-skill, delegate-*, human-input)
├── adapters/             ← LLMServiceAdapter (IDeviceDriver → ILLMService)
├── services/             ← HITLQueue
├── tty/                  ← NodeTTYDriver, TTYSessionManager
└── shell/                ← NodeShellRunner
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

详情: [关键设计 + ToolMeta + 扩展点](./doc/design-details.md)

## Conventions

- Handler 必须返回 string，异常内部 try/catch
- 添加内置工具加入 `BUILTIN_TOOLS` 数组
- 添加事件类型在 `agent-types.ts` 的 `AgentEventType` + `AgentEventPayloads`
