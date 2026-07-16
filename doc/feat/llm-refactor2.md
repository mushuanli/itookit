# LLM 架构重构计划 2 — Turn 持久化审计 + 系统性简化

> 设计日期: 2026-07-15 | 分支: v4.2
> 审计对象: [llm-turn.md](./llm-turn.md) | 系统全貌: [design.md](../llm/design.md)
> 目标: 低耦合高内聚 — 单一事实源、单一写路径、消除适配层阻抗

---

## 1. 审计结论（TL;DR）

**llm-turn.md 的方向正确，问题诊断经代码验证全部属实**，但存在 6 处设计缺口需要修正（§3）。
更重要的是：**Turn 持久化只解决了"存储格式"这一层，当前架构还有三个同级别的结构性问题**（§4），
若不一并处理，TurnLog 落地后依然是"新格式 + 旧数据流"，收益减半。

| # | 结构性问题 | Turn 方案是否覆盖 |
|---|---|---|
| 1 | Turn → ChatNode 拍扁，配对靠位置推导 | ✅ 覆盖（TurnLog） |
| 2 | **双写路径**：ILog.append 与 TaskRunner 直写 engine 并存 | ❌ 未提及 |
| 3 | **双重状态**：SessionState 内存投影与持久化层手动双写同步 | ⚠️ 部分（TurnProjection 只换了数据结构，没换同步机制） |
| 4 | **SessionManager 职责过载**（1530 行，10+ 职责） | ❌ 未提及 |

---

## 2. 代码验证：llm-turn.md 问题诊断核实

对文档 §1.1 五个症状逐条核实（均属实）：

| # | 文档声称 | 代码证据 |
|---|---|---|
| 1 | 配对靠位置推导 | `session-state.ts:64-92` — `findUserMessageBefore`/`findAssistantMessagesAfter` O(n) 线性扫描，遇下一个 user 停止 |
| 2 | `parentUserNodeId` 只在 regenerate/edit 设置 | `session-manager.ts:575,895` 设置；正常 `sendMessage` 路径（`task-runner.ts:573-608`）不写 |
| 3 | 删除靠位置搜索 | `session-manager.ts:766-782` `collectDeletableIds` → `collectAssistantIdsAfter` |
| 4 | Turn 语义在持久化层丢失 | `chat-engine-log.ts:260-288` `append()` 取 `payload[0].role`，multi-part payload `join('\n')` |
| 5 | 阻抗适配代码 | `chat-engine-log.ts:279-283` `_turnId/_parents/_origin` 以 `as any` 塞进 meta；`Turn.parents[]`（DAG 多亲）无法映射到 `ChatNode.parent_id`（单亲） |

**审计还发现文档未列出的同层问题**：

| # | 问题 | 位置 |
|---|---|---|
| A | `append()` 把 `ref`（分支名）当 `sessionId` 传给 `engine.appendMessage`，锁 key 错位，非 main 分支有并发竞态 | `chat-engine-log.ts:273` |
| B | `resolveNodeId()` 全 VFS 树 O(N) 扫描 + 逐文件读 manifest；且 TaskRunner **每个任务 new 一个 ChatEngineLog**，缓存失效 | `chat-engine-log.ts:429-453`, `task-runner.ts:360` |
| C | `fold()` 声明接收 `AssemblyStrategy` 但完全忽略 | `chat-engine-log.ts:290-338` |
| D | `VFSDraftArea` 混用 `FSNode.path` 与 nodeId，不同 VFS 驱动下行为不一致 | `chat-engine-log.ts:92,103` |
| E | `manifest.branch_nums`/`next_branch_num` 是 ULID 迁移后的死代码 | `chat-engine.ts:118-121` |

---

## 3. llm-turn.md 设计缺口与修正

### 3.1 缺口一：Turn DAG 无反向索引 → sibling 导航退化为 O(N) 全目录扫描

Turn 只有 `parents: TurnId[]`。现有功能 `switchToSibling`/`getSiblings`（regenerate 分支切换）
需要"某 Turn 的所有 children"，在纯 parents 模型下必须扫描全部 turn 文件。

