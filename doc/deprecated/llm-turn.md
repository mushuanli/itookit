# Round 持久化设计 — user ↔ agent 显式配对

> 设计日期: 2026-07-14 | 分支: v4.2
> 上级设计: [llm-2.md](./llm-2.md) §2.1 Log 原语
> 定位: 消除 Round → ChatNode 的阻抗不匹配，让 Round 成为持久化一等公民

---

## 1. 动机

### 1.1 当前问题

四原语模型中 `Round` 天然是一个"轮次组"——`payload: ChatMessage[]` 可以同时包含 user 和 assistant 消息。但 `ChatEngineLog.append()` 把它拍扁成单个 ChatNode：

```
Round 模型：    [user, assistant]  →  一个 Round（配对，ULID 标识）
ChatNode 模型： ChatNode(user)        ChatNode(assistant)  →  两个独立节点，无显式配对
```

**具体症状**：

| # | 问题 | 表现 |
|---|---|---|
| 1 | **user ↔ agent 关联靠位置推导** | `findAssistantMessagesAfter()` 遍历数组找下一个 user 之前的 assistant；`findUserMessageBefore()` 反向遍历。没有显式 `roundId` 关联字段 |
| 2 | **`parentUserNodeId` 只在 regenerate 设置** | 正常 `sendMessage` 不写这个字段，assistant 不知道是哪个 user 触发的 |
| 3 | **删除靠位置搜索** | `collectDeletableIds()` 用语 `collectAssistantIdsAfter()` 猜测响应范围，如果数组顺序被打破就丢消息 |
| 4 | **Round 原语语义在持久化层丢失** | `fold()` 返回 `ChatMessage[]` 线性列表，无法区分"这是第几个轮次" |
| 5 | **阻抗不匹配导致适配代码** | `ChatEngineLog.append()` 只看 `payload[0].role` 决定 ChatNode.role，multi-part payload 被 join 成字符串 |

### 1.2 业务规则

| 规则 | 语义 |
|---|---|
| **删除 user → 级联删除 agent** | 同一个 Round，删 user 就必须删 assistant |
| **删除 agent → user 保留** | 删 assistant 后 user 还在，resend 不建新分支（Round 内原地重生成） |
| **编辑 user → 旧 assistant 标记 stale** | 编辑 user 内容后，assistant 可能过时，不自动删除但标记 `stale: true` |
| **resend user（无修改）→ 复用 Round** | 同内容重新发送 = 重新驱动该 Round 的 assistant 生成 |

这些规则的本质：**user 和 assistant 属于同一个 Round，Round 是不可分割的操作单元**。

---

## 2. 数据模型

### 2.1 Round 接口（已有，不变）

```typescript
// common/src/interfaces/agent/loop.ts — 不变

interface Round {
    id: RoundId;                    // ULID
    parents: RoundId[];             // 1 parent = linear; 2+ = merge; [] = root
    payload: ChatMessage[];        // [userMessage, assistantMessage?, ...toolMessages?]
    meta: RoundMeta;
    result?: RoundResult;
}

interface RoundMeta {
    createdAt: number;
    origin: 'loop' | 'merge' | 'rebase' | 'edit';
    usage?: TokenUsage;
    stale?: boolean;               // ← 编辑 user 后置 true
    rebasedFrom?: RoundId;
    assembly?: AssemblyStrategy;
}
```

### 2.2 持久化格式（新增）

每个 Round 存为一个 JSON 文件，位于 session 的 `rounds/` 子目录：

```
my-session.chat                           ← ChatManifest JSON（简化）
__my-session.chat/                        ← VFS asset dir
  ├── manifest.json                       ← 新的 RoundManifest（替代 ChatManifest）
  ├── rounds/
  │   ├── <roundId>.json                   ← Round JSON（完整 Round 对象）
  │   └── ...
  ├── draft.json                          ← DraftArea 草稿（已有，不变）
  └── settings.yaml                       ← session 设置
```

**RoundManifest**（替代 ChatManifest）：

```typescript
interface RoundManifest {
    id: string;                           // session ULID
    rootRoundId: RoundId;                   // 首个 Round（常为 system）
    branches: Record<Ref, RoundId>;        // branchName → head RoundId
    currentBranch: Ref;                   // 'main'
    currentHead: RoundId;                  // 当前活跃分支的 head Round 指针
    tags: Record<string, RoundId>;         // 命名快照（tag = immutable ref）
    createdAt: string;
    updatedAt: string;
}
```

关键变化：
- **不再有 ChatNode 的 `parent_id` / `children_ids` 树**，改用 Round DAG（`Round.parents: RoundId[]`）
- **不再有每个消息一个文件的布局**，一个 Round 一个文件
- `currentHead` 是 RoundId 而不是 ChatNode id

