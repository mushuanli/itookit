
## Workspace Structure

pnpm monorepo. Packages under `packages/`, apps under `apps/`（`apps/web-app` = `mind-os`）。

### LLM 子系统分层（单向依赖）

```
llm-session ──▶ llm-flow ──▶ llm-programs ──▶ harness ──▶ common
（会话/持久化） （DAG 编排） （LLM 任务单元）  （执行内核）
```

### Package 清单

| Package | Role |
|---|---|
| `@itookit/common` | 共享接口、类型、i18n、工具。零运行时依赖，跨包契约之源。 |
| `@itookit/llm-common` | LLM 领域共享接口/类型：DagNode/DagEdge/DagRunSpec、FlowDraft/FlowRevision、SerializableExpression、TokenUsage、Tool 定义等纯契约。 |
| `@itookit/harness` | 持久化执行内核：`DurableTaskProgram`（init/reduce 状态机）、`EffectAdapter`、Task/Resource/Budget/Interaction 调度与恢复。 |
| `@itookit/llm-programs` | 平台无关的 LLM Durable Program 层：`llm.agent`/`llm.chat`/`llm.plan` 状态机、依赖收集（DependencyCollector）、`extractNodeOutput`、`buildLlmTaskInput`、ContextAssembler。 |
| `@itookit/llm-flow` | DAG 编排：`DurableFlowExecutor`（route/loop/spawn/compensate/on_failure/budget）、内置插件、Flow programs、环检测（`findCycles`）、FlowDefinitionStore。 |
| `@itookit/llm-session` | 用户可见的会话语义 + 持久化：SessionManager、Round/Branch、ChatEngine、RoundLog、SessionEventBus、UI projections。依赖 llm-flow。 |
| `@itookit/coreutils` | Harness 能力适配器：bash/llm-chat/tool-call/tty/skill-load 等 EffectAdapter、Exec/ApprovedEffect 程序、运行时装配。 |
| `@itookit/device-llm` | LLM 设备驱动：OpenAI/Anthropic/Gemini 通信、SSE 流式、MCP、Skill/Connection 存储。 |
| `@itookit/device-tty` | TTY 设备驱动：node-pty 交互 shell 会话。 |
| `@itookit/tools` | 内置工具实现（`buildTool()` 工厂）：File/Search/Shell/Task/Agent/Bash/Skill 等。 |
| `@itookit/stdio` | VFS 引擎核心：协议层 + 引擎实现 + 事件总线 + 通用 IO（IIOStream/pipe）。 |
| `@itookit/vfsdriver-indexeddb` | IndexedDB 存储后端（浏览器）。 |
| `@itookit/vfsdriver-localfs` | SQLite + 本地 FS 后端（Node/Electron）。 |
| `@itookit/llm-ui` | Chat UI：聊天界面、流式历史视图、会话编排可视化。 |
| `@itookit/vfs-ui` | 文件树 UI：目录导航、标签、内容大纲。 |
| `@itookit/mdxeditor` | 基于 CodeMirror 6 的 MDX 编辑器（目录 `packages/mdx`）。 |
| `@itookit/ui-common` | 共享 UI 组件、契约、浏览器工具。 |
| `@itookit/app-settings` | 设置模块：SettingsEngine、SkillsEngine。 |
| `@itookit/app-shell` | Bootstrap 装配：`initApp()`、workspace 策略、路由、harness/VFS/LLM 组装。 |
| `@itookit/demo` | 演示/示例。 |

### App 清单

| App | Role |
|---|---|
| `mind-os`（`apps/web-app`） | 主浏览器 SPA（IndexedDB 后端、workspace 配置、入口）。 |
| `@itookit/cli`（`apps/cli`） | 命令行入口：YAML 工作流 → DurableFlowExecutor 运行。 |
| `tauri-app`（`apps/tauri-app`） | Tauri 桌面壳。 |
| `@itookit/sync-server`（`apps/sync-server`） | Hono HTTP 同步服务（diff 同步 + Bearer auth）。 |
