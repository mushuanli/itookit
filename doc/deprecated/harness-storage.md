# Harness 存储架构 — 最终设计（方案 B：高内聚会话目录）

## 0. 设计哲学（一句话定调）

> **存储层只做一件事——把"发生过的事实"可靠地记下来，并能快速重建出"现在的状态"。**
> 事件日志（`events.jsonl`）是**唯一可信源（SSOT）**；黑板、Agent 状态、Session 状态、Checkpoint、组装好的上下文，全都是这条事件流的**派生视图或缓存**。

---

## 1. 核心设计原则

| # | 原则 | 含义 |
|---|------|------|
| 1 | **Event Sourcing 为唯一真相** | `events.jsonl` 是唯一同步必成功的写点；其余皆可重建、可删除 |
| 2 | **Checkpoint 是派生缓存** | 解决"全量重放慢"，但永远可从事件重建，删光不影响正确性 |
| 3 | **黑板是视图，不是文件** | 黑板 = `events` 中 `visibility:"public"` 的投影 |
| 4 | **状态分层且皆为投影** | Session 状态、Agent 状态都从事件重建，统一物化进 checkpoint |
| 5 | **等待/唤醒是事件驱动状态机** | 绝不用进程内阻塞；等待是磁盘上的状态，唤醒靠匹配事件 |
| 6 | **高内聚会话目录（方案 B）** | 一个 session 的逻辑+资产同处一个目录，生命周期一致，无孤儿 |
| 7 | **存储不规定实现** | 定义记忆条目格式，不绑定 VectorDB/GraphDB（依赖倒置） |
| 8 | **编排归引擎，持久化归存储** | DAG 调度、上下文压缩策略、权限裁决属引擎；存储只记事实 |
| 9 | **约定优于配置** | 默认路径开箱即用，仅关键后端（资产存储）可插拔 |

---

## 2. 完整目录结构

```text
~/.harness/                              # 【全局层】用户级配置与系统缓存
├── settings.json                        # 全局设置（权限/模型/env/preferences/storage）
├── plugins/                             # 插件系统
└── backups/                             # 设置备份

<project-root>/.harness/                 # 【项目层】$project_dir（可被 HARNESS_DIR 覆盖）
│
├── sessions/                            # ★ 会话层（方案 B：逻辑+资产高内聚）
│   └── <session-name>/                  # 一个会话的全部数据都在这里
│       │
│       │   ── 逻辑部分（小，纳入 git） ──
│       ├── session.meta.json            # 会话元数据 + Agent 拓扑
│       ├── events.jsonl                 # ★ 唯一可信源：统一事件流（黑板/消息/工具/状态变更）
│       ├── agents/                      # 各 Agent 私有 scratchpad（events 的投影，可重建）
│       │   ├── agent-coordinator.jsonl
│       │   ├── agent-coder.jsonl
│       │   └── agent-tester.jsonl
│       ├── checkpoints/                 # ★ 派生缓存：状态快照（可删除、可重建）
│       │   ├── latest                   # 软引用：当前最新 checkpoint 的文件名
│       │   └── cp-{seq}.json            # 某序列点的物化状态 + 物化上下文
│       │
│       │   ── 资产部分（大，gitignore） ──
│       └── assets/                      # ★ 资产层（与逻辑同目录，但独立 gitignore/远程化）
│           ├── file-history/            # {file-hash}@v{version} 文件版本快照
│           ├── tool-cache/              # call_{id}.txt 工具结果缓存
│           └── plans/                   # 该会话的计划文档（归属此 session）
│
├── workflows/                           # ★ 工作流层（后台任务/DAG/loop 的状态持久化）
│   ├── definitions/                     # 可复用的工作流模板（DAG 定义，JSON/YAML）
│   └── runs/                            # 运行实例
│       └── {run-uuid}.state.json        # 节点状态 + loop 熔断 + 心跳锁
│
└── memory/                              # ★ 记忆层（跨会话；仅定义条目格式，不规定实现）
    ├── entries.jsonl                    # 标准化记忆条目（追加写）
    └── index/                           # 索引目录（由上层检索器维护，存储层不解析）
```

### `.gitignore` 规则

```gitignore
# 逻辑入库，资产排除 —— 一行 glob 解决
.harness/sessions/*/assets/
.harness/memory/index/
.harness/backups/
```

---