### 2.3 Round 内部结构（持久化格式）

```json
{
    "id": "01H...",
    "parents": ["01H..."],
    "payload": [
        { "role": "user", "content": "帮我写个函数" },
        { "role": "assistant", "content": "好的，这是函数..." }
    ],
    "meta": {
        "createdAt": 1721000000000,
        "origin": "loop",
        "usage": { "inputTokens": 150, "outputTokens": 80 },
        "stale": false
    },
    "result": {
        "assistantBlocks": [...],
        "toolResults": [...],
        "finishReason": "stop"
    },
    "_agentId": "agent-xxx",
    "_agentName": "Coding Assistant"
}
```

- `payload`：完整消息组。user 消息一定存在，assistant 消息在生成完成后追加
- `result`：LoopExecutor 填充的运行时数据（工具结果等）
- `_agent*`：助理 agent 的标识（UI 渲染用，不属于核心 Round 契约）

---

## 3. ILog 适配层变更

### 3.1 `ChatEngineLog` → `RoundLog`

当前 `ChatEngineLog` 适配 ChatEngine。改造后直接操作 Round 文件，不再经过 ChatEngine 的 ChatNode 层：

```typescript
// llm-runtime/src/persistence/round-log.ts — 新文件

export class RoundLog implements ILog {
    constructor(
        private readonly driver: IFSDriver,    // VFS 驱动
        private readonly sessionNodeId: string, // .chat 文件路径
    ) {}

    // ── append(ref, round) ─────────────────────────────────
    async append(ref: Ref, round: Round): Promise<RoundId> {
        const roundId = round.id || ulid();
        const manifest = await this.readManifest();

        // 1. 获取 parent Round
        const headRoundId = manifest.branches[ref] ?? manifest.rootRoundId;
        const parents = round.parents.length > 0 ? round.parents : [headRoundId];

        // 2. 写 Round 文件
        const roundFile: RoundPersisted = {
            ...round,
            id: roundId,
            parents,
        };
        await this.writeRound(roundId, roundFile);

        // 3. 更新 parent Round 的 children（不需要！Round DAG 通过 parents 反向索引）
        // 4. 更新 manifest head
        manifest.branches[ref] = roundId;
        manifest.currentHead = roundId;
        manifest.updatedAt = new Date().toISOString();
        await this.writeManifest(manifest);

        this._cache.invalidateRef(ref);
        return roundId;
    }

    // ── fold(ref, strategy?) ──────────────────────────────
    async fold(ref: Ref, strategy?: AssemblyStrategy): Promise<ChatMessage[]> {
        const manifest = await this.readManifest();
        const headRoundId = manifest.branches[ref] ?? manifest.rootRoundId;

        // Walk the DAG from headRoundId along parents[0] (linear path)
        // to build the message list
        const visited = new Set<RoundId>();
        const rounds: Round[] = [];
        let current: RoundId | null = headRoundId;

        while (current && !visited.has(current)) {
            visited.add(current);
            const round = await this.readRound(current);
            if (!round) break;
            rounds.unshift(round);  // prepend — walk from head backwards

            // Follow first parent for linear projection
            current = round.parents[0] ?? null;
        }

        // Flatten all round payloads into a single ChatMessage[]
        const messages: ChatMessage[] = [];
        for (const round of rounds) {
            messages.push(...round.payload);
        }
        return messages;
    }

    // ── delete(roundId) ────────────────────────────────────
    async deleteRound(roundId: RoundId): Promise<void> {
        const round = await this.readRound(roundId);
        if (!round) return;

        // 1. Mark round file as deleted (soft delete)
        await this.writeRound(roundId, { ...round, _deleted: true });

        // 2. Update parent's reference (if needed)
        const manifest = await this.readManifest();

        // 3. Re-link: find rounds that had this as parent, re-parent them
        //    (only needed for hard delete; soft delete just marks)
        // 4. If this round was the head of a branch, move head back
        for (const [branch, headId] of Object.entries(manifest.branches)) {
            if (headId === roundId) {
                const parentId = round.parents[0];
                if (parentId) {
                    manifest.branches[branch] = parentId;
                }
            }
        }
        manifest.updatedAt = new Date().toISOString();
        await this.writeManifest(manifest);

        this._cache.invalidateAll();
    }

    // ... merge, rebase, refs, draft — 已存在，小幅调整
}
```

### 3.2 关键差异：fold 从 Round DAG 线性化

```
ChatEngine.fold() (旧): 读 ChatNode 树 → 按 parent_id 链 → 每个 ChatNode 独立文件
RoundLog.fold()    (新): 读 Round DAG  → 按 parents[0] 链 → 每个 Round 一个文件
```

