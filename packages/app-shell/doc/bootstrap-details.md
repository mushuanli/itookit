# app-shell 启动与装配

`initApp()` 是跨包具体实现的唯一装配点：

```text
1. createVFS
2. 初始化 LLMDeviceDriver
3. 创建 Settings、VFSAgentService、ChatEngine
4. createHarness({ llmDriver, vfsPort })
5. initializeConversationSystem({
     agentService,
     sessionEngine,
     processHost: harness.kernel,
     dagPlugins: harness.dagPlugins,
   })
6. 创建 WorkspaceStrategy
7. 绑定路由和事件
8. 加载初始 Workspace
```

Harness 装配资源与 Scheduler，Conversation 装配 Session、Round 和命令插件。普通聊天通过 Direct Scheduler 执行，显式 Flow 才使用 DagScheduler。

浏览器环境通过 `VfsPort` 将 Process 文件访问映射到虚拟文件系统，不允许 Process 直接访问 `node:fs`。