## 3. 分层状态模型

```text
┌──────────────────────────────────────────────────────────────┐
│  Session State（会话级，所有 Agent 共享）                       │
│    activeAgent / 共享变量 / latestSeq                          │
│        │                                                       │
│        ├── Agent State（Agent 级，私有）                        │
│        │     status(idle/runnable/waiting/...) / scratchpad    │
│        │     waitingFor / localVars                            │
│        │                                                       │
│        └── (可选) Workflow State（跨 Agent 编排进度）            │
│              graphState / loopControl / lock                   │
└──────────────────────────────────────────────────────────────┘
        ▲ 全部由 events.jsonl 重建，统一物化进 checkpoint
```

**关键不变式：** 没有任何独立可写的 `*.state.json` 作为状态本体（workflow 除外，见 §6 说明）。Session/Agent 状态只存在于 ① 事件流（真相）② checkpoint（缓存）两处。

---

## 4. 核心数据结构

### 4.1 统一事件日志 `events.jsonl`（SSOT）

```jsonc
{
  "seq": 50,                          // ★ 全局单调递增序列号（重放/checkpoint/因果序锚点）
  "eventId": "evt-uuid",
  "parentEventId": "evt-uuid-prev",   // 支持分支/fork
  "timestamp": "2026-06-20T10:00:00.000Z",

  // ── 可观测性 ──
  "traceId": "trace-111",             // 链路追踪（关联整个工作流）
  "spanId": "span-222",               // 当前处理步骤

  // ── 路由与可见性（多 Agent 协作核心）──
  "type": "request",                  // 见 §4.2 事件类型表
  "from": "agent-coder",              // 发声实体
  "to": "agent-tester",               // 路由目标；null = 广播（黑板语义）
  "visibility": "public",             // public(上黑板) | private(仅 from/to 可见)
  "correlationId": "req-xyz",         // ★ 请求/响应配对 ID（等待-唤醒用）

  "sessionId": "debug-auth",

  // ── 载荷（按 type 区分）──
  "payload": {
    "ask": "请测试 /api/login，返回结果"
    // message 类型则为 { role, content[], usage{...} }
    // tool_use 类型则为 { id, name, input{...} }
    // tool_result 类型则为 { tool_use_id, content, status }
  },

  // ── 状态变更（用于重建 Session/Agent 状态）──
  "stateMutations": [
    { "op": "set", "scope": "agent:agent-coder", "key": "status", "value": "waiting" },
    { "op": "set", "scope": "agent:agent-coder", "key": "waitingFor", "value": "req-xyz" }
    // scope: "session" | "agent:<id>"
    // op: "set" | "delete" | "increment" | "append"
  ]
}
```

### 4.2 事件类型表

| `type` | 语义 | 关键字段 |
|--------|------|---------|
| `message` | 对话消息（user/assistant） | `payload.role`, `payload.content` |
| `tool_use` | 工具调用发起 | `payload.name`, `payload.input` |
| `tool_result` | 工具返回 | `payload.tool_use_id`, `payload.content`, `resultRef`(大结果指向 assets) |
| `request` | 请求另一 Agent 做事 | `to`, `correlationId`, `payload.ask` |
| `response` | 对 request 的答复（**唤醒触发器**） | `correlationId`, `payload.result` |
| `handoff` | 移交控制权 | `to`, `stateMutations`(改 activeAgent) |
| `timeout` | 等待超时（系统注入，**唤醒触发器**） | `correlationId` |
| `file-snapshot` | 文件版本快照引用 | `payload.fileHash`, `payload.version`, `payload.path` |
| `state-mutation` | 纯状态变更（无消息体） | `stateMutations` |
| `checkpoint-marker` | 标记此处生成了 checkpoint | `payload.checkpointId` |

### 4.3 会话元数据 `session.meta.json`

```jsonc
{
  "name": "debug-auth",
  "cwd": "/path/to/project",
  "startedAt": 1781850398705,
  "kind": "interactive",              // interactive | workflow | background
  "entrypoint": "cli",
  "version": "1.0.0",
  "gitBranch": "main",

  "agents": [                         // ★ 多 Agent 拓扑（谁能和谁通信）
    { "id": "agent-coordinator", "role": "coordinator",
      "model": "claude-sonnet-4-6", "canHandoffTo": ["agent-coder", "agent-tester"] },
    { "id": "agent-coder", "role": "executor",
      "model": "claude-sonnet-4-6", "canHandoffTo": ["agent-coordinator"] },
    { "id": "agent-tester", "role": "executor",
      "model": "claude-haiku-4", "canHandoffTo": ["agent-coordinator"] }
  ],

  "latestSeq": 58                     // 当前事件水位（快速定位，由引擎维护）
}
```

