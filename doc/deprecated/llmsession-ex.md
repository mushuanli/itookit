# LLM Session 扩展设计方案

> 版本: 2.0 | 日期: 2026-06-06 | 状态: 设计阶段

## 一、背景与真实需求

### 1.1 三个真实问题

通过代码审查，确认以下三个问题是真实存在的：

**问题 A — 消息来源无法区分**
同一 bound session 内，用户主动发起的聊天与 agent 自动触发的聊天（auto-retry、/btw 指令等）在 UI 和 LLM history 中完全同等对待，无法差异化处理。

**问题 B — LLM history 无法按需排除**
部分消息（如 `/btw` 旁注请求/响应、上下文压缩的摘要注入）需要只在当前界面显示，不进入后续的 LLM chat history。当前 `getHistory()` 只有 `historyLength` 数量截断，没有基于标记的按条 exclude 机制。

**问题 C — Thinking 面板无自动折叠**
当前 thinking 内容在流式期间展开显示，流式结束（`node_status=success`）后 `StreamController.updateStatus()` 对 `.llm-ui-thought` DOM **零操作**，thinking 面板永远保持展开，占用大量屏幕空间。

### 1.2 已验证的现状（不需要修改的部分）

> 原 v1.1 的诊断存在误判，代码审查已确认：

| 原诊断 | 实际状态 |
|---|---|
| "非 bound session 的 assistant 消息无条件 emit 到 UI" | **错误**。`createUserMessage` 和 `createAssistantNode` 均有 `if (isBound)` 守卫，非 bound 事件已被完全阻断 |
| "Mission 子任务出现在聊天流" | **不存在**。Mission 走 `SubAgentRouter → ILLMService.chat()`，完全绕开 SessionManager/TaskRunner/EventBus |
| "AgentTaskRequest 是所有任务的公共入口" | **错误**。Mission 不走 `IAgentRuntime.run()`，regenerate 直接构建 `TaskInput` |

---

## 二、现状分析

### 2.1 核心数据流（已验证）

```
用户输入 → SendMessageCommand → SessionManager.sendMessage()
  → TaskRunner.submit(TaskInput) → processQueue() → setupTaskExecution()
    → createUserMessage()
        → engine.appendMessage()           // 持久化
        → state.addUserMessage()           // 内存 SessionGroup
        → if (isBound) emitSession('session_start', userSession)
    → createAssistantNode()
        → engine.appendMessage()           // 持久化
        → state.createAssistantMessage()   // 内存 ExecutionNode + SessionGroup
        → if (isBound) emitSession('session_start', assisSession)
        → if (isBound) emitSession('node_start', rootNode)
    → executeHarnessTask() / executeTask()
        → if (isBound) emitSession('node_update', chunk)   // 含 field:'thought'|'output'
        → if (isBound) emitSession('node_status', ...)
        → if (isBound) emitSession('finished', ...)
```

**关键确认**：所有向 UI 的事件推送都受 `isBound` 守卫保护，非 bound session 静默执行。

### 2.2 LLM History 构建机制（已验证）

```
TaskRunner.executeTask()
  → buildHistoryForTask(state, currentInput, historyLength?)
      → SessionState.getHistory()           // 遍历 sessions[]，仅取 user/assistant
      → slice(-historyLength)               // 数量截断
      → 过滤连续 user、末尾 user 清洗
  → buildHistoryMessages()                  // 附件解析，转为 ChatMessage[]
```

`SessionState.getHistory()` 无条件将所有 `sessions[]` 中的 user/assistant 纳入历史，**没有基于标记的 exclude 机制**。这是问题 B 的根源。

### 2.3 Thinking 渲染管线（已验证）

```
agent:stream:thinking 事件
  → HarnessAdapter → OrchestratorEvent { type:'node_update', field:'thought', chunk }
  → EventBatchProcessor → batched.chunks[nodeId].thought 累积
  → HistoryView.handleBatchedEvents()
      → StreamController.updateContent(nodeId, thought, 'thought')
          → updateThought(): 首个 chunk 时 display:block，追加 textContent
  → node_status=success
      → StreamController.updateStatus()    // 对 .llm-ui-thought 零操作 ← 问题所在
```

