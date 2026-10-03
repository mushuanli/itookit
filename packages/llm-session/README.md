# @itookit/llm-session

Conversation 语义与持久化层，负责 Session、Round、分支、上下文提交、不可变 FlowRevision 和 UI 投影。

```typescript
import { initializeConversationSystem } from '@itookit/llm-session';

const conversation = await initializeConversationSystem({
  agentService,
  sessionEngine,
  processHost: kernel.kernel,
  dagPlugins: kernel.dagPlugins,
});
```

普通 Chat 提交 Direct Run；只有显式 Flow 才提交 DAG Run。

Session manifest 只接受规范 `schemaVersion: 3` 数据，不迁移旧会话结构。

公共入口 `@itookit/llm-session/contracts` 提供会话、命令/扩展、Agent/连接管理与定价契约及纯函数，不加载 VFS、YAML 或会话运行时。实现已移除 common/llm-common 依赖。

```ts
import { configureSessionHostPorts } from "@itookit/llm-session";

configureSessionHostPorts({
  translate: key => myTranslations[key],
  logger: myLogger,
  traceBoot: async (label, operation) => {
    console.debug(label);
    return operation();
  },
});
// Create the conversation system after configuring its host ports.
// Call configureSessionHostPorts() after disposing it to reset defaults.
```

`myTranslations` 和 `myLogger` 由宿主提供，端口都可省略。默认英文提示、空日志和直接执行启动操作。配置按当前 Conversation singleton 的进程级生命周期共享；同一进程内的会话使用同一组展示端口。MindOS 的 app-core 已接回现有 i18n、日志与启动追踪。