### 4.4 Checkpoint `checkpoints/cp-{seq}.json`（派生缓存）

```jsonc
{
  "checkpointId": "cp-000058",
  "atSeq": 58,                        // ★ 对应 events.jsonl 的序列号
  "timestamp": "2026-06-20T10:05:00.000Z",
  "parentCheckpointId": "cp-000042",  // 版本链，支持回滚/fork
  "_derived": true,                   // ★ 明确标识：缓存，删除后可重建

  // ── 分层状态快照 ──
  "sessionState": {
    "activeAgent": "agent-coder",
    "status": "running",              // running | paused | error | completed
    "variables": { "tests_passed": false, "compile_errors_count": 2 }
  },
  "agentStates": {
    "agent-coordinator": { "status": "idle", "scratchpad": "...", "localVars": {} },
    "agent-coder": {
      "status": "waiting",            // ★ 在等 agent-tester
      "waitingFor": ["req-xyz"],      // 数组：支持 fan-out join（全齐才唤醒）
      "scratchpad": "已写完 login 接口，等待测试结果...",
      "localVars": { "current_file": "src/api/login.ts" }
    },
    "agent-tester": { "status": "runnable", "scratchpad": "...", "localVars": {} }
  },

  // ── 中断点未完成的工具调用 ──
  "pendingToolCalls": [
    { "agentId": "agent-tester", "toolUseId": "tool-789", "name": "Bash", "input": { "cmd": "npm test" } }
  ],

  // ── 已组装的 LLM 上下文（物化以加速恢复，但本质可重建）──
  "materializedContext": {
    "agent-coder": { "ref": "events:0-58", "tokenCount": 4200 }
    // ref 指向事件范围而非内联拷贝，避免与 SSOT 重复存储
    // 引擎按需从 events 重新组装；此处仅缓存 token 计数等元信息
  }
}
```

### 4.5 工作流运行状态 `workflows/runs/{run-uuid}.state.json`

```jsonc
{
  "runId": "run-888",
  "workflowTemplateId": "code-review-pipeline",
  "sessionId": "debug-auth",
  "status": "running",                // pending | running | paused | failed | completed
  "createdAt": 1781850398705,
  "updatedAt": 1781850400000,

  "loopControl": {                    // ★ 防死循环熔断
    "maxIterations": 10,
    "currentIteration": 3
  },
  "graphState": {                     // DAG 节点状态（存储仅持久化，调度归引擎）
    "node_lint": { "status": "completed", "resultRef": "assets/.../lint.json" },
    "node_test": { "status": "running", "retryCount": 1 },
    "node_fix":  { "status": "pending", "dependencies": ["node_test"] }
  },
  "lock": {                           // ★ 心跳锁，替代静态 .lock，支持僵尸检测
    "pid": 4567,
    "heartbeatAt": 1781850400000
  }
}
```

### 4.6 记忆条目 `memory/entries.jsonl`

```jsonc
{
  "id": "mem-uuid",
  "type": "semantic",                 // semantic(知识) | episodic(经历)
  "scope": "project",                 // project | session:<name>
  "content": "本项目鉴权统一走 middleware/auth.ts",
  "sourceSessionId": "debug-auth",
  "createdAt": "2026-06-20T...",
  "embeddingRef": "index/xxx"         // 可选：上层检索器维护，存储层不解析
}
```

---

## 5. 逐一回答你的问题

### Q1：每个 Agent 是否应该有状态？整个 Session 是否也应该有状态？

**都应该有，且分两层——但都是事件流的派生，不是独立可写的本体。**

| 层级 | 持有什么状态 | 存在哪里 |
|------|-------------|---------|
| **Session 状态** | `activeAgent`、共享变量、整体 `status`、`latestSeq` | `checkpoint.sessionState`（缓存）+ 由 `events` 重建（真相） |
| **Agent 状态** | 自身 `status`、私有 scratchpad、`waitingFor`、局部变量 | `checkpoint.agentStates[id]`（缓存）+ 由 `events` 重建（真相） |

