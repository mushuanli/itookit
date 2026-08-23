# 跨包开发模式

## LLM 能力归属

| 需求 | 所属包 |
| --- | --- |
| 跨包协议 | `common` |
| Provider 通信 | `device-llm` |
| DurableTaskProgram、ContextPolicy | `llm-runtime` |
| Session/Task 内核与 Durable 调度 | `durable-kernel` |
| LLM、Tool、Skill、Bash、TTY 能力适配 | `kernel-adapters` |
| Session、Round、Flow 持久化 | `llm-conversation` |
| 展示、编辑和 Task attach | `llm-ui` |
| 具体实现装配 | `app-shell` |

## 扩展规则

- 新 Agent 循环实现 `DurableTaskProgram`。
- 新 DAG 节点注册 manifest，并编译为 `TaskSpec/dependsOn`。
- 多步 Skill 在 manifest 声明 `taskProgram`，使用 `createSkillTaskSpec` 编译为 Task；只有加载和单次外部调用属于 Effect。
- 新能力通过 Kernel 插件注册 `EffectAdapter` 或 Resource provider。
- 需要确认或输入的动作返回 `InteractionRequest`，恢复时由 signal 驱动。
- 不新增万能 Middleware 或核心节点类型分支。

## 依赖方向

```text
common ← llm-runtime → durable-kernel
vfs-core ← durable-kernel ← kernel-adapters
common ← llm-conversation → llm-runtime
common ← llm-ui → llm-conversation → durable-kernel
app-shell → concrete packages
```

`llm-runtime` 只依赖 common 与 Kernel 公共契约，不依赖 Conversation、UI 或平台实现；
UI 不读取 Kernel 内部 Store，平台能力实现归属 `apps/*`。
