# 跨包开发模式

## LLM 能力归属

| 需求 | 所属包 |
| --- | --- |
| 跨包协议 | `common` |
| Provider 通信 | `device-llm` |
| ProcessProgram、ContextPolicy | `llm-engine` |
| Kernel、Scheduler、DAG Runtime | `llm-harness` |
| Session、Round、Flow 持久化 | `llm-conversation` |
| 展示、编辑和 Run attach | `llm-ui` |
| 具体实现装配 | `app-shell` |

## 扩展规则

- 新 Agent 循环实现 `ProcessProgram`。
- 新调度算法实现 `SchedulingPolicy`。
- 新编排方式实现 `SchedulerModule`。
- 新 DAG 节点实现 Manifest、Runtime 和可选 UI Contribution。
- 新资源实现 `LLMPort`、`ToolPort` 或 `VfsPort`。
- 不新增万能 Middleware 或核心节点类型分支。

## 依赖方向

```text
common ← llm-engine
common ← llm-harness
common ← llm-conversation → llm-engine
common ← llm-ui → llm-conversation
app-shell → concrete packages
```

`llm-engine` 不依赖 Conversation/Harness/UI；`llm-harness` 不依赖 Conversation/UI；UI 不读取 Kernel 内部对象。
