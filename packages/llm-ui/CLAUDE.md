# CLAUDE.md — @itookit/llm-ui

Chat UI — Claude.ai 风格 ChatInput + AI 右键菜单 + Settings 编辑器 + OCR 面板 + Cost 仪表板 + TaskGraph 工作台。

peerDependency: `@itookit/mdxeditor`

## Architecture

```
src/
├── shell/              ← 组合根 + 编排
│   ├── LLMWorkspaceEditor.ts    Shell / Composition Root — 组装依赖图、路由事件
│   ├── SessionEventHandler.ts   事件 → 副作用声明式映射（renderFull/refreshBranch 等）
│   ├── StateManager.ts          会话状态管理
│   ├── EditorEventBus.ts        Editor 事件总线（wraps common/EventBus）
│   ├── EventBinder.ts           事件绑定
│   ├── AgentProvider.ts         Agent/Connection 选项构建
│   ├── HarnessIntegration.ts    Harness 回调 + HITL 拦截
│   ├── SlashCommandRouter.ts    斜杠命令路由
│   ├── NavigationHelper.ts      导航辅助
│   └── WorkspacePaneController.ts 面板切换控制
├── components/         ← UI 组件
│   ├── HistoryView.ts           会话历史视图（IHistoryPresenter 实现）
│   ├── TaskGraphWorkbench.ts    TaskGraph 设计/运行工作台
│   ├── FloatingNavPanel.ts      浮动导航面板
│   ├── history/                 历史子控制器
│   │   ├── SessionRenderer.ts   会话 DOM 渲染
│   │   ├── StreamController.ts  流式内容增量更新
│   │   ├── CollapseController.ts 折叠/展开管理
│   │   ├── EditController.ts    内联编辑
│   │   ├── EventDispatcher.ts   事件分发
│   │   └── NodeRenderer.ts      节点渲染
│   ├── input/                   输入组件
│   │   ├── ChatInputView.ts     textarea + 附件 + 图片上传 + OCR
│   │   ├── AttachmentManager.ts 附件管理
│   │   ├── OcrReviewPanel.ts    OCR 审核面板
│   │   ├── SkillInvocationParser.ts Skill 调用解析
│   │   └── plugins/             ChatInput 插件
│   │       ├── HistoryPlugin.ts / MentionPlugin.ts / SlashCommandPlugin.ts
│   │       ├── HarnessPlugin.ts / TokenMeterPlugin.ts / InputPlugin.ts
│   │       └── PopupPanel.ts
│   ├── task-graph/             TaskGraph UI 子组件
│   │   ├── DraftController.ts    Flow 草稿 CRUD
│   │   ├── SchemaForm.ts         JSON Schema 编辑器
│   │   └── TaskGraphCanvas.ts    DAG 画布渲染
│   ├── tty/                     TTY 面板
│   │   ├── TtyController.ts / TtyPanel.ts
│   ├── mdx/                     MDX 编辑器
│   │   └── MDxController.ts
│   ├── indicators/              状态指示器
│   │   ├── BranchIndicatorView.ts / StatusIndicatorView.ts
│   ├── templates/               HTML 模板（BEM 命名）
│   │   ├── ChatInputTemplates / NodeTemplates / LayoutTemplates 等
│   └── common/                  通用基础设施
│       ├── EventBatchProcessor.ts 事件批量处理（message:updated 合并）
│       ├── ScrollController.ts / ContentResizeTracker.ts
│       ├── DOMCache.ts / TimerManager.ts / EventCleanup.ts
├── domain/             ← 类型 + Port 接口
│   ├── types.ts               SessionGroup / CollapseStateMap 等
│   ├── events.ts              IEditorEventBus 接口
│   └── ports/                 Presenter 接口（Shell → View 契约）
│       ├── IHistoryPresenter / IChatInputPresenter / IStatusPresenter
│       ├── IBranchPresenter / IBranchStore / INavigationPresenter
│       ├── IStreamableEditor / IStreamingController / ICollapseManager
├── editors/            ← 设置编辑器
│   ├── AgentConfigEditor.ts       Agent 配置（含 systemPromptAppend）
│   ├── ConnectionSettingsEditor.ts Connection 编辑器（API Protocol 选择器）
│   ├── ProviderSettingsEditor.ts  Provider 设置（含 thinkingMode per-model）
│   ├── MCPSettingsEditor.ts       MCP 服务器配置
│   ├── SkillSettingsEditor.ts     Skill 管理
│   ├── CostEditor.ts              Cost 仪表板 + 定价配置
│   ├── llm-import.ts              .llm 文件导入/导出
│   └── skill/                     Skill 子组件
│       ├── SkillImporter / SkillOperations / SkillRenderer
├── services/           ← 业务服务
│   ├── SessionService.ts     VFS 会话设置（直接读写 VFS，无 sessionStorage）
│   ├── StateService.ts       状态管理
│   ├── AssetService.ts       资产管理
│   ├── BranchService.ts / BranchStore.ts  分支操作
│   ├── FileSearchService.ts  文件搜索
│   ├── NavDataBuilder.ts     导航数据构建
│   └── OcrService.ts         OCR 识别
├── commands/           ← 编辑器命令
│   ├── Command.ts / CommandContext.ts / CommandRegistry.ts
│   ├── SendMessageCommand / RegenerateCommand / DeleteMessageCommand
│   ├── EditAndRetryCommand / SiblingSwitchCommand
│   ├── BranchCommands / BatchCommands / NodeCommands / WorkspaceCommands
├── context-menu/       ← AI 右键菜单
│   └── AIContextMenu.ts      聊天工作区右键委托
├── utils/              ← 工具函数
│   ├── debounce / domEvents / domInsertion / errorHandler
│   ├── iconResolver / imageDownscale / modelBadges
│   ├── styleInjector / textUtils / timeUtils
└── styles/             ← BEM 变量
    └── variables.css
```