**修正**：TurnManifest 增加 children 反向索引（append 时增量维护，无需扫描）：

```typescript
interface TurnManifest {
    // ... llm-turn.md §2.2 原有字段
    children: Record<TurnId, TurnId[]>;   // ★ 反向索引: turnId → child turnIds
}
```

sibling 枚举 = `children[turn.parents[0]]`，O(1)。

### 3.2 缺口二：编辑 user 后旧 Turn 变成不可达孤儿

文档 §4.3：编辑创建新 Turn（与旧 Turn 同 parents），旧 Turn 只标记 `stale`。
但 manifest 的 ref 移到新 Turn 后，**旧 Turn 不在任何 ref 的祖先链上**——除非有 children 索引，
否则 UI 无法发现它，"保留旧路径"名存实亡。

**修正**：依赖 §3.1 的 children 索引，旧 Turn 作为 sibling 可被 `getSiblings` 枚举；
不需要为它创建命名分支（与现有 editMessage 的"匿名分支"语义一致）。

### 3.3 缺口三：`clearAssistantInTurn` 原地改写破坏 append-only 语义

文档 §4.2/§4.4 允许原地改写 Turn 文件（清空 assistant、resend 复用）。这与 Log 原语的
append-only 直觉冲突，需明确边界，否则缓存失效、DraftArea 恢复、并发写都会踩坑。

**修正**：明确唯一合法的原地变更集合，其余一律 append：

| 操作 | 变更方式 | 理由 |
|---|---|---|
| assistant 生成完成 | 原地：payload 追加 assistant 消息 | Turn 的生命周期本就是 "user 就绪 → assistant 填充" |
| 删除 assistant / resend | 原地：payload 过滤只留 user，删 result | 同一 Turn 内的状态回退 |
| 标记 stale / 软删除 | 原地：只改 meta | 元数据不影响 DAG 结构 |
| 编辑 user 内容 | **append 新 Turn**（origin: 'edit'） | 内容变更必须保留历史 |
| 任何 parents 变更 | 禁止 | DAG 结构不可变 |

配套要求：所有原地变更必须走 `TurnLog` 单一入口并同步 `invalidate` fold 缓存。

### 3.4 缺口四：fold() 串行逐文件 I/O

文档 §3.1 的 fold 沿 parents[0] 链逐个 `await readTurn()`，长会话 = N 次串行 VFS 读。

**修正**：
1. fold 缓存保留（沿用 FoldCache TTL 机制），append/原地变更精确失效
2. 首次 fold 时按 manifest 收集完整链路后**并行读**（`Promise.all` 分批）
3. 读到 `_deleted: true` 的 Turn 时跳过（文档 §3.1 deleteTurn 软删除后 fold 未提过滤——补上）

### 3.5 缺口五：TurnProjection 假设 "1 user + 0/1 assistant" 过窄

root Turn 是 system（无 user）；agent loop 一轮可能含多条 tool_call/tool_result；
Mission/merge Turn 可能无 user。

**修正**：

```typescript
interface TurnProjection {
    turnId: TurnId;
    parents: TurnId[];
    kind: 'system' | 'chat' | 'merge';        // ★ 显式区分
    userMessage?: { ... };                     // system/merge Turn 可为空
    assistantMessage?: { ... };
    meta: TurnMeta;
}
```

### 3.6 缺口六：迁移算法未处理分支树

文档 §6.2 的迁移是线性 walk，但旧 ChatNode 树有 `children_ids` 多子分支（regenerate/edit 产生）。

**修正**：迁移按分支逐条处理——对 `manifest.branches` 每个 head 走 parent 链生成 Turn 链，
共享前缀的 ChatNode 映射到同一 TurnId（用 `_turnId` meta 或内容 hash 去重）；
sibling ChatNode → sibling Turn（同 parents），并写入 children 索引。

---

## 4. 超越 Turn：三个必须一并解决的结构性问题

### 4.1 问题一：双写路径 — TaskRunner 绕过 ILog 直写 engine ★ 最高优先级

**现状**（`task-runner.ts`）：