**为什么必须分两层（而非只有 Session 或只有 Agent）：**
- 只有 Session 状态 → 无法表达"Coder 在等、Tester 在跑"这种**并发异构**局面。
- 只有 Agent 状态 → 无法表达"现在控制权在谁手里""共享变量是什么"这种**全局协调**信息。
- 多 Agent 协作的本质就是**多个有独立状态的实体共享一个全局状态**——黑板模式的标准结构。

**关键纪律：** 这些状态**不允许**有独立的 `agent-coder.state.json` 之类的可写文件。任何状态变更必须先 append 一条带 `stateMutations` 的事件到 `events.jsonl`，引擎据此更新内存状态，再周期性物化进 checkpoint。**这保证了崩溃后状态永远能重建，永不丢失或撕裂。**

### Q2：LLM chat 是否应该保存方便直接使用（save），还是 recall（按需重建）？

**两者都要，分工明确——这是"性能"与"正确性"的经典权衡：**

| 方案 | 角色 | 落点 |
|------|------|------|
| **Recall（重建）** | **正确性兜底** | 从 `events.jsonl` 按 `visibility`/`to`/`agentId` 过滤 + 组装出某 Agent 当前应见的上下文。永远可行，永远正确。 |
| **Save（保存可直接用）** | **性能优化** | checkpoint 的 `materializedContext` 缓存"已组装好的上下文"的元信息（token 数、事件范围引用）。 |

**为什么不直接内联保存完整 chat 数组？**
1. **避免双份真相**：若 checkpoint 内联完整 messages，它就和 `events.jsonl` 形成两份可能不一致的数据，违背 SSOT。
2. **上下文是有策略的派生物**：不同 Agent 看到的上下文不同（私有 vs 公开过滤）；长对话需要压缩/裁剪/RAG 注入——这些**策略属于引擎**，会随版本演进。把组装结果硬编码进存储会绑死策略。
3. **`materializedContext` 用 `ref` 而非内联**：缓存"组装这段上下文需要哪些事件 + 大概多少 token"，恢复时引擎据此快速重组。命中则快，未命中则 recall——快慢双通道。

**结论：以 recall 为正确性基础，以 save（轻量元信息缓存）为性能加速。绝不内联完整 chat 作为第二份真相。**

### Q3：不同 Agent 互相通信——一个 Agent 等待另一个，如何表示？如何唤醒？

**核心思想：等待是磁盘上的一个状态，不是进程里的一次阻塞。唤醒靠匹配事件，不靠回调/锁。**

**① 发起请求（Coder 请 Tester 做事）：**

```jsonc
{ "seq": 50, "type": "request", "from": "agent-coder", "to": "agent-tester",
  "correlationId": "req-xyz",                    // ★ 配对凭证
  "payload": { "ask": "测试 /api/login，返回结果" },
  "stateMutations": [
    { "op": "set", "scope": "agent:agent-coder", "key": "status", "value": "waiting" },
    { "op": "set", "scope": "agent:agent-coder", "key": "waitingFor", "value": ["req-xyz"] }
  ]}
```

写完这条事件后，**Coder 不占用任何进程/线程**——它的状态机停在 `waiting`，调度器不再 tick 它。这点至关重要：等待的 Agent 不消耗运行时资源，即使整个进程退出，重启后从 checkpoint 读到 `status:waiting` 依然知道它在等什么。

**② Tester 被调度执行，完成后应答：**

```jsonc
{ "seq": 56, "type": "response", "from": "agent-tester", "to": "agent-coder",
  "correlationId": "req-xyz",                    // ★ 回填同一 correlationId
  "payload": { "result": "2 passed, 0 failed", "status": "success" } }
```

**③ 唤醒机制（事件驱动，无回调）：**

引擎主循环每次读到新事件就跑一次"唤醒检查"：

```
对每个 status=="waiting" 的 agent:
    若其 waitingFor 中的 correlationId 都已出现对应的 response/timeout 事件:
        → append 一条 state-mutation: status: "runnable", 清空 waitingFor
        → 调度器下一 tick 即可执行该 agent（它能从 events 读到 response 结果）
```

**④ 高级场景天然支持：**

