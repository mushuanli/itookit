# llm-engine 引擎详情

## LLMSessionEngine — Chat 持久化

```
my-session.chat               ← ChatManifest JSON
_my-session.chat/             ← 资产目录
├── 000_00000_s.chat          ← 系统节点
├── 000_00001_u.chat          ← 用户消息
├── 000_00002_a.chat          ← 助手消息
└── settings.yaml             ← ChatSessionSettings
```

## HarnessAdapter — 事件映射

| Agent Event | OrchestratorEvent |
|---|---|
| `agent:stream:content` | `node_update` field=output |
| `agent:stream:thinking` | `node_update` field=thought |
| `agent:tool:start` | `node_start` (新建 tool 子节点) |
| `agent:tool:success` | `node_status(success)` + toolResult |
| `agent:tool:error/timeout` | `node_status(failed)` |
| `agent:tty:open/data/close` | `node_update` metaInfo.tty* |
| `agent:human:input/resolved` | `node_update` metaInfo.hitl* |
| `agent:budget:warning/exhausted` | `node_update` / `error` |

单例模式：`initHarnessAdapter(runtime)` / `getHarnessAdapter()` / `resetHarnessAdapter()`

## Mission 编排

```
MissionService.createMission(goal)
  → 并行 Planner → TodoItem[]
  → MissionScheduler.run() loop:
      getReadyTodos() → executeTodo() → runVerifier()
      → verdict: done | retry | hitl
```

VFS 存储：`missions/<id>/plan.json` + `journal.md` + `results/` + `summaries/` + `hitl/`

## Session Dependency Graph

每个 VFS 文件是一个 "session"，依赖声明在 `_<filename>/session-meta.json`。`GraphOrchestrator` 拓扑排序后自底向上执行。
