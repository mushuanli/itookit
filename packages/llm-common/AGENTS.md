# @itookit/llm-common

LLM 领域**共享契约层**：Provider / Connection / Agent / Tool / Skill / TTY / 会话的跨包接口与纯类型。所有 LLM 相关包从这里取类型，而不是从 `@itookit/common` 取。零运行时依赖——只有类型与纯函数。详见 [架构设计](../../doc/architecture.md)、[接口契约](../../doc/interface-contracts.md)。

## 定位与铁律

- **零依赖**：`src/` 内不 import 任何 `@itookit/*`，也不 import 第三方运行时库；只用 TypeScript 类型与纯函数（比较、构造、默认值）。
- **无副作用**：不得读写文件、DOM、网络或全局状态；需要 I/O 的能力以接口（`ILLMService`、`ISkillService`、`IToolService`、`ITTYDriver`）声明，由实现层提供。
- **向后兼容的 re-export**：`@itookit/common` 通过 `export * from '@itookit/llm-common'` 转发（历史兼容）。**新代码直接从本包导入**，避免依赖链上多一跳。
- 类型演进会影响 `device-llm`、`llm-session`、`llm-flow`、`llm-tasks`、`kernel-adapters`、`llm-ui`：改名/改形状前先看 [接口契约](../../doc/interface-contracts.md) 与各实现的编译错误。
- **`AgentDefinition` 的字段层级要看清**：`capabilityPolicy`（`toolIds`/`skillIds`/`mcpProfileIds`）、`memoryPolicy`、`modelPolicy`、`defaultContextPolicy` 都在**顶层**，不在 `config` 下。`AgentResolver.buildConfig` 只读顶层字段——把 `capabilityPolicy` 写进 `config` 会**静默**导致模型请求里没有工具（实测 `tools: []`）。新增字段时同步 `agent-resolver` 的映射与 [验收记录 §17](../../doc/minimal-system-acceptance.md)。

## 结构

```
src/
├── index.ts                     根导出（llm + agent + tools + skills + tty + 日志/会话设置）
├── types.ts                     RestoreStatus / RestorableItem 等通用小类型
├── chat.ts                      ChatAttachment / ChatSessionSettings / DEFAULT_SESSION_SETTINGS
├── ILLMLogger.ts                LLMRequestLog / LLMResponseLog / ILLMLogger（日志契约）
├── llm/                         模型侧契约
│   ├── agent.ts                 AgentDefinition（system prompt 等）
│   ├── connection.ts            LLMConnection（tier → model 映射）
│   ├── completion.ts            补全/流式响应类型
│   ├── message.ts               消息与内容块（ChatMessage 等）
│   ├── llm-service.ts           ILLMService（模型调用面）
│   ├── node-config.ts           LlmNodeConfig（Flow 节点模型配置）
│   ├── execution-defaults.ts    执行默认值
│   └── pricing.ts               token 计价
├── agent/                       会话/编排侧契约
│   ├── conversation.ts          会话与 round 语义
│   ├── session.ts               Session 契约
│   ├── flow.ts / flow-definition.ts  Flow/DAG 定义（DagRunSpec 相关）
│   ├── dag-plugin.ts            DAG 插件清单与端口 schema 契约
│   ├── agent-event.ts           Agent 事件
│   ├── command-bus.ts           命令总线
│   ├── context-types.ts         上下文组装类型
│   ├── delegation-defaults.ts   委派默认策略
│   ├── extension.ts             扩展点
│   ├── harness-hook.ts          宿主 hook
│   └── sub-agent.ts             子代理契约
├── tools/                       ToolService 契约与工具类型
├── skills/                      SkillDefinition / SkillService / FS Skill 类型
└── tty/                         TTY 契约（ITTYDriver、TTY 事件）
```

## 类型层级速查

```
LLMProvider (云厂商) → LLMConnection (tier→model) → AgentDefinition (system prompt)
```

- 关键类型集中在 `src/llm/` 与 `src/agent/`，并统一由 `@itookit/common` 间接可用。
- Provider 实现见 `device-llm/src/providers/`；Skill 触发与作用域见 [Skill 设计](../../doc/design/skill-design.md)。

## 运行

```bash
pnpm --filter @itookit/llm-common typecheck
pnpm --filter @itookit/llm-common build        # tsup（CJS + ESM + .d.ts）
```

本包**没有独立测试套件**：它是类型与纯函数契约，正确性由消费方（`device-llm`、`llm-session`、`llm-flow` 等）的测试与全仓 `pnpm typecheck` 保障。新增纯函数若含分支逻辑，应在使用它的包里覆盖。

## 相关文档

| 文档 | 内容 |
|---|---|
| [接口契约](../../doc/interface-contracts.md) | 跨包核心接口与实现/消费关系 |
| [架构设计](../../doc/architecture.md) | LLM 四层分层（Provider→Connection→Agent）|
| [开发模式](../../doc/dev-patterns.md) | 新增 Provider/Connection/Agent/Tool 流程 |
| [Skill 设计](../../doc/design/skill-design.md) | Skill 类型系统与路由 |
