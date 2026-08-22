# AI 助手配置

## 语言
- 始终使用**中文**交流
- 代码注释用英文，Git commit 用 Conventional Commits (`type(scope): description`)

## 开发原则
SOLID / DRY / KISS / YAGNI / CoC / LoD — 函数≤30行，圈复杂度≤10

## 构建

| 类型 | 工具 |
|---|---|
| 逻辑包 (`common`, `llm-common`, `stdio`, `device-llm`, `device-tty`, `tools`, `coreutils`, `harness`, `llm-programs`, `llm-flow`, `llm-session`, vfsdrivers) | **tsup** (CJS+ESM+.d.ts) |
| UI 包 (`llm-ui`, `llm-settings-ui`, `vfs-ui`, `ui-common`, `mdx`, `app-settings`, `app-shell`) | **vite build** |

## 项目文档

| 文档 | 内容 |
|---|---|
| [包结构](./doc/pkgstructure.md) | 20+ 个包及职责、LLM 四层分层 |
| [架构设计](./doc/architecture.md) | 系统全貌 — VFS / LLM / Agent / Skill / Session / Flow / TTY |
| [集成链](./doc/integration-chains.md) | VFS / Chat / AppShell 端到端调用链 |
| [接口契约](./doc/interface-contracts.md) | 跨包核心接口 + 实现/消费关系 |
| [事件流](./doc/event-flows.md) | Agent / VFS / HITL / TTY 事件消费链 |
| [开发模式](./doc/dev-patterns.md) | 新增 Provider/Connection/Agent/Tool/i18n 流程 |
| [文件索引](./doc/file-index.md) | 场景 → 关键文件快速定位 |
| [Harness API](./doc/harness-api.md) | 执行内核 API + 源码结构/存储路径 |
| [llm-programs API](./doc/llm-programs-api.md) | Durable Program 层 API + 文件结构 |
| [llm-flow API](./doc/llm-flow-api.md) | DAG 编排层 API + 文件结构 |
| [llm-session API](./doc/llm-session-api.md) | 会话语义/持久化 API + 文件结构/VFS 路径 |
| [联网搜索](./doc/web-search.md) | 三态 WebSearchMode 决策 + citations[] 事件链 + Provider 适配 |
| [历史设计归档](./doc/feat/) | 已实现特性的设计/评审记录（**归档，不随代码更新**） |

> 上表为**活文档**（随代码更新）。改代码时按此表定位对应文档即可，无需全量扫描。
> `doc/feat/` 是历史设计归档，仅作决策记录参考，代码演进后不再同步。

## UI 约定

- **技术栈**: 原生 DOM + 模板字符串 + `addEventListener` 委托绑定
- **CSS**: BEM 命名 (`llm-input__xxx`), 变量在 `llm-ui/src/styles/variables.css`
- **图标**: 从 `@itookit/common` import (`ENTITY_ICONS`, `ACTION_ICONS` 等), 禁止硬编码 emoji
- **i18n**: `t('domain.section.item')`, key 在 `common/src/i18n/zh-CN.ts` 先加 → `en.ts` 同步

## LLM 子系统速查

```
LLMProvider (云厂商) → LLMConnection (tier→model) → AgentDefinition (system prompt)
```

- 关键类型: `llm-common/src/agent/` + `llm-common/src/llm/`（common re-export）
- Provider 实现: `device-llm/src/providers/`
- 联网搜索: `resolveWebSearchStrategy` → `WebSearchMode`（详见 [联网搜索](./doc/web-search.md)）
- 详见 [架构设计](./doc/architecture.md)