持久化路径：`accumulator.thinking → ChatNode.meta.thinking`，加载时经 `converters.ts` 还原为 `ExecutionNode.data.thought`，由 `NodeRenderer.renderThinking()` 初始渲染。

### 2.4 现有过滤机制汇总

| 层级 | 机制 | 位置 | 局限 |
|---|---|---|---|
| 持久化加载 | `role==='system'` → 跳过 | `session-manager.ts:1218` | 仅 role 过滤 |
| 转换 | 非 user/assistant ChatNode → null | `converters.ts` | 仅 role 过滤 |
| 任务创建 | `skipUserMessage=true` → 不创建 user session | `task-runner.ts:268` | 仅跳过 user 侧，assistant 侧无对应机制 |
| LLM 上下文 | `historyLength=N` → 尾部截断 | `task-runner.ts:1015` | 数量截断，非按条标记 |
| LLM 上下文 | 末尾重复 user 消息 → 移除 | `task-runner.ts:990` | 防御性清洗 |
| UI 事件 | `isBound` 守卫 | `task-runner.ts:820,857` | 已有效阻断非 bound session |

---

## 三、行业参考

| 产品 | 来源区分 | History 控制 | Thinking 折叠 |
|---|---|---|---|
| **Claude Code** | 工具输出在独立面板，非用户触发不进主对话流 | 无 — 每次全量上下文 | Thinking 在独立区块，流结束后折叠 |
| **Cursor** | Agent 中间步骤不出现在主对话 | 可配置历史窗口大小 | `⏺ Running tool...` 单行折叠 |
| **ChatGPT** | user=右气泡，system=灰色内联 | 后台做上下文压缩 | 推理模型 thinking 默认折叠 |
| **Devin** | 完全后台，专用任务视图 | 执行上下文独立于对话 | — |

**行业共识**：
1. 来源通过视觉层级区分，不是强制隐藏
2. 不进历史的消息通过 metadata 标记，渲染正常但 history 构建时过滤
3. Thinking 在生成结束后自动折叠，用户可手动展开

---

## 四、设计方案

### 4.1 总体策略：两个正交字段

| 字段 | 控制维度 | 消费方 |
|---|---|---|
| `origin` | **谁发起的** — 影响 UI 视觉样式、来源标签 | `SessionRenderer`（CSS class）、`HistoryView`（初始折叠策略） |
| `historyPolicy` | **是否进 LLM history** — 影响下次请求的上下文构建 | `SessionState.getHistory()` |

`visibility`（v1.1 方案）从设计中移除：非 bound session 已由 `isBound` 守卫处理；bound session 内的显示策略通过 `origin` + CSS 表达，不需要额外字段控制 DOM 可见性。

### 4.2 类型定义

#### 新增联合类型（`llm-runtime/src/core/types.ts`）

```typescript
/** 请求来源 */
export type SessionOrigin = 'user' | 'agent' | 'system';

/** LLM history 策略 */
export type HistoryPolicy =
    | 'include'     // 默认：纳入后续 LLM history
    | 'exclude';    // 不纳入 LLM history（只在 UI 显示当次响应）
```

**`origin` 三值而非四值的原因**：原方案的 `'mission'` 和 `'agent'` 在 UI 表达上没有差异，Mission 也不走 TaskRunner（无需标记），合并为 `'agent'` 足够。

#### Layer ① — `TaskInput`（`llm-runtime/src/core/types.ts:264`）

