# llm-tasks 开发说明

本包是平台无关的 LLM Durable Program 层，不是系统总控。详见 [llm-tasks API](../../doc/llm-tasks-api.md)。

## 目录

```text
src/
├── index.ts                        统一导出
├── core/
│   ├── context-assembler.ts        兼容转发到 @itookit/context
│   └── provider-message-adapter.ts 兼容转发到 @itookit/context
└── durable/
    ├── types.ts                    Program 状态 / 输入 / 输出类型
    ├── task-spec.ts                llm.agent / llm.chat 的 TaskInput 装配
    ├── program-helpers.ts          Program 共享辅助（事件、用量、失败处理）
    ├── dependency-collector.ts     依赖收集状态机（等待 task-exited → 就绪）
    ├── context-compaction.ts       兼容转发到 @itookit/context
    ├── chat-program.ts             DurableChatProgram
    ├── agent-program.ts            DurableAgentProgram（工具调用 / 审批）
    └── plan-program.ts             DurablePlanProgram
```

## 约束

- 新运行模式实现 `DurableTaskProgram`。
- 所有等待必须返回 Kernel `WaitSpec`，State 必须可持久化。
- 所有外部能力通过 Kernel `Effect` 使用。
- 不得依赖 `llm-session`、`llm-flow`、UI、DOM 或具体设备。
- 不在本包新增 Session、Flow、Scheduler、CommandBus 或通用 Middleware。

运行：

```bash
pnpm --filter @itookit/llm-tasks typecheck
pnpm --filter @itookit/llm-tasks test        # vitest run（等价于 test:run）
pnpm --filter @itookit/llm-tasks test:watch  # 监听模式
```

ContextTaskProgram 为 Agent/Chat v2 bridge，负责把 context 写集转换为 Kernel actions；预算、Notes 与检索策略全部归独立 context 包。