## 事件处理

`SessionEventHandler` 使用声明式副作用映射表 `EVENT_SIDE_EFFECTS`，事件类型 → 副作用列表：

| 事件 | 副作用 |
|---|---|
| `finished` | clearErrors, updateStatus, notifyChange, refreshNav |
| `message:appended` | clearErrors, updateStatus, notifyChange, scrollToBottom |
| `message:updated` | 流式增量渲染（StreamController），不触发全量刷新 |
| `message:status` | 更新节点状态图标 |
| `branch:switched` | refreshBranch, refreshNav, flashIndicator |
| `regenerate_started` / `regenerate_completed` | flashIndicator, refreshBranch, refreshNav |
| `task_graph_run_projected` | 导航到 TaskGraph 运行视图 |

`EventBatchProcessor` 默认合并 `message:updated`（chunk）和 `message:status`（statusChange）事件。

## TaskGraph 工作台

`TaskGraphWorkbench` — Flow 设计与运行的双模式工作台：

| 模式 | 说明 |
|---|---|
| **Design** | TaskGraphCanvas（DAG 可视化）+ SchemaForm（节点属性编辑）+ 目录面板（拖入新 Task） |
| **Run** | 实时运行状态视图 — 任务状态轮询 + 事件流 + Artifact 预览 |

依赖 `ICommandBus` 执行 `flow.*` / `taskGraph.*` / `plugin.taskKinds.list` 命令。

子组件：
- `TaskGraphDraftController` — Flow 草稿 CRUD（addNode/removeNode/addEdge/persist）
- `TaskGraphCanvas` — DAG 画布（节点拖拽 + 连线）
- `SchemaForm` — JSON Schema 驱动的属性表单

## Shell 初始化流程

