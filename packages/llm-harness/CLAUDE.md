# CLAUDE.md — @itookit/llm-harness

多轮 Agent 循环执行器 + 内置工具 + Skill 系统 + TTY + HITL。由 `createHarness()` 装配，输出 `IAgentRuntime` + `ILLMService`。通过 `HarnessLoopExecutor`（ILoop）和 `HarnessAgentTaskExecutor`（TaskExecutor）接入 llm-engine 的执行管线。

## Architecture

```
src/
├── factory.ts                  ← createHarness() — 一站式装配
├── executor/                   ← 执行器
│   ├── agent-loop-executor.ts      AgentLoopExecutor（while-true，兼容旧 IAgentRuntime 接口）
│   ├── harness-loop-executor.ts    ★ HarnessLoopExecutor（AsyncGenerator ILoop，mode='harness'）
│   ├── harness-middleware.ts       ★ 6 个 ILoopMiddleware 工厂（harness 级实现）
│   ├── agent-task-executor.ts      ★ HarnessAgentTaskExecutor — 适配 harness → TaskGraph
│   ├── budget-controller.ts        BudgetController（六维预算 + auto-downgrade）
│   ├── context-manager.ts          ContextManager（system prompt + messages 构建）
│   ├── error-recovery.ts           ErrorRecoveryService（五类错误恢复）
│   ├── back-pressure.ts            BackPressureValidator（Shell 反压）
│   └── sub-agent-router.ts         SubAgentRouter（子代理路由）
├── drivers/                    ← Device Driver
│   ├── agent-device-driver.ts      AgentDeviceDriver（IAgentRuntime 实现）
│   ├── skill-device-driver.ts      SkillDeviceDriver（ISkillService 实现）
│   └── tool-device-driver.ts       → @itookit/tools（ToolDeviceDriver）
├── tools/                      ← Harness 专属工具
│   ├── load-skill.ts / delegate-task.ts / delegate-agent.ts
│   ├── human-input.ts / write-result.ts
│   └── shell-session.ts / tty-write.ts / tty-close.ts
├── adapters/                   ← 适配器
│   └── llm-service-adapter.ts      ★ LLMServiceAdapter（IDeviceDriver → ILLMService）
├── services/                   ← 服务
│   └── hitl-queue.ts               HITLQueue（人工输入请求队列）
├── skills/                     ← Skill 加载
│   ├── fs-skill-loader.ts         文件系统 Skill 加载器
│   ├── compact-extractor.ts       压缩提取器
│   └── glob-matcher.ts            Glob 匹配
├── shell/                      ← Shell 执行
│   └── node-shell-runner.ts       NodeShellRunner
└── utils/                      ← 工具
    └── tool-call.ts                XML tool call 解析
```

## 核心流程

```
createHarness({ llmDriver, ttyDriver? })
  ├─ LLMServiceAdapter(llmDriver) → ILLMService
  ├─ ToolDeviceDriver(BUILTIN_TOOLS) → IToolService
  ├─ SkillDeviceDriver() → ISkillService
  ├─ AgentDeviceDriver()
  │   └─ setServices({ llm, tool, skill, hitlQueue })
  │       ├─ 创建 SubAgentRouter
  │       ├─ 注册 load_skill + delegate_task（动态工具）
  │       ├─ 注册 TTY 工具（如有 ttyDriver）
  │       └─ 注册 human_input 工具（如有 HITLQueue）
  └─ 返回 { runtime, config, toolService, skillService, llmService, agentDriver, toolDriver, skillDriver }
```

### HarnessLoopExecutor（ILoop，mode='harness'）

```
while (roundNumber < maxRounds):
  1. beforeExchange middleware（budget/compression/skills/HITL）
  2. ContextManager.buildSystemPrompt() + buildMessages()
  3. LLM Call via ILLMService.chatStream() → yield stream:content
  4. Error recovery via onError middleware → retry/compress/fallback
  5. onToolCalls middleware（plan confirm → pause → yield await_signal）
  6. Execute tools（reads 并行，writes 串行）
  7. afterExchange middleware（back-pressure → inject）
  8. Build round → log.append() → yield round:end
```

