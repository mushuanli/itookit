# Log 原语详细设计 — append-only 轮次 DAG

> 上级设计: [llm-2.md](../llm-2.md) §2.1 / §4
> 定位: 唯一事实源。状态 = `fold(log, ref, strategy)`。分支/回退/合并/插入全部是本原语的操作。

---

## 1. 职责与不变式

**职责**：持久化对话历史（轮次 DAG）、管理引用（refs/tags）、提供线性化投影（fold）、支持分支组合（merge）与历史改写（rebase）。

**四条不变式**（违反任何一条即 bug）：

| # | 不变式 | 推论 |
|---|---|---|
| I1 | append-only：Turn 一经写入永不修改、永不删除 | 编辑 = 新 sibling；删除 = ref 层面不可达 |
| I2 | 单写入方：每 session 的写操作串行化 | 无需 `LockManager`；`manifest-repair` 失去存在理由 |
| I3 | Log 永不调用 LLM | `summarize-branches` 的摘要在 merge 时由调用方物化，fold 保持纯函数 |
| I4 | 流式增量不入日志 | delta 是瞬时事件；仅完成轮次落盘；in-flight 内容进 DraftArea |

---

## 2. 数据结构

### 2.1 Turn

```typescript
interface Turn {
    id: TurnId;                  // ULID — time-ordered, used as topo tie-break
    parents: TurnId[];           // 1 = linear; 2+ = merge point; [] = root
    payload: Message[];          // one user/assistant group (or system)
    meta: TurnMeta;
}

interface TurnMeta {
    createdAt: number;
    origin: 'loop' | 'merge' | 'rebase' | 'edit';
    usage?: TokenUsage;
    /** rebase without regenerate: content causally invalidated. */
    stale?: boolean;
    /** rebase provenance: the original turn this was copied from. */
    rebasedFrom?: TurnId;
    /** merge node only: recorded assembly strategy. */
    assembly?: AssemblyStrategy;
}
```

**ID 方案决策**：ULID 而非现行 `BBB_SSSSS_R` 位置编码。

| 对比 | `BBB_SSSSS_R`（现行） | ULID + `parents[]` |
|---|---|---|
| 线性分支 | ✅ | ✅ |
| 多父 merge | ❌ 无法表达 | ✅ |
| 拓扑排序 tie-break | 依赖序号 | ULID 天然时间有序 |
| 文件名可读性 | 高 | 低（由 ref 名 + meta 补偿） |

分支号降级为 ref 元数据，角色信息在 payload 内。

### 2.2 Ref / Tag

```typescript
interface Ref {
    name: string;            // 'main', 'explore/a', ...
    tip: TurnId;             // movable pointer
    createdAt: number;
    meta?: Record<string, unknown>;   // display name, color, origin session...
}

// Tag = immutable named ref (save point). Stored separately, never moves.
interface Tag { name: string; at: TurnId; createdAt: number; }
```

---

## 3. VFS 存储布局

沿用现有 `.chat` + assetdir 约定，manifest 语义改为 ref store：

```
/chat/my-session.chat            ← RefStore JSON { refs: [], tags: [], head: 'main' }
/chat/_my-session.chat/          ← assetdir
    turns/01J8Z….json            ← immutable Turn（一文件一轮次）
    draft/current.json           ← DraftArea（in-flight 轮次，崩溃安全）
    settings.yaml                ← session 设置（保持现状）
```

写路径：所有写操作经过单一 `LogWriter`（per-session 串行队列），I2 由结构保证而非锁保证。

---

## 4. 核心算法

### 4.1 fold — DAG 线性化投影

```
fold(refTip, strategy?):
    nodes = reachable(refTip)                     // walk parents, memoized
    order = kahnTopoSort(nodes, tieBreak=ULID)    // deterministic
    for each merge node m in order:
        apply m.meta.assembly (see 4.2 semantics)
    return flatMap(order, n => n.payload)
```

- **确定性**：同 (tip, strategy) 输入必得同输出 → 可缓存
- **缓存**：key = `(tipId, strategyHash)`；append 使 tip 变化，缓存自然失效，无需主动 invalidate
- **复杂度**：O(N)；merge 点稀少，实践中接近链遍历