```
路径 A（ILog）:   loop 内部 → log.append(turn)            → ChatEngineLog → engine.appendMessage
路径 B（直写）:   TaskRunner.createUserMessage    (L573)  → engine.appendMessage
                 TaskRunner.createAssistantNode  (L611)  → engine.appendMessage
                 TaskRunner 流式节流 + 完成       (L509)  → engine.updateNode
```

同一个 assistant 消息被两条路径操作，语义靠"恰好不冲突"维持。**这是比存储格式更深的耦合**：
只要路径 B 存在，TurnLog 落地后 TaskRunner 依然要理解存储细节。

**目标：单一写者（Single Writer）——持久化只经过 ILog**：

```
TaskRunner 职责收缩为:
  1. 构建初始 Turn { payload: [userMessage] } → draft().setCurrent()
  2. drive(loop) — 流式期间只更新 DraftArea（checkpoint 即崩溃安全，替代 updateNode 节流）
  3. turn:end → log.append(完成的 Turn) / clearAssistantInTurn 场景走原地更新
  4. 只发事件，不碰 engine
```

收益：
- `engine`（IChatEngine）从 TaskRunner/SessionManager 的依赖中移除，降为 TurnLog 的内部实现细节
- 崩溃安全统一由 DraftArea 承担（现在是 DraftArea + updateNode 节流两套机制并存）
- `parentUserNodeId`/`skipUserMessage` 等 hack 参数消失——regenerate 就是 `clearAssistantInTurn(turnId)` + 重驱动

### 4.2 问题二：双重状态 — SessionState 与持久化层手动双写

**现状**：每个写操作都要"engine 写一次 + state 写一次 + emit 一次"三连（`task-runner.ts:573-657`），
且编辑/regenerate/切分支后靠 `reloadSessionData`（`session-manager.ts:1348-1367`）
**全量 clear + 逐条重发 message:appended**，UI 闪烁、O(N) 事件风暴。

**目标：SessionState 变成 TurnLog 的纯投影（Projection），单向数据流**：

```
TurnLog (事实源)
   │  append / clearAssistant / markStale / deleteTurn
   ▼
TurnLogEvent  { type: 'turn:appended' | 'turn:updated' | 'turn:deleted', turn }
   ▼
SessionState.apply(event)      ← 唯一的状态更新入口（消灭手动双写）
   ▼
MessageProjectionEvent → UI    ← 增量事件，替代 cleared+全量重放
```

- 切分支/编辑不再全量 reload：diff 新旧 head 链，只对差异 Turn 发 `turn:appended/deleted`
- `interruptedAssistantId` 反向扫描 hack（`session-manager.ts:253-261`）→ 由 DraftArea 是否存在 checkpoint 判定

### 4.3 问题三：SessionManager 职责过载（1530 行）

**现状** 10+ 职责混在一个类。**目标拆为四个协作对象**（对外 `ISession` 门面不变）：

| 新组件 | 迁入职责 | 来源行数（约） |
|---|---|---|
| `SessionRegistry` | 注册/绑定/解绑/自动清理/恢复 | ~400 |
| `TurnOperations` | send/delete/edit/regenerate/resend — 全部基于 turnId | ~450 |
| `BranchService` | branch CRUD / sibling 导航 / tags（委托 TurnLog.refs()） | ~350 |
| `SessionFacade`（实现 ISession） | 组合上述三者 + settings + prompt history 委托 | ~300 |

拆分与 Turn 重构天然协同：`TurnOperations` 直接消费 `TurnLog`，
`collectDeletableIds`/`findUserMessageBefore` 等位置推导代码在迁移中自然消亡而非搬家。

---

## 5. 快赢清单（Phase 0，与主线无依赖，先行合并）

