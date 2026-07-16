# LLM 架构重构计划 — Turn 持久化审计 + 系统性简化

> 上级文档: [llm-refactor2.md](./llm-refactor2.md) | [llm-turn.md](./llm-turn.md)
> 本文件: 分阶段实施方案

## Context

根据 `llm-refactor2.md` 对现有 LLM 子系统的审计结论，当前存在 4 个结构性问题：
1. **Turn → ChatNode 拍扁**：user/assistant 配对靠位置推导，Turn 语义在持久化层丢失
2. **双写路径**：ILog.append 与 TaskRunner 直写 engine 并存
3. **双重状态**：SessionState 内存投影与持久化层手动双写同步
4. **SessionManager 职责过载**（1530 行，10+ 职责）

本次重构按 5 个阶段（P0~P5）逐步解决上述问题，每阶段可独立合并、独立回退。

---

## Phase 0 — 快赢清理（7项，无行为变化）

**目标**：清除已知 bug、死代码和重复逻辑。

### 文件变更

| # | 动作 | 文件 | 说明 |
|---|---|---|---|
| 1 | 修改 | `utils/converters.ts` | 删除三处无效 `generateUUID()` 调用（生成后立即被 `node.id` 覆盖），`ExecutionNode.id` 改为 `node.id + ':exec'` 稳定派生 id |
| 2 | 删除 | `session-manager.ts:1101-1102` | 删除 `listBranches()` 中两行 `console.log` |
| 3 | 删除+移动 | `session/agent-loop-strategy.ts` | 删除此残留文件，`IToolExecutor` 移入 `core/types.ts`，更新引用方 import |
| 4 | 新建 | `persistence/vfs-utils.ts` | 提取 `collectAllFiles` 递归遍历为共享函数，替换 `chat-engine.ts` 和 `chat-engine-log.ts` 中的重复实现 |
| 5 | 修改 | `chat-engine-log.ts:268-274` | 修复 `ref` 当 `sessionId` 传参的锁错位——直接使用构造时持有的 `this._sessionId` |
| 6 | 修改 | `task-runner.ts:360` | 新增 `Map<string, ChatEngineLog>` 按 session 复用实例，消除每任务冷扫描 |
| 7 | 修改 | `core/types.ts`, `task-runner.ts:646-653` | `message:appended` payload 改为判别联合 `SessionGroup \| ExecutionNode`，消除 `rootNode as any` |

### 验收

- `grep generateUUID` 在 `converters.ts` 零命中
- `grep console.log` 在 `session-manager.ts` 零命中
- `grep agent-loop-strategy` 全 packages 零命中
- `collectAllFiles` 在 chat-engine.ts 和 chat-engine-log.ts 中均已替换
- `new ChatEngineLog` 仅在 Map miss 时执行
- `as any` 在 `task-runner.ts:649` 消除

---

## Phase 1 — TurnLog 落地

**目标**：新建基于 Turn 文件的 ILog 实现，与 ChatEngineLog 并存，通过 manifest 格式路由。

### 新建文件

**`persistence/turn-log.ts`** (~350 行)
- `TurnLog implements ILog`：`append()` / `fold()` / `refs()` / `draft()` / `merge()` / `rebase()`
- Turn 专属操作：`clearAssistantInTurn()` / `markStale()` / `deleteTurn()`
- 内部类 `TurnRefStore implements RefStore`
- append 顺序：先写 turn 文件 → 后写 manifest（head 指针 + children 反向索引）
- fold 并行读：收集完整 TurnId 链 → `Promise.all` 并行读 → 按链顺序展开，跳过 `_deleted: true`

**`persistence/draft-area.ts`** (~100 行)
- 从 `chat-engine-log.ts` 抽取 `VFSDraftArea` → `FileDraftArea`
- 修复 `FSNode.path` 与 nodeId 混用问题（`llm-refactor2.md §2-D`）
- 构造接收 `IFSDriver` + `assetDirPath` 字符串

**`persistence/turn-manifest.ts`** (~50 行，类型定义)

```typescript
interface TurnManifest {
    format: 'turn';
    id: string;
    rootTurnId: TurnId;
    branches: Record<Ref, TurnId>;
    currentBranch: Ref;
    currentHead: TurnId;
    children: Record<TurnId, TurnId[]>;  // §3.1 反向索引
    tags: Record<string, TurnId>;
    createdAt: string;
    updatedAt: string;
}

interface TurnPersisted extends Turn {
    _deleted?: boolean;
    _agentId?: string;
    _agentName?: string;
}
```

### 修改文件

