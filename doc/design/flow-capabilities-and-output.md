# Flow 能力装配与输出查看

## 查看执行结果

### History 交互与重新运行

Session 标题栏的「重新运行」读取当前分支的最近一次 Flow 调用，预填其参数。提交前校验参数；成功提交会创建替代分支并切换展示，原分支的参数和结果不变。使用原调用的固定 revision，不自动切换到最新草稿。取消表单不创建分支；运行中不允许再提交；宿主的 Session 写入租约同样适用。每个执行 Round 保存自己的 `flow`，旧 Session 的首次调用兼容读取 manifest.flow。

History 展示交互而不展开 DAG：输入节点与补充输入显示为 user，执行任务和输入请求显示为 assistant；路由、内部汇总和判断不显示逻辑卡片。LLM 默认沿用设备流式能力（节点显式 `stream:false` 时返回完整内容），按 Task ID 投影独立消息，多个并发检查不会混合增量。终态用实际返回值替换该任务的流式文本，支持 JSON、失败及取消状态。

这些消息是 `RoundResult.flowInteractions` 的展示投影，不改变模型 history 策略，也不会把内部交互添加到 Round.input/output。任务即使 `flowHistory=omit` 仍可在界面显示。终态保存后，切换分支或重新打开会话会重建交互；执行中的原始增量仍由 Kernel 事件日志持久保存，本次不增加关闭窗口后自动续订整条 Flow 的机制。

实现：[重新运行](../../packages/llm-session/src/session/flow-rerun.ts)、[History 投影](../../packages/llm-session/src/session/flow-history.ts)。

在 llm-ui 运行 `.flow` 后，打开生成的 Session，点击标题栏的「流程输出」。窗口只列出当前 Session 的 Run，默认打开最新一次，也可以切换历史运行。

- 顶部显示最终输出，各节点卡片显示已完成的返回值；运行中每秒刷新一次，终态停止轮询。
- 字符串直接展示，结构化结果显示 JSON，保留 `0`、`false`、`null` 和空字符串。业务对象中的 `content` 字段不会被当作通用文本封装而丢弃其他字段。
- 作文评审显示结束原因、已完成轮数、各维度得分、来源轮次，以及是否对应当前输入；达到轮数上限与通过条件分别显示。
- 原有任务记录入口保留，可查看模型和工具事件。「流程输出」窗口按节点结果刷新，History 则显示 LLM 的流式文本。
- 打开历史输出只读取持久记录，不自动恢复执行；显式恢复仍使用工作台的恢复操作。切换 Session 或关闭窗口会释放轮询。
- 新完成的 Flow 同时把格式化结果写入会话消息；旧会话中已保存的空消息不会自动重写，但仍可从「流程输出」读取 Run 的持久结果。

源码：[输出投影](../../packages/llm-common/src/agent/flow-output.ts)、[会话窗口](../../packages/llm-ui/src/flows/session-output.ts)、[输出渲染](../../packages/llm-ui/src/components/dag/FlowOutput.ts)。

## 节点工具与 Skill

UI 与 CLI 复用 [createFlowCapabilities](../../packages/app-core/src/runtime/flow-capabilities.ts)，在 Session 创建后装配节点的 `config.toolIds` 和 `config.skillIds`。动态派发子任务也经过身份绑定、Skill 选择和工具白名单校验。缺失或禁用的工具、不可供模型使用的 Skill 会明确报错。

隔离 history 只移除消息、记忆及父会话上下文；显式选择的 Skill 指令和持久快照仍保留。宿主可注入 Agent/SystemPrompt 引用解析器；CLI 默认不提供实体引用解析，引用未接入的实体会报错，内联 system prompt 可直接使用。

### MCP

直接工具引用使用 `mcp__<server>__<tool>`。例如服务 `fixture` 的 `lookup` 工具为 `mcp__fixture__lookup`；含特殊字符的名称应通过导出的 `mcpToolId` 构造，不能手工拼接。服务地址、认证和进程配置来自已配置的 MCP Server，模型只提交工具参数。

Skill 可通过工具绑定声明：

```json
{
  "toolId": "lookup",
  "executionType": "mcp",
  "mcpServerId": "fixture",
  "mcpToolName": "lookup"
}
```

适配器按显式工具列表发现并注册 MCP 工具，执行通过 Kernel `tool.call` Effect，沿用批准、取消和恢复机制；结果保留 MCP content 与 structuredContent，`isError` 转为失败。冷启动后重新发现所需工具，不依赖内存中的注册状态。

设备层使用 [MCP 官方 TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/client.md) 完成初始化、工具分页与传输。HTTP 使用 Streamable HTTP，另支持 SSE/WebSocket；stdio 仅 Node 宿主支持，浏览器入口明确拒绝 stdio。支持配置 headers、cwd、环境变量和 timeout，取消信号传递给 SDK。远端副作用是否已经发生，仍受远端服务契约约束。

### 其他 Skill 工具

默认适配提供 HTTP 与宿主 nativeShell 执行；自定义 handler 由宿主工厂优先提供，找不到实现即失败，不静默跳过。Shell 推荐显式 `command` + `args` 数组，参数占位符为 `{{field}}`，替换值作为单个 argv 传入，不经额外 shell 解释。

需要先调用工具再生成结论的节点，应把 `maxExchanges` 至少配置为 `2`（更多调用按任务增加）；作文流程的业务 `maxRounds` 是另一层循环参数，不能替代模型交互预算。

## 验证范围

真实模型与构建后 CLI 的跨进程验证见 [CLI 能力与持久化实测](flow-cli-capabilities-verification.md)。执行记录与 UI 所需的聊天 Round 均已保存，等待输入、跨进程恢复和重复导出均有回归覆盖。

- [CLI 集成](../../apps/cli/tests/flow-capabilities.test.ts)：本地模拟模型 + 真实 stdio MCP 进程，直接工具、Skill 工具、独立 history、批准等待、关闭后恢复及再次运行。
- [HTTP MCP 测试](../../packages/device-llm/tests/mcp-transport.test.ts)：初始化、认证头、分页、结构化结果和取消。
- [输出测试](../../packages/llm-ui/src/flows/flow-output.test.ts) 与 [DOM 集成](../../packages/app-shell/tests/flow-output.test.ts)：结构化数据、转义、运行刷新、会话过滤、历史查看和关闭清理。

这些测试不依赖外部模型或用户 MCP 服务，也不等同于真实桌面手工验收。

CLI 使用共享 `FlowRunProjection` 按根 Task 幂等写入 History Round；节点、工具、输入和批准携带 `FlowActor` 身份。Skill 作为节点/工具来源展示，工具调用按 Task 和 call ID 隔离；分支切换保留 Flow 交互。验证见 [CLI 能力验收](flow-cli-capabilities-verification.md)。