| # | 项 | 位置 |
|---|---|---|
| 1 | 删除 `Converters` 中无效的 `generateUUID()`（生成后立即被 `node.id` 覆盖）；`ExecutionNode.id` 改用稳定派生 id（`nodeId + ':' + index`），修复 reload 后 id 漂移 | `utils/converters.ts:25,38,42` |
| 2 | 删除 `listBranches` 遗留 `console.log` | `session-manager.ts:1101-1102` |
| 3 | 删除 `agent-loop-strategy.ts` 残留文件，`IToolExecutor` 移入 `core/types.ts` | `session/agent-loop-strategy.ts` |
| 4 | 提取三处重复的 `collectAllFiles` VFS 递归遍历为共享工具 | `chat-engine.ts:160`, `chat-engine-log.ts:442` |
| 5 | 修复 `ref` 当 `sessionId` 传参的锁错位（ChatEngineLog 构造时已持有 sessionId，直接传它） | `chat-engine-log.ts:273` |
| 6 | TaskRunner 按 session 复用 ChatEngineLog 实例（Map 缓存），消除每任务冷扫描 | `task-runner.ts:360` |
| 7 | 修复 `rootNode as any` — `message:appended` payload 类型改为 `SessionGroup \| ExecutionNode` 判别联合 | `task-runner.ts:649` |

---

## 6. 分阶段实施计划

依赖关系：`P0 → P1 → P2 → P3 → P4`，P5 独立可后置。每阶段可独立合并、独立回退。

### Phase 0 — 快赢清理（§5）
无行为变化，纯清理 + 修 bug。回归：现有会话读写、分支切换。

### Phase 1 — TurnLog 落地（llm-turn.md 主体 + §3 六项修正）

- 新建 `llm-engine/src/persistence/turn-log.ts`：实现 ILog + `clearAssistantInTurn`/`markStale`/`deleteTurn`
- TurnManifest 含 `children` 反向索引（§3.1）
- fold 并行读 + 软删除过滤 + 缓存（§3.4）
- 原地变更边界表落地为 TurnLog 私有方法（§3.3）
- DraftArea 抽出为独立文件，统一用 nodeId（修复 §2-D）
- **格式路由**：`SessionManager.bindSession` 检测 `manifest.format === 'turn'` 选择 TurnLog / ChatEngineLog
- 新 session 默认 turn 格式；旧 session 只读兼容

### Phase 2 — 单一写路径（§4.1）★ 本计划核心增量

- TaskRunner 删除 `createUserMessage`/`createAssistantNode`/`updateNode` 直写，全部经 TurnLog
- 流式崩溃安全统一到 DraftArea checkpoint，删除 updateNode 节流
- 删除 `TaskInput.parentUserNodeId`/`skipUserMessage`，regenerate = clearAssistant + 重驱动
- 仅对 turn 格式 session 启用（旧格式 session 保持旧路径，Strangler-Fig）

### Phase 3 — 投影化 SessionState（§4.2 + llm-turn.md §5）

- `SessionGroup[]` → `TurnProjection[]`（含 §3.5 kind 修正）
- 新增 `TurnLogEvent`，SessionState 只经 `apply(event)` 更新
- `reloadSessionData` 全量重放 → head 链 diff 增量事件
- 删除 `findUserMessageBefore`/`findAssistantMessagesAfter`/`collectAssistantIdsAfter`/`collectDeletableIds`
- UI 侧 `SessionEventHandler` 适配增量结构事件（llm-ui 改动集中在此一处）

### Phase 4 — SessionManager 拆分（§4.3）

- 按 §4.3 表格拆四组件，`ISession` 门面签名不变，llm-ui 零改动
- 收尾：`ChatEngineLog` 标 `@deprecated`

### Phase 5 — 迁移工具（可选，独立）

- `migrateToTurnFormat(sessionId)`：按 §3.6 修正的分支感知算法
- 失败回退旧格式；迁移前 manifest 备份

---

## 7. 风险与开放问题

| 风险/问题 | 缓解 |
|---|---|
| Phase 2 改变崩溃安全语义（updateNode 节流 → DraftArea） | DraftArea checkpoint 频率对齐原节流间隔；恢复路径已有 `resumeDrive` 覆盖 |
| children 索引与 turn 文件不一致（写 turn 成功、写 manifest 失败） | append 顺序：先 turn 文件后 manifest；启动时可从 parents 重建 children（自愈） |
| 旧格式 session 长期共存的维护成本 | ChatEngineLog 冻结只修 bug；UI 层经投影统一，不感知格式 |
| fold 的 AssemblyStrategy（§2-C）实现时机 | Phase 1 只实现 `concat`；`summarize-branches`/`pick` 留待 merge 功能实际启用时（YAGNI） |
| SessionRecovery 的 localStorage 快照是否含 turnId | Phase 3 时同步升级快照 schema，版本号不兼容则丢弃重建 |

