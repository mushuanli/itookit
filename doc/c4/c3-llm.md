# C3 - LLM 子系统组件图 (v4.1 优化后)

## 四层 LLM 栈

```
device-llm    →  LLMConnection / streaming / MCP / SkillDefinition 存储 / migrateOldSkill
llm-kernel    →  Executor (Agent/HTTP/Tool/Script) + Runtime + PluginManager
llm-harness   →  AgentLoopExecutor (multi-turn) + built-in tools + TTY + HITLQueue
llm-engine    →  SessionManager, LLMSessionEngine, VFSAgentService + scheduler/
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
| `SkillManager` | SkillDefinition CRUD + 旧格式读时迁移 (migrateOldSkill) |
| `MCPClient` | MCP 协议客户端 |
| `CostStore` | 费用跟踪 |

> **已删除**: `SkillRegistry`（孤儿代码，零外部消费者）

## llm-kernel 核心组件

| 组件 | 职责 |
|---|---|
| `AgentExecutor` | Agent 执行器（llm 推理） |
| `HttpExecutor` | HTTP 调用执行器 |
| `ToolExecutor` | 工具执行器 |
| `ScriptExecutor` | 脚本执行器 |
| `ExecutionRuntime` | 执行运行时/状态机 |
| `PluginManager` | 内核插件管理 |

> **已删除**: 5 个 Orchestrator（Serial/Parallel/Router/Loop/DAG），全部零外部消费者

## llm-harness 核心组件

| 组件 | 职责 |
|---|---|
| `AgentLoopExecutor` | 多轮 while(true) agent 循环 |
| `BudgetController` | 6 维度预算控制 |
| `ContextManager` | 4 层上下文压缩 + System Prompt 构建 |
| `ErrorRecoveryService` | 5 类错误恢复 |
| `SubAgentRouter` | 上下文防火墙子 Agent 路由 |
| `SkillDeviceDriver` | Skill 设备驱动 |
| `HITLQueue` | 人机交互队列（唯一实现） |

## llm-engine 核心组件

| 组件 | 职责 |
|---|---|
| `SessionManager` | 会话生命周期管理 |
| `TaskRunner` | 双路径执行 (Kernel/Harness) |
| `ChatEngine` | .chat 文件持久化 |
| `HarnessAdapter` | Agent 事件 → UI 事件映射 |
| `VFSAgentService` | IConnectionReader + IAgentConfigService 实现 |
| `MissionService` | Mission 编排入口 |
| `MissionScheduler` | Mission 调度主循环（复用 getReadyItems） |
| `GraphOrchestrator` | Session 依赖图执行 |

## 新增：共享调度器

`llm-engine/src/scheduler/dependency-resolver.ts`:
- `getReadyItems()` — 通用依赖就绪计算（Mission 和 SessionGraph 共享）
- `topologicalSort()` — 拓扑排序
