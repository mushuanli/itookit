# Branch & Regenerate 增强设计

> 状态：方案已修订，待实施
> 日期：2026-07-17

## 1. 目标与验收语义

Round 是一次完整对话交换的持久化单元：

```text
Round = user + assistant + tool/result + meta
```

针对一个包含 user 的当前 Round 创建/生成 branch 时，只允许以下两种状态转换。

### 1.1 当前 Round 没有有效 assistant

“没有有效 assistant”包括：

- 不存在 assistant payload；
- assistant content 经过 `trim()` 后为空。即使 payload 带有 `tool_calls`，本需求仍将其视为无效 assistant，可在当前 Round 替换。

此时不创建 branch、不复制 user、不 append 新 Round，而是在当前 Round 内补全 assistant：

```text
当前 branch
  P -> R1[user]

生成后
  P -> R1[user, assistant]
```

必须保持：

- `R1.id` 不变；
- `manifest.branches` 数量不变；
- `currentBranch/currentHead` 不变；
- assistant 的流式 placeholder 和最终持久化都归属 R1。

### 1.2 当前 Round 已有有效 assistant

此时保留原 Round，创建一个只复制 user 部分的新兄弟 Round，并立即切换到新 branch：

```text
                 ┌─ R1[user, assistant-1]  (原 branch)
共同父 Round P ──┤
                 └─ R2[user]               (新 branch、新 head)
                          ↓
                    R2[user, assistant-2]
```

必须保持：

- R1 及原 branch 不发生修改；
- R2 的 `parents = [P]`，与 R1 是兄弟 Round；
- R2 只复制 R1 的 user message、attachments 和必要的 user 元数据，不能复制旧 assistant、tool、result；
- branch 创建后立即指向 R2，TaskRunner 后续更新 R2，而不是 append R3；
- manifest 明确记录 branch 从哪个 session 位置切分；
- UI 立即切换到新 branch，显示“切分前共同内容 + 当前 branch 独有内容”。

## 2. 当前实现的根因

### 2.1 TaskRunner 只有 append-new 模式

`task-runner.ts` 每次执行都会分配 `preallocatedRoundId`，并在完成后执行：

```ts
round.payload = [userMsg, ...round.payload];
await logAdapter.append(branchRef, round);
```

因此：

- 空 assistant 时无法写回当前 Round；
- 如果先 clone user Round，再调用 TaskRunner，会再次写入 user，形成两个重复 user Round。

`skipUserMessage` 只影响临时 UI user message，不影响最终持久化，不能用它表达“更新已有 Round”。

### 2.2 branch 操作存在两套持久化模型

- 新路径：`RoundLog`，资产格式为 `round-<roundId>.json`，关系存在 `RoundManifest.children`；
- 旧路径：`ChatEngine.createBranch/getNodeSiblings`，读取 `<nodeId>.chat` 和 `children_ids`。

`BranchService.createBranch/getSiblings/switchToSibling` 仍依赖旧 ChatNode 路径，不能作为 Round DAG 的 branch 实现。

### 2.3 manifest 只能记录 head，不能记录切分语义

当前 `branches: Record<string, RoundId>` 只能回答 branch 的 head，不能回答：

- 从哪个 branch 创建；
- 哪个 Round 触发切分；
- 共同内容截止到哪个 Round；
- 新 branch 的第一个独有 Round 是哪个。

### 2.4 SessionState 不是完整 sibling 数据源

`reloadSessionData()` 只把当前 head chain 投影到 SessionState。切换 branch 后，其他 sibling Round 不一定存在于 state，所以不能只依赖 `state.getChildRoundIds()` 枚举 siblings。

Round sibling 的权威来源必须是持久化的 `RoundManifest.children`。

### 2.5 UI 全量渲染固定滚到底部

`HistoryView.renderFull()` 当前无条件调用 `scrollToBottom(true)`。即使 branch 已切换并正确重载，也不能满足“从顶显示”或“定位切分点”的要求。

