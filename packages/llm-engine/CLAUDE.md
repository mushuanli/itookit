# llm-engine 开发说明

本包是 LLM Process 层，不是系统总控。

## 目录

```text
src/
├── core/
│   ├── context-assembler.ts
│   └── provider-message-adapter.ts
└── process/
    └── programs/
```

## 约束

- 新运行模式实现 `ProcessProgram`。
- 所有等待必须返回 `waiting` 和可序列化 State。
- 所有外部能力通过 `ProcessContext.resources` 使用。
- 不得依赖 `llm-conversation`、`llm-harness`、UI、DOM 或具体设备。
- 不在本包新增 Session、Flow、Scheduler、CommandBus 或通用 Middleware。

运行：

```bash
pnpm --filter @itookit/llm-engine typecheck
pnpm --filter @itookit/llm-engine test:run
```