```typescript
export interface TaskInput {
    // ── 现有字段保持不变 ──
    sessionId: string;
    nodeId: string;
    text: string;
    files: ChatAttachment[];
    agentId: string;
    overrides?: ExecutionOverrides;
    skipUserMessage?: boolean;
    parentUserNodeId?: string;
    branchInfo?: BranchInfo;
    regenerateContext?: { ... };

    // ── 新增 ──
    /** 任务来源，默认 'user' */
    origin?: SessionOrigin;
    /** LLM history 策略，默认 'include' */
    historyPolicy?: HistoryPolicy;
}
```

#### Layer ② — `SessionGroup`（`llm-runtime/src/core/types.ts:152`）

```typescript
export interface SessionGroup {
    // ── 现有字段保持不变 ──
    id: string;
    timestamp: number;
    role: 'user' | 'assistant';
    content?: string;
    files?: ChatAttachment[];
    executionRoot?: ExecutionNode;
    persistedNodeId?: string;
    siblingIndex?: number;
    siblingCount?: number;
    branchInfo?: BranchMetadata;
    parentUserSessionId?: string;

    // ── 新增 ──
    /** 请求来源，默认 'user' */
    origin?: SessionOrigin;
    /** LLM history 策略，默认 'include' */
    historyPolicy?: HistoryPolicy;
}
```

#### Layer ③ — `AppendMessageMeta`（`common/src/interfaces/chat.ts`）

持久化层需要记录 `historyPolicy`，以便重新加载后行为一致：

```typescript
export interface AppendMessageMeta {
    // ── 现有字段保持不变 ──
    files?: ChatAttachment[];
    executorId?: string;
    // ...

    // ── 新增 ──
    origin?: SessionOrigin;
    historyPolicy?: HistoryPolicy;
}
```

### 4.3 数据流

```
调用者                       引擎（llm-runtime）                   UI（llm-ui）
════════                    ══════════════════                   ════════════

SendMessageCommand           TaskRunner.submit(TaskInput)          HistoryView
  origin: 'user'  ────────→  createUserMessage()                  processEventImmediate('session_start')
  historyPolicy: 'include'     state.addUserMessage()               → renderer.appendSession(group)
                               group.origin = input.origin          → collapse.setState(id, isUser)
                               group.historyPolicy = input.historyPolicy  → CSS: .llm-ui-session--origin-{origin}
                               if (isBound) emitSession(...)
                                                  ↓
/btw Command                 TaskRunner.submit(TaskInput)          同上
  origin: 'user'  ────────→  createUserMessage()
  historyPolicy: 'exclude'     group.historyPolicy = 'exclude'
                               engine.appendMessage(meta: { historyPolicy: 'exclude' })

auto-retry                   TaskRunner.submit(TaskInput)          同上，CSS 显示来源标签
  origin: 'agent' ────────→  createUserMessage()
  historyPolicy: 'include'     group.origin = 'agent'
```

```
下次 LLM 请求时：

TaskRunner.buildHistoryForTask()
  → SessionState.getHistory()
      for session of this.sessions:
          if session.historyPolicy === 'exclude': continue  ← 新增过滤
          if session.role === 'user': push to history
          if session.role === 'assistant': push to history (if output not empty)
```

### 4.4 各层改动详情

#### `session-state.ts` — `addUserMessage()` 携带新字段

```typescript
// session-state.ts
addUserMessage(
    text: string,
    files: ChatAttachment[],
    persistedNodeId: string,
    origin?: SessionOrigin,         // 新增
    historyPolicy?: HistoryPolicy,  // 新增
): SessionGroup {
    const group: SessionGroup = {
        id: persistedNodeId,
        timestamp: Date.now(),
        role: 'user',
        content: text,
        files,
        persistedNodeId,
        origin: origin ?? 'user',
        historyPolicy: historyPolicy ?? 'include',
    };
    this.sessions.push(group);
    return group;
}
```

`createAssistantMessage()` 同步携带 `origin` 和 `historyPolicy`，从对应的 user session 继承（assistant 响应与发起请求的 policy 保持一致）。

#### `task-runner.ts` — `createUserMessage()` 透传字段