### 4.2 merge — 分支组合

```
merge(refs, strategy):
    tips = refs.map(r => r.tip)
    payload = materialize(strategy, tips)     // 调用方预先物化（I3）
    mergeTurn = { parents: tips, payload, meta: { origin: 'merge', assembly: strategy } }
    newRef = refStore.create(autoName, append(mergeTurn))
    return newRef
```

三种装配策略的 fold 语义：

| 策略 | merge 时物化 | fold 时行为 |
|---|---|---|
| `concat` | payload 为空 | 两支独占历史按拓扑+ULID 序拼接，再接 merge 后续 |
| `summarize-branches` | **副支摘要写入 merge payload**（由 executor 调 LLM 生成，Log 不参与） | mainline 全量 + merge payload（含摘要），副支正文跳过 |
| `pick` | payload 为空，策略记录 turnIds | 仅 fold 选中 turns + mainline |

> 设计要点：`summarize` 在 merge 时一次性物化，而不是 fold 时动态生成——保证 fold 纯函数（I3）且历史不随模型漂移。

### 4.3 rebase — 不可变 DAG 中的"插入"

```
rebase(ref, insertAfter, newTurns, opts):
    newRef = refStore.create(autoName, tip=insertAfter)
    for t in newTurns: append(newRef, t)
    downstream = pathBetween(insertAfter, ref.tip)     // 原下游
    for t in downstream:
        copy = { ...t, id: newUlid(), parents: [newRef.tip],
                 meta: { ...t.meta, origin: 'rebase', rebasedFrom: t.id,
                         stale: !opts.regenerate } }
        append(newRef, copy)
    return newRef        // 旧 ref 原封不动（Jujutsu 语义）
```

- **因果失效显式化**：`regenerate=false` 时下游拷贝标记 `stale`，UI 必须可视化
- **级联重生成**：`regenerate=true` 时 rebase 只建结构，重生成由命令层发起一个 `Goal`（regenerate-cascade）驱动 Loop——**Log 不调用 Loop**（层次单向）
- 拷贝是新 Turn 文件但 payload 引用共享（附件等大对象经 VFS asset 引用，不复制）

### 4.4 DraftArea — 崩溃安全

```
流式过程:  delta → DraftArea.write(累积)     // 节流写，替代 ThrottledWriter
轮次完成:  DraftArea.promote() → append(turn) + draft 清空
崩溃恢复:  启动时发现 draft 非空 → Loop.resume(lastCheckpoint)，draft 内容作为部分输出供续写判断
```

---

## 5. 与现有实现的映射

| 现有（llm-engine/persistence + session） | 归宿 |
|---|---|
| `ChatEngine` | → `Log` 实现主体（append/fold/refs 骨架现成） |
| `ChatManifest` | → RefStore JSON（分支指针语义不变，格式升级） |
| `ChatNode`（`BBB_SSSSS_R`） | → Turn（ULID + parents，见 §2.1 迁移） |
| `ThrottledWriter` | → DraftArea 节流写（删独立模块） |
| `SessionState`（内存副本） | **删除** → fold 缓存 |
| `LockManager` | **删除** → 单写入方（I2） |
| `manifest-repair` | **删除** → append-only 无不一致态 |
| `chatFileParser` / `Converters` | → Turn 序列化模块 |

**数据迁移**：一次性脚本将旧 `BBB_SSSSS_R` 节点按 (分支号→ref, 序号→parents 链) 转换；sibling 变体转为同 parent 的多子节点。

---

## 6. 开放问题

| 问题 | 倾向 |
|---|---|
| 大 session 的 fold 性能（万级 turn） | fold 缓存 + 增量 fold（新 append 仅追加投影尾部）；暂不做快照压缩（YAGNI） |
| turns/ 目录文件数上限 | VFS assetdir 已承载同量级文件；如成瓶颈再引入分桶 |
| 跨 session 引用（Mission 结果引用另一 session 的 turn） | 允许 TurnId 全局唯一（ULID 天然），fold 禁止跨 session 遍历，引用仅作元数据 |
