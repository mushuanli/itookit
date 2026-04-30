# llm-ui 工厂函数与插件

## 工厂函数

### createLLMFactory

```typescript
const factory = createLLMFactory(agentService: VFSAgentService): EditorFactory;
```

返回 `EditorFactory`，供 `MemoryManager` 使用。包含去重（同一 nodeId 复用 promise）和自动创建文件（无 nodeId 时通过 `sessionEngine.createFile()` 创建）。

### createAgentEditorFactory / createSkillsEditorFactory

```typescript
const factory = createAgentEditorFactory(agentService: VFSAgentService): EditorFactory;
const factory = createSkillsEditorFactory(agentService: IAgentManagementService): EditorFactory;
```

## LLMWorkspaceEditor

```
LLMWorkspaceEditor
├── ChatInputView        ← 输入框 + /command + @mention + Skill 选择
├── HistoryView          ← 消息列表 + 流式渲染 + 折叠 + TTY 面板
├── BranchIndicatorView  ← 分支名 + 切换 + fork
└── StatusIndicatorView  ← 连接状态 + token 用量
```

## 输入插件系统

| 插件 | 触发 | 功能 |
|---|---|---|
| `SlashCommandPlugin` | `/exec`, `/read`, `/grep`... | 直接调用 harness 工具 |
| `MentionPlugin` | `@` | 文件/目录引用 |
| `HarnessPlugin` | Agent 事件 | 工具状态 + 权限 + HITL 输入 |
| `HistoryPlugin` | `↑↓` 键 | Prompt 历史浏览 |
| `TokenMeterPlugin` | 实时 | Token 用量显示 |

Chat 输入语法：`/sk-<id> [--key val] [[file](path)]* [@glob]* [text]`
