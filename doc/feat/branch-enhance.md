# Branch & Regenerate 增强设计

> 状态：调研完成，待实施
> 日期：2026-07-16

## 1. 当前实现分析

### 1.1 regenerate 流程（round-operations.ts:80-227）

```
regenerate(assistantId)
  ├─ findUserRoundForAssistant() → 找到 assistant 对应的 user round
  ├─ forkPointId = userRound.parents[0]  ← fork 在 user round 之上
  ├─ roundLog.refs().create(branchName, forkPointId)  ← 创建新分支
  ├─ manifest.currentBranch = branchName; manifest.currentHead = forkPointId
  ├─ reloadSessionData() → diffAndApply() 清掉旧 rounds，重建新分支的投影
  └─ taskRunner.submit({ skipUserMessage: true, parentUserNodeId: forkPointId, ... })
```

### 1.2 关键文件

| 文件 | 职责 |
|---|---|
| `round-operations.ts` | regenerate/resend/delete/edit — 消息级突变 |
| `branch-service.ts` | 分支 CRUD + 兄弟节点导航（ChatNode 格式） |
| `session-registry.ts` | 会话绑定、状态加载、diffAndApply、事件路由 |
| `session-state.ts` | 内存投影 — RoundProjection→SessionGroup 转换 |
| `round-log.ts` | ILog 实现 — append/fold/manifest/children 反向索引 |
| `round-types.ts` | RoundProjection / RoundManifest 类型 |

### 1.3 兄弟节点信息现状

- `RoundManifest.children: Record<RoundId, RoundId[]>` — parent→children 反向索引，持久化在 manifest.json
- `SessionState.childrenByParent: Map<RoundId, RoundId[]>` — 内存版索引
- `RoundProjection` **不暴露兄弟信息** — 没有 siblingIndex/siblingCount
- `getSiblings()` 调用的是 `engine.getNodeSiblings()`，走的是 **ChatNode 格式**的老路径（从 parent 的 children_ids 列表获取），不是 Round DAG 的 children 索引
- `siblingIndex/siblingCount` 只在 task-runner 创建 placeholder 时设置，非持久化

## 2. 问题诊断

### 2.1 regenerate 替换当前 branch 的 assistant

**现象**：用户点击 regenerate 按钮 → 当前 branch 的 assistant 被清掉 → 新消息回填进来。
**根因**：`executeRegenerate` 总是创建新分支，然后 `diffAndApply` 删掉当前分支的旧 rounds，重建新分支的投影。用户看到的效果就是"当前 assistant 被替换了"。
**期望**：clone 当前 user round 到新分支 → 新分支上生成新 assistant → 渲染新分支。原分支的内容保持不变。

### 2.2 assistant content 为空时不应创建新 branch

**现象**：首次发送消息，assistant 还没产生（或产生到一半），点击 regenerate 仍然创建了新分支。
**根因**：`executeRegenerate` 没有检查 `assistant content 是否为空`。
**期望**：assistant content 为空 → 直接在当前分支 regenerate，不创建新分支。resend 同理。

### 2.3 缺少同级关系透出

**现状**：`RoundManifest.children` 在持久层维护了 parent→children，但：
- `RoundProjection` 不暴露 siblingIndex/siblingCount
- `getSiblings()` 用 ChatNode 老路径而非 Round DAG children 索引
- reload 后没有任何同级关系信息

**设计缺陷**：Round DAG 已经有全部同级关系数据（children 反向索引），但 `roundToProjection` 和 `roundProjectionToSessionGroups` 没有利用它。应该把 siblings 数量注到 SessionGroup。

### 2.4 没有轻量级 Copy 机制

**现状**：regenerate 时 fork 在 `userRound.parents[0]`，user round 的内容靠 `buildFoldPrependLog` 的 wrapper 注入 fold 结果，没有真正 clone 一份 round。

**需要的 Copy 方式**：
- "Copy" 只是新建一个 Round，其 `.payload` 引用 clone 自原 user round 的 payload（浅拷贝数组 + 对象 spread 即可），parents 指向 forkPointId
- 不需要完整复制或硬链接，因为 payload 通常很小（几百字节）
- 真正的性能瓶颈是 `reloadSessionData()` 里的 **全量 diffAndApply + VFS event 重放**

## 3. 设计方案

### 3.1 RoundLog.cloneRound()

