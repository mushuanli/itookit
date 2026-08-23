# @itookit/llm-tasks

基于 `@itookit/kernel` 的可持久、可恢复 LLM Task Program。

该包只负责一项 LLM 工作如何向前运行，提供：

- `DurableChatProgram`
- `DurableAgentProgram`
- `ContextAssembler`
- Provider 消息适配

Program 只产生 Kernel `Effect`、`Interaction` 与领域事件。LLM、Tool 等能力由
`@itookit/coreutils` 注册，平台实现由 `apps/*` 注入。本包不负责 Session、DAG
调度、Conversation 状态、UI 或平台装配。

```typescript
import { DurableChatProgram } from '@itookit/llm-tasks';

kernel.registerProgram(new DurableChatProgram());
```

完整边界见 [Kernel Session / Task 最终设计](../../doc/feat/kernel-session-task-final-design.md)。