| 文件 | 修改 |
|---|---|
| `persistence/chat-engine-log.ts` | 抽走 DraftArea；标记 `@deprecated`；修复 `ref` 当 `sessionId` 传参（P0 #5） |
| `session/session-manager.ts` | `ensureRegistered()` 中检测 `manifest.format === 'turn'`，构造 TurnLog 或 ChatEngineLog |
| `core/types.ts` | `SessionRuntime` 增加 `logFormat?: 'chat' \| 'turn'`；新增 `TurnProjection` 类型导出 |
| `session/task-runner.ts` | 从 runtime 获取 log 实例，不再自行 new |
| `session/session-state.ts` | 新增 `loadFromTurn()` 方法（Phase 3 切换渲染，此阶段先铺设） |
| `persistence/index.ts` | 导出新模块 |

### 格式路由关键逻辑

```typescript
const manifest = await this.engine.getManifest(nodeId);
const isTurnFormat = (manifest as any).format === 'turn';
if (isTurnFormat) {
    const turnLog = new TurnLog(this.engine.driver, nodeId);
    // populate from TurnLog
} else {
    // 现有 ChatNode 路径
}
```

新 session 默认创建 `{ format: 'turn', ... }` 的 TurnManifest。旧 session 继续走 ChatEngineLog。

---

## Phase 2 — 单一写路径（核心增量）

**目标**：TaskRunner 不再直调 `engine.appendMessage`/`engine.updateNode`，所有持久化统一经 ILog。仅对 turn 格式 session 启用。

### 修改 `session/task-runner.ts`

- **删除 `createUserMessage()` (L572-608)**：不再直调 `engine.appendMessage` + `state.addUserMessage` + emit。改为通过 `log.draft().setCurrent(turn)` 设置初始 Turn
- **删除 `createAssistantNode()` (L610-656)**：assistant 创建延迟到 loop 内部通过 `log.append()` 完成
- **删除 `updateNode` 节流 (L306-321)**：流式内容累积，仅在 DraftArea checkpoint 时落盘
- **删除 `updateNode` 最终持久化 (L509-521)**：由 `log.append()` 或 `clearAssistantInTurn()` 承担
- **删除 `handleError` 中的 `updateNode` (L722-733)**：错误写入 DraftArea checkpoint
- **删除 `TaskInput.parentUserNodeId` 和 `skipUserMessage`**：regenerate 改为 `clearAssistantInTurn(turnId)` + 重驱动
- 流式崩溃安全统一到 DraftArea checkpoint（频率对齐原节流间隔）

### 修改 `session/session-manager.ts`

- **`executeRegenerate()`**：不再创建 branch；改为 `clearAssistantInTurn(turnId)` + 重驱动
- **`commitEdit()`**：创建新 Turn（`origin: 'edit'`），旧 Turn 标记 `stale`。不创建 branch
- **`deleteMessage()`**：user → `log.deleteTurn(turnId)` 级联；assistant → `log.clearAssistantInTurn(turnId)` 原地
- **`switchToSibling()`**：通过 TurnLog children 索引枚举 sibling，不再调 `engine.getNodeSiblings`

### 修改 `core/types.ts`

- `TaskInput` 删除 `skipUserMessage`、`parentUserNodeId`
- 新增 `turnId?: string`、`isRegenerate?: boolean`

### Strangler-Fig 开关

```typescript
if (runtime.logFormat === 'turn') {
    // 新路径：单写 TurnLog
} else {
    // 旧路径：保持原样
}
```

---

## Phase 3 — 投影化 SessionState

**目标**：`SessionGroup[]` → `TurnProjection[]`，通过事件源（TurnLogEvent）驱动单向更新，消除位置推导。

### 新增类型（`core/types.ts`）

```typescript
interface TurnProjection {
    turnId: TurnId;
    parents: TurnId[];
    kind: 'system' | 'chat' | 'merge';  // §3.5 显式区分
    userMessage?: { id, content, files?, origin?, historyPolicy? };
    assistantMessage?: { id, content, executionRoot?, agentId, agentName, status };
    meta: TurnMeta;
}

type TurnLogEvent =
    | { type: 'turn:appended'; turn: TurnProjection; afterTurnId?: TurnId }
    | { type: 'turn:updated'; turnId: TurnId; changes: Partial<TurnProjection> }
    | { type: 'turn:deleted'; turnId: TurnId }
    | { type: 'turns:cleared' };
```

### 修改 `session/session-state.ts`