| 场景 | 表示 |
|------|------|
| **Fan-out / Join**（等多个 Agent 全回来） | `waitingFor: ["req-a", "req-b", "req-c"]`，全部 response 齐了才转 `runnable` |
| **超时** | 引擎为 request 注册 deadline；到点注入 `type:"timeout"` 事件，同样能触发唤醒（唤醒后 Agent 自行决定重试或放弃） |
| **死等检测** | 调度器若发现所有 Agent 都 `waiting` 且无任何 pending request 能产生 response → 死锁，注入 `timeout`/`error` 打破 |
| **崩溃恢复** | 重启读 checkpoint，`waiting` 的 Agent 状态原样恢复；引擎扫一遍 `events` 看 `correlationId` 是否已应答，决定是继续等还是立即唤醒 |

**为什么不用进程内 Promise/await 或文件锁？**
- 进程内阻塞 → 进程一挂，等待状态全丢，无法恢复。
- 文件锁 → 只能表达互斥，无法表达"在等什么、等谁、等几个"。
- **事件 + correlationId + 磁盘状态**才能做到：可恢复、可观测、可超时、可 fan-out。这是 Temporal/LangGraph 等成熟框架的共同选择。

### Q4：`events.jsonl` 说"含黑板"，那黑板在哪里？

**黑板不是一个文件，而是 `events.jsonl` 的一个视图（view）。** 这正是合并两份设计后消除"双写不一致"的关键决策。

```
黑板（Blackboard）= SELECT * FROM events WHERE visibility = "public"

定向私信         = visibility:"private"，仅 from/to 可见
某 Agent 的视野   = 黑板(public) ∪ 与我相关的 private(from==我 OR to==我)
```

**为什么不把黑板做成独立的 `blackboard.jsonl`（第二份的做法）？**
1. **双写问题**：若黑板和私有日志是两个文件，一条 handoff 既要上黑板又涉及具体 Agent，就得同时写两处，崩溃在中间会撕裂——违背 SSOT。
2. **顺序问题**：黑板消息和私有思考的**全局时序**必须一致（谁先谁后影响因果），分文件后需要额外的全局时钟来对齐 `seq`，徒增复杂度。
3. **过滤即视图**：合并成一条流后，"黑板"只是一个 `visibility=="public"` 的过滤投影；`agents/<id>.jsonl` 也只是 `visibility=="private" && involves(id)` 的投影缓存。**真相只有一份。**

**所以：**
- 想看黑板 → 过滤 `events.jsonl` 的 public 事件。
- 想看某 Agent 私有思考 → 读 `agents/<id>.jsonl`（它是 events 的投影，丢了能重建）。
- 写入永远只写 `events.jsonl` 一处。

### Q5：`assets/` 放在总体（项目根）还是放进 `<session-name>/` 内？

**放进 `<session-name>/` 内（方案 B），不放项目根。** 这是对我上一版（assets 在项目根、与 sessions 平级）的修正。理由如下：

| 维度 | assets 在项目根（旧 A 方案） | **assets 在 session 内（B 方案，推荐）** |
|------|---------|---------|
| **生命周期** | session 删了，要去另一个目录手动清 assets，易留**孤儿文件** | `rm -rf sessions/<name>/` 一次删干净，逻辑+资产同生共死 |
| **可移植性** | 导出/归档一个 session 要从两处捞 | 整个 `<name>/` 目录打包即完整可迁移 |
| **路径关联** | event 引用 assets 需写跨目录相对/绝对路径，脆弱 | event 引用 assets 只需 `assets/...` 这样的**会话内相对路径**，简洁稳定 |
| **gitignore** | 需匹配项目根下另一棵目录树 | 一行 `sessions/*/assets/` 通配全覆盖 |
| **并发清理** | 清理脚本要遍历两处、注意配对 | 单目录递归删除，无配对逻辑 |
| **远程化** | 需单独配置整棵 assets 树的后端 | 可逐 session 决定是否上传/归档，粒度更细 |

**唯一需要权衡的反方观点（已评估并接受）：**
- 反方认为"assets 在项目根可让多 session 共享同一份 file-history，省存储"。**但这恰恰是反模式**：不同 session 对同一文件可能有不同的修改版本链，共享会导致版本冲突和归属不清。文件快照本就该**归属产生它的 session**（按内容哈希去重可在后端层做，不需要在目录结构上耦合）。