## 3. 数据模型

### 3.1 BranchMeta

在 `RoundManifest` 中增加 branch 元数据，保留 `branches` 作为 branch head 的快速索引：

```ts
export interface BranchMeta {
    /** branch 创建时间。 */
    createdAt: number;
    /** branch 创建原因。 */
    createdFrom: 'regenerate' | 'manual' | 'edit';
    /** 创建 branch 时所在的 branch。 */
    forkedFromBranch: Ref;
    /** 用户触发 branch 的原 Round。 */
    sourceRoundId: RoundId;
    /** 两个 branch 最后一个共同 Round；根部分支时可为空。 */
    commonHeadId?: RoundId;
    /** 新 branch 的第一个独有 Round。 */
    branchRootRoundId: RoundId;
}

export interface RoundManifest {
    rootRoundId: RoundId;
    branches: Record<Ref, RoundId>;
    branchMeta: Record<Ref, BranchMeta>;
    currentBranch: Ref;
    currentHead: RoundId;
    children: Record<RoundId, RoundId[]>;
}
```

兼容要求：旧 manifest 缺少 `branchMeta` 时，加载结果默认为 `{}`；main 可在 bootstrap/migration 时补一条元数据，也可以明确约定 main 没有 fork metadata。

### 3.2 Round 不变量

实现和测试必须共同维护：

1. 一个普通 chat Round 最多包含一个初始 user message；
2. 同一次 regenerate 不得生成两个连续且内容相同的 user Round；
3. `manifest.branches[manifest.currentBranch] === manifest.currentHead`；
4. 对每个 `round.parents`，`manifest.children[parentId]` 必须包含该 Round ID；
5. branch 的 `branchRootRoundId` 必须能沿 `parents[0]` 回溯到 `commonHeadId`；
6. 已有有效 assistant 的 source Round 在 fork 前后字节语义不变；
7. assistant placeholder ID、最终 assistant 所属 Round ID、持久化目标 ID 一致。

## 4. RoundLog 持久化 API

不要实现会复制整个 payload 的通用 `cloneRound()`。branch 需要的是有领域语义的 `forkUserRound()`。

### 4.1 assistant 有效性判断

提供单一判断函数，避免 UI、operations、persistence 各自定义：

```ts
export function hasEffectiveAssistant(round: PersistedRound): boolean {
    return round.payload.some(message => {
        if (message.role !== 'assistant') return false;
        const hasText = typeof message.content === 'string'
            ? message.content.trim().length > 0
            : message.content != null;
        const hasToolCalls = Array.isArray(message.tool_calls)
            && message.tool_calls.length > 0;
        return hasText || hasToolCalls;
    });
}
```

如果后续需要把空文本 tool-call 视为有效 assistant，必须另行修改本需求和验收规则。

### 4.2 `forkUserRound()`

建议接口：

```ts
interface ForkUserRoundOptions {
    branchName?: Ref;
    createdFrom: 'regenerate' | 'manual' | 'edit';
}

interface ForkUserRoundResult {
    branchName: Ref;
    sourceRoundId: RoundId;
    newRoundId: RoundId;
    commonHeadId?: RoundId;
}

forkUserRound(
    sourceRoundId: RoundId,
    options: ForkUserRoundOptions,
): Promise<ForkUserRoundResult>
```

处理流程：

```text
1. 读取 source Round 和 manifest
2. 校验 source Round 存在且包含 user
3. 生成不会冲突的 branchName 和 newRoundId
4. 构造 R2：
   - parents = source.parents[0] ? [source.parents[0]] : []
   - payload = 只复制 user message
   - result = undefined
   - meta = 新对象，记录 origin/createdAt/sourceRoundId
5. 写入 round-R2.json
6. 更新 manifest.children[commonHeadId]
7. 更新 manifest.branches[branchName] = R2
8. 写入 manifest.branchMeta[branchName]
9. 更新 currentBranch/currentHead
10. 保存 manifest，返回结果
```

