# CLAUDE.md — @itookit/llm-ui

Chat UI 组件和 Agent/Skill 编辑器。采用 Ports/Adapters 架构，提供 `LLMWorkspaceEditor`（Chat 主编辑器）和各类 Settings 编辑器。

peerDependency: `@itookit/mdxeditor`

## Commands

```bash
pnpm --filter @itookit/llm-ui build        # vite build
pnpm --filter @itookit/llm-ui dev          # vite dev
```

## Architecture

```
src/
├── index.ts                    ← 公共 API + 工厂函数
├── shell/
│   ├── LLMWorkspaceEditor.ts   ← Chat 主编辑器 (implements IEditor)
│   ├── SessionEventHandler.ts  ← 会话事件处理
│   ├── StateManager.ts         ← 状态管理
│   ├── EventBinder.ts          ← DOM 事件绑定
│   └── EditorEventBus.ts       ← 编辑器事件总线
├── views/
│   ├── ChatInputView.ts        ← 消息输入 (textarea + 插件)
│   ├── HistoryView.ts          ← 流式消息历史
│   ├── BranchIndicatorView.ts  ← 分支切换
│   ├── StatusIndicatorView.ts  ← 连接/用量状态
│   └── FloatingNavPanel.ts     ← 导航面板 (文件大纲/历史)
├── controllers/
│   ├── StreamController.ts     ← 流式内容更新
│   ├── CollapseController.ts   ← 工具结果折叠
│   ├── EditController.ts       ← 消息编辑 (fork 分支)
│   └── MdxController.ts        ← MDx 编辑器控制
├── renderers/
│   ├── NodeRenderer.ts         ← 消息节点渲染
│   └── SessionRenderer.ts      ← 会话级渲染
├── plugins/                    ← 输入系统插件
│   ├── HarnessPlugin.ts        ← Skill 选择器 + 工具集成
│   ├── SlashCommandPlugin.ts   ← /command 执行
│   ├── MentionPlugin.ts        ← @-mention
│   ├── HistoryPlugin.ts        ← prompt 历史
│   ├── TokenMeterPlugin.ts     ← token 计数
│   └── PopupPanel.ts           ← 插件弹窗
├── editors/                    ← Settings 编辑器
│   ├── AgentConfigEditor.ts    ← Agent 配置
│   ├── ConnectionSettingsEditor.ts ← LLM 连接
│   ├── ProviderSettingsEditor.ts   ← Provider
│   ├── MCPSettingsEditor.ts        ← MCP
│   └── SkillSettingsEditor.ts      ← Skill
├── services/
│   ├── SessionService.ts       ← 会话管理
│   ├── AgentLoader.ts          ← Agent 加载
│   ├── BranchStore.ts          ← 分支管理
│   ├── AssetService.ts         ← 附件处理
│   └── StateService.ts         ← UI 状态缓存
├── commands/
│   ├── SendMessageCommand.ts   ← 发送消息
│   ├── NodeCommands.ts         ← 节点操作
│   └── BranchCommands.ts       ← 分支操作
├── contracts/
│   └── ports/                  ← Port 接口 (IBranchPresenter, IChatInputPresenter...)
├── context-menu/
│   └── AIContextMenu.ts        ← AI 右键菜单配置
├── common/
│   └── utils/                  ← ScrollController, DOMCache, EventBatchProcessor...
└── styles/
```

## 关键工厂函数

### createLLMFactory

```typescript
const factory = createLLMFactory(agentService: VFSAgentService): EditorFactory;
```

返回 `EditorFactory`，供 `MemoryManager` 使用。包含：
- 去重：同一 `nodeId` 并发创建 → 复用 promise
- 自动创建文件：无 `nodeId` 时通过 `sessionEngine.createFile()` 创建

### createAgentEditorFactory

```typescript
const factory = createAgentEditorFactory(agentService: VFSAgentService): EditorFactory;
```

### createSkillsEditorFactory

```typescript
const factory = createSkillsEditorFactory(agentService: IAgentManagementService): EditorFactory;
```

## LLMWorkspaceEditor

Chat 主编辑器，组装输入、历史、分支、状态四个视图：

```
LLMWorkspaceEditor
├── ChatInputView        ← 输入框 + /command + @mention + Skill 选择
├── HistoryView          ← 消息列表 + 流式渲染 + 折叠
├── BranchIndicatorView  ← 分支名 + 切换 + fork
└── StatusIndicatorView  ← 连接状态 + token 用量
```

## 输入插件系统

每个插件实现 `InputPlugin` 接口：

| 插件 | 触发 | 功能 |
|---|---|---|
| `SlashCommandPlugin` | `/exec`, `/read`, `/grep`... | 直接调用 harness 工具 |
| `MentionPlugin` | `@` | 文件/目录引用 |
| `HarnessPlugin` | `/sk-<id>` | Skill 加载 + 参数面板 |
| `HistoryPlugin` | `↑↓` 键 | Prompt 历史浏览 |
| `TokenMeterPlugin` | 实时 | Token 用量显示 |

## Conventions

- 所有文本通过 `t()` 导入（`@itookit/common`）
- Port 接口定义在 `contracts/ports/`，视图通过 port 接口通信
- `SessionService` 封装 `SessionManager` 的交互
- 流式内容通过 `StreamController` 管理增量更新
- Chat 输入支持 `/sk-<id> [--key val] [[file](path)]* [@glob]* [text]` 语法
