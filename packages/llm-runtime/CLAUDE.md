# llm-runtime 开发说明

本包是平台无关的 LLM Durable Program 层，不是系统总控。

## 目录

```text
src/
├── core/
│   ├── context-assembler.ts
│   └── provider-message-adapter.ts
└── durable/
    ├── chat-program.ts
    ├── agent-program.ts
    └── program-helpers.ts
```

## 约束

- 新运行模式实现 `DurableTaskProgram`。
- 所有等待必须返回 Harness `WaitSpec`，State 必须可持久化。
- 所有外部能力通过 Harness `Effect` 使用。
- 不得依赖 `llm-conversation`、UI、DOM 或具体设备。
- 不在本包新增 Session、Flow、Scheduler、CommandBus 或通用 Middleware。

运行：

```bash
pnpm --filter @itookit/llm-runtime typecheck
pnpm --filter @itookit/llm-runtime test:run
```