复制时应创建新的 payload/message/attachments 对象，不能共享可变对象引用。

branch 名称不能使用 `Object.keys(branches).length` 直接生成，否则删除 branch 后可能碰撞。应循环查找可用名称或使用 ULID 后缀。

### 4.3 `setAssistantInRound()`

提供更新已有 Round 的显式方法：

```ts
interface AssistantRoundUpdate {
    assistantMessages: ChatMessage[];
    result?: RoundResult;
    status?: NodeStatus;
}

setAssistantInRound(
    roundId: RoundId,
    update: AssistantRoundUpdate,
): Promise<void>
```

要求：

- 保留 user payload；
- 替换该执行产生的 assistant/tool payload，不能重复追加旧 assistant；
- 更新 result、usage、thinking/status 等执行结果；
- 不改变 parents、branch head 和 children；
- 使 fold cache 失效；
- 发出 `round:updated`，让 SessionState/UI 从同一个 Round 更新。

如果流式阶段需要持久化，增加同一 Round 的节流 update，不得切回 append-new。

### 4.4 原子性与失败恢复

`forkUserRound()` 是一个逻辑事务。现有 VFS 不支持事务时采用以下顺序：

1. 先写新 Round 文件；
2. 后一次性保存完整 manifest；
3. manifest 保存失败时，新 Round 是不可达孤儿，可由启动自检/GC 清理；
4. 不允许先切换 `currentBranch` 再写新 Round。

增加 manifest 自检/修复：

- branch head 文件不存在时报告并回退；
- `children` 缺项时可从所有 Round 的 `parents` 重建；
- `branchMeta` 指向不存在 Round 时忽略该 metadata 并记录告警。

## 5. TaskRunner：支持更新已有 Round

### 5.1 明确持久化模式

给 TaskInput 增加互斥的持久化目标，而不是继续复用 `skipUserMessage/parentUserNodeId`：

```ts
type RoundPersistenceTarget =
    | {
        mode: 'append-new';
        parentRoundId?: RoundId;
    }
    | {
        mode: 'update-existing';
        targetRoundId: RoundId;
    };

interface TaskInput {
    // ...
    roundTarget?: RoundPersistenceTarget;
}
```

迁移完成后，`parentUserNodeId` 不再承担 Round parent 语义；按实际引用情况删除或限制为 legacy UI adapter 字段。

### 5.2 两种持久化行为

`append-new`：正常发送新 user 时使用，保持现有 append 行为。

`update-existing`：空 assistant 补全和 fork 后生成时使用：

```text
1. 读取 target Round
2. fold 历史时避免再次 prepend 已存在的 target user
3. assistant placeholder 使用 targetRoundId
4. executor 完成后不再 prepend user
5. 调用 setAssistantInRound(targetRoundId, result)
```

特别注意上下文组装：当前 `buildFoldPrependLog()` 用于尚未持久化的 user；`update-existing` 的 user 已在 branch head 中，不能再次 prepend，否则 LLM 输入仍会重复 user。

### 5.3 ID 语义

当前 UI 把一个 Round 投影成 user SessionGroup 和 assistant SessionGroup，两者可能共享 `persistedNodeId`。实施时必须统一以下约定：

- 持久层操作使用 `roundId`；
- UI message ID 可以有稳定派生后缀，如 `${roundId}-user`、`${roundId}-assistant`；
- SessionGroup 额外保留 `persistedNodeId = roundId`；
- `findUserRoundForAssistant()` 先从 UI message ID 解析/映射到 Round，而不是假定二者永远相等。

这是避免 placeholder、删除、regenerate 查找互相误认的必要条件。

## 6. Regenerate / Create Branch 编排

### 6.1 `executeRegenerate()`

