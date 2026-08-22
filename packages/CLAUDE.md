# packages/ 模块协作指南

20 个 package + 4 个 app 的协作关系。各模块自身的架构和命令详见 `packages/<pkg>/CLAUDE.md`。

## 模块分层

```
┌────────────────────────────────────────────────────┐
│  apps/{web-app(mind-os), cli, tauri-app}   入口   │
├────────────────────────────────────────────────────┤
│  app-shell                      引导 + 路由 + 装配  │
├──────────────┬──────────────┬──────────────────────┤
│  llm-ui      │  vfs-ui      │  mdxeditor   ui-common │  UI 层
├──────────────┼──────────────┼──────────────────────┤
│ llm-session  │  llm-flow    │ llm-programs  harness │  业务层
├──────────────┼──────────────┼──────────────────────┤
│ coreutils    │  device-llm  │ device-tty    stdio  │  引擎/能力层
├──────────────┼──────────────┼──────────────────────┤
│ tools        │ vfsdriver-*  │ llm-common           │  工具/存储/契约
├──────────────┴──────────────┴──────────────────────┤
│  common                       接口 + 类型 + i18n    │
└────────────────────────────────────────────────────┘
```

LLM 依赖方向（单向，下层永不知上层）：

```
llm-session ──▶ llm-flow ──▶ llm-programs ──▶ harness ──▶ common
（会话/持久化） （DAG 编排） （LLM 任务单元）  （执行内核）
```

## 依赖铁律

- 上层可依赖下层，下层永不知上层
- 跨层通过接口：具体实现通过 `app-shell/bootstrap.ts` 注入
- 调用方类型为接口 (`IVFSManager`, `IModuleFS`)，不依赖具体类

## 核心文档

| 文档 | 内容 |
|---|---|
| [架构设计](../doc/architecture.md) | 系统全貌 — VFS / LLM / Agent / Skill / Mission / Session / TTY |
| [集成链](../doc/integration-chains.md) | 3 条核心集成链（VFS / Chat / AppShell）|
| [接口契约](../doc/interface-contracts.md) | 跨包接口表（VFS / LLM / UI 体系）|
| [事件流](../doc/event-flows.md) | Agent / VFS / HITL / TTY 事件流 |
| [Skill 设计](../doc/design/skill-design.md) | 触发策略、作用域、四层路由、类型系统 |
| [VFS 设计](../doc/design/VFS-design.md) | VFS 详细设计 |
| [开发模式](../doc/dev-patterns.md) | 新增 Provider/Connection/Agent/Tool/i18n 流程 |
| [文件索引](../doc/file-index.md) | 场景 → 关键文件映射 |
| [联网搜索](../doc/web-search.md) | 三态 WebSearchMode 决策 + citations[] 事件链 + Provider 适配 |

> 上表为**活文档**（随代码更新）；`../doc/feat/` 为历史设计归档，不随代码更新。

## 常见任务速查

| 任务 | 文档引用 |
|---|---|
| 新增 Provider | [dev-patterns](../doc/dev-patterns.md) → `device-llm/CLAUDE.md` |
| 修改 ChatInput UI | [file-index](../doc/file-index.md) `#chat-input` |
| 新增 i18n | [dev-patterns](../doc/dev-patterns.md) `#i18n` → `common/CLAUDE.md` |
| 新增工具 | [dev-patterns](../doc/dev-patterns.md) `#tools` → `tools/CLAUDE.md` |
| 理解 agent loop | [architecture.md](../doc/architecture.md) `#harness` |
| 理解联网搜索 | [web-search.md](../doc/web-search.md) |