### HarnessAgentTaskExecutor（TaskExecutor）

```
HarnessAgentTaskExecutor.execute(context)
  ├─ resolveDefinition(id, version) → HarnessAgentDefinition
  ├─ 校验版本精确匹配
  └─ runtime.execute(definition, context) → TaskResult
```

这是 harness 与 llm-engine TaskGraph 控制面的桥接点。`HarnessAgentTaskExecutor` 实现 `TaskExecutor<AgentTaskConfig>`，通过 `HARNESS_AGENT_TASK_HANDLER` 注册到 `TaskExecutorRegistry`。

## 接入 llm-engine

```
initializeLLMEngine({ llmService: harness.llmService })
  └─ SessionManager.setLLMService(llmService)
       └─ TaskRunner 所有路径统一走 ILLMService.chatStream()

// mode='harness' 执行器
engine.registerExecutor(new HarnessLoopExecutor(...))

// TaskGraph Agent 执行
taskGraph.registry.register(new HarnessAgentTaskExecutor(...))
```

## 6 个 Harness 中间件

| 中间件 | 工厂函数 | 说明 |
|---|---|---|
| Budget | `createHarnessBudgetMiddleware()` | 六维预算（tokens/cost/time/rounds/tool-calls/injections）+ auto-downgrade |
| Error Recovery | `createHarnessErrorRecoveryMiddleware()` | 五类错误恢复（rate-limit/auth/context/server/unknown） |
| HITL | `createHarnessHITLMiddleware()` | 计划确认 + human_input 暂停协议 |
| Back Pressure | `createHarnessBackPressureMiddleware()` | Shell 执行结果验证 + 错误反馈注入 |
| Compression | `createHarnessCompressionMiddleware()` | 四层压缩（trim/summarize/truncate/reset） |
| Skills | `createHarnessSkillsMiddleware()` | Skill 加载 + 注入 system prompt |

这些中间件通过 `HarnessMiddlewareSet` 接口注入到 `createLoopExecutor('full', config, harness)` 中，替代 llm-engine 的内置轻量实现。

## Harness 专属工具

| 工具 | 说明 |
|---|---|
| `load_skill` | 动态加载 Skill 到当前会话 |
| `delegate_task` | 委派任务到子代理 |
| `delegate_agent` | 委派到指定 Agent |
| `human_input` | 请求人工输入（HITL） |
| `write_result` | 写入任务结果 |
| `shell_session` | 持久 Shell 会话（需 TTY driver） |
| `tty_write` / `tty_close` | TTY 交互（需 TTY driver） |

通用工具（文件读写、搜索等）已迁至 `@itookit/tools`。

## Conventions

- Handler 必须返回 string，异常内部 try/catch
- 添加通用工具到 `@itookit/tools`；harness 专属工具（需 ISkillService 等运行时依赖）才放此包
- 添加事件类型使用 canonical `AgentEvent`（from `@itookit/common`）
- 新中间件实现 `ILoopMiddleware` 接口，通过 `createHarness*Middleware()` 工厂导出
- `LLMServiceAdapter` 是 `ILLMService` 的标准实现（IDeviceDriver → ILLMService 适配）
- `HarnessAgentTaskExecutor` 是 harness 接入 TaskGraph 控制面的唯一桥接点

## 相关项目文档

| 文档 | 内容 |
|---|---|
| [架构设计](../../doc/architecture.md) | Harness 设计参考 — Agent Loop、Budget、Context 压缩、Error Recovery、Sub-Agent Router |
| [集成链](../../doc/integration-chains.md) | createHarness → initializeLLMEngine 装配链 |
| [Harness v3](../../doc/feat/harness-v3.md) | TaskGraph v3 架构决策 — Task/Agent/State 三核心分离 |
| [设计详情](./doc/design-details.md) | Tool 执行规则、4 层压缩、6 维预算、扩展点 |
| [接口契约](../../doc/interface-contracts.md) | IAgentRuntime / ISkillService / IToolService / ILLMService |
| [文件索引](../../doc/file-index.md) | 场景 → 关键文件映射 |