```typescript
// task-runner.ts: createUserMessage()
const userSession = state.addUserMessage(
    input.text,
    contextFiles,
    userNodeId,
    input.origin,        // 透传
    input.historyPolicy, // 透传
);

// 持久化时写入 meta
await this.engine.appendMessage(nodeId, sessionId, 'user', input.text, {
    files: persistedFiles,
    executorId: input.agentId,
    origin: input.origin,
    historyPolicy: input.historyPolicy,  // 新增
});
```

#### `session-state.ts` — `getHistory()` 加 exclude 过滤

```typescript
// session-state.ts
getHistory(): HistoryMessage[] {
    const history: HistoryMessage[] = [];

    for (const session of this.sessions) {
        // 新增: exclude 策略的消息跳过
        if (session.historyPolicy === 'exclude') continue;

        if (session.role === 'user') {
            history.push({ role: 'user', content: session.content || '', files: session.files });
        } else if (session.role === 'assistant' && session.executionRoot) {
            const output = this.extractOutput(session.executionRoot);
            if (output.trim()) {
                history.push({ role: 'assistant', content: output });
            }
        }
    }
    return history;
}
```

#### `converters.ts` — 持久化还原时读取新字段

```typescript
// converters.ts: chatNodeToSessionGroup()
static chatNodeToSessionGroup(node: ChatNode): SessionGroup | null {
    if (node.role === 'user') {
        return {
            // ... 现有字段
            origin: (node.meta?.origin as SessionOrigin) ?? 'user',
            historyPolicy: (node.meta?.historyPolicy as HistoryPolicy) ?? 'include',
        };
    }
    if (node.role === 'assistant') {
        return {
            // ... 现有字段
            origin: (node.meta?.origin as SessionOrigin) ?? 'user',
            historyPolicy: (node.meta?.historyPolicy as HistoryPolicy) ?? 'include',
        };
    }
    return null;
}
```

#### `HistoryView.ts` — 基于 origin 设置初始折叠

```typescript
// HistoryView.ts: processEventImmediate()
case 'session_start': {
    this.clearErrors();
    this.enterStreamingMode();
    const isUser = event.payload.role === 'user';

    // 'agent'/'system' 来源的消息默认折叠，让用户聚焦主对话
    const defaultCollapsed = isUser || event.payload.origin === 'agent' || event.payload.origin === 'system';

    this.renderer.appendSession(event.payload, defaultCollapsed);
    this.collapse.setState(event.payload.id, defaultCollapsed);
    this.scrollController.scrollToBottom(false);
    break;
}
```

#### `SessionRenderer.ts` — 渲染时附加 origin CSS class

```typescript
// SessionRenderer.ts: appendSession()
appendSession(group: SessionGroup, defaultCollapsed: boolean): void {
    // ... 现有逻辑

    // 新增: origin CSS class
    if (group.origin && group.origin !== 'user') {
        el.classList.add(`llm-ui-session--origin-${group.origin}`);
    }
    if (group.historyPolicy === 'exclude') {
        el.classList.add('llm-ui-session--ephemeral');
    }
}
```

### 4.5 Thinking 自动折叠（问题 C）

#### 方案：`StreamController.updateStatus()` 在 success 时折叠 thought

```typescript
// StreamController.ts: updateStatus()
updateStatus(nodeId: string, status: NodeStatus, result?: unknown): void {
    const el = this.container.querySelector(`[data-node-id="${nodeId}"]`) as HTMLElement;
    if (!el) return;

    // ── 现有逻辑（status class、label 更新等）──

    // 新增: 生成结束后折叠 thinking 面板
    if (status === 'success' || status === 'failed') {
        this.collapseThought(el);
    }
}

private collapseThought(nodeEl: HTMLElement): void {
    const thoughtEl = nodeEl.querySelector('.llm-ui-thought') as HTMLElement | null;
    if (!thoughtEl || thoughtEl.style.display === 'none') return;

    // 添加折叠 class，CSS transition 实现动画
    thoughtEl.classList.add('llm-ui-thought--collapsed');
}
```

