## packages/ 模块协作指南

`packages/` 下 14 个模块的协作关系。各模块自身的架构和命令详见 `packages/<pkg>/CLAUDE.md`。

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
│ llm-kernel   │  device-llm  │  vfslib            │  引擎层
├──────────────┴──────────────┴────────────────────┤
│  vfsdriver-*                         存储驱动     │
├──────────────────────────────────────────────────┤
│  common                    接口 + 类型 + i18n     │
└──────────────────────────────────────────────────┘
```

## 依赖铁律

| 规则 | 说明 |
|---|---|
| 上层可依赖下层 | UI 层 → 业务层 → 引擎层 → `common` |
| 下层永不知上层 | `vfslib` 不 import `llm-engine` |
| 跨层通过接口 | 具体实现通过 `app-shell/bootstrap.ts` 注入 |

## 核心集成链

- **VFS 全栈**: `vfs-ui → ISessionEngine → VFSModuleEngine → ModuleFS → VFSEngine → IStorageBackend`
- **LLM Chat**: `llm-ui → SessionManager → TaskRunner → AgentLoopExecutor → LLMServiceAdapter → Provider`
- **App 装配**: `initApp() → createVFS → createHarness → initializeLLMEngine → WorkspaceStrategy`

详情: [集成链](./integration-chains.md)

## 渐进式详情

| 文档 | 内容 |
|---|---|
| [接口契约](./interface-contracts.md) | 跨包接口表（VFS / LLM / UI 体系） |
| [集成链](./integration-chains.md) | 3 条核心集成链（VFS / Chat / AppShell） |
| [事件流](./event-flows.md) | Agent / VFS / HITL / TTY 事件流 |
| [Skill 同步](./skill-sync.md) | LLMSkill ↔ SkillDefinition 双体系 |
| [开发模式](./dev-patterns.md) | 新功能流程、模块边界、浏览器差异、测试策略 |
| [文件索引](./file-index.md) | 场景 → 关键文件映射 |