- `private sessions: SessionGroup[]` → `private turns: TurnProjection[]`
- 新增 `apply(event: TurnLogEvent): void` — 唯一外部写入口
- 删除位置推导方法：`findUserMessageBefore` / `findAssistantMessagesAfter` / `getOriginalAgentId` / `collectAssistantIdsAfter`
- 新增精确查找：`getTurnById()` / `getUserForTurn()` / `getAssistantForTurn()`

### 修改 `session/session-manager.ts`

- `populateState()` → 从 TurnLog fold 构建 `TurnProjection[]`
- `reloadSessionData()` 全量重放 → head 链 diff 增量事件（不再发 `messages:cleared` + N 条 `message:appended`）
- `getSnapshot()` 中 `interruptedAssistantId` 扫描 → 检查 `DraftArea.restore() !== null`

### UI 适配（`llm-ui` 包）

- `SessionEventHandler` 新增 `turn:appended` / `turn:updated` / `turn:deleted` 处理
- 旧事件保留兼容旧格式 session

---

## Phase 4 — SessionManager 拆分

**目标**：1530 行拆为 4 个组件（均 < 500 行），`ISession` 门面签名不变。

### 新组件

| 新文件 | 类名 | 职责 | ~行数 |
|---|---|---|---|
| `session/session-registry.ts` | `SessionRegistry` | 注册/绑定/解绑/自动清理/恢复 | ~350 |
| `session/turn-operations.ts` | `TurnOperations` | send/delete/edit/regenerate/resend | ~400 |
| `session/branch-service.ts` | `BranchService` | branch CRUD / sibling 导航 / tags | ~250 |
| `session/session-facade.ts` | `SessionFacade` | 实现 ISession，组合上述三者 + settings + history | ~250 |

### 收尾

- `session-manager.ts` 标记 `@deprecated`，内部委托给 `SessionFacade`
- `ChatEngineLog` 标记 `@deprecated`
- `chat-engine.ts` 中 `branch_nums` / `allocateBranchNum` 标记 `@deprecated`

---

## Phase 5 — 迁移工具（独立可选）

- 新建 `persistence/migration.ts`：`migrateToTurnFormat(sessionId)`
- 分支感知：按 manifest.branches 每个 head 走 parent 链，合并相邻 ChatNode 为 Turn
- 共享前缀 ChatNode → 同一 TurnId（content hash 去重）
- 写入 children 反向索引
- 失败恢复备份 manifest

---

## 关键依赖关系

```
P0 ──独立──> 可随时合并
 |
P1 ──依赖 P0 #4, #5──> 新旧格式并存
 |
P2 ──依赖 P1──> 核心增量，仅 turn 格式启用
 |
P3 ──依赖 P2──> 投影化，UI 适配
 |
P4 ──依赖 P3──> 拆分收尾
 |
P5 ──依赖 P1──> 独立可选
```

---

## 验收标准

1. `grep "engine\.appendMessage\|engine\.updateNode"` 在 `session/` 下仅存在于 `!isTurnFormat` 保护分支
2. `findUserMessageBefore` / `collectAssistantIdsAfter` 等位置推导方法已删除
3. `persistence/` 和 `session/` 中 `as any` 归零
4. 切分支不再发 `messages:cleared` + N 条 `message:appended`
5. 三条业务规则有集成测试：删 user 级联删 agent / 删 agent 保留 user / resend 不建分支
6. session-manager.ts 后继组件均 < 500 行

---

## 关键文件

| 文件 | 角色 |
|---|---|
| `common/src/interfaces/agent/loop.ts` | ILog/Turn/DraftArea 接口定义 |
| `llm-engine/src/persistence/chat-engine-log.ts` | 当前 ILog 实现（455 行），TurnLog 参照物 |
| `llm-engine/src/persistence/chat-engine.ts` | ChatEngine（1690 行），含 branch_nums 死代码 |
| `llm-engine/src/session/session-manager.ts` | SessionManager（1530 行），P2~P4 拆解目标 |
| `llm-engine/src/session/task-runner.ts` | TaskRunner（759 行），P2 双写路径消除的核心 |
| `llm-engine/src/session/session-state.ts` | SessionState（363 行），P3 投影化改造目标 |
| `llm-engine/src/utils/converters.ts` | P0 #1 清理目标 |

## 验证方式

- 每阶段完成后运行现有测试套件确保无回归
- Phase 2 后手动验证：新建 session → send → regenerate → delete → edit → 切分支 全流程
- Phase 3 后检查事件发射：切分支不产生 `messages:cleared` 事件
- 代码审查 checklist：`as any` 计数、行数统计、grep 验收标准逐条核对
