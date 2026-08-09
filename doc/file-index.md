# 文件索引 — 场景 → 关键文件

## LLM Provider

| 场景 | 文件 |
|---|---|
| 新增 Provider 定义 | `device-llm/src/constants/providers.ts` |
| 注册 Provider 类 | `device-llm/src/providers/registry.ts` |
| 新增 Provider 类 | `device-llm/src/providers/<name>.ts` |
| LLM 调用核心 | `device-llm/src/core/driver.ts` |
| Provider 基类 | `device-llm/src/providers/base.ts` |
| Provider Settings UI | `llm-ui/src/editors/ProviderSettingsEditor.ts` |
| Connection Settings UI | `llm-ui/src/editors/ConnectionSettingsEditor.ts` |
| Agent 配置 UI | `llm-ui/src/editors/AgentConfigEditor.ts` |
| Attachment 处理 | `device-llm/src/utils/attachment.ts` |

## Chat Input

| 场景 | 文件 |
|---|---|
| ChatInput 主组件 | `llm-ui/src/components/input/ChatInputView.ts` |
| 模板 | `llm-ui/src/components/templates/ChatInputTemplates.ts` |
| 样式 | `llm-ui/src/styles/llm-input.css` |
| 附件管理 | `llm-ui/src/components/input/AttachmentManager.ts` |
| Slash 命令弹窗 | `llm-ui/src/components/input/plugins/SlashCommandPlugin.ts` |
| @提及弹窗 | `llm-ui/src/components/input/plugins/MentionPlugin.ts` |
| Skill 命令解析 | `llm-ui/src/components/input/SkillInvocationParser.ts` |
| Token 用量显示 | `llm-ui/src/components/input/plugins/TokenMeterPlugin.ts` |
| 插件基类 | `llm-ui/src/components/input/plugins/InputPlugin.ts` |
| Popup 面板 | `llm-ui/src/components/input/plugins/PopupPanel.ts` |

## Skill

| 场景 | 文件 |
|---|---|
| SkillDefinition 接口 | `common/src/interfaces/skills/skill-types.ts` |
| ISkillService 接口 | `common/src/interfaces/skills/skill-service.ts` |
| SkillDeviceDriver | `coreutils/src/skill/skill-device-driver.ts` |
| System Prompt 构建 | `llm-harness/src/executor/context-manager.ts` |
| FS Skill 加载 | `coreutils/src/skill/fs-skill-loader.ts` |
| LLMSkill 持久化 | `device-llm/src/device/llm-device-driver.ts` |
| Skill 设置 UI | `llm-ui/src/editors/SkillSettingsEditor.ts` |
| 同步桥接 | `app-shell/src/bootstrap.ts::syncSkillsToHarness()` |

## Harness / Agent Loop

| 场景 | 文件 |
|---|---|
| createHarness 工厂 | `llm-harness/src/factory.ts` |
| AgentLoopExecutor | `llm-harness/src/executor/agent-loop-executor.ts` |
| HarnessLoopExecutor (ILoop) | `llm-harness/src/executor/harness-loop-executor.ts` |
| HarnessAgentTaskExecutor | `llm-harness/src/executor/agent-task-executor.ts` |
| Harness Middleware (6 个) | `llm-harness/src/executor/harness-middleware.ts` |
| ContextManager | `llm-harness/src/executor/context-manager.ts` |
| SubAgentRouter | `llm-harness/src/executor/sub-agent-router.ts` |
| SessionActor 事件桥接 | `llm-runtime/src/core/session-actor.ts` |
| HITL Queue | `llm-harness/src/services/hitl-queue.ts` |
| Skill 内置工具 | `coreutils/src/tool/load-skill.ts` |

## Session / LLM Engine

