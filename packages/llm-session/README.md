# @itookit/llm-session

会话机制：Session、Round、分支、上下文提交、运行协调和历史投影。普通 Chat 提交 Direct Run，显式 Flow 才提交 DAG Run。

```ts
import { initializeConversationSystem } from '@itookit/llm-session';

const conversation = await initializeConversationSystem({
  agentService, sessionEngine, promptHistoryFiles,
  kernel, dagPlugins, flowStore,
  hostPorts: {
    translate: key => myTranslations[key],
    logger: myLogger,
  },
  agentResolution: { missingAgent: 'reject' },
});

// Pass this instance to the editor instead of reading a process singleton.
const sessionManager = conversation.sessionManager;
await conversation.dispose();
```

宿主提供模型管理、会话仓储、提示词历史文件能力、Kernel 和 Flow 存储。翻译、日志、启动追踪均为可选的实例端口；默认英文提示、空日志和直接执行操作。多个运行时的展示配置和提示词历史互不覆盖；关闭时只释放自己的资源。

`agentResolution.missingAgent` 可以为 `'reject'`，也可以为返回 `ExecutorConfig` 的同步/异步函数，接收 Agent ID 与失败原因；省略时保留旧回退。`resolveExact` 始终严格校验 Agent 身份。授权、单写者和已锁定执行模式的约束不因回退策略改变。

`@itookit/llm-session/contracts` 提供会话、事件、命令/扩展契约，兼容转发配置管理契约，不初始化 VFS、YAML 或运行时。配置声明和纯函数从 kernel-adapters/contracts 内联到发布产物，适配器仅作为开发依赖。

Session manifest 只接受规范 `schemaVersion: 3` 数据。作文预设和播种属于 app-core 的产品装配，不再由本包导出。

迁移：删除 `configureSessionHostPorts`，改为 `initializeConversationSystem({ hostPorts, ... })`。该工厂不再设置全局 SessionManager 或 PromptHistory；使用返回的实例。旧 `createSessionManager/getSessionManager` 与提示词历史单例仍是兼容入口，不用于独立运行时装配。UI 使用 `createLLMFactory(agentService, { sessionManager, sessionRepository, ... })`。
