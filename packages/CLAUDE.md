# packages/ 模块协作指南

16 个模块的协作关系。各模块自身的架构和命令详见 `packages/<pkg>/CLAUDE.md`。

## 模块分层

```
┌──────────────────────────────────────────────────┐
│  apps/web-app                     入口 + 配置     │
├──────────────────────────────────────────────────┤
│  app-shell                 引导 + 路由 + 装配    │
├──────────────┬──────────────┬────────────────────┤
│ memory-mgr   │  llm-ui      │  vfs-ui   mdx      │  UI 层
├──────────────┼──────────────┼────────────────────┤
│ llm-engine   │  llm-harness │  app-settings      │  业务层
├──────────────┼──────────────┼────────────────────┤
│ device-llm   │  vfslib      │                    │  引擎层
├──────────────┼──────────────┼────────────────────┤
│ tools        │              │                    │  工具层
├──────────────┴──────────────┴────────────────────┤
│  vfsdriver-*                         存储驱动     │
├──────────────────────────────────────────────────┤
│  common                    接口 + 类型 + i18n     │
└──────────────────────────────────────────────────┘
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
| [Skill 同步](../doc/skill-sync.md) | LLMSkill ↔ SkillDefinition 双体系 |
| [Skill 设计](../doc/design/skill-design.md) | 触发策略、作用域、四层路由、类型系统 |
| [VFS 设计](../doc/design/VFS-design.md) | VFS 详细设计 |
| [开发模式](../doc/dev-patterns.md) | 新增 Provider/Connection/Agent/Tool/i18n 流程 |
| [文件索引](../doc/file-index.md) | 场景 → 关键文件映射 |

## 常见任务速查

| 任务 | 文档引用 |
|---|---|
| 新增 Provider | [dev-patterns](../doc/dev-patterns.md) → `device-llm/CLAUDE.md` |
| 修改 ChatInput UI | [file-index](../doc/file-index.md) `#chat-input` |
| 新增 i18n | [dev-patterns](../doc/dev-patterns.md) `#i18n` → `common/CLAUDE.md` |
| 新增工具 | [dev-patterns](../doc/dev-patterns.md) `#tools` → `tools/CLAUDE.md` |
| 理解 agent loop | [architecture.md](../doc/architecture.md) `#harness` |
