# Turn 持久化设计 — user ↔ agent 显式配对

> 设计日期: 2026-07-14 | 分支: v4.2
> 上级设计: [llm-2.md](./llm-2.md) §2.1 Log 原语
> 定位: 消除 Turn → ChatNode 的阻抗不匹配，让 Turn 成为持久化一等公民

---

## 1. 动机

### 1.1 当前问题

四原语模型中 `Turn` 天然是一个"轮次组"——`payload: ChatMessage[]` 可以同时包含 user 和 assistant 消息。但 `ChatEngineLog.append()` 把它拍扁成单个 ChatNode：

```
Turn 模型：    [user, assistant]  →  一个 Turn（配对，ULID 标识）
ChatNode 模型： ChatNode(user)        ChatNode(assistant)  →  两个独立节点，无显式配对
```

**具体症状**：

| # | 问题 | 表现 |
|---|---|---|
| 1 | **user ↔ agent 关联靠位置推导** | `findAssistantMessagesAfter()` 遍历数组找下一个 user 之前的 assistant；`findUserMessageBefore()` 反向遍历。没有显式 `turnId` 关联字段 |
| 2 | **`parentUserNodeId` 只在 regenerate 设置** | 正常 `sendMessage` 不写这个字段，assistant 不知道是哪个 user 触发的 |
| 3 | **删除靠位置搜索** | `collectDeletableIds()` 用语 `collectAssistantIdsAfter()` 猜测响应范围，如果数组顺序被打破就丢消息 |
| 4 | **Turn 原语语义在持久化层丢失** | `fold()` 返回 `ChatMessage[]` 线性列表，无法区分"这是第几个轮次" |
| 5 | **阻抗不匹配导致适配代码** | `ChatEngineLog.append()` 只看 `payload[0].role` 决定 ChatNode.role，multi-part payload 被 join 成字符串 |

### 1.2 业务规则

| 规则 | 语义 |
|---|---|
| **删除 user → 级联删除 agent** | 同一个 Turn，删 user 就必须删 assistant |
| **删除 agent → user 保留** | 删 assistant 后 user 还在，resend 不建新分支（Turn 内原地重生成） |
| **编辑 user → 旧 assistant 标记 stale** | 编辑 user 内容后，assistant 可能过时，不自动删除但标记 `stale: true` |
| **resend user（无修改）→ 复用 Turn** | 同内容重新发送 = 重新驱动该 Turn 的 assistant 生成 |

这些规则的本质：**user 和 assistant 属于同一个 Turn，Turn 是不可分割的操作单元**。

---

## 2. 数据模型

### 2.1 Turn 接口（已有，不变）

```typescript
// common/src/interfaces/agent/loop.ts — 不变

interface Turn {
    id: TurnId;                    // ULID
    parents: TurnId[];             // 1 parent = linear; 2+ = merge; [] = root
    payload: ChatMessage[];        // [userMessage, assistantMessage?, ...toolMessages?]
    meta: TurnMeta;
    result?: TurnResult;
}

interface TurnMeta {
    createdAt: number;
    origin: 'loop' | 'merge' | 'rebase' | 'edit';
    usage?: TokenUsage;
    stale?: boolean;               // ← 编辑 user 后置 true
    rebasedFrom?: TurnId;
    assembly?: AssemblyStrategy;
}
```

### 2.2 持久化格式（新增）

每个 Turn 存为一个 JSON 文件，位于 session 的 `turns/` 子目录：

```
my-session.chat                           ← ChatManifest JSON（简化）
__my-session.chat/                        ← VFS asset dir
  ├── manifest.json                       ← 新的 TurnManifest（替代 ChatManifest）
  ├── turns/
  │   ├── <turnId>.json                   ← Turn JSON（完整 Turn 对象）
  │   └── ...
  ├── draft.json                          ← DraftArea 草稿（已有，不变）
  └── settings.yaml                       ← session 设置
```

**TurnManifest**（替代 ChatManifest）：

```typescript
interface TurnManifest {
    id: string;                           // session ULID
    rootTurnId: TurnId;                   // 首个 Turn（常为 system）
    branches: Record<Ref, TurnId>;        // branchName → head TurnId
    currentBranch: Ref;                   // 'main'
    currentHead: TurnId;                  // 当前活跃分支的 head Turn 指针
    tags: Record<string, TurnId>;         // 命名快照（tag = immutable ref）
    createdAt: string;
    updatedAt: string;
}
```