Round DAG 已经包含完整的 `ChatMessage[]`，fold 不需要 role 推断——直接展开 round.payload。

---

## 4. 业务规则实现

### 4.1 删除 user → 级联删除 agent（默认）

```typescript
// SessionManager.deleteMessage()

async deleteMessage(messageId: string, options?: DeleteOptions): Promise<DeleteResult> {
    const state = this.states.get(sessionId);
    const session = state.findSessionById(messageId);
    if (!session) throw error;

    if (session.role === 'user' && options?.deleteAssociatedResponses !== false) {
        // ★ 新逻辑：通过 roundId 找到 Round，删除整个 Round
        const roundId = session._roundId;
        if (roundId) {
            await this.log.deleteRound(roundId);     // 一次删除整个 Round
            state.removeRound(roundId);              // 内存中移除整个 Round
        }
    } else if (session.role === 'assistant') {
        // 删除 assistant：只清空 assistant payload，user 保留
        const roundId = session._roundId;
        if (roundId) {
            await this.log.clearAssistantInRound(roundId);  // Round 内清空 assistant
            state.clearAssistantInRound(roundId);
        }
    }
}
```

### 4.2 删除 agent → user 保留，resend 不建新分支

```typescript
// RoundLog.clearAssistantInRound(roundId)
async clearAssistantInRound(roundId: RoundId): Promise<void> {
    const round = await this.readRound(roundId);
    if (!round) return;

    // 只保留 user 消息，移除 assistant 及后续 tool 消息
    round.payload = round.payload.filter(m => m.role === 'user');
    round.meta.stale = false;          // 清除 stale 标记
    delete round.result;               // 清除运行时数据
    await this.writeRound(roundId, round);
    this._cache.invalidateAll();
}
```

此时 Round 变为"user 已就绪、assistant 待生成"状态。再次 `sendMessage` 同一内容时，**复用同一个 Round**，loop 重新驱动 assistant 生成——不创建新 Round、不建新分支。

### 4.3 编辑 user → 标记 stale + 保留旧路径

```typescript
// SessionManager.commitEdit()
async commitEdit(messageId: string, newContent: string, autoRerun: boolean): Promise<void> {
    const state = this.states.get(sessionId);
    const session = state.findSessionById(messageId);

    // 1. 创建新 Round（内容为新 user message）
    const newRound: Round = {
        id: ulid(),
        parents: session._roundParents ?? [currentHead],
        payload: [{ role: 'user', content: newContent }],
        meta: { createdAt: Date.now(), origin: 'edit' },
    };
    await this.log.append(ref, newRound);

    // 2. 旧 Round 标记 stale（不作为分支，只是元数据标记）
    if (session._roundId) {
        await this.log.markStale(session._roundId);
    }

    // 3. autoRerun → 驱动新 Round 的 assistant 生成
    if (autoRerun) {
        // 复用同一个 Round（append assistant 进 payload），不建新 Round 节点
    }
}
```

### 4.4 resend（同内容重发）→ 复用 Round

"resend"就是清空 assistant 后重新驱动 loop：

```
1. clearAssistantInRound(roundId)     // payload 中只留 user 消息
2. loop.run() 重新生成 assistant    // 将 assistant 消息 append 进同一个 Round 的 payload
3. 不创建新 Round、不创建新分支
```

这与"删除 agent 后 resend"是同一个流程。

---

## 5. SessionState 变更

### 5.1 从"消息数组"到"Round 数组"

```typescript
// 旧
class SessionState {
    private sessions: SessionGroup[] = [];  // 平铺的 user/assistant 交替数组
}

// 新
class SessionState {
    private rounds: RoundProjection[] = [];   // Round 的 UI 投影数组
}

interface RoundProjection {
    roundId: RoundId;
    parents: RoundId[];
    userMessage: {
        id: string;        // = roundId + '#user'
        content: string;
        files?: ChatAttachment[];
    };
    assistantMessage?: {
        id: string;        // = roundId + '#assistant'
        content: string;
        executionRoot?: ExecutionNode;   // 工具调用树
        agentId: string;
        agentName: string;
    };
    meta: RoundMeta;
}
```

### 5.2 关联查找 → 直接索引

```typescript
// 旧：O(n) 遍历
findAssistantMessagesAfter(userId) → 遍历数组

// 新：O(1) 查找
getAssistantForUser(roundId) → this.rounds.find(t => t.roundId === roundId)?.assistantMessage
getUserForAssistant(roundId) → this.rounds.find(t => t.roundId === roundId)?.userMessage
```

### 5.3 删除 → Round 级操作

