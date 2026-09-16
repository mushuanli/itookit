# llm-flow 开发说明

本包是 DAG 编排层：把 `llm-tasks` 的 LLM 任务单元连成动态图（route/loop/spawn/compensate/on_failure/budget），并持久化 Flow 定义。详见 [llm-flow API](../../doc/llm-flow-api.md)。

Flow / Node 类型、当前编排能力与 Harness 要求的覆盖及限制，见 [Harness Flow 分析](../../doc/design/harness-flow.md)。

MCP/tools/Skill 的宿主装配、隔离上下文、批准恢复与 UI 输出见 [Flow 能力与输出](../../doc/design/flow-capabilities-and-output.md)。

真实模型 CLI 运行与输入补全验收见 [作文 CLI 验证](../../doc/design/essay-review-cli-verification.md)。

## 目录

```text
src/
├── index.ts                  统一导出
├── flow-definition-store.ts  FlowDefinitionStore（最小 FlowStore 接口 + 版本冲突）
└── flow/
    ├── executor.ts           DurableFlowExecutor（动态图调度 / 补偿 / 工作区）
    ├── builtin-plugins.ts    内置插件 transform/reduce/route/spawn/flow/human/agent
    ├── structured/           输入补全、route@2 独立 Task 派发、隔离上下文、按键汇总
    ├── programs.ts           FlowValue / FlowHuman / FlowAggregate Program
    ├── operations.ts         transform/reduce/route/spawn 纯操作
    ├── plugin-registry.ts    插件注册表 + schema 注册
    ├── to-dag.ts             FlowRevision → DagRunSpec
    ├── validation.ts         Flow 校验（环检测、预算校验）
    ├── graph.ts              泛型 findCycles
    ├── commands.ts           DagCommandService
    ├── delegation-runtime.ts 动态委派（fan-out / join / 预算）
    ├── parameters.ts         运行参数模板解析与校验
    ├── connections.ts        节点连接槽解析
    ├── run-members.ts        运行成员读取与重试准备
    └── workflow/             工作流 DSL：类型 + compile + route 表达式
```

## 约束

- 只编排 DAG，不持有会话语义（Round/Branch/SessionRepository 属于 llm-session）。
- 不依赖 llm-session、UI、DOM 或具体设备；能力通过 kernel Effect 使用。
- FlowDefinitionStore 只依赖最小 `FlowStore` 接口（listFiles/findFile/createFile/readFile/writeFile/renameFile/deleteFile/createAsset/readAsset/listAssets），由会话层的 `FlowEngine`（`llm-session/src/persistence/flow-engine.ts`，`flows` VFS 模块）适配。

运行：

```bash
pnpm --filter @itookit/llm-flow typecheck
pnpm --filter @itookit/llm-flow test
```

结构化派发配置与边界见 [作文评审实现](../../doc/design/essay-review-flow.md)，可运行定义见 [essay-review-isolated.flow](../llm-ui/src/flows/library/essay-review-isolated.flow)。紧凑派发使用 route@2；可视分节点使用 route@3 → check@1 → aggregate@2 → judge@1，`structured/graph.ts` 编译为持久作用域，`expand.ts` 展开旧草稿；业务轮数在判断节点配置 `maxRounds`。

统一契约：`structured/references.ts` 编译引用依赖并在节点提交前解析；`condition.ts` 将可视条件编译为表达式；`join.ts` 注册版本化纯 reducer。公共 prompt 在每次 spawn 时渲染一次，不能重解释插入数据。修改 schema 支持范围时同步 schema-registry、schema-compat 和结构化输出校验。