关键变化：
- **不再有 ChatNode 的 `parent_id` / `children_ids` 树**，改用 Turn DAG（`Turn.parents: TurnId[]`）
- **不再有每个消息一个文件的布局**，一个 Turn 一个文件
- `currentHead` 是 TurnId 而不是 ChatNode id

### 2.3 Turn 内部结构（持久化格式）

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
- `_agent*`：助理 agent 的标识（UI 渲染用，不属于核心 Turn 契约）

---

## 3. ILog 适配层变更

### 3.1 `ChatEngineLog` → `TurnLog`

当前 `ChatEngineLog` 适配 ChatEngine。改造后直接操作 Turn 文件，不再经过 ChatEngine 的 ChatNode 层：

```typescript
// llm-engine/src/persistence/turn-log.ts — 新文件

export class TurnLog implements ILog {
    constructor(
        private readonly driver: IFSDriver,    // VFS 驱动
        private readonly sessionNodeId: string, // .chat 文件路径
    ) {}

    // ── append(ref, turn) ─────────────────────────────────
    async append(ref: Ref, turn: Turn): Promise<TurnId> {
        const turnId = turn.id || ulid();
        const manifest = await this.readManifest();

        // 1. 获取 parent Turn
        const headTurnId = manifest.branches[ref] ?? manifest.rootTurnId;
        const parents = turn.parents.length > 0 ? turn.parents : [headTurnId];

        // 2. 写 Turn 文件
        const turnFile: TurnPersisted = {
            ...turn,
            id: turnId,
            parents,
        };
        await this.writeTurn(turnId, turnFile);

        // 3. 更新 parent Turn 的 children（不需要！Turn DAG 通过 parents 反向索引）
        // 4. 更新 manifest head
        manifest.branches[ref] = turnId;
        manifest.currentHead = turnId;
        manifest.updatedAt = new Date().toISOString();
        await this.writeManifest(manifest);

        this._cache.invalidateRef(ref);
        return turnId;
    }

    // ── fold(ref, strategy?) ──────────────────────────────
    async fold(ref: Ref, strategy?: AssemblyStrategy): Promise<ChatMessage[]> {
        const manifest = await this.readManifest();
        const headTurnId = manifest.branches[ref] ?? manifest.rootTurnId;

        // Walk the DAG from headTurnId along parents[0] (linear path)
        // to build the message list
        const visited = new Set<TurnId>();
        const turns: Turn[] = [];
        let current: TurnId | null = headTurnId;

        while (current && !visited.has(current)) {
            visited.add(current);
            const turn = await this.readTurn(current);
            if (!turn) break;
            turns.unshift(turn);  // prepend — walk from head backwards

            // Follow first parent for linear projection
            current = turn.parents[0] ?? null;
        }

        // Flatten all turn payloads into a single ChatMessage[]
        const messages: ChatMessage[] = [];
        for (const turn of turns) {
            messages.push(...turn.payload);
        }
        return messages;
    }

    // ── delete(turnId) ────────────────────────────────────
    async deleteTurn(turnId: TurnId): Promise<void> {
        const turn = await this.readTurn(turnId);
        if (!turn) return;

        // 1. Mark turn file as deleted (soft delete)
        await this.writeTurn(turnId, { ...turn, _deleted: true });

        // 2. Update parent's reference (if needed)
        const manifest = await this.readManifest();

        // 3. Re-link: find turns that had this as parent, re-parent them
        //    (only needed for hard delete; soft delete just marks)
        // 4. If this turn was the head of a branch, move head back
        for (const [branch, headId] of Object.entries(manifest.branches)) {
            if (headId === turnId) {
                const parentId = turn.parents[0];
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

### 3.2 关键差异：fold 从 Turn DAG 线性化

```
ChatEngine.fold() (旧): 读 ChatNode 树 → 按 parent_id 链 → 每个 ChatNode 独立文件
TurnLog.fold()    (新): 读 Turn DAG  → 按 parents[0] 链 → 每个 Turn 一个文件
```

Turn DAG 已经包含完整的 `ChatMessage[]`，fold 不需要 role 推断——直接展开 turn.payload。

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
        // ★ 新逻辑：通过 turnId 找到 Turn，删除整个 Turn
        const turnId = session._turnId;
        if (turnId) {
            await this.log.deleteTurn(turnId);     // 一次删除整个 Turn
            state.removeTurn(turnId);              // 内存中移除整个 Turn
        }
    } else if (session.role === 'assistant') {
        // 删除 assistant：只清空 assistant payload，user 保留
        const turnId = session._turnId;
        if (turnId) {
            await this.log.clearAssistantInTurn(turnId);  // Turn 内清空 assistant
            state.clearAssistantInTurn(turnId);
        }
    }
}
```

