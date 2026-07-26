# @itookit/llm-engine

可暂停、可继续的 LLM ProcessProgram 实现。

该包只负责一项 LLM 工作如何向前运行，提供：

- `ChatProgram`
- `AgentProgram`
- `ContextAssembler`
- Provider 消息适配

它通过 `ProcessContext.resources` 使用 LLM、Tool 和 VFS 端口，不负责 Session、DAG 调度、UI 或运行时装配。

```typescript
import { ChatProgram } from '@itookit/llm-engine';

processHost.registerProgram(new ChatProgram());
```

完整边界见 [LLM v3 设计](../../doc/feat/llm-v3-design.md)。