```typescript
// 旧
removeMessage(messageId)   → splice 单个 SessionGroup
removeMessages(messageIds) → filter 多个

// 新
removeRound(roundId)         → splice 整个 RoundProjection
clearAssistantInRound(roundId) → 置空 RoundProjection.assistantMessage
```

---

## 6. 迁移策略

### 6.1 Strangler-Fig 三步

| 步骤 | 动作 | 风险 |
|---|---|---|
| **Step 1** | 新建 `RoundLog`（实现 ILog），与 `ChatEngineLog` 并存。新 session 使用 RoundLog，旧 session 继续用 ChatEngineLog | 零风险——两条路径独立 |
| **Step 2** | 在 `TaskRunner` / `SessionManager` 中按 session 的存储格式选择 log 实现（`manifest.format === 'round'` ? RoundLog : ChatEngineLog） | 需要 format 检测逻辑 |
| **Step 3** | 提供迁移工具：`migrateToRoundFormat(sessionId)` — 读旧 ChatNode 树，合并相邻 user+assistant 对为 Round，写入 rounds/ | 可降级（迁移失败回退旧格式） |

### 6.2 迁移算法

```
function migrateSession(oldManifest):
    rounds = []
    walk 旧 ChatNode 树 from root to head:
        if node.role === 'user':
            currentRound = new Round({
                payload: [node.toChatMessage()]
            })
        elif node.role === 'assistant':
            currentRound.payload.push(node.toChatMessage())
            currentRound.meta.usage = node.meta.tokens
            currentRound.result = reconstructFromExecutionNodes()
            rounds.push(currentRound)

    writeRoundManifest()
    for each round: writeRoundFile()
```

相邻 user + assistant ChatNode 对合并为一个 Round。中间如果有 tool call / tool result 节点（assistant → tool_call → tool_result → assistant 循环），全部进入同一个 Round 的 payload（因为它们是同一轮 agent loop 的产物）。

---

## 7. 影响范围

| 组件 | 改动 |
|---|---|
| `common/src/interfaces/agent/loop.ts` | Round 接口不变；新增 `RoundPersisted`（仅持久化用） |
| `llm-runtime/src/persistence/round-log.ts` | **新文件**：RoundLog 实现 ILog |
| `llm-runtime/src/persistence/chat-engine-log.ts` | 保留为遗留适配器（旧 session 读取），标记 `@deprecated` |
| `llm-runtime/src/session/session-state.ts` | `SessionGroup[]` → `RoundProjection[]`；删除 position-based 查找方法 |
| `llm-runtime/src/session/session-manager.ts` | `deleteMessage`/`commitEdit`/`collectDeletableIds` 使用 roundId 关联 |
| `llm-runtime/src/session/task-runner.ts` | `createUserMessage`/`createAssistantNode` → 操作 Round |
| `llm-runtime/src/core/types.ts` | 新增 `RoundProjection`；废弃 `SessionGroup`、`HistoryMessage` |
| `llm-runtime/src/index.ts` | 导出 RoundLog |

---

## 8. 与现有设计的对齐

| 四原语概念 | 此方案中的落点 |
|---|---|
| **Log** | RoundLog 直接操作 Round DAG，不再经过 ChatNode 中间层 |
| **Round** | 唯一持久化单元——`payload` 完整保留 user + assistant 消息组 |
| **fold()** | 沿 `parents[0]` 链 walk DAG，展开所有 round.payload |
| **merge()** | 创建 `parents = [refA.head, refB.head]` 的多父 Round |
| **rebase()** | 新 ref 分支 + cherry-pick 下游 Round（已在 ChatEngineLog 有框架） |
| **DraftArea** | 不变——in-flight Round 草稿机制与 Round 模型天然匹配 |
| **RefStore** | 简化——不再需要 ChatNode ID 与 RoundId 的阻抗适配 |

---

## 9. 开放问题

| 问题 | 倾向 |
|---|---|
| 旧 session 是否强制迁移？ | 不强制。新 session 用 RoundLog，旧 session 读 ChatEngineLog。迁移工具可选 |
| Round 文件数上限 | 万级 Round 无问题。如需优化做分桶（`rounds/00/`, `rounds/01/`...），YAGNI |
| Round payload 中的 tool_call / tool_result | 保留在 payload 中（ILog 接口已有 ToolCall 类型），fold 时正常展开 |
| multi-parent Round 的 fold 策略 | `AssemblyStrategy` 已定义（concat/summarize-branches/pick），RoundLog 实现即可 |
| SessionState 是否需要同时支持旧格式 | 不需要——SessionState 只读 RoundProjection，旧格式通过 ChatEngineLog.fold() 提供兼容 |