#### CSS — Thinking 折叠动画（`chat-nodes.css`）

```css
/* Thinking panel — expanded state (streaming) */
.llm-ui-thought {
    overflow: hidden;
    transition: max-height 0.3s ease-out, opacity 0.2s ease-out;
}

.llm-ui-thought__content {
    max-height: 300px;
    overflow-y: auto;
}

/* Thinking panel — collapsed state (after streaming ends) */
.llm-ui-thought--collapsed .llm-ui-thought__content {
    max-height: 2.4em;        /* 约 2 行，显示摘要 */
    overflow: hidden;
    cursor: pointer;
    -webkit-mask-image: linear-gradient(to bottom, black 50%, transparent 100%);
    mask-image: linear-gradient(to bottom, black 50%, transparent 100%);
}

.llm-ui-thought--collapsed .llm-ui-thought__label::after {
    content: ' (click to expand)';
    font-weight: normal;
    opacity: 0.6;
}

/* 持久化加载后已完成的 thinking 初始即折叠 */
.llm-ui-node--done > .llm-ui-thought {
    max-height: 2.4em;
}
```

#### Thinking 展开交互（`EventDispatcher.ts`）

```typescript
// EventDispatcher.ts: 委托绑定
container.addEventListener('click', (e) => {
    const thoughtEl = (e.target as Element).closest('.llm-ui-thought--collapsed');
    if (thoughtEl) {
        thoughtEl.classList.remove('llm-ui-thought--collapsed');
    }
});
```

#### 持久化加载后的 thinking 初始状态

`NodeRenderer.create(node)` 渲染静态 DOM 时，已完成节点（`status !== 'running'`）的 thinking 初始即为折叠：

```typescript
// NodeRenderer.ts: create()
static create(node: ExecutionNode): HTMLElement {
    const hasThought = !!node.data?.thought;
    const isDone = node.status !== 'running';

    const thoughtHtml = NodeTemplates.renderThinking(node.data?.thought ?? '', hasThought);
    // ... 装配 DOM

    if (hasThought && isDone) {
        thoughtEl.classList.add('llm-ui-thought--collapsed');
    }
}
```

### 4.6 CSS 来源标识（`chat-nodes.css`）

```css
/* Origin labels — 使用 ACTION_ICONS/ENTITY_ICONS，禁止硬编码 emoji */
.llm-ui-session--origin-agent .llm-ui-session__origin-label {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 0.72rem;
    color: var(--llm-text-muted);
    padding: 2px 6px;
    border-radius: 3px;
    background: var(--llm-bg-secondary);
}

/* Ephemeral 消息 — 不进 history，显示提示 */
.llm-ui-session--ephemeral .llm-ui-session__origin-label::after {
    content: ' · ephemeral';
    opacity: 0.5;
}
```

来源标签的文字通过 `t('chat.origin.agent')` / `t('chat.origin.system')` 获取（i18n key 需在 `common/src/i18n/` 中新增）。

---

## 五、改动清单

