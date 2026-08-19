# Session Round DAG 设计方案

> 设计日期: 2026-07-19 | 分支: v4.2
> 参考: [pkgstructure.md](../pkgstructure.md)（LLM 四层分层）、[harness-design.md](./harness-design.md)（Durable Task Program 调度内核）
> 定位: 在现有 Round 结构之上，将线性链升级为真正的 DAG，同时支持 chat / harness 两种模式，并完善 round 级 history 排除机制

---

## 目录

- [1. 当前实现分析](#1-当前实现分析)
  - [1.1 数据模型](#11-数据模型)
  - [1.2 fold 逻辑](#12-fold-逻辑)
  - [1.3 分支模型](#13-分支模型)
  - [1.4 historyPolicy 现状](#14-historypolicy-现状)
  - [1.5 当前架构总结](#15-当前架构总结)
- [2. DAG 设计目标](#2-dag-设计目标)
- [3. DAG 数据模型](#3-dag-数据模型)
  - [3.1 Round 结构增强](#31-round-结构增强)
  - [3.2 RoundManifest 增强](#32-roundmanifest-增强)
  - [3.3 DAG 拓扑示例](#33-dag-拓扑示例)
- [4. Chat 模式 DAG](#4-chat-模式-dag)
- [5. Harness 模式 DAG](#5-harness-模式-dag)
- [6. DAG fold 策略](#6-dag-fold-策略)
  - [6.1 线性 fold（chat）](#61-线性-foldchat)
  - [6.2 拓扑 fold（harness）](#62-拓扑-foldharness)
  - [6.3 合并节点处理](#63-合并节点处理)
- [7. Round 级 History 排除](#7-round-级-history-排除)
  - [7.1 排除策略](#71-排除策略)
  - [7.2 数据流](#72-数据流)
  - [7.3 实现要点](#73-实现要点)
- [8. UI 交互设计](#8-ui-交互设计)
  - [8.1 Round 操作菜单](#81-round-操作菜单)
  - [8.2 排除状态的视觉标识](#82-排除状态的视觉标识)
  - [8.3 DAG 导航面板](#83-dag-导航面板)
  - [8.4 分支创建对话框](#84-分支创建对话框)
- [9. 事件流设计](#9-事件流设计)
- [10. 迁移策略](#10-迁移策略)

---

## 1. 当前实现分析

### 1.1 数据模型

当前 Round 结构已具备 DAG 基础：

```typescript
// common/src/interfaces/agent/loop.ts
interface Round {
    id: RoundId;                  // ULID
    parents: RoundId[];           // ★ 已是数组 — DAG 基础已有
    payload: ChatMessage[];       // [user, assistant, tool...]
    meta: RoundMeta;              // createdAt, origin, usage, historyPolicy...
    result?: RoundResult;         // 运行时执行结果
}

// persistence/round-types.ts
interface RoundManifest {
    rootRoundId: RoundId;
    branches: Record<string, RoundId>;     // branch name → head RoundId
    branchMeta: Record<string, BranchMeta>;
    currentBranch: string;
    currentHead: RoundId;
    children: Record<RoundId, RoundId[]>;  // ★ 反向索引已存在
}
```

**关键判断**：数据结构层面 `parents: RoundId[]` 和 `children` 反向索引已经支持 DAG。问题在于 `fold()` 算法仍按线性链（`parents[0]`）遍历。

### 1.2 fold 逻辑

```typescript
// round-log.ts:191-201 — 当前 fold 实现
const chain: RoundId[] = [];
let current = headId;
while (current && !visited.has(current)) {
    visited.add(current);
    chain.unshift(current);
    const r = await this.readRound(current);
    current = r?.parents?.[0];  // ← 只取第一个 parent，走单链
}
```

**局限**：
- 只走 `parents[0]`，多 parent 的合并节点被当作单链处理
- 合并节点的其他 parent 分支内容被折叠忽略
- `children` 索引存在但未用于正向遍历

### 1.3 分支模型

当前分支模型是 **线性 fork**：

```
main:    R1 → R2 → R3(assistant)
                        ↘ fork
branch-1:                 R3'(new assistant)
```

- `forkUserRound()` 复制 user round 到新分支
- 分支之间互不可见（每个分支是独立的线性链）
- 没有"合并"操作——分支一旦创建就永远分叉

### 1.4 historyPolicy 现状

`RoundMeta.historyPolicy` 已定义三种值：

| 值 | 含义 | 实现状态 |
|---|---|---|
| `'include'` | 进入 LLM history（默认） | ✅ 已实现 |
| `'exclude'` | 完全跳过，不进 history | ✅ `round-log.ts:209` 和 `session-state.ts:385` 已过滤 |
| `'summary'` | 折叠为摘要注入 | ❌ 未实现 |

**已实现链路**：

```
SlashCommandRouter (/btw)
  └─ SendMessageCommand({ historyPolicy: 'exclude' })
       └─ TaskInput.historyPolicy = 'exclude'
            └─ SessionGroup.historyPolicy = 'exclude'
                 └─ SessionRenderer: CSS class 'llm-ui-session--ephemeral'
                 └─ RoundMeta.historyPolicy = 'exclude'
                      └─ fold(): continue (skip)
```

**未实现部分**：
- `'summary'` 策略在 `fold()` 中无处理
- UI 层无切换入口（只能在 slash command 中硬编码）
- 无法事后修改已持久化 round 的 historyPolicy
- 无视觉反馈告知用户哪些 round 被排除

### 1.5 当前架构总结

```
┌─ 已具备 ─────────────────────────────────────┐
│ Round.parents: RoundId[]        DAG 数据结构   │
│ RoundManifest.children          反向索引       │
│ RoundMeta.historyPolicy         标记字段       │
│ fold() 已解析 exclude           过滤逻辑       │
│ ILog.merge()                    合并 API       │
│ RefStore (branch CRUD)          分支管理       │
├─ 缺失 ─────────────────────────────────────┐ │
│ DAG 拓扑 fold (多 parent 遍历)              │ │
│ 合并节点语义 (merge round)                  │ │
│ 'summary' historyPolicy 实现                │ │
│ UI 层 historyPolicy 切换入口                │ │
│ UI 层 DAG 可视化                            │ │
│ 事后修改 historyPolicy 的 API               │ │
└─────────────────────────────────────────────┘
```

---

## 2. DAG 设计目标

| 目标 | chat 模式 | harness 模式 |
|------|----------|-------------|
| 线性对话链 | ✅ 主要使用方式 | ✅ 默认链 |
| 分支（fork） | ✅ 仅 regenerate/edit | ✅ 支持任意节点 fork |
| 合并（merge） | ❌ 不允许 | ✅ 多分支汇合 |
| history 排除 | ✅ toggle per round | ✅ toggle per round + summary |
| 子对话隔离 | ✅ sub-agent 消息 exclude | ✅ sub-agent 独立子图 |
| 回退重建 | ✅ 编辑后 rerun | ✅ fork + merge 保持上下文 |

---

## 3. DAG 数据模型

### 3.1 Round 结构增强

```typescript
// common/src/interfaces/agent/loop.ts — 修改

interface Round {
    id: RoundId;
    parents: RoundId[];   // 不变 — 已支持多 parent
    payload: ChatMessage[];
    meta: RoundMeta;
    result?: RoundResult;
}

interface RoundMeta {
    createdAt: number;
    origin: 'loop' | 'merge' | 'rebase' | 'edit' | 'user';
    usage?: TokenUsage;
    stale?: boolean;
    rebasedFrom?: RoundId;
    assembly?: AssemblyStrategy;
    historyPolicy?: 'include' | 'exclude' | 'summary';  // ★ 增强实现
    // ★ 新增字段
    dagKind?: 'linear' | 'fork-point' | 'merge-point' | 'isolated';
    /** merge 节点的合并策略 */
    mergeStrategy?: 'concat' | 'summarize' | 'pick-mainline';
}
```

### 3.2 RoundManifest 增强

```typescript
// persistence/round-types.ts — 修改

interface RoundManifest {
    rootRoundId: RoundId;
    branches: Record<string, RoundId>;
    branchMeta: Record<string, BranchMeta>;
    currentBranch: string;
    currentHead: RoundId;
    children: Record<RoundId, RoundId[]>;

    // ★ 新增: merge 点索引
    merges: Record<RoundId, {
        mergedFrom: RoundId[];      // 被合并的分支 head
        strategy: 'concat' | 'summarize' | 'pick-mainline';
        createdAt: number;
    }>;

    // ★ 新增: 排除索引 (加速 fold 查询)
    excludedRounds: RoundId[];
}
```

### 3.3 DAG 拓扑示例

```
聊天 DAG 示例：

                    ┌─ R4(assistant) ─┐
                    │   tool: read    │
R1(user) ─ R2(assistant) ─ R3(user) ─┤                 ┌─ R7(assistant)
  "分析    "找到3个            "详细   │                 │  merge 结果
  代码库"  模块"              看模块A" └─ R5(assistant) ─┤
                                        │  tool: search  │
                                        └─ R6(user)     ┘
                                           "也看看模块B"

R4, R5 并行工具调用 → R6 汇总 → R7 合并

RoundManifest:
  children: {
    R2: [R3],
    R3: [R4, R5],    // ← fork point: R3 有两个孩子
    R4: [R6],
    R5: [R6],        // ← R6 有两个 parent (merge point)
    R6: [R7],
  }
  merges: {
    R6: { mergedFrom: [R4, R5], strategy: 'concat' }
  }
```

---

## 4. Chat 模式 DAG

Chat 模式保持**线性为主 + branch on regenerate**，不引入合并：

```
Chat DAG 拓扑约束：
  1. 每个 round 最多 1 个 parent（线性链）
  2. 分支只在 regenerate / edit+rerun 时创建
  3. 分支之间永不合并
  4. historyPolicy 默认为 'include'
```

### 4.1 Chat fold

```typescript
// round-log.ts — chatFold (替代当前 linear walk)
async function chatFold(ref: Ref): Promise<ChatMessage[]> {
    const headId = manifest.branches[ref];
    // Walk parents[0] chain — 线性但显式处理 historyPolicy
    const chain = walkLinear(headId);  // parents[0] only
    const messages: ChatMessage[] = [];

    for (const round of chain) {
        if (round._deleted) continue;
        switch (round.meta.historyPolicy) {
            case 'exclude':
                continue;  // 跳过
            case 'summary':
                // 注入摘要替代完整内容
                messages.push({
                    role: 'user',
                    content: `[上文摘要] ${summarize(round)}`,
                });
                break;
            default: // 'include' or undefined
                messages.push(...round.payload);
        }
    }
    return messages;
}
```

### 4.2 Chat 执行路径

```
chatExecutor (ILoop, mode='chat')
  └─ ctx.log.fold(ctx.ref) → 线性链
       └─ 单次 LLM call → yield stream:content
            └─ 返回 single Round
```

**与当前的差异**：仅增强 `fold()` 对 `historyPolicy: 'summary'` 的处理，执行流程不变。

---

## 5. Harness 模式 DAG

Harness 模式使用**完整 DAG**，支持分支、并行工具、合并：

```
Harness DAG 拓扑规则：
  1. fork point:    一个 round 有多个 children（并行工具调用）
  2. merge point:   一个 round 有多个 parents（多分支汇总）
  3. isolated:      sub-agent 子树标记为 isolated，默认 exclude
  4. 环检测:        append 时检查不会形成环
```

### 5.1 Harness 特有 round 类型

| dagKind | 创建场景 | fold 行为 |
|---------|---------|----------|
| `linear` | 普通对话 | 包含在 history 中 |
| `fork-point` | 并行工具分叉处 | 自身包含，children 按拓扑选择 |
| `merge-point` | 多分支汇合 | 按 mergeStrategy 决定如何合并 |
| `isolated` | sub-agent 弹出 | 默认 historyPolicy='exclude' |

### 5.2 Harness 执行路径

```
HarnessLoopExecutor (ILoop, mode='harness')
  └─ ctx.log.fold(ctx.ref) → DAG 拓扑 fold
       └─ beforeRound middleware (budget/compression/skills)
       └─ LLM call with streaming
       └─ tool_calls:
            ├─ reads → 并行执行 → each creates child round
            └─ writes → 串行执行 → each creates child round
       └─ afterRound middleware (back-pressure/truncation)
       └─ 如果 tool_calls.length > 0 → continue loop
            └─ fork point: 当前 round 有多个 children
```

### 5.3 并行工具 DAG 形成

```
用户: "读取 A.md 和 B.md 并对比"
  │
  └─ R1(assistant)
       tool_calls: [read(A.md), read(B.md)]
       │
       ├─ R2(tool: read A.md)  ← parents: [R1]
       ├─ R3(tool: read B.md)  ← parents: [R1]
       │
       └─ R4(assistant)        ← parents: [R1] (同一轮)
            "对比结果..."
```

**关键**：工具结果 round 是 assistant round 的 children，而 continue 后下一轮 assistant 的 parent 仍是上一轮的 assistant（不是工具 round）。

---

## 6. DAG fold 策略

### 6.1 线性 fold（chat）

```
算法: walk parents[0] chain
复杂度: O(n)
适用: chat 模式
```

### 6.2 拓扑 fold（harness）

```
算法: Kahn 拓扑排序
  1. 从 head 出发，沿 parents 反向 BFS
  2. 收集所有可达 round（包括所有 parent 分支）
  3. 按拓扑序排列（parents 在 children 之前）
  4. 对每个 merge point，按 mergeStrategy 合并
复杂度: O(V + E)
适用: harness 模式

拓扑 fold 伪代码:

function dagFold(headId: RoundId): ChatMessage[] {
    const visited = new Set<RoundId>()
    const queue = [headId]
    const rounds: Round[] = []

    // BFS 收集所有可达 round
    while (queue.length > 0) {
        const id = queue.shift()!
        if (visited.has(id)) continue
        visited.add(id)
        const round = readRound(id)
        if (!round || round._deleted) continue
        if (round.meta.historyPolicy === 'exclude') continue
        rounds.push(round)
        for (const p of round.parents) queue.push(p)
    }

    // 拓扑排序: parents 在 children 之前
    rounds.sort((a, b) => topologicalOrder(a, b))

    // 收集消息并处理 merge
    const messages: ChatMessage[] = []
    for (const round of rounds) {
        if (round.meta.mergeStrategy === 'summarize') {
            messages.push({ role: 'user', content: summarize(round) })
        } else {
            messages.push(...round.payload)
        }
    }
    return messages
}
```

### 6.3 合并节点处理

合并节点有三种策略：

```typescript
// AssemblyStrategy 在 merge round 的 meta 中指定
type MergeStrategy = 'concat' | 'summarize' | 'pick-mainline';

// concat: 将所有 parent 分支的消息按时间顺序拼接（去重）
// summarize: 将各分支内容 LLM 摘要后作为单条 user 消息注入
// pick-mainline: 只取 mainline parent 分支，其他分支忽略
```

---

## 7. Round 级 History 排除

### 7.1 排除策略

| 策略 | Round 可见性 | LLM history 行为 | 使用场景 |
|------|-------------|-----------------|---------|
| `include` | 正常显示 | 完整 payload 进 history | 普通对话 |
| `exclude` | 显示但 dimmed | 完全跳过 | `/btw` 旁注、调试指令 |
| `summary` | 显示带摘要标记 | 折叠为单条 `[上文摘要]` user 消息 | 长对话压缩、context 清理 |

### 7.2 数据流

```
设置 historyPolicy 的两条路径:

路径 A — 发送时指定（已有）:
  ChatInput → SendMessageCommand({ historyPolicy: 'exclude' })
    → TaskInput.historyPolicy → SessionGroup.historyPolicy → RoundMeta.historyPolicy

路径 B — 事后修改（★ 新增）:
  UI 右键菜单 → HistoryView.processEvent
    → commands.execute('session.set-history-policy', { roundId, policy })
      → RoundLog.updateMeta(roundId, { historyPolicy })
        → fold 缓存失效 → UI 重新渲染

路径 C — sub-agent 自动隔离（★ 新增）:
  LiteSubAgentRouter → 子对话 round.meta.dagKind = 'isolated'
    → historyPolicy 默认 'exclude'
    → 用户可手动切换为 'include' 或 'summary'
```

### 7.3 实现要点

**引擎侧**：

```typescript
// RoundLog 新增方法
async setHistoryPolicy(roundId: RoundId, policy: HistoryPolicy): Promise<void> {
    const round = await this.readRound(roundId);
    if (!round) throw new Error(`Round not found: ${roundId}`);
    round.meta.historyPolicy = policy;
    await this.writeRound(roundId, round);
    this._cache.invalidateAll(); // 所有 fold 缓存失效

    if (this.onEvent) {
        this.onEvent({
            type: 'round:meta_updated',
            roundId,
            changes: { historyPolicy: policy },
        });
    }
}

// fold 中增强 handling
for (const r of rounds) {
    if (r._deleted) continue;
    switch (r.meta?.historyPolicy) {
        case 'exclude':
            continue;
        case 'summary':
            messages.push({
                role: 'user',
                content: `[上文摘要: ${extractSummary(r)}]`,
            });
            break;
        default:
            messages.push(...r.payload);
    }
}
```

**UI 侧**：

```typescript
// EventDispatcher 新增 action
m.set('toggle-history', (ctx) => {
    const currentPolicy = ctx.sessionEl?.dataset.historyPolicy || 'include';
    const next = currentPolicy === 'include' ? 'exclude' :
                 currentPolicy === 'exclude' ? 'summary' : 'include';
    this.fireNodeAction('set-history-policy', {
        roundId: ctx.sessionId,
        policy: next,
    });
});
```

---

## 8. UI 交互设计

### 8.1 Round 操作菜单

每个 round bubble 的右上角更多菜单（`...`）新增选项：

```
┌─────────────────┐
│  📋 复制         │  已有
│  🔄 重新生成     │  已有
│  🗑 删除         │  已有
│  ✏️ 编辑         │  已有（仅 user）
│─────────────────│
│  📌 创建分支     │  已有
│─────────────────│
│  👁 加入上下文   │  ★ 新增: historyPolicy → 'include'
│  🙈 排除上下文   │  ★ 新增: historyPolicy → 'exclude'
│  📝 摘要化       │  ★ 新增: historyPolicy → 'summary'
│─────────────────│
│  🔀 从此处合并   │  ★ 新增 (仅 harness)
└─────────────────┘
```

### 8.2 排除状态的视觉标识

```
include:   正常样式，无标记

exclude:   ┌──────────────────────────┐
           │ 🙈 此消息不进入上下文     │  ← dimmed + 顶部标签
           │ 内容正常显示但半透明      │
           └──────────────────────────┘

summary:   ┌──────────────────────────┐
           │ 📝 此消息将以摘要形式     │  ← 虚线边框 + 标签
           │    进入上下文             │
           └──────────────────────────┘
```

CSS 类名：
- `.llm-ui-session--ephemeral`（已有，对应 exclude）
- `.llm-ui-session--summarized`（新增，对应 summary）
- `.llm-ui-session--dag-merge`（新增，merge 节点标识）

### 8.3 DAG 导航面板

在现有 FloatingNavPanel 基础上扩展，增加 DAG 拓扑视图：

```
FloatingNavPanel (现有)
  ├─ 会话列表（按时间线）
  │   └─ 每个 round 缩略图 + 状态图标
  ├─ ★ DAG 迷你图（新增）
  │   └─ 垂直拓扑连线图，显示 fork/merge 关系
  └─ 分支切换器（现有）
```

DAG 迷你图渲染：

```typescript
// FloatingNavPanel 新增方法
renderDAGMiniMap(manifest: RoundManifest): string {
    // 从 root 出发，按 DFS 渲染节点和连线
    // fork point: 分叉图标
    // merge point: 汇合图标
    // excluded: 虚线节点
    // current branch: 高亮路径
}
```

### 8.4 分支创建对话框

现有 `DialogTemplates.renderBranchNameDialog()` 保持不变，但增加 merge 选项（仅 harness）：

```
┌──────────────────────────────┐
│  创建新分支                   │
│                              │
│  名称: [______________]      │
│                              │
│  ☐ 同时创建为合并目标         │  ← ★ 新增
│    合并策略: [concat ▾]      │
│                              │
│  [取消]         [创建]       │
└──────────────────────────────┘
```

---

## 9. 事件流设计

### 9.1 新增事件

```typescript
// SessionStructuralEvent 新增变体

| { type: 'round:history_policy_changed'; payload: {
    roundId: string;
    policy: 'include' | 'exclude' | 'summary';
}}

| { type: 'dag:merged'; payload: {
    mergeRoundId: string;
    mergedFrom: string[];      // 被合并的分支 head
    newBranchName: string;
}}

| { type: 'dag:forked'; payload: {
    forkRoundId: string;
    newBranches: string[];
}}
```

### 9.2 事件流向

```
UI 操作 (右键菜单 → '排除上下文')
  └─ EventDispatcher.fireNodeAction('set-history-policy', { roundId, policy })
       └─ SetHistoryPolicyCommand
            └─ commands.execute('session.set-history-policy', { roundId, policy })
                 └─ RoundLog.setHistoryPolicy(roundId, policy)
                      └─ emit round:history_policy_changed
                           └─ SessionState.apply → 更新投影
                                └─ SessionEventBus.emitSession
                                     └─ SessionEventHandler
                                          ├─ historyView.processEvent
                                          │    └─ 更新 CSS class (ephemeral / summarized)
                                          └─ EVENT_SIDE_EFFECTS → refreshBranch
```

---

## 10. 迁移策略

### Phase 1 — historyPolicy 完善（低风险）

| 步骤 | 文件 | 变更 |
|------|------|------|
| 1.1 | `round-log.ts` | `fold()` 增加 `summary` case |
| 1.2 | `round-log.ts` | 新增 `setHistoryPolicy()` 方法 |
| 1.3 | `session-state.ts` | `getHistory()` 同步 `summary` 处理 |
| 1.4 | `round-events.ts` | 新增 `round:meta_updated` 事件 |
| 1.5 | `EventDispatcher.ts` | 新增 `toggle-history` action |
| 1.6 | `SessionRenderer.ts` | 新增 `.llm-ui-session--summarized` 样式 |
| 1.7 | plugins | 新增 `set-history-policy` command |

### Phase 2 — DAG fold（中风险）

| 步骤 | 文件 | 变更 |
|------|------|------|
| 2.1 | `round-log.ts` | 新增 `dagFold()` 方法（BFS + 拓扑排序） |
| 2.2 | `round-log.ts` | `merge()` 增强——支持多 parent round |
| 2.3 | `round-log.ts` | `append()` 增加环检测 |
| 2.4 | `loop-executor.ts` | harness 路径切换到 `dagFold()` |
| 2.5 | `loop-driver.ts` | 无需变更——`drive()` 与 fold 策略无关 |

### Phase 3 — UI DAG 可视化（低风险，渐进）

| 步骤 | 文件 | 变更 |
|------|------|------|
| 3.1 | `FloatingNavPanel.ts` | 新增 `renderDAGMiniMap()` |
| 3.2 | `NodeTemplates.ts` | 新增 merge/fork 节点模板 |
| 3.3 | `EventDispatcher.ts` | 新增 `merge-here` action |
| 3.4 | `BranchCommands.ts` | 新增 `createMerge` command |
| 3.5 | CSS | merge-point、fork-point 样式 |

### 兼容性保证

- `parents: RoundId[]` 数组不变 — 已有 round 向后兼容
- 现有单链 `fold()` 不删除 — chat 模式继续使用
- `dagFold()` 仅 harness 模式调用 — 不影响现有 chat 行为
- `historyPolicy` 默认 `undefined` = `'include'` — 老数据行为不变

---

## 附录 A: Chat vs Harness DAG 差异速查

| 维度 | chat | harness |
|------|------|---------|
| 拓扑 | 线性链 (parents[0]) | 完整 DAG (BFS + 拓扑) |
| 分支触发 | regenerate / edit+rerun | 任意点 fork |
| 合并 | 不支持 | 支持 (concat / summarize / pick) |
| 并行工具 | 不支持 | 支持 (read并行, write串行) |
| Sub-agent | 不支持 | isolated 子树 (默认 exclude) |
| historyPolicy UI | 右键菜单 toggle | 右键菜单 + 自动隔离 |
| fold 方法 | `chatFold()` | `dagFold()` |
| 环检测 | 不需要 | append 时检测 |

## 附录 B: 与当前实现对照

| 当前代码位置 | 当前实现 | DAG 变更 |
|-------------|---------|---------|
| `round-log.ts:191-201` | `parents[0]` 线性遍历 | 新增 `dagFold()` BFS 拓扑 |
| `round-log.ts:209` | `historyPolicy === 'exclude'` → continue | 增加 `'summary'` case |
| `round-log.ts` | 无 `setHistoryPolicy()` | 新增方法 + 事件 |
| `round-types.ts` | `RoundManifest` 有 children | 新增 merges + excludedRounds |
| `loop-executor.ts:112` | `log.fold(ref)` | harness 切 `dagFold()` |
| `SessionRenderer.ts:86` | `llm-ui-session--ephemeral` | 新增 `--summarized` `--dag-merge` |
| `EventDispatcher.ts` | 无 history toggle | 新增 `toggle-history` action |
