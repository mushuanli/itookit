# 文件索引 — 场景 → 关键文件

## Harness 执行内核（@itookit/harness）

| 场景 | 文件 |
|---|---|
| 内核实现（drain/submit/dispatchEffect/recover） | `harness/src/application/harness.ts` |
| 领域类型（DurableTaskProgram/EffectAdapter/KernelAction/WaitSpec/TaskSpec） | `harness/src/domain/types.ts` |
| 能力绑定（bindCapabilities） | `harness/src/application/capabilities.ts` |
| effect 工具（assertEffectGrant/interactionApproved/normalizeEffect） | `harness/src/application/effect-utils.ts` |
| 决策/durability/actions 工具 | `harness/src/application/{decision,durability,actions}.ts` |
| seqfile 存储（session/task/effect/resource/budget） | `harness/src/infrastructure/seqfile/store.ts`、`store-helpers.ts` |
| 注册表（Program/Effect/Storage/Workspace） | `harness/src/ports/registry.ts` |

## LLM 任务单元（@itookit/llm-programs）

| 场景 | 文件 |
|---|---|
| Agent 状态机（llm.agent） | `llm-programs/src/durable/agent-program.ts` |
| Chat 状态机（llm.chat） | `llm-programs/src/durable/chat-program.ts` |
| Plan 状态机（llm.plan） | `llm-programs/src/durable/plan-program.ts` |
| program 辅助（llmEffect/extractNodeOutput/capabilitySignal） | `llm-programs/src/durable/program-helpers.ts` |
| 依赖收集（collectDependency/dependenciesReady/dependencyWait） | `llm-programs/src/durable/dependency-collector.ts` |
| TaskSpec 装配（buildLlmTaskInput） | `llm-programs/src/durable/task-spec.ts` |
| 输入/输出类型（DurableAgentInput 等） | `llm-programs/src/durable/types.ts` |
| 上下文装配（ContextAssembler） | `llm-programs/src/core/context-assembler.ts` |
| provider 消息适配 | `llm-programs/src/core/provider-message-adapter.ts` |

## DAG 编排（@itookit/llm-flow）

| 场景 | 文件 |
|---|---|
| 动态图调度（DurableFlowExecutor） | `llm-flow/src/flow/executor.ts` |
| 内置插件（transform/reduce/route/spawn/agent/human） | `llm-flow/src/flow/builtin-plugins.ts` |
| Flow 程序（value/human/aggregate） | `llm-flow/src/flow/programs.ts` |
| 纯操作（transform/reduce/route/spawn/表达式求值） | `llm-flow/src/flow/operations.ts` |
| FlowDraft → DagRunSpec | `llm-flow/src/flow/to-dag.ts` |
| Flow 校验 / 环检测（findCycles） | `llm-flow/src/flow/validation.ts`、`graph.ts` |
| 插件注册表 | `llm-flow/src/flow/plugin-registry.ts` |
| DAG 控制面命令（DagCommandService） | `llm-flow/src/flow/commands.ts` |
| Flow 定义持久化（FlowDefinitionStore/FlowAssetStore） | `llm-flow/src/flow-definition-store.ts` |

## 会话语义 + 持久化（@itookit/llm-session）

| 场景 | 文件 |
|---|---|
| SessionManager / SessionRegistry | `llm-session/src/session/session-manager.ts`、`session-registry.ts` |
| SessionState（消息/分支状态机） | `llm-session/src/session/session-state.ts` |
| RoundOperations / BranchService | `llm-session/src/session/round-operations.ts`、`branch-service.ts` |
| ConversationRunCoordinator（Direct/Flow 分流） | `llm-session/src/session/conversation-run-coordinator.ts` |
| SessionRunCoordinator（DAG 运行协调） | `llm-session/src/session/session-run-coordinator.ts` |
| AgentResolver（connection/model 解析） | `llm-session/src/session/agent-resolver.ts` |
| SessionEventBus | `llm-session/src/session/session-event-bus.ts` |
| ChatEngine（IChatEngine 实现） | `llm-session/src/persistence/chat-engine.ts` |
| RoundLog（round 增量日志 + 投影） | `llm-session/src/persistence/round-log.ts` |
| RoundGraphService | `llm-session/src/persistence/round-graph-service.ts` |
| IChatEngine / ConversationManifest / RoundManifest 类型 | `llm-session/src/persistence/types.ts`、`round-types.ts` |
| 装配入口（initializeConversationSystem） | `llm-session/src/index.ts` |
| 控制面（CommandBus/ExtensionRegistry/插件） | `llm-session/src/core/`、`plugins/` |
| PromptHistoryService / VFSAgentService | `llm-session/src/services/` |

## 能力实现（@itookit/coreutils）