### 4.2 删除 agent → user 保留，resend 不建新分支

```typescript
// TurnLog.clearAssistantInTurn(turnId)
async clearAssistantInTurn(turnId: TurnId): Promise<void> {
    const turn = await this.readTurn(turnId);
    if (!turn) return;

    // 只保留 user 消息，移除 assistant 及后续 tool 消息
    turn.payload = turn.payload.filter(m => m.role === 'user');
    turn.meta.stale = false;          // 清除 stale 标记
    delete turn.result;               // 清除运行时数据
    await this.writeTurn(turnId, turn);
    this._cache.invalidateAll();
}
```

此时 Turn 变为"user 已就绪、assistant 待生成"状态。再次 `sendMessage` 同一内容时，**复用同一个 Turn**，loop 重新驱动 assistant 生成——不创建新 Turn、不建新分支。

### 4.3 编辑 user → 标记 stale + 保留旧路径

```typescript
// SessionManager.commitEdit()
async commitEdit(messageId: string, newContent: string, autoRerun: boolean): Promise<void> {
    const state = this.states.get(sessionId);
    const session = state.findSessionById(messageId);

    // 1. 创建新 Turn（内容为新 user message）
    const newTurn: Turn = {
        id: ulid(),
        parents: session._turnParents ?? [currentHead],
        payload: [{ role: 'user', content: newContent }],
        meta: { createdAt: Date.now(), origin: 'edit' },
    };
    await this.log.append(ref, newTurn);

    // 2. 旧 Turn 标记 stale（不作为分支，只是元数据标记）
    if (session._turnId) {
        await this.log.markStale(session._turnId);
    }

    // 3. autoRerun → 驱动新 Turn 的 assistant 生成
    if (autoRerun) {
        // 复用同一个 Turn（append assistant 进 payload），不建新 Turn 节点
    }
}
```

### 4.4 resend（同内容重发）→ 复用 Turn

"resend"就是清空 assistant 后重新驱动 loop：

```
1. clearAssistantInTurn(turnId)     // payload 中只留 user 消息
2. loop.run() 重新生成 assistant    // 将 assistant 消息 append 进同一个 Turn 的 payload
3. 不创建新 Turn、不创建新分支
```

这与"删除 agent 后 resend"是同一个流程。

---

## 5. SessionState 变更

### 5.1 从"消息数组"到"Turn 数组"

```typescript
// 旧
class SessionState {
    private sessions: SessionGroup[] = [];  // 平铺的 user/assistant 交替数组
}

// 新
class SessionState {
    private turns: TurnProjection[] = [];   // Turn 的 UI 投影数组
}

interface TurnProjection {
    turnId: TurnId;
    parents: TurnId[];
    userMessage: {
        id: string;        // = turnId + '#user'
        content: string;
        files?: ChatAttachment[];
    };
    assistantMessage?: {
        id: string;        // = turnId + '#assistant'
        content: string;
        executionRoot?: ExecutionNode;   // 工具调用树
        agentId: string;
        agentName: string;
    };
    meta: TurnMeta;
}
```

### 5.2 关联查找 → 直接索引

```typescript
// 旧：O(n) 遍历
findAssistantMessagesAfter(userId) → 遍历数组

// 新：O(1) 查找
getAssistantForUser(turnId) → this.turns.find(t => t.turnId === turnId)?.assistantMessage
getUserForAssistant(turnId) → this.turns.find(t => t.turnId === turnId)?.userMessage
```

### 5.3 删除 → Turn 级操作

```typescript
// 旧
removeMessage(messageId)   → splice 单个 SessionGroup
removeMessages(messageIds) → filter 多个

// 新
removeTurn(turnId)         → splice 整个 TurnProjection
clearAssistantInTurn(turnId) → 置空 TurnProjection.assistantMessage
```

---

## 6. 迁移策略

### 6.1 Strangler-Fig 三步

