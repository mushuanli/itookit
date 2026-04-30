# llm-harness 设计详情

## 关键设计决策

### Tool 执行规则（基于 sideEffect）

| sideEffect | 并行策略 | 权限检查 |
|---|---|---|
| `none` | 并行 (`Promise.all`) | 无 |
| `local` | 串行 (`for`) | `agent:permission:request` 拦截 |
| `external` | 串行 (`for`) | `agent:permission:request` 拦截 |

### 4 层上下文压缩

| 层 | 阈值 | 名称 | 操作 |
|---|---|---|---|
| L1 | ≥ 0.70 | `history_snip` | 截断 >2000 chars 消息 |
| L2 | ≥ 0.80 | `cache_prune` | 移除旧 assistant 消息 |
| L3 | ≥ 0.85 | `llm_summarize` | LLM 摘要前 60% |
| L4 | ≥ 0.95 | `sliding_window` | 仅保留最后 6 条 |

### 6 维预算

turns(100) / inputTokens(5M) / outputTokens(1M) / cost($10) / duration(1h) / toolCalls(500)

## 内置工具 ToolMeta 契约

```typescript
interface ToolMeta {
    id: string;
    sideEffect: 'none' | 'local' | 'external';
    timeoutMs: number;
    type: 'builtin' | 'plugin' | 'mcp';
    enabled: boolean;
    skillLoaderArgKey?: string;
}
type ToolHandler = (args, context: { cwd, signal, timeoutMs, vfs? }) => Promise<string>;
```

## 扩展点

- **添加内置工具**：`tools/` 下创建文件，加入 `BUILTIN_TOOLS`
- **添加 Agent 事件**：`agent-types.ts` 的 `AgentEventType` 和 `AgentEventPayloads`
- **添加 BackPressure 规则**：`agentDriver.setLoopConfig({ backPressureRules: [...] })`
