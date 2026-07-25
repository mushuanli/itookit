# Chat Navigator 驱动的 TaskGraph v3 Flow 管理

> 状态：TaskGraph v3 是唯一 DAG 模型。
> 更新日期：2026-07-24。

## 1. 架构结论

系统维护两套彼此独立的关系：

| 关系 | 节点 | 边/引用 | 职责 |
|---|---|---|---|
| ConversationGraph | Round | parents、branch ref、containment | 对话导航、fork、regenerate、上下文选择 |
| Flow TaskGraph | FlowNode | control/data TaskEdge | 可复用任务定义、调度依赖、Artifact 传递 |

Chat Navigator 所点的 Round 仅是创建操作的入口。创建 Flow Node 不会修改该 Round，不会把 Round 自动绑定为节点输入，也不会在 Flow 中保存 ConversationGraph 边。显式 Round 输入属于独立能力。

Flow 的生命周期只有：

```text
FlowDraft → FlowRevision → TaskGraphRun
```

- `FlowDraft` 是唯一可编辑对象。
- `FlowRevision` 由引擎从指定 draft/version 创建，创建后不可修改。
- `TaskGraphRun` 由 Reconciler 单写入；UI 只读取投影。

## 2. Chat Navigator

每条记录旁的 “+” 打开分组菜单：

- `Conversation / Create Branch`：沿用原 branch 行为。
- `Flow Node`：展示所有已注册 Task 类型。

选择 Task 类型后：

1. 选择已有 FlowDraft，或输入 ID、名称创建 Flow。
2. 查看草稿版本和最新 Revision。
3. 编辑节点参数。
4. 节点只写入当前内存 FlowDraft。
5. 打开 Designer 并选中新节点。

所点 Round 不参与上述数据写入。

## 3. Task 类型目录

`TaskKindDescriptor` 是可序列化目录项，包含：

- handler、显示名称、说明和图标；
- JSON config schema 与默认 config；
- 默认 input/output ports；
- 默认 join、retry 与 resource policy。

内置类型：

| 类型 | 用途 |
|---|---|
| `agent` | Agent/version、prompt、context/state policy、loop mode |
| `route` | 模式、稳定 TaskEdgeId 规则、默认边与条件表达式 |
| `transform` | identity/pick、value/path、输出名称与类型 |
| `reduce` | 多 Artifact 聚合 |
| `human` | 人工请求与响应 schema |
| `subflow` | 子 Flow 扩展计划 |
| `spawn` | 动态 children 与 continuation |

插件通过 `TaskKindContribution` 提供相同描述字段，并可附加 validator、compiler、executor、migration 或专用 editor。没有专用 editor 时使用通用 JSON Schema 表单。`plugin.taskKinds.list` 默认返回完整 descriptor；`handlersOnly` 保留 handler-only 兼容读取。

## 4. FlowDraft 命令

UI 只能通过 CommandBus 调用：

| 命令 | 语义 |
|---|---|
| `flow.draft.list` | 列出草稿 |
| `flow.draft.create` | 创建 v1 空草稿 |
| `flow.draft.load` | 加载草稿 |
| `flow.draft.save` | 使用 expectedDraftVersion 乐观保存 |
| `flow.draft.validate` | 校验节点、端口、边、cycle、route 与 config |
| `flow.revision.create` | 从 draft ID/expected version 发布 Revision |
| `flow.revision.get/list` | 读取不可变 Revision |

版本只由引擎递增。版本冲突不会覆盖持久化草稿，Designer 保留本地修改并提示用户重新加载。

## 5. Designer

Design mode 支持：

- 节点新增、编辑、复制、删除；
- 删除节点时确认并原子删除 incident edges；
- SVG control/data 连线和端口点击连接；
- edge Inspector、端口与策略 JSON 编辑；
- 拖动布局、自动布局、缩放、适应画布；
- undo/redo、实时校验、保存与发布。

边必须满足：

- 禁止 self-edge、重复边和 cycle；
- data edge 必须引用有效 output/input port；
- cardinality 与 schema 必须通过引擎校验；
- route rule/default 只引用该 route 的稳定 outgoing TaskEdgeId；
- 删除边同步清理 route rules/default。

Run 按钮固定执行：

```text
保存草稿 → 校验 → 创建 Revision → ChatInput.selectFlow → 聚焦输入框
```

用户发送消息时，SendIntent 同时携带当前 ConversationGraph branch/context 和选定 Flow revision。

## 6. Run 投影

Flow 启动后，会话层发布只读 `graphRunId` 投影事件。Workbench 加载 `TaskGraphRun` 并进入 Run mode：

- 使用 `FlowNodeId → TaskRunId[]` 映射；
- 展示任务状态、Attempts、Artifacts 与 edge states；
- 支持运行级 cancel、任务 retry 和人工响应命令；
- 禁止任何结构编辑。

运行状态只能由 TaskGraph Reconciler、event store 与 run store 更新，UI 不直接修改 TaskGraphRun。

## 7. 不变量与安全

1. Revision 与 Artifact 创建后不可修改。
2. handler 必须使用已注册的 provider/kind/version/schemaVersion。
3. UI 不直接访问 VFS、GraphStore 或 TaskGraphRun store。
4. 输入配置通过 JSON Schema 与插件 validator 校验。
5. 敏感配置不得写入 Flow config；只保存连接或资源引用。
6. AgentGroup 当前不是独立 Task 类型，待 strategy compiler 契约稳定后通过贡献机制加入。

## 8. 验证范围

- Navigator 分组菜单与原 branch 行为；
- 七种内置 descriptor 默认节点；
- required、enum、object、array、嵌套 schema；
- draft create/list/load/save 与版本冲突；
- 节点/边 CRUD、复制、incident edge 删除、route 清理、cycle/port 校验；
- Revision 不可变与 Run 选择 ChatInput；
- Design/Run mode 只读边界；
- 当前 branch/context 与 direct-agent 路径不回归；
- common、llm-engine、llm-ui、llm-harness TypeScript 检查，相关 Vitest 与构建。