**结论：高内聚优先于"理论上的存储复用"。** 一个 session 的逻辑（events/checkpoints）与资产（file-history/tool-cache/plans）放在同一目录下，做到：

```
sessions/<name>/        ← 这一个目录 = 一个 session 的全部，自包含
├── (逻辑：小，入 git)
└── assets/             ← (资产：大，gitignore)
```

> 注意：物理同目录 ≠ 逻辑耦合。`assets/` 子目录依然通过独立的 gitignore 规则和（可选的）独立存储后端实现"逻辑与资产解耦"——**目录是高内聚的，存储后端是可拆分的**，二者并不矛盾。这恰好同时满足了"高内聚生命周期管理"和"资产可远程化"两个目标。

---

## 6. 关键流程时序

### 6.1 写入路径（保证 SSOT，杜绝双写）

```text
引擎产生事件
   │
   ▼
[1] append events.jsonl    ← ★ 唯一同步必成功写点（O_APPEND + fsync）
   │                          真相在此落定，黑板/私信/状态变更全在这一行
   │
   ├─[2] 应用 stateMutations 到内存中的 Session/Agent 状态（纯内存，零落盘）
   │
   ├─[3] (异步/可选) 投影到 agents/<id>.jsonl   ← 失败可重建，不阻塞主流程
   │
   └─[4] (周期性/阈值触发) 物化 checkpoints/cp-{seq}.json
              ├─ 写 cp-{seq}.json.tmp → fsync → rename（原子）
              └─ 原子更新 latest 软引用
```

**唯一不变式：只有 [1] 是同步必成功的。[2][3][4] 全是派生，崩溃后皆可从 [1] 重建。**

### 6.2 恢复路径（快慢双通道，自愈）

```text
启动恢复 session <name>
   │
   ▼
读 checkpoints/latest
   │
   ├─ 命中且校验通过
   │     ├─ 加载 cp（拿到 sessionState / agentStates / pendingToolCalls）── 快
   │     ├─ 重放 (cp.atSeq, latestSeq] 区间的增量事件，补齐到最新
   │     ├─ 扫描 waiting 的 agent：检查 waitingFor 的 correlationId 是否已应答
   │     │     └─ 已应答 → 立即标记 runnable；未应答 → 维持 waiting
   │     └─ 就绪
   │
   └─ 缺失/损坏
         ├─ 从 events.jsonl 全量重放（慢，但永远可行）
         ├─ 逐条应用 stateMutations 重建全部状态
         └─ 重建完成后顺手生成新 checkpoint（★ 自愈：下次就快了）
```

> **设计哲学复述：Checkpoint 是优化不是依赖。删光 `checkpoints/`，系统仍 100% 正确运行，只是恢复变慢。这就是 Event Sourcing 的核心价值，也是为什么状态绝不能只存在 checkpoint 里。**

### 6.3 多 Agent 等待-唤醒（完整时序）

```text
T1  Coder: 写完接口，需要测试
       └─ append request(seq=50, to=tester, corrId=req-xyz)
          + mutation: coder.status=waiting, coder.waitingFor=[req-xyz]
       Coder 状态机停在 waiting，退出调度，零资源占用
   ─────────────────────────────────────────────
T2  调度器: 发现 tester 是 runnable，tick 它
       └─ Tester 从 events 读到 request(req-xyz)，执行 npm test
   ─────────────────────────────────────────────
T3  Tester: 测试完成
       └─ append response(seq=56, to=coder, corrId=req-xyz, result="2 passed")
          + mutation: tester.status=idle
   ─────────────────────────────────────────────
T4  引擎唤醒检查（每条新事件后跑）:
       └─ 发现 coder.waitingFor=[req-xyz] 已被 seq=56 的 response 满足
          └─ append state-mutation: coder.status=runnable, coder.waitingFor=[]
   ─────────────────────────────────────────────
T5  调度器: tick coder
       └─ Coder 从 events 读到 response(req-xyz) 的结果，继续工作
```

**若 T2~T3 之间进程崩溃：** 重启 → 恢复 → 读到 coder=waiting、events 中已有 seq=50 request 但无 req-xyz 的 response → 维持 waiting，重新调度 tester 继续 → 完全无缝。

---

## 7. 存储层 vs 引擎层的职责边界（设计宪法）