```text
读取 source Round
  ├─ !hasEffectiveAssistant(source)
  │    ├─ 不创建 branch
  │    ├─ targetRoundId = source.id
  │    └─ submit(update-existing, targetRoundId)
  │
  └─ hasEffectiveAssistant(source)
       ├─ forkUserRound(source.id, createdFrom='regenerate')
       ├─ reload 新 branch 投影
       ├─ 发出 branch switched/regenerate started 事件
       └─ submit(update-existing, newRoundId)
```

返回值应准确返回当前生成目标：

```ts
interface RegenerateResult {
    branchName: string;
    roundId: RoundId;
    branchCreated: boolean;
    agentId: string;
}
```

### 6.2 手动 `createBranch()`

Round session 的 `BranchService.createBranch()` 必须调用 `RoundLog.forkUserRound()`，不得调用旧 `ChatEngine.createBranch()`。

手动 branch 默认行为与 regenerate fork 相同：复制 user-only Round 并切换，但不自动生成 assistant；如果产品需要“只创建空分支”或“创建后立即生成”，应由显式 option 区分。

旧 ChatNode branch API：

- 若已不再支持 legacy session，应删除 `BranchService` 对它们的依赖；
- 若迁移期仍需支持，必须先通过明确的 format discriminator 分流，不能用 try/catch 猜格式。

### 6.3 branch 切换

`switchBranch()` 的 Round 路径只更新：

```ts
manifest.currentBranch = branchName;
manifest.currentHead = manifest.branches[branchName];
```

然后 reload 当前 head chain，并发出统一的 `branch:switched` 事件。不要混用旧字段 `current_branch/current_head`。

## 7. Sibling 导航

### 7.1 权威查询

为 RoundLog 增加：

```ts
getSiblingRoundIds(roundId: RoundId): Promise<RoundId[]>
getSiblingRounds(roundId: RoundId): Promise<RoundProjection[]>
```

查询流程：

```text
readRound(roundId)
  -> parentId = parents[0]
  -> manifest.children[parentId]
  -> readRound(siblingIds)
  -> 过滤 _deleted/不可达节点
  -> 稳定排序
```

排序应有稳定规则，例如 `meta.createdAt`，相同时间再按 Round ID；不能依赖对象或文件系统遍历顺序。

### 7.2 branch 定位

点击 sibling 后需要找到包含该 sibling 的 branch。优先策略：

1. 找 `branches[ref] === siblingId` 的 ref；
2. 否则找 head 沿 `parents[0]` 包含 siblingId 的 ref；
3. 如果 sibling 尚未被 ref 覆盖，显式注册新 ref，并补写 `branchMeta`。

### 7.3 Projection/UI sibling 信息

`siblingIndex/siblingCount` 是派生展示数据，不是 Round 本体事实。可以在 reload/adapter 时根据 manifest 注入 `SessionGroup`，但查询仍必须回到 RoundLog。

user 和 assistant SessionGroup 应获得相同的 sibling 信息，导航目标是 Round，而不是单个气泡。

## 8. Session reload 与 UI

### 8.1 当前 branch 内容

`collectHeadChain()` 沿 `currentHead -> parents[0]` 回溯并反转，可以自然得到：

```text
切分前共同内容 + 当前 branch 独有内容
```

reload 时必须以 manifest 的 `currentBranch/currentHead` 为同一次快照，避免并发切换读到不一致字段。

### 8.2 统一 branch 事件

建议使用：

```ts
type BranchSwitchedEvent = {
    type: 'branch:switched';
    payload: {
        branchName: Ref;
        headRoundId: RoundId;
        branchRootRoundId?: RoundId;
        reason: 'create' | 'regenerate' | 'manual-switch' | 'sibling-switch';
        displayPosition: 'top' | 'branch-root' | 'bottom';
    };
};
```

避免依赖 `log:appended`、`regenerate_started` 等多个事件碰巧触发全量渲染。

### 8.3 显示位置

修改 `HistoryView.renderFull()`：

