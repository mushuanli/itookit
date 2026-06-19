# CLAUDE.md — @itookit/llm-ui

Chat UI — Claude.ai 风格 ChatInput + AI 右键菜单 + Settings 编辑器 + OCR 面板。

peerDependency: `@itookit/mdxeditor`

## Architecture

```
src/
├── shell/         ← LLMWorkspaceEditor
├── components/    ← input/ChatInputView (textarea + 附件 + 图片上传 + OCR), history, mdx, tty
├── domain/        ← types, events
├── editors/       ← Agent/Connection/Provider/MCP/Skill Settings
├── services/      ← SessionService, OcrService, AssetService, FileSearchService, StateService
├── context-menu/  ← AIContextMenu (chat workspace 右键委托)
├── commands/      ← workspace 命令
└── styles/        ← BEM 变量 (variables.css)
```

## 近期关键功能

- **Tier 快速切换**: 工具栏 model tier badge，一键切换 optimal/standard/fast
- **Tier 模型名称**: 连接卡片显示每 tier 配的模型名
- **Deep-link 导航**: 聊天 badge → 对应 Provider/Connection 设置页
- **systemPromptAppend**: Agent 编辑支持追加 system prompt 到已有定义
- **OCR 面板**: 批量图片 OCR 识别 + review flow
- **ChatInput 图片上传**: 照片附件 + 粘贴支持
- **Claude.ai 风格 UX**: ChatInput 重新设计

## Conventions

- 所有文本通过 `t()` 导入（`@itookit/common`）
- Port 接口定义在 `domain/`，视图通过 port 通信
- 流式内容通过 `HistoryView` 增量渲染
