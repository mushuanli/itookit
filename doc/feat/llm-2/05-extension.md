# 扩展系统详细设计 — ExtensionRegistry + 功能插件

> 上级设计: [llm-2.md](../llm-2.md) §6
> 定位: 内核之外一切功能皆插件。扩展点必须满足 Rule of Three；内置功能必须吃自己的狗粮。

---

## 1. 插件契约

```typescript
interface IPlugin {
    readonly name: string;
    readonly dependencies?: string[];       // plugin names, topo-ordered activation
    activate(ctx: ExtensionContext): void | Promise<void>;
    deactivate?(): void | Promise<void>;
}

interface ExtensionContext {
    // kernel primitives (read-mostly; writes go through contracts)
    log: ILog;
    sessions: ISessionRegistry;
    commands: ICommandBus;
    events: IEventSubscriber;               // subscribe-only view of EventStream
    // contribution points
    registerExecutor(loop: ILoop): Disposable;
    registerMiddleware(mw: ILoopMiddleware, order?: number): Disposable;
    registerTool(def: ToolDefinition): Disposable;
    registerPredicate(name: string, p: Predicate): Disposable;
    registerView(id: string, projection: ViewProjection): Disposable;
    // plugin-scoped storage (VFS)
    storage: IPluginStorage;                // /plugins/<name>/ 命名空间
    log_(tag: string): ILogger;             // scoped logger
}
```

**激活策略**：启动时按依赖拓扑序全量激活。不做 VS Code 式懒激活事件——全部插件是第一方代码（YAGNI）。

**失败隔离**：单插件 activate 抛错 → 记录 + 跳过该插件，不阻塞内核；依赖它的插件级联跳过并警告。

---

## 2. 六个扩展点契约

| 扩展点 | 契约 | Rule of Three 消费者 |
|---|---|---|
| `executors` | `ILoop`（[02-loop.md](./02-loop.md)） | chat / loop / mission / graph |
| `loop.middleware` | `ILoopMiddleware` | budget / compression / recovery / hitl / skills / back-pressure |
| `commands` | `(args) => Promise<unknown>` | vcs ×6 / tasks ×4 / session ×5 / export... |
| `tools` | 现有 `ToolDefinition`（保持 @itookit/tools 注册表） | 内置工具 + skill 动态工具 + MCP |
| `predicates` | `Predicate`（[04-goal.md](./04-goal.md)） | truncation / shell / llm-judge |
| `views` | `ViewProjection`（[07-ui.md](./07-ui.md)） | history / tasks 面板 / cost 仪表板 |

**红线**：新扩展点必须先有 ≥2 个具体消费者才允许开设（本库 llm-kernel PluginManager 零插件的教训）。

---

## 3. vcs 插件（git 式会话管理）

**依赖面**：仅 `ctx.log`（refs/merge/rebase）+ `ctx.commands` + 一个 view。**不触碰 Loop/Goal**。

### 3.1 贡献清单

```typescript
export const vcsPlugin: IPlugin = {
    name: 'vcs',
    activate(ctx) {
        const refs = ctx.log.refs();
        ctx.commands.register('vcs.branch.create', ({ name, at }) => refs.create(name, at));
        ctx.commands.register('vcs.branch.delete', ({ name }) => refs.delete(name));
        ctx.commands.register('vcs.rollback',      ({ ref, to }) => refs.move(ref, to));
        ctx.commands.register('vcs.save',          ({ name, at }) => refs.tag(name, at));
        ctx.commands.register('vcs.merge',         ({ refs: r, strategy }) => ctx.log.merge(r, strategy));
        ctx.commands.register('vcs.rebase',        ({ ref, at, turns, regenerate }) =>
            ctx.log.rebase(ref, at, turns, { regenerate }));
        ctx.commands.register('vcs.log',           () => refs.list());
        ctx.registerView('vcs.graph', dagGraphProjection);   // git log --graph 式分支图
    },
};
```

### 3.2 关键交互流

**并行探索 → 合并**（用户视角）：
1. 历史视图某节点右键 →"从此分叉"×N → `vcs.branch.create`
2. 各分支独立对话（每 ref 一个协程，天然并发）
3. 分支图视图多选 tips →"合并"→ 选策略 → `vcs.merge`
4. merge 节点出现，继续主线对话

**插入**：节点间 hover"+"→ 输入内容 → 选"照搬下游(stale 标记)"或"级联重生成"→ `vcs.rebase`。级联重生成内部创建一个 Goal（predicate=llm-judge 可选）。

---

## 4. tasks 插件（任务管理）

**依赖面**：`ctx.storage`（todo 持久化）+ `ctx.commands` + `registerTool` + `registerView` + Goal 原语。

### 4.1 贡献清单

| 贡献 | 内容 |
|---|---|
| commands | `tasks.create` / `tasks.update` / `tasks.list` / `tasks.runGoal`（把 todo DAG 提交给 reconcile） |
| tools | `todo_create` / `todo_update`（LLM 在对话中管理任务，同 Claude Code 模式） |
| view | 任务面板：订阅 `goal:progress` 事件渲染 DAG 进度 |
| storage | `/plugins/tasks/<scope>.json`（沿用 TodoStateManager 格式） |

### 4.2 与 Mission 的关系

executor-mission（[06-executors.md](./06-executors.md)）负责"目标 → 规划 → 执行"全自动流；tasks 插件负责**人工/半自动**任务管理。两者共享 Goal 原语与存储格式——Mission 生成的计划出现在任务面板，人工可干预（改依赖/跳过/重试）。

---

## 5. 其余功能插件（迁移自现有服务）

| 插件 | 迁移自 | 依赖面 |
|---|---|---|
| `agent-config` | `VFSAgentService`（Agent/Connection CRUD + 恢复诊断） | VFS + commands + device-llm `ILLMManagementService` |
| `prompt-history` | `PromptHistoryService` | storage + commands + 输入插件联动 |
| `export` | `exportToMarkdown` | `log.fold` 投影 + commands |
| `cost` | Cost 链路 UI 侧 | events 聚合投影 + device-llm 查询 |

---

## 6. Dogfooding 执行机制

规则："内核对内置功能零特权路径"的落实：

1. **结构约束**：`llm-core` 包不 import 任何插件包（依赖方向单向，lint rule 强制）
2. **注册对等**：executor-chat 与第三方 executor 走同一个 `registerExecutor`，无内核白名单
3. **审查清单**：新功能 PR 必答"用了哪个扩展点？若都不适用，为什么不是开新扩展点（附 ≥2 消费者证明）？"

---

## 7. 开放问题

| 问题 | 倾向 |
|---|---|
| 插件间通信 | 仅经 commands / events，禁止直接 import（Emacs 教训）；lint 强制 |
| 插件配置 | `ctx.storage` 下 `config.json`，UI 经 settings 编辑器统一呈现 |
| 卸载时资源清理 | 全部贡献返回 `Disposable`，deactivate 时批量 dispose |