| 步骤 | 动作 | 风险 |
|---|---|---|
| **Step 1** | 新建 `TurnLog`（实现 ILog），与 `ChatEngineLog` 并存。新 session 使用 TurnLog，旧 session 继续用 ChatEngineLog | 零风险——两条路径独立 |
| **Step 2** | 在 `TaskRunner` / `SessionManager` 中按 session 的存储格式选择 log 实现（`manifest.format === 'turn'` ? TurnLog : ChatEngineLog） | 需要 format 检测逻辑 |
| **Step 3** | 提供迁移工具：`migrateToTurnFormat(sessionId)` — 读旧 ChatNode 树，合并相邻 user+assistant 对为 Turn，写入 turns/ | 可降级（迁移失败回退旧格式） |

### 6.2 迁移算法

```
function migrateSession(oldManifest):
    turns = []
    walk 旧 ChatNode 树 from root to head:
        if node.role === 'user':
            currentTurn = new Turn({
                payload: [node.toChatMessage()]
            })
        elif node.role === 'assistant':
            currentTurn.payload.push(node.toChatMessage())
            currentTurn.meta.usage = node.meta.tokens
            currentTurn.result = reconstructFromExecutionNodes()
            turns.push(currentTurn)

    writeTurnManifest()
    for each turn: writeTurnFile()
```

相邻 user + assistant ChatNode 对合并为一个 Turn。中间如果有 tool call / tool result 节点（assistant → tool_call → tool_result → assistant 循环），全部进入同一个 Turn 的 payload（因为它们是同一轮 agent loop 的产物）。

---

## 7. 影响范围

| 组件 | 改动 |
|---|---|
| `common/src/interfaces/agent/loop.ts` | Turn 接口不变；新增 `TurnPersisted`（仅持久化用） |
| `llm-engine/src/persistence/turn-log.ts` | **新文件**：TurnLog 实现 ILog |
| `llm-engine/src/persistence/chat-engine-log.ts` | 保留为遗留适配器（旧 session 读取），标记 `@deprecated` |
| `llm-engine/src/session/session-state.ts` | `SessionGroup[]` → `TurnProjection[]`；删除 position-based 查找方法 |
| `llm-engine/src/session/session-manager.ts` | `deleteMessage`/`commitEdit`/`collectDeletableIds` 使用 turnId 关联 |
| `llm-engine/src/session/task-runner.ts` | `createUserMessage`/`createAssistantNode` → 操作 Turn |
| `llm-engine/src/core/types.ts` | 新增 `TurnProjection`；废弃 `SessionGroup`、`HistoryMessage` |
| `llm-engine/src/index.ts` | 导出 TurnLog |

---

## 8. 与现有设计的对齐

| 四原语概念 | 此方案中的落点 |
|---|---|
| **Log** | TurnLog 直接操作 Turn DAG，不再经过 ChatNode 中间层 |
| **Turn** | 唯一持久化单元——`payload` 完整保留 user + assistant 消息组 |
| **fold()** | 沿 `parents[0]` 链 walk DAG，展开所有 turn.payload |
| **merge()** | 创建 `parents = [refA.head, refB.head]` 的多父 Turn |
| **rebase()** | 新 ref 分支 + cherry-pick 下游 Turn（已在 ChatEngineLog 有框架） |
| **DraftArea** | 不变——in-flight Turn 草稿机制与 Turn 模型天然匹配 |
| **RefStore** | 简化——不再需要 ChatNode ID 与 TurnId 的阻抗适配 |

---

## 9. 开放问题

| 问题 | 倾向 |
|---|---|
| 旧 session 是否强制迁移？ | 不强制。新 session 用 TurnLog，旧 session 读 ChatEngineLog。迁移工具可选 |
| Turn 文件数上限 | 万级 Turn 无问题。如需优化做分桶（`turns/00/`, `turns/01/`...），YAGNI |
| Turn payload 中的 tool_call / tool_result | 保留在 payload 中（ILog 接口已有 ToolCall 类型），fold 时正常展开 |
| multi-parent Turn 的 fold 策略 | `AssemblyStrategy` 已定义（concat/summarize-branches/pick），TurnLog 实现即可 |
| SessionState 是否需要同时支持旧格式 | 不需要——SessionState 只读 TurnProjection，旧格式通过 ChatEngineLog.fold() 提供兼容 |