```
LLMWorkspaceEditor.init()
  ├─ SessionService.ensureReady() → VFS 目录就绪
  ├─ 构建 EditorEventBus + SessionEventHandler
  ├─ 创建 Presenter 实现：
  │   ├─ HistoryView（IHistoryPresenter）
  │   ├─ ChatInput（IChatInputPresenter）
  │   ├─ BranchIndicatorView（IBranchPresenter）
  │   ├─ StatusIndicatorView（IStatusPresenter）
  │   └─ TaskGraphWorkbench（按需）
  ├─ 注册 Command（SendMessage / Regenerate / DeleteMessage 等）
  ├─ 绑定 SessionEventHandler → SessionManager.onEvent()
  ├─ 装配 ChatInput 插件（History / Mention / SlashCommand / Harness / TokenMeter）
  └─ 恢复会话状态（resumeSession）
```

## Cost / Billing

- **CostEditor** (`editors/CostEditor.ts`): 双标签编辑器（Dashboard + Pricing Config）
  - Dashboard 聚合 cost.seq 记录，支持周期（today/week/month）和 provider 过滤
  - Pricing Config 编辑 MODEL_PRICING 条目，可展开 hits 面板
- **Import/Export**: `.llm` 文件支持可选的 `pricing` 字段
- 依赖 `aggregateCostRecords` / `lookupPricingEntry` from `@itookit/common`

## 关键功能

- **ICommandBus 集成**: Shell 通过 `options.commandBus` 接收命令总线，高层操作委托给 `commands.execute('session.*')` / `'vcs.*'`
- **TaskGraphWorkbench**: Flow 可视化设计 + 运行监控
- **Connection 分组**: ChatInput 连接选择器按 hasApiKey 分组
- **Tier 快速切换**: 工具栏 model tier badge，一键切换 optimal/standard/fast
- **Auto Tier 模型名**: Tier 按钮在 Auto 状态显示解析后的模型名
- **Thinking Mode Per-Model**: Provider 编辑器模型表新增 thinkingMode 列
- **API Protocol 选择器**: Connection 编辑器支持 Anthropic Messages 协议
- **VFS Session Settings**: 设置直接写入 `{assetDir}/settings.yaml`，废弃 sessionStorage
- **Rename 传播**: `updateBoundNodeId()` 传播到 StateManager + SessionManager
- **Deep-link 导航**: 聊天 badge → 对应 Provider/Connection 设置页
- **systemPromptAppend**: Agent 编辑支持追加 system prompt
- **OCR 面板**: 批量图片 OCR + review flow
- **ChatInput 图片上传**: 照片附件 + 粘贴支持
- **Claude.ai 风格 UX**: ChatInput 重新设计，inline 设置布局

## Conventions

- 技术栈：原生 DOM + 模板字符串 + `addEventListener` 委托绑定
- CSS: BEM 命名（`llm-input__xxx`），变量在 `styles/variables.css`
- 图标：从 `@itookit/common` import（`ENTITY_ICONS`、`ACTION_ICONS` 等），禁止硬编码 emoji
- i18n: `t('domain.section.item')`，key 在 `common/src/i18n/zh-CN.ts` 先加 → `en.ts` 同步
- Port 接口定义在 `domain/ports/`，视图通过 port 通信（Shell 不知 View 内部实现）
- 流式内容通过 `HistoryView` → `StreamController` 增量渲染
- `processEvent(event: SessionEvent)` — 事件类型来自 `@itookit/llm-engine`
- Session 设置直接读写 VFS，不使用 localStorage/sessionStorage
- `IChatInputPresenter.refreshConnections()` — Shell 在 import/save 后调用以同步连接下拉

## 相关项目文档

| 文档 | 内容 |
|---|---|
| [架构设计](../../doc/architecture.md) | 系统全貌 — LLM Engine Stack、Skill 系统、Workspace 策略 |
| [集成链](../../doc/integration-chains.md) | LLM Chat 链 + App 装配链 |
| [事件流](../../doc/event-flows.md) | SessionEvent → UI 副作用映射 |
| [事件处理详情](./doc/event-processing.md) | Event → DOM 完整链路 + 流式渲染细节 |
| [工厂与插件](./doc/factories-and-plugins.md) | createLLMFactory + 输入插件系统 |
| [接口契约](../../doc/interface-contracts.md) | UI Port 接口（IHistoryPresenter 等） |
| [文件索引](../../doc/file-index.md) | 场景 → 关键文件映射 |
