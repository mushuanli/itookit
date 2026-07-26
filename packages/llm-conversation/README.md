# @itookit/llm-conversation

Conversation 语义与持久化层，负责 Session、Round、分支、上下文提交、不可变 FlowRevision 和 UI 投影。

```typescript
import { initializeConversationSystem } from '@itookit/llm-conversation';

const conversation = await initializeConversationSystem({
  agentService,
  sessionEngine,
  processHost: harness.kernel,
  dagPlugins: harness.dagPlugins,
});
```

普通 Chat 提交 Direct Run；只有显式 Flow 才提交 DAG Run。

Session manifest 只接受规范 `schemaVersion: 3` 数据，不迁移旧会话结构。