| 层 | 文件 | 改动内容 | 影响面 |
|---|---|---|---|
| **common** | `common/src/interfaces/chat.ts` | `AppendMessageMeta` +`origin`, +`historyPolicy` | 持久化 schema |
| **common** | `common/src/i18n/zh-CN.ts` + `en.ts` | `chat.origin.*` i18n key | 国际化 |
| **engine** | `llm-runtime/src/core/types.ts` | 新增 `SessionOrigin` / `HistoryPolicy` 联合类型；`TaskInput` +`origin`, +`historyPolicy`；`SessionGroup` +`origin`, +`historyPolicy` | 类型定义 |
| **engine** | `llm-runtime/src/session/session-state.ts` | `addUserMessage()` 新增参数；`createAssistantMessage()` 继承 origin/historyPolicy；`getHistory()` 加 `exclude` 过滤 | **核心逻辑** |
| **engine** | `llm-runtime/src/session/task-runner.ts` | `createUserMessage()` 透传 origin/historyPolicy 到 state 和 engine.appendMessage | 数据透传 |
| **engine** | `llm-runtime/src/utils/converters.ts` | `chatNodeToSessionGroup()` 从 `node.meta` 还原 origin/historyPolicy | 持久化加载 |
| **UI** | `llm-ui/src/components/HistoryView.ts` | `processEventImmediate('session_start')` 基于 origin 计算 defaultCollapsed | 渲染策略 |
| **UI** | `llm-ui/src/components/history/SessionRenderer.ts` | `appendSession()` 附加 origin/ephemeral CSS class | DOM 标记 |
| **UI** | `llm-ui/src/components/history/StreamController.ts` | `updateStatus()` 在 success/failed 时调用 `collapseThought()`；新增 `collapseThought()` 私有方法 | **Thinking 折叠** |
| **UI** | `llm-ui/src/components/history/NodeRenderer.ts` | `create()` 在 `isDone && hasThought` 时初始即加 `llm-ui-thought--collapsed` class | 持久化渲染 |
| **UI** | `llm-ui/src/components/history/EventDispatcher.ts` | 委托绑定 `.llm-ui-thought--collapsed` 点击展开 | 交互 |
| **CSS** | `llm-ui/src/styles/chat-nodes.css` | `.llm-ui-thought--collapsed` 折叠样式 + 渐变遮罩；`.llm-ui-session--origin-*` 来源标签；`.llm-ui-session--ephemeral` 标记 | 样式 |

---

## 六、使用场景映射

| 场景 | origin | historyPolicy | 初始折叠 | 触发路径 |
|---|---|---|---|---|
| 用户正常输入 | `'user'` | `'include'` | 否（user 气泡折叠，assistant 展开） | `SendMessageCommand` |
| `/btw` 旁注请求 | `'user'` | `'exclude'` | 否（显示但不进 history） | `/btw` slash command |
| Agent auto-retry | `'agent'` | `'include'` | 是（origin=agent 默认折叠） | 错误恢复逻辑 |
| 上下文摘要注入 | `'system'` | `'exclude'` | 是（system 默认折叠） | `ContextManager.compress()` |
| Regenerate | `'user'` | `'include'` | 否 | `executeRegenerate()` |
| 后台 Skill 加载 | `'system'` | `'exclude'` | 是（不进 history，不干扰对话） | `autoDetectAndLoadSkills()` |
| LLM 主动挑选历史 | 视具体消息 | `'exclude'`（对被剔除的消息） | 取决于 origin | `ContextManager` 压缩决策 |

---

## 七、向后兼容

- `origin` 默认 `'user'`，`historyPolicy` 默认 `'include'`：所有现有调用路径不传新字段 → 行为完全不变
- `getHistory()` 新增 `if (session.historyPolicy === 'exclude') continue`：老数据 `historyPolicy` 为 undefined，`undefined !== 'exclude'`，不受影响
- 持久化加载时 `node.meta?.historyPolicy ?? 'include'`：老 ChatNode 无此字段，默认 include，行为不变
- Thinking 折叠：`collapseThought()` 只在 `.llm-ui-thought` 存在且 `display !== 'none'` 时生效，无 thinking 的节点不受影响

---

## 八、遗留说明（本次不处理）

| 事项 | 说明 |
|---|---|
| `isBound` 切换 race condition | 用户在任务执行中途切换 session，可能出现 user session_start 已 emit 但后续 assistant session_start 被阻断的情况，UI 会卡住。这是既有问题，与本次改动无关，建议单独跟踪 |
| Thinking 展开后折叠记忆 | 用户手动展开 thinking 后，再次渲染（如 branch 切换）是否保持展开态，本次不处理，由 `CollapseController` 的 state 管理，后续可扩展 |
| `/btw` command 实现 | 本文档只描述 `historyPolicy:'exclude'` 的数据层支持，`/btw` command 的解析和 UI 交互在 slash command 模块单独实现 |
