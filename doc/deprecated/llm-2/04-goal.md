# Goal 原语详细设计 — 控制回路 + 唯一依赖调度器

> 上级设计: [llm-2.md](../llm-2.md) §2.4 / §4
> 定位: 任务 = 期望状态 + 完成谓词。现有 4 份控制回路（Mission / SessionGraph / AutoContinue / BackPressure）收敛为一个 reconcile 原语的配置。

---

## 1. 数据模型

```typescript
interface Goal {
    id: string;
    nodes: GoalNode[];
    edges?: Array<[from: string, to: string]>;   // dependency DAG
}

interface GoalNode {
    id: string;
    task: TaskSpec;               // what to run (prompt / loop mode / tools allowlist)
    predicate: PredicateRef;      // how to judge completion
    canParallel?: boolean;        // default true when deps allow
    maxRetries?: number;          // default 2
}

type NodeStatus = 'pending' | 'ready' | 'running' | 'done' | 'retrying'
                | 'awaiting_signal' | 'failed' | 'skipped';

type Predicate = (result: TurnResult, node: GoalNode) => Promise<Verdict>;
type Verdict =
    | { status: 'done' }
    | { status: 'retry'; feedback: string }      // feedback 注入下次 prompt
    | { status: 'hitl'; request: PauseRequest }  // 升级人工
    | { status: 'failed'; reason: string };
```

---

## 2. reconcile 算法

```
reconcile(goal, loopFactory):
    scheduler = DependencyScheduler(goal.nodes, goal.edges)   // Kahn 预排序 + 环检测
    while not scheduler.finished():
        ready = scheduler.readySet()              // deps 全 done 且 pending
        parallel, serial = partition(ready, canParallel)
        dispatch parallel via Promise.allSettled
        dispatch serial sequentially
        // per node:
        result  = drive(loopFactory(node.task))   // 复用 Loop 宿主（含 pause 支持）
        verdict = node.predicate(result, node)
        switch verdict:
            done   → scheduler.complete(node)
            retry  → retries++ ≤ maxRetries ? requeue(feedback) : fail(node)
            hitl   → yield await_signal(request)  // 复用 Loop 的暂停协议！
            failed → fail(node)
        fail(node) → scheduler.propagateSkipped(descendants(node))
        await scheduler.onChange()                // 事件驱动，取代 500ms 轮询
    return summary
```

关键改进（相对现有 4 份实现）：

| 改进 | 现状 | 新设计 |
|---|---|---|
| 事件驱动 | MissionScheduler 500ms 轮询 | 节点完成即触发下一轮调度 |
| HITL 复用 | Mission 自带 hitl 分支 + HITLQueue | verdict=hitl 直接走 Loop 的 `await_signal` 协议 |
| 结果组合 | ResultPersistenceService 手工拼接 | 节点产出在独立 ref 上，组合 = `log.merge`（见 06-executors） |
| 失败传播 | Mission / Graph 各写一份 | `propagateSkipped` 唯一实现 |

---

## 3. DependencyScheduler — 全系统唯一依赖调度器

取代 4 份实现：kernel `DagOrchestrator` / engine `DependencyGraph` / `MissionScheduler` 内嵌调度 / `scheduler/dependency-resolver`。

```typescript
class DependencyScheduler {
    constructor(nodes: GoalNode[], edges: Edge[]);   // Kahn 拓扑 + CycleError
    readySet(): GoalNode[];
    complete(id: string): void;
    fail(id: string): void;                          // auto propagateSkipped
    onChange(): Promise<void>;                       // event-driven wakeup
    finished(): boolean;
    snapshot(): Record<string, NodeStatus>;          // → goal:progress 事件
}
```

- 环检测：构造时 Kahn 检出即抛 `CycleError`（沿用 kernel 实现，唯一保留）
- 同深度节点天然并行（fan-out）；fan-in 等待全部依赖 done
- `snapshot()` 驱动 `goal:progress` 事件 → tasks 面板

---

## 4. 内置 Predicate（三个）

| Predicate | 判定方式 | 来源模块 |
|---|---|---|
| `truncation` | 启发式检测输出是否被截断（finish_reason + 尾部完整性） | `TruncationDetector` |
| `shell` | 运行 shell 命令，退出码 0 = done，非 0 输出作为 retry feedback | `BackPressureValidator` |
| `llm-judge` | verifier LLM 结构化判定 done/retry/hitl | Mission verifier + `CompletionAnalyzer`（两份合一） |

Predicate 经扩展点 `predicates` 注册（见 [05-extension.md](./05-extension.md)），插件可增自定义谓词。

---

## 5. 四个现有控制回路的配置化表达

| 现有模块 | Goal 配置 |
|---|---|
| **Mission** | nodes = planner 产出的 TodoItem[]；edges = todo 依赖；predicate = `llm-judge`(verifier)；task = subagent 委托 |
| **SessionGraph** | nodes = 文件依赖拓扑；edges = 文件 `dependencies` 声明；predicate = `llm-judge`(CompletionAnalyzer)；上游结果注入下游 prompt |
| **AutoContinue** | 单节点；predicate = `truncation`；retry = 续写 prompt；maxRetries = maxContinuations |
| **BackPressure**（回路部分） | 单节点；predicate = `shell`；retry feedback = 修正注入（单轮内检查仍是 loop 中间件，见 02-loop §3.2） |

**删除清单**：`MissionScheduler`（调度部分）、`GraphOrchestrator`（调度部分）、`AutoContinueHandler`（循环部分）、kernel 5 种 Orchestrator（Serial/Parallel/Router/Loop 是 Goal 的退化形态：串行 = 链式 edges；并行 = 无 edges；Router/Loop = predicate 组合）。

---

## 6. 与 Loop / Log 的关系（层次单向）

```
Goal ──调用──▶ Loop（loopFactory 每节点一个协程）──检查点──▶ Log
  │                                                        ▲
  └──────────────结果组合 log.merge ───────────────────────┘
```

- Goal 不直接写 Log（经 Loop 检查点）；组合结果时调用 `log.merge`
- Goal 的暂停（verdict=hitl）复用 Loop 宿主的 `await_signal` 挂起/持久化，崩溃后 `reconcile` 从 `snapshot` 恢复（TodoStateManager 的 VFS 持久化保留为 Goal 状态存储）

---

## 7. 开放问题

| 问题 | 倾向 |
|---|---|
| Goal 嵌套（节点的 task 又是一个 Goal） | 允许（Mission 子任务再分解），深度限制 3（继承 SubAgent 深度限制） |
| 并发上限 | 全局并发池与 Session mailbox 共享（maxConcurrent=8 保留） |
| Goal 状态持久化格式 | 沿用 TodoStateManager 的 VFS JSON，字段对齐 GoalNode |
