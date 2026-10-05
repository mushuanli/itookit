
## Workspace Structure

pnpm monorepo. Packages under `packages/`, apps under `apps/`（`apps/web-app` = `mind-os`）。

### LLM 子系统分层（单向依赖）

```
llm-session ──▶ llm-flow ──▶ llm-tasks ──▶ durable-kernel ──▶ vfs-core
（会话/持久化） （DAG 编排） （LLM 任务单元）  （执行内核）
```

### Package 清单

| Package | Role |
|---|---|
| `@itookit/common` | 通用工具、导航接口、日志、i18n 与图标元数据；无运行时包依赖，不再转发 LLM 契约。 |
| `@itookit/llm-context` | 零运行时依赖的上下文领域：Profile、装配、窗口预算、Notes、原始历史、不可变请求与内容存储端口。详见 [Context API](context-api.md)。 |
| `@itookit/durable-kernel` | 持久化执行内核：`DurableTaskProgram`（init/reduce 状态机）、`EffectAdapter`、Task/Resource/Budget/Interaction 调度与恢复。 |
| `@itookit/llm-tasks` | 平台无关的 LLM Durable Program 层：`llm.agent`/`llm.chat`/`llm.plan` 状态机、依赖收集（`collectDependency`/`dependenciesReady`/`dependencyWait`）、`extractNodeOutput`、`buildLlmTaskInput`、ContextTaskProgram v2 bridge。 |
| `@itookit/llm-flow` | DAG 编排：`DurableFlowExecutor`（route/loop/spawn/compensate/on_failure/budget）、内置插件、Flow programs、环检测（`findCycles`）、FlowDefinitionStore。 |
| `@itookit/llm-session` | 用户可见的会话语义 + 持久化：SessionManager、Round/Branch、SessionRepository（会话资产）、FlowEngine（Flow 定义存储）、RoundLog、SessionEventBus、UI projections。依赖 llm-flow。 |
| `@itookit/kernel-adapters` | Kernel 能力适配器：Effect、Exec/ApprovedEffect 程序与运行时装配；`/llm` 子入口提供 VFS 模型设备、配置、费用、Skill 和 MCP 管理。 |
| `@itookit/driver-llm` | 独立模型通信：OpenAI/Responses/Anthropic/Gemini/Codex、SSE、取消与注入式网络/日志/重试；发布产物零运行时依赖。 |
| `@itookit/device-tty` | TTY 设备驱动：node-pty 交互 shell 会话；只从 tools/contracts 取中立接口，使用 Node crypto 生成会话 ID。 |
| `@itookit/sanbox` | Seatbelt / Bubblewrap 策略与启动计划；根入口平台无关，`/node` 负责真实路径与启动探测，`native/` Rust crate 已接入 Tauri Session/Flow Bash，见 [系统沙箱](design/system-sandbox.md)。 |
| `@itookit/tools` | 内置工具实现（`buildTool()` 工厂）：File/Search/Shell/Task/Agent/Bash/Skill 等；拥有 Tool/TTY 公共执行契约，Skill/子代理契约和 MCP 纯协议入口也归本包；外部 Skill/Agent 经最小端口注入。 |
| `@itookit/vfs-sync` | 多端文件同步核心：规范 manifest、扫描完整性与三方计划、持久操作序列、冲突决策和恢复；零运行时依赖，I/O 由端口注入。 |
| `@itookit/vfs-core` | VFS 引擎核心：协议层 + 引擎实现 + 事件总线 + 通用 IO（IIOStream/pipe）。 |
| `@itookit/vfsdriver-indexeddb` | IndexedDB 存储后端（浏览器）；既有 SeqFile 记录存储与通用原生事务能力；同步适配、原子应用与 Web Locks 由 sync-adapters 提供。 |
| `@itookit/vfsdriver-agent` | HTTP 外挂文件驱动（Web/Tauri/CLI），可取消批量读取与条件写入；另提供独立 HttpSyncClient；服务端为 `tools/fs-agent`。 |
| `@itookit/vfsdriver-local` | SQLite + 本地 FS 后端（Node/Electron）。 |
| `@itookit/llm-ui` | Chat UI：聊天界面、流式历史视图、会话编排可视化。 |
| `@itookit/llm-settings-ui` | LLM 设置 UI：Agent/Provider/Connection/MCP/Skill/Cost/SystemPrompt 编辑器 + 配置导入导出（`llm-import`）。 |
| `@itookit/vfs-ui` | 独立文件/资源浏览 UI：目录导航、标签、内容大纲；仅依赖 vfs-core，通过公开接口注入数据源、动作、展示和持久化。 |
| `@itookit/mdxeditor` | 独立 CodeMirror 6 编辑器（目录 `packages/mdx`），不依赖其他内部包；宿主通过公共附件、存储、导航和保存接口注入能力。 |
| `@itookit/mdx-adapter` | MindOS 编辑器适配：VFS/namespace/Session 校验、文件格式、插件元数据、附件管理 UI、文件聊天引用及会话打印。 |
| `@itookit/ui-common` | 共享 UI 组件、契约、浏览器工具。 |
| `@itookit/app-settings` | 设置模块：SettingsEngine、SkillsEngine。 |
| `@itookit/app-core` | 无 UI 应用核心：MindOS profile、RunDefinition、共享 Session 文件/目录服务，以及统一装配 `createApplicationRuntime`（VFS/LLM/Session/Flow）与 headless `createKernelRuntime`（durable-kernel + kernel-adapters + Flow programs）。Web/Tauri/CLI 共用。 |
| `@itookit/app-shell` | Web/Tauri UI shell：`initApp()`（调用 app-core `createApplicationRuntime`）、workspace 策略、路由、Workbench/编辑器装配；依赖 app-core。 |
| `@itookit/demo` | 演示/示例。 |

