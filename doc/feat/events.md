# 事件系统 — 分析、重构方案与实现

> 分析范围: `packages/` 下所有 20 个包 | 重构日期: 2026-07-11 | 状态: ✓ 已实施

---

## 目录

- [1. 重构动机与问题分析](#1-重构动机与问题分析)
- [2. 统一 EventBus 核心设计](#2-统一-eventbus-核心设计)
- [3. 各包迁移明细](#3-各包迁移明细)
- [4. 性能对比](#4-性能对比)
- [5. 重构后架构图](#5-重构后架构图)
- [A. 附录：重构前全景分析](#a-附录重构前全景分析)
  - [A.1 概览：6 套独立事件系统](#a1-概览6-套独立事件系统)
  - [A.2 事件总线实现详解](#a2-事件总线实现详解)
  - [A.3 端到端事件流](#a3-端到端事件流)
  - [A.4 各包事件使用明细](#a4-各包事件使用明细)
  - [A.5 事件穿越架构图](#a5-事件穿越架构图)

---

## 1. 重构动机与问题分析

### 1.1 问题清单

重构前共 **6 套独立 EventBus 实现**（~756 行）分布在 6 个包中，各自实现相似的 on/emit/once/off 逻辑：

| 问题 | 详情 | 影响 |
|------|------|------|
| **重复实现** | 6 套 on/emit/once + snapshot + try/catch，核心逻辑相同 | 维护成本高，bug 修复需同步 6 处 |
| **Scope 隔离低效** | `ScopedEventBus` 通过 parent 注册 + filter 谓词，每个事件遍历 N 个并发 scope | 3 个并发执行时，每个事件被无效分发 3 次 |
| **Wildcard bug** | `once` + `'*'` 组合会导致 off 删除错误的 handler（off 只能按 type 桶删，`'*'` 桶需要按 handler 引用） | 单次监听器可能不生效 |
| **'*' 滥用** | 5 处使用 `'*'` 通配，`WorkerAdapter` 和 `CLI Runner` 用 `'*'` + 手工 `if (event.executionId === id)` 过滤 | 语义不清、性能浪费 |
| **API 不一致** | 清理方法 `removeAll()` / `removeAllListeners()` / `clear()` / `destroy()` 命名不统一 | 跨包理解成本高 |
| **泄漏风险** | `UIEventAdapter.bridge()` 返回裸函数，依赖调用方记得调用；9 个全局订阅无自动清理 | 会话异常退出后事件泄漏 |
| **批处理仅一处** | MDX 的 `queueMicrotask` 批处理只在 mdx 包中实现，VFS 和 LLM 需要类似能力但无共享方案 | 重复造轮子或直接放弃优化 |
| **TransactionEventBuffer 专用化** | 事务缓冲只服务于 VFS 的 `FSEventPayloadMap`，其他领域无法复用 | 代码重复 |
| **优先级排序每次 emit** | `priority` 选项全库零使用，但 kernel emit 每次 `sort()` O(n log n) | 空开销 |

### 1.2 设计原则

| 原则 | 含义 |
|------|------|
| **一套实现** | 所有包共用 `common/src/eventbus/` 下的 `EventBus<M>`，不保留兼容层 |
| **Channel = 隔离队列** | `channel(key)` 统一 `createScope(executionId)` 和 Session 白名单，O(1) 路由 |
| **组合优于继承** | `coalesce` 为构造选项而非子类；`EventBuffer` 实现 `IEventEmitter` 可 drop-in 替换 emit 目标 |
| **类型安全** | 泛型 `M extends Record<string, any>` 约束 event→payload 映射 |
| **保持不动** | DOM CustomEvent 导航、IAgentRuntime 事件接口、Adapter 语义翻译层 |
| **YAGNI** | 不引入持久化/重放、DLQ、ack/重试、异步投递——这是进程内同步总线 |

---

## 2. 统一 EventBus 核心设计

### 2.1 文件结构

```
packages/common/src/eventbus/
├── types.ts         接口 + 类型 (~60 行)
├── event-bus.ts     EventBus<M> + ChannelImpl (~160 行)
├── event-buffer.ts  EventBuffer<M> 事务缓冲 (~50 行)
└── index.ts         统一导出
```

### 2.2 核心接口

```typescript
// types.ts
export type Unsubscribe = () => void;

export interface EventMeta {
  readonly type: string;
  readonly timestamp: number;
  readonly channel?: string;
  readonly [key: string]: unknown;  // 领域扩展: moduleId, mountId, nodeId...
}

export type Handler<P> = (payload: P, meta: EventMeta) => void;
export type AnyHandler<M> = (payload: M[keyof M], meta: EventMeta) => void;

export interface IEventEmitter<M extends Record<string, any>> {
  emit<K extends keyof M & string>(type: K, payload: M[K], meta?: Record<string, unknown>): void;
  on<K extends keyof M & string>(type: K, handler: Handler<M[K]>): Unsubscribe;
  once<K extends keyof M & string>(type: K, handler: Handler<M[K]>): Unsubscribe;
  onAny(handler: AnyHandler<M>): Unsubscribe;
}

export interface IEventBus<M extends Record<string, any>> extends IEventEmitter<M> {
  channel(key: string): IEventChannel<M>;   // 幂等创建
  closeChannel(key: string): void;          // 关闭后 emit 静默丢弃
  hasChannel(key: string): boolean;
  clear(): void;
  stats(): { topics: number; handlers: number; channels: number };
}

export interface IEventChannel<M extends Record<string, any>> extends IEventEmitter<M> {
  readonly key: string;
}

export interface EventBusOptions {
  coalesce?: (keyof any & string)[];  // 高频事件微任务合并（覆盖语义）
  onError?: (err: unknown, type: string) => void;
}
```

### 2.3 Channel 隔离机制

Channel 替换了旧的 `createScope` + filter 谓词模式，实现 O(1) 路由：

```
旧方案:
  execution-1    on('*', filter: exId===1) }── 每个 emit 遍历 N 个 filter
  execution-2    on('*', filter: exId===2) }
  execution-3    on('*', filter: exId===3) }

新方案:
  bus.channel('exec-1').onAny(handler1)  ← 私有 handler 表
  bus.channel('exec-2').onAny(handler2)  ← 独立，无交叉遍历
  bus.channel('exec-3').onAny(handler3)  ← 独立，无交叉遍历

  channel.emit() → dispatchLocal(type, payload, meta)   // 1) channel 内 handler
                 → parent.dispatchBus(type, payload, meta)  // 2) bus 级 handler（含 onAny）
```

闭包后的 channel 所有 emit 操作自动丢弃，替代旧的 `registeredSessions` Set 门卫模式。

### 2.4 EventBuffer — 泛化事务缓冲

```typescript
export class EventBuffer<M extends Record<string, any>> implements IEventEmitter<M> {
  constructor(target: IEventEmitter<M>, baseMeta?: Record<string, unknown>);

  emit(type, payload, meta?)   // 缓冲而非立即分发
  on / once / onAny            // 委托给 target（订阅不走缓冲）
  commit()                     // 批量 flush 到 target，附加 fromTransaction: true
  rollback()                   // 丢弃所有缓冲，幂等
}
```

**设计要点**：`EventBuffer` 实现 `IEventEmitter`，可作为 ModuleFS 的 `_emitTarget` 直接替换 `bus`，事务期间所有 `_emit()` 调用自动进入缓冲，无需猴子补丁。

### 2.5 coalesce 高频事件合并

`emit()` 时若 type 在 `coalesce` 集合中，payload 仅写入 `pending` Map（覆盖语义），由 `queueMicrotask` 在下一微任务 tick 批量 flush。每个 tick 内同类型只保留最新 payload。

```typescript
// mdx 用法
new EventBus({ coalesce: ['change', 'cursorMove'] })
```

---

## 3. 各包迁移明细

### 3.1 迁移总表

| 包 | 旧文件 | 新实现 | 行数变化 | 变更要点 |
|---|---|---|---|---|
| `common` | — | `src/eventbus/` (新增) | +270 | 核心实现 |
| `llm-ui` | `EditorEventBus.ts` (45行) | 门面类委托 `CoreEventBus<EditorBusEvents>` | 45→20 | `destroy()`→`clear()`，handler签名适配 |
| `vfs-ui` | `EventBus.ts` (47行) | 门面类委托 `CoreEventBus<PublicEventMap>` | 47→23 | 实现 `IEventPort` 不变 |
| `mdx` | `event-bus.ts` (67行) | 门面类委托 `CoreEventBus<Record<string,any>>` + coalesce | 67→30 | 自身的 batch 逻辑删除，改用核心 |
| `vfslib` | `event-bus.ts` (113行) | 别名类 `extends CoreEventBus<FSEventPayloadMap>` | 113→10 | `removeAll()`→`clear()`；`TransactionEventBuffer`→泛型 |
| `llm-kernel` | `event-bus.ts` (185行) | 重写为类型目录 + `getEventBus()` 单例 | 185→76 | `IScopedEventBus`→`IEventChannel`；`createScope`→`channel`；`'*'`→`onAny` |
| `llm-engine` | `session-event-bus.ts` (299行) | 薄门面，双 `EventBus<M>` 分别管 session/global track | 299→110 | `getDebugInfo/getStats/debug` 删除；`registeredSessions`→channel 生命周期 |

**净效果**：~756 行 → ~270 行核心 + ~190 行领域适配

### 3.2 ModuleFS transaction 重构

重构前使用猴子补丁 `(this.bus as any).emit = bufferedEmit` 在事务期间拦截事件。重构后通过 `_emitTarget` 字段切换：

```typescript
// 重构前
async transaction(fn) {
  const buffer = new TransactionEventBuffer(this.bus, this.moduleId);
  (this.bus as any).emit = bufferedEmit;  // 猴子补丁
  try { await fn(tx); buffer.commit(); }
  catch(e) { buffer.rollback(); throw e; }
  finally { (this.bus as any).emit = originalEmit; }
}

// 重构后
private _emitTarget: IEventEmitter<FSEventPayloadMap> = this.bus;

_emit(type, payload) {
  this._emitTarget.emit(type, payload, { moduleId, mountId });
}

async transaction(fn) {
  this._emitTarget = new EventBuffer(this.bus, { moduleId: this.moduleId });
  try { await fn(tx); this._emitTarget.commit(); }
  catch(e) { this._emitTarget.rollback(); throw e; }
  finally { this._emitTarget = this.bus; }
}
```

### 3.3 WorkerAdapter 优化

```typescript
// 重构前 — '*' 通配 + executionId 过滤，N 并发时每个事件 N 次无效分发
const unsubscribe = eventBus.on('*', (event) => {
  if (event.executionId === id) this.postMessage(...)
});

// 重构后 — channel.onAny()，私有 handler 表 O(1) 直达
const channel = eventBus.channel(id);
channel.onAny((payload, meta) => this.postMessage(...));
```

### 3.4 Handler 签名变更

旧 API handler 接受单一 event 对象 `(event)`；新 API 拆分为 `(payload, meta)`：
- `event.type` → `meta.type`
- `event.timestamp` → `meta.timestamp`
- `event.payload` → 第一参数 `payload`
- 领域扩展字段（`moduleId`, `nodeId`, `mountId` 等）→ `meta.xxx`

**边界适配**：`ModuleFS.on/onAny` 和 `VFSManager.on/onAny` 在内部将 `(payload, meta)` 重新组装为旧 `FSEvent` / `VFSManagerEvent` 对象传给回调，对外契约（`FSEventEmitter` 接口）完全不变。

### 3.5 保持不动的部分

| 机制 | 原因 |
|------|------|
| `DOM CustomEvent` 导航事件 | 原生机制穿越 Shadow DOM，职责不同 |
| `HarnessAdapter` / `UIEventAdapter` 语义翻译 | Agent 词汇→Orchestrator 词汇是领域转换，非重复代码 |
| `IAgentRuntime` 事件接口 | 领域契约，独立于进程内 EventBus |
| `FSEvent` / `VFSManagerEvent` 对外接口 | 通过内部组装保持兼容 |

---

## 4. 性能对比

| 操作 | 重构前 | 重构后 | 提升 |
|------|--------|--------|------|
| emit 分发 | kernel 每次 `sort()` O(n log n) | 无排序 O(n) | 消除空开销 |
| Scope 隔离 | parent 注册 + filter 谓词，N 并发 = 每事件 N 次无效函数调用 | channel 私有 handler 表，无交叉遍历 | O(N)→O(1) |
| WorkerAdapter | `'*'` + `if (executionId === id)` 每条事件执行一次过滤 | `channel(id).onAny()` — 物理隔离 | 消除过滤开销 |
| 高频事件批处理 | 仅 mdx 支持 | 核心内置 `coalesce`，任何实例可配 | 通用化 |
| 事务内事件拦截 | 猴子补丁 `(bus as any).emit = ...` | `EventBuffer` 实现 `IEventEmitter` | 类型安全 |
| `once` + wildcard | 有 bug（off 错桶） | `once` 闭包直接删 entry 自身 | 修复 |

---

## 5. 重构后架构图

```
┌──────────────────────────────────────────────────────────────────┐
│                     common/src/eventbus/                          │
│  ┌──────────────┐  ┌──────────────────────┐  ┌───────────────┐  │
│  │ IEventEmitter│  │ EventBus<M>          │  │ EventBuffer<M>│  │
│  │ IEventBus    │  │  + channel(key)      │  │  (IEventEmitter│  │
│  │ IEventChannel│  │  + closeChannel(key) │  │   实现)        │  │
│  │ EventMeta    │  │  + coalesce 选项     │  │  commit/rollback│ │
│  └──────────────┘  └──────────────────────┘  └───────────────┘  │
└──────────────────────────────┬───────────────────────────────────┘
                               │ import
        ┌──────────────────────┼──────────────────────┐
        ▼                      ▼                      ▼
┌───────────────┐    ┌─────────────────┐    ┌─────────────────┐
│ llm-kernel    │    │ vfslib          │    │ llm-engine      │
│ getEventBus() │    │ EventBus extends│    │ SessionEventBus │
│ → singleton   │    │ CoreEventBus    │    │  session track  │
│ channel(id)   │    │ FSEventPayload  │    │  global track   │
│ → Kernel路径  │    │ Map             │    │  各自 EventBus  │
└───────┬───────┘    └────────┬────────┘    └────────┬────────┘
        │                     │                      │
        ▼                     ▼                      ▼
┌───────────────┐    ┌─────────────────┐    ┌─────────────────┐
│ worker-adapter│    │ EventBuffer     │    │ UIEventAdapter │
│ channel(id)   │    │ → ModuleFS      │    │ channel(id)    │
│ .onAny()     │    │   transaction()  │    │ → Handler     │
└───────────────┘    └─────────────────┘    └─────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│ 叶子包（零逻辑门面）                                              │
│ ┌───────────────┐  ┌─────────────────┐  ┌─────────────────┐    │
│ │llm-ui         │  │ vfs-ui          │  │ mdx              │    │
│ │EditorEventBus │  │ EventBus        │  │ EventBus         │    │
│ │→ CoreEventBus │  │→ CoreEventBus   │  │→ CoreEventBus    │    │
│ │EditorBusEvents│  │ PublicEventMap  │  │ coalesce配置     │    │
│ └───────────────┘  └─────────────────┘  └─────────────────┘    │
└──────────────────────────────────────────────────────────────────┘
```

---

---

## A. 附录：重构前全景分析

### A.1 概览：6 套独立事件系统

| # | 事件总线 | 所在包 | 作用域 | 核心文件 |
|---|---------|--------|--------|---------|
| 1 | **Kernel EventBus** | `llm-kernel` | 全局单例 | `src/core/event-bus.ts` |
| 2 | **SessionEventBus** | `llm-engine` | 每 SessionManager | `src/session/session-event-bus.ts` |
| 3 | **VFS EventBus** | `vfslib` | 每 VFSEngine / VFSManager | `src/event/event-bus.ts` |
| 4 | **EditorEventBus** | `llm-ui` | 每 LLMWorkspaceEditor | `src/shell/EditorEventBus.ts` |
| 5 | **MDX EventBus** | `mdx` | 每 PluginManager | `src/core/event-bus.ts` |
| 6 | **VFS-UI EventBus** | `vfs-ui` | 每 shell 实例 | `src/interaction/EventBus.ts` |

**额外事件机制：**

| # | 机制 | 所在包 | 作用域 |
|---|------|--------|--------|
| 7 | **DOM CustomEvent** | `common` | 浏览器 DOM 树冒泡 |
| 8 | **IAgentRuntime 事件** | `llm-harness`（接口在 `common`） | 运行时实例 |
| 9 | **SyncService 事件** | `app-settings` | 服务实例内部 |

---

### A.2 事件总线实现详解

### 2.1 Kernel EventBus（`llm-kernel`）

**文件：** `packages/llm-kernel/src/core/event-bus.ts`

全局单例，通过 `getEventBus()` 获取。是整个 LLM 执行引擎的事件中枢。

**事件类型（`KernelEventType`，16 种）：**

```
执行生命周期:
  execution:start       → 工作流开始执行
  execution:progress    → 执行进度更新
  execution:complete    → 执行成功完成
  execution:error       → 执行出错
  execution:cancel      → 执行被取消

节点生命周期:
  node:start            → 节点开始执行
  node:update           → 节点执行中更新
  node:complete         → 节点执行完成
  node:error            → 节点执行出错

流式输出:
  stream:thinking       → 思考过程流
  stream:content        → 内容输出流
  stream:tool_call      → 工具调用流

交互:
  interaction:request_input → 请求用户输入
  interaction:confirm       → 请求用户确认

状态:
  state:changed         → 状态迁移（StateMachine 发出）
```

**接口：**

```typescript
interface IEventBus {
  emit<T>(event: KernelEvent<T>): void
  on<T>(type: KernelEventType | '*', handler: EventHandler<T>, options?: SubscribeOptions): () => void
  once<T>(type: KernelEventType, handler: EventHandler<T>): () => void
  off(type: KernelEventType, handler: EventHandler<T>): void
  createScope(executionId: string): IScopedEventBus
  destroyScope(executionId: string): void
}

interface IScopedEventBus {
  emit<T>(event: KernelEvent<T>): void
  on<T>(type: KernelEventType | '*', handler: EventHandler<T>, options?: SubscribeOptions): () => void
  once<T>(type: KernelEventType, handler: EventHandler<T>): () => void
  off(type: KernelEventType, handler: EventHandler<T>): void
}
```

**使用方（emit）：**

| 文件 | 发出事件 |
|------|---------|
| `src/runtime/execution-runtime.ts` | `execution:start`, `execution:complete`, `execution:error` |
| `src/runtime/state-machine.ts` | `state:changed` |
| `src/core/execution-context.ts` | `stream:thinking`, `stream:content`, `node:update`, `execution:error` |
| `src/executors/base-executor.ts` | `node:start`, `node:complete`, `node:error` |
| `src/executors/agent-executor.ts` | `stream:content`, `stream:thinking`, `stream:tool_call` |
| `src/executors/tool-executor.ts` | `node:start`, `node:update` |
| `src/executors/http-executor.ts` | `node:start`, `node:update` |

**使用方（listen）：**

| 文件 | 监听事件 |
|------|---------|
| `src/worker/worker-adapter.ts` | `*`（通配，转发到 Worker） |
| `llm-engine/src/adapters/ui-event-adapter.ts` | `node:start`, `node:update`, `node:complete`, `node:error`, `stream:thinking`, `stream:content`, `stream:tool_call`, `execution:complete`, `execution:error` |

---

### 2.2 SessionEventBus（`llm-engine`）

**文件：** `packages/llm-engine/src/session/session-event-bus.ts`

管理 Session 级别和全局级别两种事件通道。是引擎与 UI 之间的桥梁。

**Session 事件（`OrchestratorEvent`，28 种）：**

```
生命周期:
  session_start           → 会话开始
  session_cleared         → 会话已清空
  finished                → 执行完成（含 token 用量）
  error                   → 执行出错

节点:
  node_start              → 节点开始
  node_update             → 节点内容更新（thought / output 字段）
  node_status             → 节点状态变更

交互:
  request_input           → 请求用户输入（HITL）

删除/编辑:
  messages_deleted        → 消息已删除
  message_edited          → 消息已编辑

重新生成:
  regenerate_started      → 重新生成开始
  regenerate_completed    → 重新生成完成

分支:
  sibling_switch          → 切换到兄弟节点
  branch_created          → 分支创建
  branch_renamed          → 分支重命名
  branch_deleted          → 分支已删除
  branch_switched         → 分支切换

Agent Loop 内容块:
  stream:thinking:start   → 思考开始
  stream:thinking:stop    → 思考结束
  stream:content:start    → 内容流开始
  stream:content:stop     → 内容流结束

工具生命周期:
  tool:queued             → 工具入队
  tool:input              → 工具输入
  tool:running            → 工具执行中
  tool:success            → 工具执行成功
  tool:error              → 工具执行失败

轮次:
  turn:start              → 一轮对话开始
  turn:end                → 一轮对话结束
```

**全局事件（`RegistryEvent`，9 种）：**

```
  session_registered        → 新 session 注册
  session_unregistered      → session 注销
  session_status_changed    → session 状态变更
  session_unread_updated    → 未读状态更新
  pool_status_changed       → 线程池状态变更
  background_task_completed → 后台任务完成
  session_tty_active        → TTY 活跃
  session_hitl_active       → HITL 活跃
  session_hitl_resolved     → HITL 已解决
```

**事件桥梁：`UIEventAdapter`**

位于 `packages/llm-engine/src/adapters/ui-event-adapter.ts`，将 Kernel 事件转换为 `OrchestratorEvent`：

```
Kernel 事件                    →  OrchestratorEvent
─────────────────────────────────────────────────────
node:start                     →  node_start
stream:content                 →  node_update (field=output)
stream:thinking                →  node_update (field=thought)
node:update                    →  node_update
node:complete                  →  node_status
node:error                     →  node_status (status=error)
execution:complete             →  finished
execution:error                →  error
stream:tool_call               →  [工具相关]
```

**事件桥梁：`HarnessAdapter`**

位于 `packages/llm-engine/src/adapters/harness-adapter.ts`，将 `IAgentRuntime` 事件转换为 `OrchestratorEvent`：

```
IAgentRuntime 事件             →  OrchestratorEvent
─────────────────────────────────────────────────────
agent:llm:start                →  [流式开始标记]
agent:stream:content           →  stream:content:start / stop + node_update
agent:stream:thinking          →  stream:thinking:start / stop + node_update
agent:llm:end                  →  [流式结束]
agent:tool:start               →  tool:queued + tool:running
agent:tool:success             →  tool:success
agent:tool:error               →  tool:error
agent:tool:timeout             →  tool:error
agent:context:compressed       →  [上下文压缩通知]
agent:budget:warning           →  [预算警告]
agent:budget:exhausted         →  [预算耗尽]
agent:skill:loaded             →  [技能加载通知]
agent:backpressure:failed      →  [背压失败]
agent:tty:open                 →  session_tty_active（全局）
agent:tty:data                 →  [TTY 数据]
agent:tty:close                →  [TTY 关闭]
agent:plan:confirm             →  request_input（HITL）
agent:user:injected            →  [用户注入通知]
agent:human:input              →  session_hitl_active（全局）
agent:human:resolved           →  session_hitl_resolved（全局）
```

---

### 2.3 VFS EventBus（`vfslib`）

**文件：** `packages/vfslib/src/event/event-bus.ts`

类型安全的事件总线，支持 `onAny()` 监听所有事件。配合 `TransactionEventBuffer` 在事务中批量提交事件。

**事件类型（`FSEventType`，9 种）：**

```
node:created      → 节点创建（含内容 type、parentId）
node:updated      → 节点更新（content / metadata / tags 变更）
node:deleted      → 节点删除（含级联路径列表）
node:moved        → 节点移动（oldPath → newPath）
node:copied       → 节点复制（sourcePath → targetPath）
node:renamed      → 节点重命名（oldName → newName）
mount:added       → 挂载点添加
mount:removed     → 挂载点移除
error             → 错误
```

**Manager 级事件（`VFSManagerEventType`，7 种）：**

```
node:created, node:updated, node:deleted  → 跨模块文件变更
module:mounted, module:unmounted         → 模块挂载/卸载
mount:added, mount:removed               → 挂载点增删
```

**事务缓冲：**

```
ModuleFS 写操作
  → TransactionEventBuffer.add(event)
  → 事务内累积，不立即发出
  → commit() → 批量 flush 所有事件
  → rollback() → 丢弃所有事件，无副作用
```

**使用方：**

| 文件 | 角色 | 发出/监听 |
|------|------|----------|
| `vfslib/src/services/module-fs.ts` | Emit | 所有 FS 变更事件（带 moduleId、mountId） |
| `vfslib/src/services/vfs-manager.ts` | Emit | 跨模块 + 挂载事件 |
| `vfslib/src/utils/debug.ts` | Listen | 所有事件（`onAny()`），调试日志 |
| `vfs-ui/src/services/EngineAdapter.ts` | Listen | 桥接到 VFSStore → UI 更新 |
| `demo/src/memory-manager.js` | Listen | `node:updated` |
| `app-settings/src/editors/system-fs/SystemVFSEngine.ts` | Listen | VFS 引擎事件 |

---

### 2.4 EditorEventBus（`llm-ui`）

**文件：** `packages/llm-ui/src/shell/EditorEventBus.ts`

实例级事件总线，用于编辑器内部各组件、命令、控制器之间的解耦通信。

**事件类型（`EditorBusEvents`，15 种）：**

```
分支:
  branch:create         → 创建分支
  branch:switch         → 切换到兄弟节点
  branch:switchById     → 按 ID 切换分支
  branch:rename         → 重命名分支
  branch:delete         → 删除分支

导航:
  nav:scrollTo          → 滚动到指定位置
  nav:toggleFold        → 切换折叠
  nav:foldAll           → 全部折叠
  nav:unfoldAll         → 全部展开

批量操作:
  batch:delete          → 批量删除
  batch:copy            → 批量复制

内容:
  content:copy          → 复制内容

状态:
  state:collapseChanged → 折叠状态变更
  state:inputChanged    → 输入框内容变更
```

**使用方：**

| 文件 | 发出 | 监听 |
|------|------|------|
| `src/shell/LLMWorkspaceEditor.ts` | — | Session 事件（间接，通过 SessionEventHandler） |
| `src/shell/SessionEventHandler.ts` | — | 所有 `OrchestratorEvent` + `RegistryEvent` |
| `src/shell/NavigationHelper.ts` | — | `nav:scrollTo`, `nav:toggleFold` 等 |
| `src/components/history/CollapseController.ts` | `state:collapseChanged` | `state:collapseChanged` |
| `src/components/history/EventDispatcher.ts` | `branch:*`, `batch:*`, `nav:*`（DOM→Bus） | — |
| `src/components/indicators/BranchIndicatorView.ts` | `branch:create` 等 | — |
| `src/components/FloatingNavPanel.ts` | `nav:scrollTo` 等 | — |

---

### 2.5 MDX EventBus（`mdx`）

**文件：** `packages/mdx/src/core/event-bus.ts`

支持高频事件批处理（通过 `queueMicrotask`）。`change` 和 `cursorMove` 默认批处理以避免频繁重渲染。

**核心编辑事件：**

```
change              → 文档内容变更（批处理）
interactiveChange   → 用户交互式变更
cursorMove          → 光标移动（批处理）
blur                → 编辑器失焦
focus               → 编辑器聚焦
ready               → 编辑器就绪
saved               → 保存成功
saveError           → 保存失败
modeChanged         → 模式切换（编辑/预览）
optimisticUpdate    → 乐观更新
```

**插件间事件：**

```
clozeRevealed           → 挖空卡片揭示（cloze.plugin.ts 发出）
clozeBatchGradeToggle   → 批量评分切换（cloze-control-ui.plugin.ts 发出）
taskToggled             → 任务勾选（task-list.plugin.ts 发出）
setTitle                → 设置标题（mdx-editor.ts 发出 → titlebar.plugin.ts 监听）
beforeDestroy           → 销毁前（auto-save.plugin.ts 监听）
```

---

### 2.6 VFS-UI EventBus（`vfs-ui`）

**文件：** `packages/vfs-ui/src/interaction/EventBus.ts`

仅对外（outbound）的事件端口，实现 `IEventPort`。外部消费者通过 `on()` 订阅。

**对外事件（`PublicEventMap`，7 种）：**

```
sessionSelected       → 用户选择了某个 session
fileRenamed           → 文件被重命名
navigateToHeading     → 导航到标题
importRequested       → 请求导入
sidebarStateChanged   → 侧边栏状态变更
menuItemClicked       → 菜单项被点击
stateChanged          → 通用状态变更
```

---

### 2.7 DOM CustomEvent 导航事件（`common`）

**文件：** `packages/common/src/events/navigation-events.ts`

基于浏览器原生 CustomEvent，通过 DOM 树冒泡（`bubbles: true, composed: true`）。

**事件名（`NAVIGATION_EVENTS`）：**

```
app:navigate:agent-config         → 导航到 Agent 配置页
app:navigate:connection-settings  → 导航到连接设置页
app:navigate:mcp-settings         → 导航到 MCP 设置页
app:navigate:create-chat          → 新建聊天
app:navigate                      → 通用导航（带 NavigationEventPayload）
```

---

### A.3 端到端事件流

### 3.1 LLM 对话执行流

这是最复杂的事件链，从用户输入到 UI 渲染：

```
用户输入消息
  │
  ▼
ChatInput (llm-ui) 调用 SessionManager.sendMessage()
  │
  ▼
SessionManager 创建 TaskInput → TaskRunner 入队
  │
  ├─ [Kernel 路径] LLMKernelAdapter
  │   │
  │   ▼
  │   ExecutionRuntime.execute()
  │     → 创建 scoped EventBus
  │     → ExecutionContext 发出 Kernel 事件:
  │         execution:start
  │         node:start
  │         stream:thinking → stream:content → stream:tool_call
  │         node:update
  │         node:complete
  │         execution:complete / execution:error
  │     │
  │     ▼
  │   UIEventAdapter.bridge()   ← 订阅 Kernel EventBus
  │     将 Kernel 事件转换为 OrchestratorEvent:
  │       node:start → node_start
  │       stream:content → node_update(field=output)
  │       stream:thinking → node_update(field=thought)
  │       node:complete → node_status
  │       execution:complete → finished
  │       execution:error → error
  │     │
  │     ▼
  │   TaskRunner 通过 SessionEventBus.emitSession() 发出
  │     │
  │     ▼
  │   SessionEventHandler.handleSessionEvent()  ← llm-ui 中
  │     → HistoryView 渲染新内容
  │     → StreamController 处理实时流更新
  │
  ├─ [Harness 路径] HarnessAdapter
  │   │
  │   ▼
  │   IAgentRuntime 事件:
  │     agent:llm:start
  │     agent:stream:content (多次)
  │     agent:stream:thinking (多次)
  │     agent:tool:start → agent:tool:success / agent:tool:error
  │     agent:llm:end
  │     │
  │     ▼
  │   HarnessAdapter 转换为 OrchestratorEvent
  │     → stream:thinking:start/stop
  │     → stream:content:start/stop
  │     → tool:queued → tool:running → tool:success/tool:error
  │     │
  │     ▼
  │   TaskRunner → SessionEventBus → UI 渲染
  │
  └─ [ClaudeCode 路径] ClaudeCodeStrategy
      │
      ▼
      直接发出 OrchestratorEvent:
        stream:thinking:start/stop
        stream:content:start/stop
        tool:queued → tool:input → tool:running → tool:success/tool:error
        turn:start → turn:end
        │
        ▼
      SessionEventBus → UI 渲染
```

### 3.2 Session 生命周期流（全局事件）

```
SessionManager.bind() / createChat()
  │
  ▼
SessionEventBus.ensureSession(sessionId)
  │
  ▼
emitGlobal('session_registered')
  │
  ▼
LLMWorkspaceEditor.onGlobalEvent() → SessionEventHandler
  → 侧边栏更新 session 列表
  → Toast 通知

SessionManager.updateStatus()
  │
  ▼
emitGlobal('session_status_changed')
emitGlobal('pool_status_changed')
  │
  ▼
UI 状态指示器更新

SessionManager.unbind()
  │
  ▼
SessionEventBus.removeSession(sessionId)
  │
  ▼
emitGlobal('session_unregistered')
  │
  ▼
UI 清理对应 session 视图

HITL / TTY 事件（来自 llm-harness）:
  agent:human:input    → session_hitl_active
  agent:human:resolved → session_hitl_resolved
  agent:tty:open       → session_tty_active
  │
  ▼
SessionEventHandler.handleGlobalEvent()
  → session_tty_active: 显示 TTY 通知栏
  → session_hitl_active: 侧边栏高亮对应 session
```

### 3.3 VFS 文件系统事件流

```
ModuleFS 操作 (createFile, writeContent, delete, rename, move, copy)
  │
  ├─ 非事务路径:
  │   this.bus.emit('node:created', payload, { moduleId, mountId })
  │   │
  │   ▼
  │   [直接订阅者]
  │   ├─ EngineAdapter (vfs-ui) → VFSStore → UI 状态更新
  │   ├─ VFSManager.managerBus → 跨模块通知
  │   ├─ Debug 工具 (vfslib) → 调试日志
  │   ├─ demo/memory-manager.js → 业务逻辑
  │   └─ app-settings/SystemVFSEngine → 设置同步
  │
  └─ 事务路径:
      TransactionEventBuffer.add(event)  ×N 次
        → commit()
          → 批量 flush 所有缓存事件（同上分发）
        → rollback()
          → 丢弃所有事件，无副作用

VFSUIShell (对外):
  eventPort.emit('sessionSelected', ...)
  eventPort.emit('fileRenamed', ...)
  eventPort.emit('stateChanged', ...)
  eventPort.emit('sidebarStateChanged', ...)
  │
  ▼
外部消费者 (如 app-shell、其他 UI)
```

### 3.4 编辑器内部事件流（llm-ui）

```
命令执行 (DeleteMessageCommand, RegenerateCommand 等)
  │
  ├─ Session 事件路径:
  │   调用 SessionManager → OrchestratorEvent → SessionEventHandler → UI 更新
  │
  └─ UI 内部协调路径:
      bus.emit('state:inputChanged', {})     → ChatInput 刷新
      bus.emit('state:collapseChanged', {})   → 折叠 UI 更新
      bus.emit('branch:create', {})           → 分支创建流程

DOM 事件委托:
  EventDispatcher (HistoryView 中)
    → 捕获 [data-action] 元素的 click 事件
    → 转换为内部 bus 事件:
        branch:switch, branch:delete, batch:delete, nav:scrollTo 等
    → 对应 Controller / Handler 处理

折叠控制:
  CollapseController
    → 用户点击折叠按钮
    → 切换折叠状态
    → bus.emit('state:collapseChanged', { states })
    → NavigationHelper 等监听者响应

导航:
  FloatingNavPanel
    → 用户点击导航项
    → bus.emit('nav:scrollTo', { targetId })
    → NavigationHelper.scrollTo() → DOM 滚动
```

### 3.5 MDX 编辑器事件流

```
MDxEditor (CodeMirror 6 封装)
  │
  ├─ 高频事件（批处理，queueMicrotask）:
  │   emit('change', ...)        → 所有监听 change 的插件
  │   emit('cursorMove', ...)    → 光标位置相关插件
  │
  ├─ 编辑器生命周期:
  │   emit('ready')              → 编辑器初始化完成
  │   emit('focus') / emit('blur') → 焦点状态
  │   emit('saved') / emit('saveError') → 自动保存结果
  │   emit('modeChanged')        → 编辑/预览模式切换
  │   emit('optimisticUpdate')   → 乐观更新
  │   emit('beforeDestroy')      → 编辑器即将销毁
  │
  └─ 插件间通信（通过 PluginContext）:
      emit('clozeRevealed')      → cloze.plugin → memory.plugin, cloze-control-ui.plugin
      emit('clozeBatchGradeToggle') → cloze-control-ui.plugin → memory.plugin
      emit('taskToggled')        → task-list.plugin → 数据更新
      emit('setTitle')           → mdx-editor → titlebar.plugin
```

### 3.6 导航事件流（DOM CustomEvent）

```
Settings UI / 任意组件
  │
  ▼
dispatchEvent(createNavigationEvent({ target: '...', resourceId: '...' }))
dispatchEvent(createOpenAgentEvent(agentId))
dispatchEvent(createChatSessionEvent(...))
  │
  ▼
DOM 树冒泡 (bubbles: true, composed: true)
  │
  ▼
AppShell / 父组件
  addEventListener('app:navigate:agent-config', handler)
  addEventListener('app:navigate:create-chat', handler)
  addEventListener('app:navigate', handler)
  │
  ▼
路由跳转 / 面板切换
```

### 3.7 状态机事件流

```
StateMachine (llm-kernel)
  │
  ▼
每次状态迁移:
  idle → START → running
  running → COMPLETE → completed
  running → ERROR → failed → RETRY → running
  running → CANCEL → cancelled
  │
  ▼
getEventBus().emit('state:changed', { from, to, executionId })
  │
  ▼
ExecutionRuntime 使用此事件追踪执行器状态
```

---

### A.4 各包事件使用明细

### `common` — 类型定义包

| 文件 | 角色 |
|------|------|
| `src/interfaces/fs/core/events.ts` | 定义 `FSEventType`、`FSEvent`、`FSEventEmitter`、`FSEventPayloadMap` |
| `src/interfaces/fs/services/vfs-manager.ts` | 定义 `VFSManagerEventType`、`VFSManagerEvent` |
| `src/interfaces/agent/agent-service.ts` | 定义 `IAgentRuntime` 接口（含 `on()`/`off()` 事件方法） |
| `src/events/navigation-events.ts` | 定义导航事件常量 + 创建事件辅助函数 |

自身不发出也不监听事件，仅提供类型和工具函数。

---

### `llm-kernel` — 核心事件中枢

**发出事件（emit）：**

| 文件 | 事件 |
|------|------|
| `src/runtime/execution-runtime.ts` | `execution:start`, `execution:complete`, `execution:error` |
| `src/runtime/state-machine.ts` | `state:changed` |
| `src/core/execution-context.ts` | `stream:thinking`, `stream:content`, `node:update`, `execution:error` |
| `src/executors/base-executor.ts` | `node:start`, `node:complete`, `node:error` |
| `src/executors/agent-executor.ts` | `stream:content`, `stream:thinking`, `stream:tool_call` |
| `src/executors/tool-executor.ts` | `node:start`, `node:update` |
| `src/executors/http-executor.ts` | `node:start`, `node:update` |

**监听事件（listen）：**

| 文件 | 监听 |
|------|------|
| `src/worker/worker-adapter.ts` | `*`（通配，转发到 Worker 线程） |
| `src/cli/runner.ts` | 执行生命周期事件 |
| `src/plugins/plugin-manager.ts` | 通过 `getEventBus()` 访问 |

---

### `llm-engine` — Session 事件桥梁

**发出事件（emit）：**

| 文件 | 发出 |
|------|------|
| `src/session/session-manager.ts` | `session_registered`, `session_unregistered`, `session_status_changed`, `pool_status_changed` 等全局事件 |
| `src/session/task-runner.ts` | 所有 `OrchestratorEvent`（28 种） |

**监听事件（listen）：**

| 文件 | 监听 |
|------|------|
| `src/adapters/ui-event-adapter.ts` | 订阅 `getEventBus()`（Kernel），转换为 `OrchestratorEvent` |
| `src/adapters/harness-adapter.ts` | 订阅 `IAgentRuntime.on()`（~20 种 Agent 事件），转换为 `OrchestratorEvent` |

---

### `llm-ui` — UI 消费 + 内部事件

**监听（来自 SessionEventBus）：**

| 文件 | 监听 |
|------|------|
| `src/shell/LLMWorkspaceEditor.ts` | `SessionManager.onEvent()` + `onGlobalEvent()` |
| `src/shell/SessionEventHandler.ts` | 所有 `OrchestratorEvent`（28 种）+ `RegistryEvent`（9 种）→ 声明式映射到 UI 副作用 |

**发出/监听（内部 EditorEventBus）：**

| 文件 | 发出 | 监听 |
|------|------|------|
| `src/components/history/CollapseController.ts` | `state:collapseChanged` | `state:collapseChanged` |
| `src/components/history/EventDispatcher.ts` | `branch:*`, `batch:*`, `nav:*` | — |
| `src/shell/NavigationHelper.ts` | — | `nav:scrollTo`, `nav:toggleFold`, `nav:foldAll`, `nav:unfoldAll` |
| `src/components/indicators/BranchIndicatorView.ts` | `branch:create` | — |
| `src/components/FloatingNavPanel.ts` | `nav:*` | — |

---

### `vfslib` — VFS 事件源

**发出事件：**

| 文件 | 事件 | 附加上下文 |
|------|------|-----------|
| `src/services/module-fs.ts` | `node:created`, `node:updated`, `node:deleted`, `node:moved`, `node:copied`, `node:renamed`, `mount:added`, `mount:removed`, `error` | 带 `moduleId`、`mountId` |
| `src/services/vfs-manager.ts` | `node:created`, `node:updated`, `node:deleted`, `module:mounted`, `module:unmounted`, `mount:added`, `mount:removed` | 跨模块 |

**监听事件：**

| 文件 | 监听 |
|------|------|
| `src/utils/debug.ts` | `onAny()` 所有事件 → 调试日志 |

---

### `vfs-ui` — VFS 事件消费 + 对外输出

**监听（来自 VFS 引擎）：**

| 文件 | 监听 |
|------|------|
| `src/services/EngineAdapter.ts` | `node:created`, `node:updated`, `node:deleted`, `node:moved`, `node:copied`, `node:renamed`, `error` → 桥接到 VFSStore |

**发出（对外 `IEventPort`）：**

| 文件 | 事件 |
|------|------|
| `src/shell/VFSUIShell.ts` | `sessionSelected`, `fileRenamed`, `stateChanged`, `sidebarStateChanged` |

---

### `mdx` — 编辑器事件

**发出事件：**

| 文件 | 事件 |
|------|------|
| `src/editor/mdx-editor.ts` | `change`, `interactiveChange`, `blur`, `focus`, `ready`, `saved`, `saveError`, `modeChanged`, `optimisticUpdate`, `cursorMove` |
| `src/plugins/cloze.plugin.ts` | `clozeRevealed` |
| `src/plugins/cloze-control-ui.plugin.ts` | `clozeBatchGradeToggle` |
| `src/plugins/task-list.plugin.ts` | `taskToggled` |

**监听事件：**

| 文件 | 监听 |
|------|------|
| `src/plugins/memory.plugin.ts` | `clozeRevealed`, `clozeBatchGradeToggle` |
| `src/plugins/cloze-control-ui.plugin.ts` | `clozeRevealed` |
| `src/plugins/titlebar.plugin.ts` | `setTitle` |
| `src/plugins/auto-save.plugin.ts` | `beforeDestroy` |

---

### `llm-harness` — Agent 运行时事件

使用 `IAgentRuntime` 接口（定义在 `common`）的事件系统，约 20 种 Agent 事件：

**发出事件：**

| 文件 | 事件 |
|------|------|
| `src/executor/agent-loop-executor.ts` | `agent:llm:start`, `agent:stream:content`, `agent:stream:thinking`, `agent:llm:end`, `agent:tool:start`, `agent:tool:success`, `agent:tool:error`, `agent:tool:timeout`, `agent:context:compressed`, `agent:budget:warning`, `agent:budget:exhausted`, `agent:skill:loaded`, `agent:backpressure:failed` |
| `src/services/hitl-queue.ts` | `agent:human:input`, `agent:human:resolved` |
| `src/tools/tty-write.ts` | `agent:tty:open`, `agent:tty:data`, `agent:tty:close` |

---

### `app-settings` — 设置同步事件

| 文件 | 事件 |
|------|------|
| `src/services/SyncService.ts` | `stateChange`, `log`, `conflict`, `progress`, `connected`, `disconnected`, `error`, `completed` |
| `src/editors/system-fs/SystemVFSEngine.ts` | 订阅 VFS 引擎事件 |
| `src/services/SettingsService.ts` | 通过 `getEventBus()` 关联 Kernel 事件 |

---

### `demo` — 示例

| 文件 | 事件 |
|------|------|
| `src/memory-manager.js` | 订阅 `vfsCore.getEventBus().on('node:updated', ...)` |

---

### A.5 事件穿越架构图

```
┌─────────────────────────────────────────────────────────────────────┐
│                        LLM 对话事件流                                │
│                                                                     │
│  llm-kernel                  llm-engine                  llm-ui     │
│  ┌──────────┐   Kernel事件   ┌──────────────┐  OrchestratorEvent  │
│  │Execution │──────────────→│UIEventAdapter│──────────────────────│
│  │Runtime   │               │              │                      │
│  │  + Scope │               │TaskRunner ──→│ SessionEventHandler │
│  │  EventBus│               │  + Session   │   │                  │
│  └──────────┘               │  EventBus    │   ▼                  │
│        │                    └──────────────┘  HistoryView         │
│        │                          │           StreamController    │
│        ▼                          │           CollapseController  │
│  llm-harness               HarnessAdapter    NavigationHelper     │
│  ┌──────────┐  Agent事件   ┌──────────────┐  EditorEventBus       │
│  │AgentLoop │─────────────→│on() callback │←─ 内部组件通信        │
│  │Executor  │              │→ Orchestrator│                       │
│  │HITLQueue │              │  Event       │                       │
│  │TTYTools  │              └──────────────┘                       │
│  └──────────┘                                                     │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                        VFS 文件事件流                                │
│                                                                     │
│  vfslib                     vfs-ui                    外部消费者     │
│  ┌──────────┐  FS事件      ┌──────────────┐  对外事件  ┌────────┐  │
│  │ModuleFS  │─────────────→│EngineAdapter │──────────→│app-shell│  │
│  │  + bus   │              │   │          │           │        │  │
│  │          │              │   ▼          │           └────────┘  │
│  │VFSManager│              │ VFSStore     │                       │
│  │  + bus   │              │   │          │                       │
│  └──────────┘              │   ▼          │                       │
│       │                    │ VFSUIShell   │                       │
│       │                    │  + EventBus  │                       │
│       ▼                    └──────────────┘                       │
│  TransactionEventBuffer                                           │
│  (事务中缓冲，commit 批量 flush)                                    │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                      MDX 编辑器事件流                                │
│                                                                     │
│  mdx                                                               │
│  ┌──────────┐  高频事件(batched)                                    │
│  │MDxEditor │──→ change, cursorMove ──→ 各监听插件                 │
│  │+eventBus │                                                      │
│  │          │  插件间事件                                           │
│  │PluginMgr │──→ clozeRevealed ──→ memory.plugin                  │
│  │+eventBus │──→ taskToggled   ──→ 数据更新                       │
│  └──────────┘──→ setTitle      ──→ titlebar.plugin                │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                      导航事件流 (DOM)                                │
│                                                                     │
│  common                            app-shell / 父组件               │
│  ┌─────────────────┐              ┌────────────────────┐           │
│  │createNavigation │──dispatch──→│addEventListener    │           │
│  │Event()          │  CustomEvent│('app:navigate:*')  │           │
│  │                 │  (冒泡)     │                    │           │
│  └─────────────────┘              └────────────────────┘           │
└─────────────────────────────────────────────────────────────────────┘
```

---

### A.6 关键设计要点

1. **分层隔离**：Kernel 事件、Session 事件、UI 事件三层独立，通过 Adapter 桥接转换
2. **作用域控制**：Kernel 使用 `ScopedEventBus` 按 executionId 隔离；SessionEventBus 区分 session 和 global 两级
3. **事务性**：VFS EventBus 配合 `TransactionEventBuffer`，在事务内缓冲事件，commit 批量发出，rollback 无副作用
4. **批处理优化**：MDX EventBus 对高频事件（change、cursorMove）使用 `queueMicrotask` 批处理
5. **类型安全**：所有 EventBus 实现均通过泛型约束事件类型与 payload 的映射关系
6. **DOM 集成**：导航事件使用原生 CustomEvent + DOM 冒泡，与框架无关
