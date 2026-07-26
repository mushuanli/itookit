# llm-ui 开发说明

本包负责 Conversation 展示和 Run 控制，不直接控制 Engine。

## 关键边界

- `RunAttachmentController` 通过 `RunHandle` attach、消费事件、signal 和 cancel。
- `DagWorkbench` 从插件 Manifest/UI Contribution 构建 Palette、端口和表单。
- UI 不 import DAG Runtime，也不判断具体节点执行类型。
- Process 输出以文本节点安全写入，不能直接拼接未转义 HTML。
- TTY 面板只展示运行输出；交互输入必须通过 Harness 控制面。
- SessionState 是 Round 的 UI 投影，不是运行事实源。

运行：

```bash
pnpm --filter @itookit/llm-ui typecheck
pnpm --filter @itookit/llm-ui exec vitest run
```