```ts
renderFull(
    sessions: SessionGroup[],
    options?: { position?: 'top' | 'bottom'; focusMessageId?: string },
): void
```

本需求默认 `position: 'top'`。如果产品最终希望直接查看切分后的内容，则使用 `focusMessageId = branchRootRoundId`；无论哪种选择，都不能继续无条件 `scrollToBottom()`。

在开始 assistant 流式输出后，不应因为普通 delta 把用户强制拉到底部；只有用户已处于底部附近时才自动跟随。

## 9. 并发与错误处理

- regenerate/create/switch 必须继续使用 session 级互斥锁；
- 判断 assistant、fork、切换 current branch 应在同一受保护操作内完成，避免检查后状态变化；
- branch 创建成功但 LLM 失败时保留 R2[user] 和 branch，用户可在同一 Round 重试；
- 空 assistant 生成失败时保留原 R1[user]，下次仍走 update-existing；
- branch name 冲突应在持久层重试生成，不能覆盖已有 ref；
- 对旧 manifest migration 和当前写入使用同一字段命名，禁止同时更新 camelCase 与 snake_case 两套 current branch。

## 10. 实施任务拆解

任务按依赖顺序执行。每一阶段完成后先通过对应测试，再进入下一阶段。

### Phase 0：补回归测试，固定失败行为

- [ ] 删除/修正“clear assistant 后 fold 出现两个相同 user 是正确结果”的测试。
- [ ] 增加 `hasEffectiveAssistant()` 表格测试：无 assistant、空白 content、非空 content、空文本+tool_calls、结构化 content。
- [ ] 增加当前 Round 空 assistant regenerate 测试：branch 数不变、Round ID 不变、最终 payload 为 user + assistant。
- [ ] 增加非空 assistant regenerate 测试：创建 sibling R2、R1 不变、R2 仅有一个 user 和新 assistant。
- [ ] 增加 LLM fold 输入断言：两条路径都只出现一次目标 user。
- [ ] 增加 branch 切换往返测试：main 与新 branch 各自恢复正确 assistant。

### Phase 1：manifest 与 RoundLog 领域 API

- [ ] 在 `round-types.ts` 增加 `BranchMeta` 和 `RoundManifest.branchMeta`。
- [ ] 更新 bootstrap/migration，兼容缺失 `branchMeta` 的旧数据。
- [ ] 实现并测试 `hasEffectiveAssistant()`。
- [ ] 实现并测试无冲突 branch name 分配。
- [ ] 实现并测试 `forkUserRound()`，只复制 user/attachments。
- [ ] 实现并测试 `setAssistantInRound()` 及 fold cache/event 行为。
- [ ] 增加 manifest 不变量校验及 children 重建测试。

### Phase 2：TaskRunner update-existing

- [ ] 增加 `RoundPersistenceTarget` discriminated union。
- [ ] 将正常发送映射到 `append-new`。
- [ ] 实现 `update-existing` 的上下文组装，禁止重复 prepend user。
- [ ] 让 executor/placeholder 使用 target Round 的稳定 ID。
- [ ] 完成后调用 `setAssistantInRound()`，禁止 append 新 Round。
- [ ] 明确多 exchange/tool payload 在同一 Round 内的替换/追加规则并测试。
- [ ] 逐步移除 `skipUserMessage/parentUserNodeId` 承担的持久化语义。

### Phase 3：Regenerate 与手动 branch 编排

- [ ] 重写 `executeRegenerate()` 的两路状态机。
- [ ] 更新 `RegenerateResult`，返回 `roundId/branchCreated`。
- [ ] Round 格式的 `BranchService.createBranch()` 改用 `forkUserRound()`。
- [ ] Round 格式的 `switchBranch/listBranches()` 只使用 camelCase manifest 字段。
- [ ] 为 legacy ChatNode 路径增加明确格式分流，或删除不再支持的路径。
- [ ] 覆盖 branch 创建成功、LLM 失败后原地重试的集成测试。