| 场景 | 文件 |
|---|---|
| 运行时装配（createCoreutilsRuntime） | `coreutils/src/runtime/create-coreutils-runtime.ts` |
| LLM effect（llm.chat + token 预算扣减） | `coreutils/src/effects/llm-chat-effect.ts` |
| 工具/技能/bash/tty effect | `coreutils/src/effects/{tool-call,skill-load,bash,tty}-effect.ts` |
| ILLMService 适配（→ LLMDeviceDriver） | `coreutils/src/llm/llm-service-adapter.ts` |
| Skill 设备驱动 / 技能加载 | `coreutils/src/skill/` |
| 工具定义（human-input/shell-session/tty-write） | `coreutils/src/tool/`、`coreutils/src/tty/` |
| Harness 插件注册 | `coreutils/src/plugin/coreutils-harness-plugin.ts` |

## LLM 设备（@itookit/device-llm）

| 场景 | 文件 |
|---|---|
| LLMDeviceDriver（IDeviceDriver + LLM_IOCTL） | `device-llm/src/device/llm-device-driver.ts` |
| Provider 基类 + OpenAI/Responses/Anthropic/Gemini | `device-llm/src/providers/` |
| Responses API（web_search/reasoning/citations） | `device-llm/src/providers/responses.ts` |
| Gemini grounding citations | `device-llm/src/providers/gemini.ts` |
| MCP 客户端 | `device-llm/src/skills/mcp-client.ts` |
| LLM 错误族 | `device-llm/src/errors.ts` |

## VFS（@itookit/stdio）

| 场景 | 文件 |
|---|---|
| 协议 barrel（接口/类型/常量） | `stdio/src/protocol.ts`、`interfaces/` |
| createVFS 工厂 | `stdio/src/impl/factory.ts` |
| VFSEngine / VFSManager / ModuleFS | `stdio/src/impl/engine/`、`impl/services/` |
| 通用 IO（IIOStream + pipe） | `stdio/src/interfaces/`、`impl/file-io/` |
| 事件总线（EventBus/FSEventBus） | `stdio/src/eventbus/`、`impl/event/` |
| IndexedDB 后端 | `vfsdriver-indexeddb/src/` |
| LocalFS 后端 | `vfsdriver-localfs/src/localfs-backend.ts` |

## CLI（@itookit/cli）

| 场景 | 文件 |
|---|---|
| YAML 工作流加载/校验/编译 | `cli/src/config.ts` |
| 运行时装配（harness+coreutils+flow） | `cli/src/runtime.ts` |
| 命令入口（run/events/doctor） | `cli/src/commands.ts` |
| 运行结果落盘（RunStore） | `cli/src/run-store.ts` |
| 工作区授权 | `cli/src/workspace.ts` |

## UI

| 场景 | 文件 |
|---|---|
| ChatInput（发送/插件/i18n） | `llm-ui/src/components/input/` |
| 流式历史 / Session 渲染 | `llm-ui/src/components/history/` |
| 会话事件消费 | `llm-ui/src/shell/SessionEventHandler.ts` |
| DagWorkbench（流程可视化） | `llm-ui/src/components/DagWorkbench.ts` |
| VFSUIShell（文件树） | `vfs-ui/src/shell/` |
| MDX 编辑器 | `packages/mdx/src/` |
| 设置（Provider/Connection/Agent） | `llm-ui/src/editors/` |

## 装配 / 入口

| 场景 | 文件 |
|---|---|
| initApp 装配 | `app-shell/src/bootstrap.ts` |
| App 类型（AppHarnessRuntime 等） | `app-shell/src/types.ts` |
| 特权命令服务（plan 等） | `app-shell/src/harness/privileged-command-service.ts` |
| web-app 入口 | `apps/web-app/src/` |
| 工作区策略 | `app-shell/src/strategies/` |

## 联网搜索（跨层）

| 场景 | 文件 |
|---|---|
| 三态策略纯函数（resolveWebSearchStrategy） | `llm-common/src/llm/connection.ts` |
| 策略解析 | `llm-session/src/session/agent-resolver.ts` |
| 派生 + 剥离客户端工具 + citations 投影 | `llm-session/src/session/conversation-run-coordinator.ts` |
| citations 事件发射 + 流式聚合 | `coreutils/src/effects/llm-chat-effect.ts` |
| citations 渲染 | `llm-ui/src/components/history/StreamController.ts`、`templates/NodeTemplates.ts` |
| 联网搜索开关 | `llm-ui/src/components/input/ChatInputView.ts`、`templates/ChatInputTemplates.ts` |
| CLI -p prompt 命令 | `apps/cli/src/commands.ts` |

> 详见 [web-search.md](./web-search.md)
