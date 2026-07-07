# CLAUDE.md — @itookit/llm-ui

Chat UI — Claude.ai 风格 ChatInput + AI 右键菜单 + Settings 编辑器 + OCR 面板 + Cost 仪表板。

peerDependency: `@itookit/mdxeditor`

## Architecture

```
src/
├── shell/         ← LLMWorkspaceEditor
├── components/    ← input/ChatInputView (textarea + 附件 + 图片上传 + OCR), history, mdx, tty
├── domain/        ← types, events, ports
├── editors/       ← Agent/Connection/Provider/MCP/Skill/Cost Settings
├── services/      ← SessionService, OcrService, AssetService, FileSearchService, StateService
├── context-menu/  ← AIContextMenu (chat workspace 右键委托)
├── commands/      ← workspace 命令
└── styles/        ← BEM 变量 (variables.css)
```

## 近期关键功能

- **Billing & Cost Dashboard**: CostEditor 双标签编辑器 — 仪表板 (time/provider 过滤、top sessions) + 定价配置 (可编辑 MODEL_PRICING、可展开匹配面板)
- **Harness Agent Loop 事件渲染**: HistoryView 渲染 tool:queued/running/success/error 等工具事件为 agent 消息子节点，含输入流式展示
- **API Protocol 选择器**: Connection 编辑器支持 Anthropic Messages 协议，适配 Claude CLI / thinking block / tool loop
- **Auto Tier 模型名**: Tier 快速切换按钮和弹窗在 Auto 状态显示解析后的最优模型名 ("Auto (gpt-4o)")
- **Thinking Mode Per-Model**: ProviderSettingsEditor 的模型表新增 thinkingMode 列 (auto/on/off)
- **VFS Session Settings**: 设置直接写入 `{assetDir}/settings.yaml`，废弃 sessionStorage 缓冲；`SessionService.ensureReady()` 保证 ChatInput 渲染前 VFS 目录就绪
- **Connection 分组**: ChatInput 连接选择器按 hasApiKey 分组 — 已配置在前，未配置 dimmed 警告
- **Rename 传播**: `LLMWorkspaceEditor.updateNodeId()` 传播到 StateManager + SessionManager，重命名无需刷新
- **Tier 快速切换**: 工具栏 model tier badge，一键切换 optimal/standard/fast
- **Tier 模型名称**: 连接卡片显示每 tier 配的模型名
- **Deep-link 导航**: 聊天 badge → 对应 Provider/Connection 设置页
- **systemPromptAppend**: Agent 编辑支持追加 system prompt 到已有定义
- **OCR 面板**: 批量图片 OCR 识别 + review flow
- **ChatInput 图片上传**: 照片附件 + 粘贴支持
- **Claude.ai 风格 UX**: ChatInput 重新设计，inline 设置布局

## Cost / Billing

- **CostEditor** (`editors/CostEditor.ts`): 双标签编辑器 (Dashboard + Pricing Config)
  - Dashboard 聚合 cost.seq 记录，支持周期 (today/week/month) 和 provider 过滤
  - Pricing Config 编辑 MODEL_PRICING 条目，可展开 hits 面板查看每个条目的 provider + names 通配符匹配结果
- **Import/Export**: `.llm` 文件支持可选的 `pricing` 字段
- 依赖 `aggregateCostRecords` / `lookupPricingEntry` from `@itookit/common`

## Conventions

- 所有文本通过 `t()` 导入（`@itookit/common`）
- Port 接口定义在 `domain/`，视图通过 port 通信
- 流式内容通过 `HistoryView` 增量渲染
- `IChatInputPresenter.refreshConnections()` — Shell 在 import/save 后调用以同步连接下拉
- Session 设置直接读写 VFS，不再使用 localStorage/sessionStorage 中间层