---

## 8. 验收标准

1. **单一写者**：`grep engine.appendMessage\|engine.updateNode` 在 session/ 目录零命中（turn 格式路径）
2. **无位置推导**：`findUserMessageBefore`/`collectAssistantIdsAfter` 等函数删除
3. **无类型逃逸**：persistence/ 与 session/ 中 `as any` 归零
4. **事件增量**：切分支不再发 `messages:cleared` + N 条 `message:appended`
5. **删除语义**：删 user 级联删 agent、删 agent 保留 user、resend 不建分支——三条业务规则有集成测试覆盖
6. 文件行数：session-manager.ts 后继组件均 < 500 行

---

## 9. 实施进度

> 最后更新：2026-07-16 | 实施分支：v4.2

### 已完成

| 阶段 | 内容 | 关键产出 | 状态 |
|---|---|---|---|
| **Phase 0** | 快赢清理（7 项） | 见下方 P0.1~P0.7 | ✅ 完成 |
| **Phase 1** | TurnLog 落地（TurnManifest + TurnLog + 格式路由） | 4 个新文件，3 个修改文件 | ✅ 完成 |
| **Phase 2** | 单一写路径 — TaskRunner 全经 TurnLog（turn 格式） | 2 个修改文件，~70 行改动 | ✅ 完成 |

#### Phase 0 明细

| # | 项 | 文件 | 状态 |
|---|---|---|---|
| P0.1 | 删除 `generateUUID()`，`id` 改为稳定派生 | `utils/converters.ts` | ✅ |
| P0.2 | 删除 `listBranches` 调试 `console.log` | `session-manager.ts:1101-1102` | ✅ |
| P0.3 | `IToolExecutor` 移入 `core/types.ts`，删除残留文件 | `core/types.ts` / 删除 `agent-loop-strategy.ts` | ✅ |
| P0.4 | 提取 `collectAllFileNodes` 为共享工具 | 新建 `persistence/vfs-utils.ts` | ✅ |
| P0.5 | 修复 `ref` 当 `sessionId` 传参的锁错位 | `chat-engine-log.ts:273` | ✅ |
| P0.6 | TaskRunner 按 session 复用 Log 实例（`logCache` Map） | `task-runner.ts` | ✅ |
| P0.7 | 消除 `rootNode as any` — `createAssistantMessage` 返回 `SessionGroup` | `session-state.ts` + `task-runner.ts` | ✅ |

#### Phase 1 明细

| # | 项 | 文件 | 状态 |
|---|---|---|---|
| P1.1 | `turn-types.ts`（TurnManifest + children 索引 + TurnProjection.kind）| 新建 `persistence/turn-types.ts` | ✅ |
| P1.2 | `draft-area.ts`（VFSDraftArea 独立，统一 `_draftPath`） | 新建 `persistence/draft-area.ts` | ✅ |
| P1.3 | `ChatManifest.format` 可选字段 | `common/.../chat.ts` | ✅ |
| P1.4 | `TurnLog` — 完整 ILog 实现（fold 并行读 + 缓存 + 原地变更白名单） | 新建 `persistence/turn-log.ts` | ✅ |
| P1.5 | 格式路由：`TaskRunner.createLog()` 按 `manifest.format` 选 TurnLog/ChatEngineLog | `task-runner.ts` | ✅ |
| P1.6 | 导出新类型（TurnManifest, TurnProjection, PersistedTurn, TurnLog, VFSDraftArea）| `index.ts` | ✅ |

#### Phase 2 明细