```
cloneRound(roundId: RoundId, overrides?: Partial<PersistedTurn>): Promise<RoundId>
  ├─ readRound(roundId) → 获取原 round
  ├─ newId = ulid()
  ├─ newRound = { ...original, id: newId, parents: overrides.parents ?? original.parents, meta: { ...original.meta, origin: 'rebase' } }
  ├─ writeRound(newId, newRound)
  └─ return newId
```

### 3.2 regenerate 决策逻辑

```
regenerate(assistantId)
  ├─ userRound = findUserRoundForAssistant(assistantId)
  ├─ assistantContent = 当前 assistant 的 content（从 RoundProjection 中获取）
  │
  ├─ if (assistantContent 为空) {
  │     // 直接在当前分支 regenerate，不创建新分支
  │     // 清除旧 assistant（如果有部分内容）→ 在原 branch 上 append
  │     branchName = manifest.currentBranch
  │     await roundLog.clearAssistantInRound(assistantId)  // 可选
  │  } else {
  │     // Clone user round 到新分支
  │     const forkPointId = userRound.parents[0]
  │     const clonedRoundId = await roundLog.cloneRound(userRoundId, { parents: [forkPointId] })
  │     const branchName = `branch-${Object.keys(manifest.branches).length}`
  │     await roundLog.refs().create(branchName, clonedRoundId)
  │     manifest.currentBranch = branchName
  │     manifest.currentHead = clonedRoundId
  │     await roundLog.saveManifest(manifest)
  │  }
  │
  └─ reloadSessionData() → 重建投影
     taskRunner.submit({ ...skipUserMessage, parentUserNodeId: forkPointId, branchName })
```

### 3.3 RoundProjection 增加同级信息

```typescript
// round-types.ts
export interface RoundProjection {
    // ... existing fields ...
    /** 同级数量（父 Round 的 children 数） */
    siblingCount?: number;
    /** 在同级中的位置（按创建时间排序） */
    siblingIndex?: number;
}
```

`roundToProjection` 调用时传入 manifest.children 来计算这两个值。`roundProjectionToSessionGroups` 把它们传到 SessionGroup 上。

### 3.4 getSiblings 切换到 Round DAG path

`BranchService.getSiblings()` 当前走的是 `engine.getNodeSiblings()`（ChatNode 老路径）。应改为：

```
getSiblings(messageId)
  ├─ roundId = session.persistedNodeId
  ├─ projection = state.getRound(roundId)
  ├─ parentId = projection.parents[0]
  ├─ siblingIds = state.getChildRoundIds(parentId)  // O(1), Round DAG children 索引
  └─ siblingIds.map(id => 转 SessionGroup)  // 或需要去 RoundLog readRound
```

## 4. 实施计划

| 步骤 | 内容 | 文件 | 复杂度 |
|---|---|---|---|
| 1 | `RoundLog.cloneRound()` — 复制 round 并返回新 ID | round-log.ts | 小 |
| 2 | `RoundProjection` 加 siblingCount/siblingIndex | round-types.ts | 小 |
| 3 | `roundToProjection` 计算同级信息 | round-log.ts | 中 |
| 4 | `roundProjectionToSessionGroups` 透出 siblingCount/siblingIndex | session-state.ts | 小 |
| 5 | `executeRegenerate` 加入空 content 判断，调整分支逻辑 | round-operations.ts | 中 |
| 6 | `getSiblings` 切换到 Round DAG children 索引 | branch-service.ts | 中 |
| 7 | 删除 `engine.getNodeSiblings()` 依赖（ChatNode 老路径） | — | 验证 |

## 5. 风险与注意事项

- **性能**：`reloadSessionData()` 每次都做全量 diffAndApply，当 rounds 数量大时开销显著。后续考虑增量 reload（只加载新增 rounds，而非 diff 整个链）。
- **一致性**：clone 后原 branch 的 user round 和 clone 出来的 round 是两个独立文件，内容相同但 ID 不同。manifest.children 需要更新（原 parent 的 children 列表包含新 clone round）。
- **回退**：用户在 branch-1 regenerate 后又想切回原来的 main branch，`switchBranch` 应该能回到原内容。`cloneRound` 方案保证了这一点。
- **写时复制**：当前 payload 很小（<10KB），不需要真正的 CoW。clone 就是浅拷贝对象。
