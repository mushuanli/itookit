# Executor 插件详细设计 — chat / loop / mission / graph

> 上级设计: [llm-2.md](../llm-2.md) §6.1
> 定位: 4 个 `ILoop` 实现，经 `registerExecutor` 注册。UI 只见统一的事件流，不感知执行模式差异。

---

## 1. 分发规则

```
signal(send, mode?) 的 executor 选择：
    mode 显式指定（如 slash 命令 /mission）
      → session settings 的默认 mode
        → 全局默认 'loop'
```

所有 executor 共享同一 `LoopContext` 装配（fold 历史、ILLMService、工具服务、AbortSignal），由内核 Loop 宿主统一驱动（`drive()`，见 [02-loop.md](./02-loop.md) §1.2）。

---

## 2. executor-chat — 单次问答

最小实现，同时是 `ILoop` 契约的参考样例与测试基线：

```typescript
export const chatExecutor: ILoop = {
    mode: 'chat',
    async *run(ctx) {
        const messages = await ctx.log.fold(ctx.ref);
        yield { type: 'turn:start', ... };
        for await (const chunk of ctx.llm.chatStream(conn, { messages })) {
            yield { type: 'stream:content', delta: chunk.delta };   // → DraftArea
        }
        yield { type: 'turn:end', ... };
        return [await promoteDraft(ctx)];      // single turn, no tools
    },
    resume: notSupported,   // 无暂停点
};
```

- 无工具、无中间件、单轮
- 迁移自：`TaskRunner` 的 kernel 路径（`LLMKernelAdapter.executeQuery` + AutoContinue 剥离——续写归 Goal）

---

## 3. executor-loop — Agent Loop（协程内核 + 中间件预设）

核心实现见 [02-loop.md](./02-loop.md)。本插件贡献两个**预设**：

| 预设 | 中间件集合 | 取代 |
|---|---|---|
| `loop`（默认） | `[budget, error-recovery]` | `UnifiedLoopStrategy` / `ClaudeCodeStrategy` |
| `loop:full` | `[budget, compression, error-recovery, hitl, skills, back-pressure]` | harness `AgentLoopExecutor` 全功能 |

```typescript
ctx.registerExecutor(createLoopExecutor({ preset: 'lite' }));    // mode='loop'
ctx.registerExecutor(createLoopExecutor({ preset: 'full' }));    // mode='loop:full'
```

- 预设仅是中间件数组的差异，循环体只有一份
- session settings 可逐项覆盖（如 lite + skills）
- 工具面：经 `IToolService` 注入；skill 动态工具由 skills 中间件挂载

---

## 4. executor-mission — 目标分解与自动执行

三阶段，全部构建在原语之上：

```
Phase 1  规划（并行多角度）:
    for agentId in plannerAgentIds:
        ref_i = refs.create('mission/plan-' + i, base)      // 每 planner 一个分支
        并发 drive(loopExecutor.run(ref_i, plannerPrompt))
    plans = 各分支解析出 TodoItem[]
    合并计划: log.merge(refs, { type: 'pick', turns: 去重后的 todo 轮次 })

Phase 2  构建 Goal:
    goal = { nodes: todos → GoalNode, edges: todo 依赖 }
    predicate = 'llm-judge'(verifierAgentId)
    持久化经 tasks 插件存储（人工可干预）

Phase 3  执行:
    reconcile(goal, node => subLoopFactory(node))            // [04-goal.md] §2
    每节点在独立 ref 上运行（并行天然隔离）
    节点完成 → 结果 ref 汇入 mission 主 ref: log.merge(..., 'summarize-branches')
    yield goal:progress 事件 → 任务面板
```

**关键升级**（相对现有 MissionService）：

| 方面 | 现状 | 新设计 |
|---|---|---|
| 规划分支 | 内存中并行调用 | **每 planner 一个真实 ref**——规划过程可回看、可人工修正后重跑 |
| 结果组合 | `ResultPersistenceService` 手工写 VFS | `log.merge(summarize-branches)`——组合进入正史，可追溯 |
| 子任务执行 | `LiteSubAgentRouter`/`SubAgentRouter` 两份 | 统一 `loopExecutor`（受限工具集经 TaskSpec 传入），Router 删除 |
| 调度 | 500ms 轮询 | 事件驱动 reconcile |

---

## 5. executor-graph — 文件依赖编排

```
run(ctx):
    graph = parseFileDependencies(entryFile)     // ./a.md, ./dir/ 声明解析（沿用现有）
    goal = { nodes: files → GoalNode, edges: 依赖 }
    node.task.prompt = 文件内容 + 上游节点结果（fold 上游 ref 的产出）
    node.predicate = advance 模式 ? 'llm-judge'(CompletionAnalyzer 合并入 llm-judge) : always-done
    reconcile(goal, ...)
    结果写回: SessionMetaStore 格式保留（session-meta.json + result.md）
```

- 迁移自：`GraphOrchestrator` + `DependencyGraph` + `CompletionAnalyzer`；拓扑与失败传播全部委托 `DependencyScheduler`
- 与 executor-mission 的边界：graph 的节点来自**文件声明**（静态），mission 的节点来自 **LLM 规划**（动态）；执行底座完全共享

---

## 6. 事件与 UI 的关系

四个 executor 产出同一 `AgentEvent` 词汇——UI 的历史视图/任务面板无模式分支代码：

| executor | 特征事件 |
|---|---|
| chat | `turn:*` + `stream:*` |
| loop | + `tool:*` / `await_signal` / `budget:*` / `context:compressed` |
| mission / graph | + `goal:progress` / `log:merged` |

---

## 7. 迁移与删除清单

| 现有 | 归宿 |
|---|---|
| `TaskRunner`（队列 + 双路径分发） | → Session mailbox 入队 + 分发规则（§1）；`selectStrategy` 删除 |
| `IAgentLoopStrategy` / `HarnessStrategy` / `HarnessAdapter` | **删除**（`ILoop` 统一） |
| `MissionService` / `MissionScheduler` | → executor-mission（Phase 1-3） |
| `LiteSubAgentRouter` / harness `SubAgentRouter` | **删除** → 受限 TaskSpec 的 loopExecutor |
| `GraphOrchestrator` / `DependencyGraph` | → executor-graph + DependencyScheduler |
| `AgentResolver` / `AttachmentProcessor` | → LoopContext 装配阶段（内核公共前置） |