| # | 项 | 文件 | 状态 |
|---|---|---|---|
| P2.1 | 前置修复：loop-executor TurnId 不一致（`turn:start` vs `log.append`） | `executors/loop-executor.ts:136` | ✅ |
| P2.2 | `createUserMessage` — turn 格式用 `ulid()` 替代 `engine.appendMessage` | `task-runner.ts` | ✅ |
| P2.3 | `createAssistantNode` — turn 格式用 `ulid()` 替代 `engine.appendMessage` | `task-runner.ts` | ✅ |
| P2.4 | `persist()` 节流闭包 — turn 格式 no-op（DraftArea.checkpoint 替代） | `task-runner.ts` | ✅ |
| P2.5 | 完成写入 — turn 格式走 `log.append()` + `draft().flush()` | `task-runner.ts` | ✅ |
| P2.6 | `handleError` — turn 格式走 `draft().flush()` 替代 `engine.updateNode` | `task-runner.ts` | ✅ |
| P2.7 | 旧格式 session 保持旧路径（Strangler-Fig） | `task-runner.ts` | ✅ |

> **注**：`TaskInput.skipUserMessage` / `parentUserNodeId` 未删除——旧格式 session 仍依赖这些字段；turn 格式下 `skipUserMessage` 用于判断是否在 `log.append()` 前将 user message 前置到 turn payload。`draft().setCurrent()` 也未显式调用——user message 在 `log.append()` 时直接拼入 turn.payload，而非通过 draft 预填充。

### 待完成

| 阶段 | 内容 | 优先级 | 依赖 |
|---|---|---|---|
| **Phase 3** | SessionState 投影化 — `TurnProjection[]` + `TurnLogEvent` 单向数据流，删除位置推导 | 高 | Phase 2 |
| **Phase 4** | SessionManager 拆分 — 4 组件 (< 500 行)，ISession 门面不变 | 中 | Phase 3 |
| **Phase 5** | 迁移工具 — `migrateToTurnFormat()` 分支感知算法 | 低（独立） | Phase 1 |

#### Phase 3 待办清单

- [ ] `SessionGroup[]` → `TurnProjection[]`
- [ ] 新增 `TurnLogEvent`，SessionState 只经 `apply(event)` 更新
- [ ] `reloadSessionData` 全量重放 → head 链 diff 增量事件
- [ ] 删除 `findUserMessageBefore` / `findAssistantMessagesAfter` / `collectAssistantIdsAfter` / `collectDeletableIds`
- [ ] `interruptedAssistantId` 反向扫描 → 由 DraftArea checkpoint 判定
- [ ] UI 侧 `SessionEventHandler` 适配增量结构事件
- [ ] `clearAssistantInTurn` 场景走原地更新（regenerate/resend）

#### Phase 4 待办清单

- [ ] 新建 `session-registry.ts`（~400 行）— 注册/绑定/解绑/清理/恢复
- [ ] 新建 `turn-operations.ts`（~450 行）— 全 turnId 操作
- [ ] 新建 `branch-service.ts`（~350 行）— branch CRUD / sibling / tags
- [ ] 新建 `session-facade.ts`（~300 行）— 组合三者 + settings + prompt history
- [ ] `ChatEngineLog` 标 `@deprecated`

#### Phase 5 待办清单

- [ ] 新建 `persistence/migration.ts`
- [ ] 分支感知迁移算法（对 `manifest.branches` 每个 head 走 parent 链）
- [ ] 共享前缀 ChatNode → 同一 TurnId（内容 hash 去重）
- [ ] sibling ChatNode → sibling Turn（同 parents）+ children 索引
- [ ] 失败回退旧格式 + manifest 备份

### 验收标准达成情况

| # | 标准 | 当前 |
|---|---|---|
| 1 | `grep engine.appendMessage\|engine.updateNode` session/ 零命中（turn 格式路径） | ✅ Phase 2 完成 — 4 处调用均在 `else`/legacy 分支 |
| 2 | `findUserMessageBefore` 等函数删除 | ❌ 待 Phase 3 |
| 3 | persistence/ + session/ 中 `as any` 归零 | ⚠️ P0.7 部分（`converters.ts` `node.meta?.status as any` 预存） |
| 4 | 切分支增量事件（不重放全量） | ❌ 待 Phase 3 |
| 5 | 三条删除语义集成测试 | ❌ 待 Phase 3 |
| 6 | 后继组件均 < 500 行 | ❌ 待 Phase 4 |
