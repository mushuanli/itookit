# AI 助手配置

## 语言
- 始终使用**中文**交流
- 代码注释用英文，Git commit 用 Conventional Commits (`type(scope): description`)

## 开发原则
SOLID / DRY / KISS / YAGNI / CoC / LoD — 函数≤30行，圈复杂度≤10

## 构建

| 类型 | 工具 |
|---|---|
| 逻辑包 (`common`, `vfslib`, `device-llm`, `llm-kernel`, `llm-engine`, `tools`, vfsdrivers) | **tsup** (CJS+ESM+.d.ts) |
| UI 包 (`memory-manager`, `vfs-ui`, `llm-ui`, `mdx`, `app-settings`) | **vite build** |

## 项目文档

| 文档 | 内容 |
|---|---|
| [包结构](./doc/pkgstructure.md) | 18 个包及职责 |
| [架构设计](./doc/architecture.md) | 系统全貌 — VFS / LLM / Agent / Skill / Mission / Session / TTY |
| [集成链](./doc/integration-chains.md) | VFS / Chat / AppShell 端到端调用链 |
| [接口契约](./doc/interface-contracts.md) | 跨包核心接口 + 实现/消费关系 |
| [事件流](./doc/event-flows.md) | Agent / VFS / HITL / TTY 事件消费链 |
| [开发模式](./doc/dev-patterns.md) | 新增 Provider/Connection/Agent/Tool/i18n 流程 |
| [文件索引](./doc/file-index.md) | 场景 → 关键文件快速定位 |

## UI 约定

- **技术栈**: 原生 DOM + 模板字符串 + `addEventListener` 委托绑定
- **CSS**: BEM 命名 (`llm-input__xxx`), 变量在 `llm-ui/src/styles/variables.css`
- **图标**: 从 `@itookit/common` import (`ENTITY_ICONS`, `ACTION_ICONS` 等), 禁止硬编码 emoji
- **i18n**: `t('domain.section.item')`, key 在 `common/src/i18n/zh-CN.ts` 先加 → `en.ts` 同步

## LLM 子系统速查

```
LLMProvider (云厂商) → LLMConnection (tier→model) → AgentDefinition (system prompt)
```

- 关键类型: `common/src/interfaces/llm/`
- Provider 实现: `device-llm/src/providers/`
- 详见 [架构设计](./doc/architecture.md)