| 场景 | 文件 |
|---|---|
| SessionManager | `llm-runtime/src/session/` |
| TaskRunner | `llm-runtime/src/session/task-runner.ts` |
| AgentResolver | `llm-runtime/src/session/agent-resolver.ts` |
| ChatFile 持久化 | `llm-runtime/src/persistence/chat-engine.ts` |
| RoundLog (ILog) | `llm-runtime/src/persistence/round-log.ts` |
| Mission 编排 | `llm-runtime/src/mission/` |
| Session Graph | `llm-runtime/src/session-graph/` |

## TaskGraph / Plugin

| 场景 | 文件 |
|---|---|
| TaskGraphReconciler | `llm-runtime/src/task-graph/reconciler.ts` |
| DependencyScheduler | `llm-runtime/src/task-graph/dependency-scheduler.ts` |
| Builtin Executors | `llm-runtime/src/task-graph/builtins.ts` |
| Task Catalog | `llm-runtime/src/task-graph/catalog.ts` |
| ContextAssembler | `llm-runtime/src/core/context-assembler.ts` |
| ExecutorRegistry | `llm-runtime/src/core/executor-registry.ts` |
| Loop Driver (drive/resume) | `llm-runtime/src/core/loop-driver.ts` |
| Middleware Pipeline | `llm-runtime/src/core/middleware-pipeline.ts` |
| CommandBus | `llm-runtime/src/core/command-bus.ts` |
| ExtensionRegistry | `llm-runtime/src/core/extension-registry.ts` |
| Session/Auth/History Plugins | `llm-runtime/src/plugins/` |
| TaskGraph Workbench UI | `llm-ui/src/components/TaskGraphWorkbench.ts` |
| TaskGraph Draft Controller | `llm-ui/src/components/task-graph/DraftController.ts` |
| TaskGraph Canvas | `llm-ui/src/components/task-graph/TaskGraphCanvas.ts` |

## VFS

| 场景 | 文件 |
|---|---|
| IStorageBackend 接口 | `common/src/interfaces/fs/storage/backend.ts` |
| createVFS 工厂 | `stdio/src/factory.ts` |
| VFSEngine | `stdio/src/engine/` |
| VFSManager | `stdio/src/services/` |
| ModuleFS | `stdio/src/file-io/` |
| IndexedDB 后端 | `vfsdriver-indexeddb/src/idb-backend.ts` |
| LocalFS 后端 | `vfsdriver-localfs/src/localfs-backend.ts` |
| BaseModuleService | `stdio/src/adapter-session/BaseModuleService.ts` |

## VFS UI

| 场景 | 文件 |
|---|---|
| VFSUIShell | `vfs-ui/src/shell/` |
| VFSService | `vfs-ui/src/services/VFSService.ts` |
| 文件树 | `vfs-ui/src/ui/` |
| 编辑器集成 | `vfs-ui/src/integrations/` |

## App Shell / Boot

| 场景 | 文件 |
|---|---|
| initApp() | `app-shell/src/bootstrap.ts` |
| Workspace 配置 | `apps/web-app/src/config/modules.ts` |
| Workspace Strategy | `app-shell/src/strategies/` |
| MemoryManager | `memory-manager/src/core/MemoryManager.ts` |

## i18n / 图标

| 场景 | 文件 |
|---|---|
| 中文 (source of truth) | `common/src/i18n/zh-CN.ts` |
| 英文 | `common/src/i18n/en.ts` |
| t() 运行时 | `common/src/i18n/index.ts` |
| 图标常量 | `common/src/i18n/icons.ts` |

## CSS / 主题

| 场景 | 文件 |
|---|---|
| 设计令牌 (变量) | `llm-ui/src/styles/variables.css` |
| 基础重置 | `llm-ui/src/styles/base.css` |
| 输入框 | `llm-ui/src/styles/llm-input.css` |
| 聊天气泡 | `llm-ui/src/styles/chat-nodes.css` |
| 工作区布局 | `llm-ui/src/styles/llm-workspace.css` |

## 测试

| 场景 | 文件 |
|---|---|
| app-shell 测试配置 | `app-shell/vitest.config.ts` |
| stdio 测试 | `stdio/tests/` |
| vfs-ui 测试 | `vfs-ui/tests/` |
