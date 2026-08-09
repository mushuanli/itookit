# C3 - LLM 子系统组件图

## 三层 LLM 栈

```
device-llm   →  LLMConnection / streaming / MCP / multi-provider / Skill 存储
llm-harness  →  HarnessLoopExecutor (ILoop) + HarnessAgentTaskExecutor (TaskExecutor)
                + built-in tools + TTY + HITLQueue + BudgetController + ContextManager
llm-runtime   →  SessionManager + ChatEngine + TaskGraph reconciler + ILoop executors
                + Plugin system (CommandBus + ExtensionRegistry) + ContextAssembler
llm-ui       →  Chat UI + Agent editor + Settings editors + TaskGraphWorkbench
```

## device-llm 核心组件

| 组件 | 职责 |
|---|---|
| `LLMDeviceDriver` | /dev/llm 设备驱动，IOCTL 接口 |
| `BaseProvider` | 多 Provider 抽象基类 |
| `OpenAIProvider` | OpenAI/GPT API 实现 |
| `AnthropicProvider` | Anthropic/Claude API 实现 |
| `GeminiProvider` | Gemini API 实现 |
| `LLMChain` | 链式调用、SSE 流式、工具调用 |
| `SkillManager` | SkillDefinition CRUD |
| `MCPClient` | MCP 协议客户端 |
| `CostStore` | 费用跟踪 |

## llm-harness 核心组件

| 组件 | 职责 |
|---|---|
| `createHarness()` | 一站式装配工厂 |
| `AgentLoopExecutor` | 多轮 while(true) agent 循环（兼容旧 IAgentRuntime） |
| `HarnessLoopExecutor` | AsyncGenerator ILoop（mode='harness'），接入 drive() 协议 |
| `HarnessAgentTaskExecutor` | TaskExecutor 实现，harness → TaskGraph 桥接 |
| `BudgetController` | 6 维度预算控制 |
| `ContextManager` | 4 层上下文压缩 + System Prompt 构建 |
| `ErrorRecoveryService` | 5 类错误恢复 |
| `SubAgentRouter` | 上下文防火墙子 Agent 路由 |
| `HarnessMiddleware` (6 个) | budget / error-recovery / hitl / back-pressure / compression / skills |
| `SkillDeviceDriver` | Skill 设备驱动 |
| `HITLQueue` | 人机交互队列 |
| `LLMServiceAdapter` | IDeviceDriver → ILLMService 适配 |
| `NodeShellRunner` | Node.js Shell 执行器 |
| `AgentDeviceDriver` | IAgentRuntime 实现 |

## llm-runtime 核心组件

| 组件 | 职责 |
|---|---|
| `SessionManager` | 会话生命周期管理（ISession 门面） |
| `TaskRunner` | 任务队列 + 并发控制 + TaskGraph 提交 |
| `ChatEngine` | .chat 文件 + Round DAG 持久化 |
| `RoundLog` | ILog 完整实现（append/fold/merge/rebase） |
| `SessionEventBus` | SessionEvent 路由（bound vs background） |
| `SessionActor` | drive ↔ EventBus 桥接，Signal 队列 |
| `drive()` / `resumeDrive()` | ILoop 协程宿主（pause/resume 协议） |
| `ExecutorRegistry` | ILoop 按 mode 注册/分发 |
| `MiddlewarePipeline` | ILoopMiddleware 组合（LIFO 栈） |
| `ContextAssembler` | ContextPlan → ContextSnapshot 确定性管线 |
| `TaskGraphReconciler` | 单写控制面，事件驱动 DAG 调度 |
| `DependencyScheduler` | Kahn 拓扑排序 + 环检测 |
| `TaskExecutorRegistry` | TaskExecutor 注册/查找 |
| `HarnessContributionRegistry` | Plugin 贡献注册 + Schema 校验 |
| `CommandBus` | ICommandBus 实现 |
| `ExtensionRegistry` | ILLMPlugin 注册/激活 |
| `AgentResolver` | Agent/Connection 解析 |
| `MissionService` | Mission 编排入口 |
| `MissionTaskGraphRunner` | MissionPlan → TaskGraphRun 编译 |
| `SessionTaskGraphRunner` | Session 依赖图 → TaskGraphRun 编译 |
| `VFSAgentService` | IAgentConfigService + IAgentManagementService |

## llm-runtime 执行模式（ILoop）

| mode | 实现 | 中间件 |
|---|---|---|
| `chat` | `chatExecutor` | 无（单轮，无工具） |
| `loop` | `LoopExecutor` (lite) | budget + error-recovery + truncation |
| `loop:full` | `LoopExecutor` (full) | budget + compression + error-recovery + hitl + skills + back-pressure + truncation |

## TaskGraph 控制面

所有执行编译为 TaskGraphRun，由 TaskGraphReconciler 统一调度：

```
MissionService → MissionTaskGraphRunner → TaskGraphRun
SessionGraph   → SessionTaskGraphRunner → TaskGraphRun
Chat / Loop    → executeV3ChatTask()    → 单节点 AgentTask Flow → TaskGraphRun
Flow Intent    → executeFlowTask()      → FlowRevision → TaskGraphRun
```

内置 7 个 TaskKind：agent / route / transform / reduce / human / spawn / subflow