### Phase 4：Sibling 与 Projection

- [ ] 实现 `RoundLog.getSiblingRoundIds/getSiblingRounds()`。
- [ ] sibling 排序固定为 `createdAt + roundId`。
- [ ] 重写 `getSiblings/switchToSibling()`，移除 Round 路径对 `engine.getNodeSiblings()` 的依赖。
- [ ] 实现 sibling 到 branch ref 的定位/注册。
- [ ] 在 SessionGroup adapter 注入一致的 `siblingIndex/siblingCount`。
- [ ] 增加 reload 后仍能看到和切换非当前 sibling 的测试。

### Phase 5：Session reload 与 UI

- [ ] reload 使用同一 manifest 快照获取 current branch/head。
- [x] 增加统一 `branch:switched` 事件及 payload。
- [x] `SessionEventHandler` 对该事件执行一次确定性的 `renderFull` 和 branch/nav refresh。
- [x] 扩展 `HistoryView.renderFull()` 支持 top/branch-root/bottom（当前实现 top/bottom）。
- [x] branch 创建和切换默认从顶显示当前 branch 完整内容。
- [ ] 调整流式自动滚动，避免覆盖 branch 切换后的用户位置。
- [ ] 增加 UI 测试：共同内容、branch 独有内容、滚动位置、切回原 branch。

### Phase 6：清理与端到端验收

- [ ] 删除 Round branch 流程中遗留的 ChatNode sibling/createBranch 调用。
- [ ] 删除无效的字段强转，如 `(manifest as any).currentBranch`。
- [ ] 搜索并消除 `current_branch/current_head` 在 Round 路径中的使用。
- [ ] 执行 llm-runtime 单测、typecheck、llm-ui 测试和 workspace build。
- [ ] 使用真实流式 provider 手工验证空响应、正常响应、tool-call-only、生成失败重试。
- [ ] 检查现有 session migration 后仍可加载、切 branch 和继续对话。

## 11. 最低验收用例

### 用例 A：只有 user

```text
初始：main -> R1[user="Q"]
操作：regenerate/create assistant
期望：main -> R1[user="Q", assistant="A"]
断言：无新 branch、无 R2、LLM 输入只有一个 Q
```

### 用例 B：assistant content 为空

```text
初始：main -> R1[user="Q", assistant="   "]
操作：regenerate
期望：main -> R1[user="Q", assistant="A"]
断言：R1 ID 不变、branch 数不变
```

### 用例 C：已有 assistant

```text
初始：main -> P -> R1[Q, A1]
操作：regenerate
期望：
  main     -> P -> R1[Q, A1]
  branch-1 -> P -> R2[Q, A2]
断言：R1 不变；R2.parents=[P]；R2 只有一个 Q
```

### 用例 D：切换 branch

```text
切到 main：显示共同内容 + R1，不能显示 R2/A2
切到 branch-1：显示共同内容 + R2，不能显示 R1/A1
每次切换默认从顶部显示
```

### 用例 E：空文本 assistant（即使有 tool_calls）

```text
初始：R1 assistant 文本为空（即使包含 tool_calls）
操作：regenerate
期望：视为无效 assistant，在当前 branch 的 R1 内替换，不创建新 branch
```

### 用例 F：新 branch 生成失败

```text
fork 后：branch-1 -> R2[Q]
LLM 失败：保留 R2[Q]
再次 regenerate：在 R2 内补 assistant，不创建 branch-2
```

## 12. 非目标与后续优化

本次不要求：

- 为小 payload 实现文件级 Copy-on-Write 或硬链接；
- 修改 Round DAG 为多父合并算法；
- 优化所有 session reload 性能。

完成正确性后可继续优化：

- `reloadSessionData()` 从全链 diff 改为 branch 切换快照或增量投影；
- 为 Round/manifest 写入增加正式事务或 journal；
- 孤儿 Round GC；
- branch tree 可视化和 branch 命名策略。