| 能力 | 归属 | 理由 |
|------|------|------|
| 事件追加、读取、按条件过滤、重放 | **存储层** | 持久化是天职 |
| Checkpoint 物化/加载/原子切换 | **存储层** | 派生缓存的生命周期管理 |
| `events → 状态` 重建（应用 stateMutations） | **引擎层**（存储提供原始事件流） | stateMutations 的语义解释属业务 |
| 唤醒检查、调度 tick、死锁检测 | **引擎层** | 编排是运行时逻辑 |
| 上下文组装/压缩/RAG 注入策略 | **引擎层** | 策略会随版本演进，不能固化进存储 |
| DAG 节点调度、重试、loop 熔断判定 | **引擎层** | 存储只持久化 graphState 结果 |
| Embedding 生成、向量检索 | **检索器层**（存储仅存 entries + index 文件） | 实现可替换 |
| 可见性裁决（谁能看哪条事件） | **引擎层**（存储仅记录 visibility 字段） | 策略与存储解耦 |
| 资产去重、远程上传 | **存储后端层**（可插拔） | 后端实现细节，不污染目录结构 |

> **任何新需求，先问一句：这是"事实的持久化"还是"逻辑的编排"？** 前者入存储，后者入引擎。这条准则贯穿全设计。

---

## 8. 一致性与并发要点

- **单写者原则**：每个 `events.jsonl` 同一时刻仅一个写者（该 session 的引擎进程）。多进程/多 session 协作通过 `workflows/runs/*.state.json` 的心跳锁协调，**绝不并发写同一事件日志**。
- **原子追加**：单条事件序列化后单次 `write`（含行尾 `\n`），配合 `O_APPEND`，保证多事件不交错。
- **截断容错**：读取时若最后一行 JSON 不完整（崩溃截断），丢弃该行，以倒数第二个完整事件为准——append-only 日志的标准容错。
- **checkpoint 原子切换**：`cp-{seq}.json.tmp` → `fsync` → `rename` 为正式名 → 原子更新 `latest`。任一步崩溃都不会留下半成品被误读。
- **僵尸进程检测**：`workflows/runs/*.state.json` 的 `lock.heartbeatAt` 超过阈值未更新 → 判定持锁进程已死，可被其他进程接管。

---

## 9. 五个问题的总结回答

| 问题 | 一句话答案 |
|------|-----------|
| **Agent 是否有状态？Session 是否有状态？** | 都有，分两层（Session 全局协调 + Agent 私有），但都是事件流的派生，不存独立可写本体。 |
| **LLM chat 应 save 还是 recall？** | 以 recall（从 events 重建）保证正确性，以轻量 save（checkpoint 缓存 token 元信息 + 事件范围引用）做性能加速；绝不内联完整 chat 作为第二份真相。 |
| **Agent 间等待如何表示/唤醒？** | 等待是磁盘上的 `status:waiting` + `waitingFor:[correlationId]` 状态；唤醒靠引擎匹配对应 `response`/`timeout` 事件后注入 `runnable` 状态变更——事件驱动，可恢复、可超时、可 fan-out。 |
| **黑板在哪里？** | 黑板不是文件，是 `events.jsonl` 中 `visibility:"public"` 的视图；合并成单一事件流以消除双写与时序不一致。 |
| **assets 放总体还是 session 内？** | 放 `sessions/<name>/assets/` 内（方案 B），生命周期高内聚、可整体迁移、一行 gitignore 覆盖；物理同目录不妨碍通过独立后端实现资产远程化。 |

---

## 10. 一句话收尾

> **整个 session 是一条事件流；Agent 是这条流上有独立状态的参与者；它们的对话、协作、等待、状态、上下文，全是同一条流的不同视图或派生缓存。** 存储层只需可靠地记下这条流，并能从任意点快速重建现场——其余的编排、调度、唤醒、组装，都交给引擎。

如需进入实现层，我可以接着产出：
1. **核心抽象的 TypeScript 接口**：`EventStore`、`CheckpointStore`、`StateProjector`（events→状态）、`AgentScheduler`（含唤醒逻辑）——体现依赖倒置；
2. **`stateMutations` 的 reducer 实现**：如何把事件流确定性地折叠（fold）成 Session/Agent 状态；
3. **等待-唤醒状态机的完整代码**：含 fan-out join、超时注入、死锁检测；
4. **Phase 1 最小可运行实现**：带原子追加与截断容错的 `events.jsonl` 读写器。