### App 清单

| App | Role |
|---|---|
| `mind-os`（`apps/web-app`） | 主浏览器 SPA（IndexedDB 后端、workspace 配置、入口）。 |
| `@itookit/cli`（`apps/cli`） | 命令行入口：YAML 工作流 → DurableFlowExecutor 运行。 |
| `tauri-app`（`apps/tauri-app`） | Tauri 桌面壳。 |
| `@itookit/sync-server`（`apps/sync-server`） | Hono HTTP 同步服务（diff 同步 + Bearer auth）。 |

### 独立 VFS 仓库与同步接入

`packages/vfs-core` 是 [mushuanli/vfs-core](https://github.com/mushuanli/vfs-core) 的 Git 子模块，保留工作区包名 `@itookit/vfs-core`。首次克隆后执行 `git submodule update --init packages/vfs-core`。该仓库有独立 tsconfig、锁文件、测试和构建，不依赖 itookit 的其他包。

VFS 驱动和 vfs-ui 的内部运行依赖仅为 vfs-core。`packages/sync-adapters` 是宿主同步接入，依赖 vfs-sync 与驱动公共端口；驱动不反向引用它。IndexedDB 适配提交文件、基线和应用证据的原生事务；HTTP 适配复用凭据通道。同步范围由宿主显式传入。

VFS `IPlugin` 可以作为可选的变更提示入口，但其文件操作中间件不涵盖其他窗口、原生事务或离线变化，不能替代扫描、恢复日志与条件提交；core 不内置同步业务。

`packages/vfs-ui` 是 [mushuanli/vfs-ui](https://github.com/mushuanli/vfs-ui) 的 Git 子模块。独立仓库通过开发子模块 `vendor/vfs-core` 固定所需核心 API；itookit 中继续使用顶层 workspace 的 core。首次克隆后执行 `git submodule update --init packages/vfs-core packages/vfs-ui`。UI 发布产物不包含开发子模块，发布 npm 前须确认核心版本已包含所需 API。

`packages/vfsdriver-indexeddb` 是 [mushuanli/vfsdriver-indexeddb](https://github.com/mushuanli/vfsdriver-indexeddb) 的 Git 子模块，独立安装、测试、构建和打包。运行依赖仅有 vfs-core，开发子模块 `vendor/vfs-core` 固定核心版本。首次克隆可执行 `git submodule update --init --recursive packages/vfsdriver-indexeddb`。

`packages/vfsdriver-local` 是 [mushuanli/vfsdriver-local](https://github.com/mushuanli/vfsdriver-local) 的 Git 子模块。独立仓库只依赖 vfs-core 与 better-sqlite3，开发 core 通过子模块固定；`/node` 导出 NodeFsOps 与 BetterSqliteSidecarDb。CLI、内核和编辑器集成测试位于 `apps/cli/tests`，不增加驱动反向依赖。

`packages/vfsdriver-agent` 是 [mushuanli/vfsdriver-agent](https://github.com/mushuanli/vfsdriver-agent) 的 Git 子模块，继承原 HTTP 驱动历史。独立运行依赖仅有 vfs-core，开发 core 通过 `vendor/vfs-core` 固定；真实 fs-agent 测试用 `FS_AGENT_MANIFEST` 指定服务器源码，默认独立测试不要求 Rust。首次克隆执行 `git submodule update --init --recursive packages/vfsdriver-agent`。

`packages/vfs-sync` 是 [mushuanli/vfs-sync](https://github.com/mushuanli/vfs-sync) 的 Git 子模块，零运行时包依赖，包含独立配置、锁文件、CI 与本地协议 fixture；首次克隆执行 `git submodule update --init packages/vfs-sync`。同步适配仍在宿主层，vfs-sync 不依赖 vfs-core。
