
### VFS System

The VFS is a modular virtual filesystem with a clear layering:

```
IStorageBackend  (path-based: Memory / LocalFS / IndexedDB / SQLite+FS)
    ↕
VFSEngine  —  AccessController, EventBus, PluginPipeline, resolveStore/mapToSystemNode
    ↕
VFSManager (implements IVFSManager)  —  module lifecycle coordinator
    ↕
ModuleFS (implements IModuleFS + IFSDriver)  —  chroot-isolated view per module
    ├── driver: IFSDriver           — CRUD + transaction (self = this)
    ├── meta: IFSMetaDriver         — assets / tags
    └── openFile(nodeId) → IFile    — FileHandle / MDXFileHandle / ChatFileHandle
                                      └── asset(name) → AssetObj  (sub-files in assetdir)
```

**v4.1 存储层**: IStorageBackend 统一为 path-based 单一接口（`stat/list/read/write/mkdir/delete/rename/updateMetadata/setTags/getAllTags`）。废弃了 IInodeStore/IMetaStore/IContentStore 三层分离，废弃了 PathResolver/node-mapper/tree-ops。

**v4.1 文件层**: IFile 新增 `asset(name): AssetObj` 统一子文件操作。AssetObj 是 assetdir 内子文件的轻量句柄（read/readText/write/delete/exists）。eliminating the readInternal/writeInternal/putAsset/getAsset 的虚假区分。

All interfaces live in `packages/common/src/interfaces/fs/`. **Callers always type their VFS dependency as `IVFSManager`, `IModuleFS`, or `IFSDriver`** — never the concrete classes. Concrete wiring (`createVFS()`) happens only in `packages/app-shell/src/bootstrap.ts` (called by each app entry point).

Each **module** is a named namespace. A module's `IModuleFS` maps its `/` root to the system path `/module/<moduleName>/`. Modules correspond 1:1 with workspace tabs — defined in `apps/web-app/src/config/modules.ts` (`WORKSPACES` array) and auto-mounted at startup.

`createVFS({ rootBackend, modules })` → `{ manager: IVFSManager, config: IConfigService }`.

**Backup/restore/export/import** live on `vfs.maintenance.*` (a sub-service), not directly on `vfs`.

### IModuleFS — the UI/backend contract (v4.0)

`IModuleFS` is a **thin wrapper** — it does NOT duplicate `IFSDriver` CRUD methods. All file operations go through `fs.driver.*`, all metadata operations through `fs.meta.*`.

```ts
interface IModuleFS extends FSEventEmitter {
    readonly moduleId: string;
    readonly capabilities: FSCapabilities;
    readonly driver: IFSDriver;     // CRUD + links + transaction + search
    readonly meta: IFSMetaDriver;   // assets / tags / seq / refs / watcher
    openFile(nodeId: string): IFile;
    init(): Promise<void>;
    dispose?(): Promise<void>;
    // VFS-specific device ops (not in IFSDriver)
    openDevice?(idOrPath, options?): Promise<IDeviceHandle>;
    createDeviceFile?(name, parentIdOrPath, handlerId): Promise<FSNode>;
    ioctl?(idOrPath, command, arg?): Promise<unknown>;
}
```

Key interfaces consumed by UI:
- **`IModuleFS`** — module filesystem entry (driver + meta + openFile factory)
- **`IFSDriver`** — CRUD + search + events (used by file trees, editors)
- **`IFile`** — per-file handle (via `IModuleFS.openFile()`)

Three file handle implementations:
- **`FileHandle`** — base `IFile`, wraps `IModuleFS`
- **`MDXFileHandle`** — `IMDXFile extends IFile`, asset resolution
- **`ChatFileHandle`** — `IChatFile extends IFile`, message tree + branches

~~`VFSModuleEngine`~~ (deprecated v3.3) — `IVFSManager.getEngine(moduleName)` returns `IModuleFS` directly.

Services needing direct VFS access extend **`BaseModuleService`** (`packages/stdio/src/adapter-session/`) — provides `readJson`/`writeJson` (upsert semantics), `ensureDirectory`.

### Workspace Strategy Pattern (web-app)

```ts
interface WorkspaceStrategy {
    getFactory(): EditorFactory;
    getEngine(moduleName: string): IModuleFS;
}
```

Five strategies: `StandardWorkspaceStrategy` (MDxEditor + `IModuleFS`), `ChatWorkspaceStrategy` (`IChatEngine`), `AgentWorkspaceStrategy`, `SettingsWorkspaceStrategy` (custom `IModuleFS`), `SkillsWorkspaceStrategy` (custom `IModuleFS`). Adding a workspace = adding an entry to `WORKSPACES` in `apps/web-app/src/config/modules.ts`.

### LLM Engine Stack

```
device-llm  →  LLMConnection / streaming / MCP / multi-provider / Skill storage
llm-harness →  HarnessLoopExecutor (ILoop) + HarnessAgentTaskExecutor (TaskExecutor) + built-in tools + TTY device + Skill/Tool drivers
llm-runtime  →  SessionManager, ChatEngine (VFS persistence), TaskGraph reconciler, ILoop executors, Plugin system
llm-ui      →  Chat UI, Agent editor, SkillSettingsEditor, MCPSettingsEditor, TaskGraphWorkbench
```

`initializeLLMEngine(options)` in `packages/llm-runtime/src/index.ts` wires `VFSAgentService`, `ChatEngine`, `PromptHistoryService`, ExecutorRegistry, TaskGraph stores + reconciler + CommandBus, plugins, and returns `{ sessionManager, commandBus, taskGraph }`.

### App-Shell Bootstrap Sequence

`initApp()` in `packages/app-shell/src/bootstrap.ts` is the single top-level init function:

1. `createVFS({ rootBackend, modules })` — one VFS module per workspace
2. `new LLMDeviceDriver(vfs)` → `init()` → `vfs.devices.register()` → `createDeviceNodes()`
3. `createSettingsModule(vfs)`, `new VFSAgentService(vfs, llmDriver)`, `new ChatEngine(vfs)`
4. `createHarness({ llmDriver })` — assembles the multi-round agent loop
5. `harness.toolDriver.setVFSContext(createVFSToolContext(vfs))` — browser VFS bridge for file tools
6. `syncSkillsToHarness(llmDriver, harness)` — syncs VFS-persisted `LLMSkill` → harness `SkillDefinition`; watches `llmDriver.onChange()`
7. `initializeLLMEngine({ agentService, sessionEngine, llmService: harness.llmService, ... })` → `{ sessionManager, commandBus, taskGraph }`
8. Workspace strategies wired; hash-based routing with lazy `MemoryManager` creation (one per workspace, cached)

### LLM Harness — Agent Loop Executor

`@itookit/llm-harness` implements the multi-round Agent loop with:

- **AgentLoopExecutor** — `while(true)` loop: budget check → context compress → LLM call → tool execution → back-pressure
- **Four-layer context compression** (HISTORY_SNIP / CACHE_PRUNE / LLM_SUMMARIZE / SLIDING_WINDOW)
- **Five-category error recovery** (rate-limit / context-too-large / overload / truncation / tool-error)
- **Built-in tools**: 通用工具来自 `@itookit/tools`；需要运行时服务的 Harness 能力位于 `@itookit/coreutils`
- **TTY tools** (when `NodeTTYDriver` is injected): `shell_session`, `tty_write`, `tty_close`

**Agent loop enhancements (Q1/Q2/Q3):**
- **Q1 Plan Confirm** — emits `agent:plan:confirm` before first tool-calling round; UI can approve/reject/redirect
- **Q2 Crash Recovery** — persists per-round session state to localStorage; `resumeSession()` reconstructs from snapshot
- **Q3 Mid-run Injection** — `agentRuntime.inject(message)` queues user instructions for the next loop iteration

**Unified execution via TaskGraph v3:**

All chat / loop / flow / mission / session-graph submissions compile to `TaskGraphRun` and execute through `TaskGraphReconciler` — the single control-plane writer.

| Submission | Compiled to |
|---|---|
| Chat / Loop | Single-node AgentTask Flow → TaskGraphRun |
| Flow (sendIntent) | Multi-node FlowRevision → TaskGraphRun |
| Mission | MissionPlan → TaskGraphRun (via MissionTaskGraphRunner) |
| Session Graph | Dependency tree → TaskGraphRun (via SessionTaskGraphRunner) |

`TaskRunner` delegates to `TaskGraphReconciler.run()` for all execution. For AgentTask nodes, `executeV3Agent()` drives the ILoop coroutine via `drive(gen, actor, ctx)`.

**Wiring:**
```ts
import { createHarness, NodeTTYDriver, NodeShellRunner } from '@itookit/llm-harness';

const harness = await createHarness({
    llmDriver,                          // IDeviceDriver from device-llm
    ttyDriver: new NodeTTYDriver(),     // optional: enables interactive shells
});
// harness.runtime  → IAgentRuntime
// harness.toolService / skillService / agentDriver / toolDriver / skillDriver
```

### TTY Device — Interactive Shell Sessions

**Why**: `shell_exec` ignores stdin; interactive tools (python REPL, psql, ssh, sudo) need bidirectional I/O. TTY device decouples execution from the interaction layer.

**Interfaces** (`packages/common/src/interfaces/tty/`):

| Interface | Role |
|---|---|
| `ITTYDriver` | Factory — spawns sessions. Different environments inject different drivers. |
| `ITTYSession` | Single live process with `write()`, `kill()`, `on('data'/'exit'/'error')` |
| `ITTYSessionManager` | Registry — `add/get/remove/abortAll` across agent rounds |

**Implementations** (`packages/llm-harness/src/tty/`):

| Class | Transport | `supportsPty` |
|---|---|---|
| `NodeTTYDriver` | `child_process.spawn` with pipes | `false` (Phase 1) |
| `NodePtyDriver` (future) | `node-pty` real PTY | `true` |
| `BrowserTTYDriver` (future) | WebSocket → remote exec server | — |

**TTY tools** (registered by `AgentDeviceDriver` when `setTTYDriver()` is called):

| Tool | sideEffect | Description |
|---|---|---|
| `shell_session` | local | Spawn a persistent shell; returns output until idle |
| `tty_write` | local | Write to stdin, collect response |
| `tty_close` | local | Kill process, remove session |

**Agent event flow:**
```
agent:tty:open  { sessionId, command, pid }
agent:tty:data  { sessionId, chunk }          ← real-time output
agent:tty:close { sessionId, exitCode, signal }
```
SessionActor bridges these to canonical `AgentEvent` (stream:content / tool:* / etc.) for UI rendering, with `SessionEventBus` routing events to the bound UI.

**Multi-round session example:**
```
Round 1: shell_session("python3")  → "[TTY tty_abc]\nPython 3.11 >>>\n[Waiting]"
Round 2: tty_write("import math\n") → ">>>"
Round 3: tty_write("print(math.pi)\n") → "3.14159...\n>>>"
Round 4: tty_close("tty_abc")      → "Session closed"
```

**Platform injection pattern:**
```ts
// Node.js / Electron / CLI
new NodeTTYDriver()                    // child_process pipes

// Future Tauri
new TauriShellRunner()                 // @tauri-apps/plugin-shell

// Browser (no ttyDriver)
createHarness({ llmDriver })           // TTY tools not registered; graceful degradation
```

**Upgrade to real PTY (Phase 2):** Replace `NodeTTYDriver` internals with `node-pty`. Interface unchanged — only the driver class changes.

### Skill System

**Two layers:**
- `LLMSkill` (stored by `device-llm`, VFS `__config:/llm/.skills/`) — flat JSON config, types: `prompt | http | shell | mcp | custom`
- `SkillDefinition` (managed by `llm-harness/SkillDeviceDriver`, harness 内存) — richer: `instructions`, `tools[]`, `triggerPatterns`, `autoLoad`

`syncSkillsToHarness()` 在启动和每次 `llmDriver.onChange()` 时将 `LLMSkill` 同步为 `SkillDefinition`（包含 disabled 技能，enabled 状态随之同步）。

**Skill types:**

| Type | Execution | System Prompt 注入方式 |
|---|---|---|
| `prompt` | 直接注入 `instructions`，无工具 | **P3 自动注入**（无需 load_skill） |
| `shell` | `spawn('sh', ['-c', command])` with `{{arg}}` template | P4 描述 → `load_skill` → 工具注册 |
| `http` | `fetch(endpoint, { body: JSON.stringify(args) })` | P4 描述 → `load_skill` → 工具注册 |
| `mcp` | MCP protocol via `_activeMCPConns` in `LLMDeviceDriver` | P4 描述 → `load_skill` |
| `builtin` | References already-registered tools | P4 描述 → `load_skill` |

**System Prompt 优先级分层（仅 harness 路径）：**

| 优先级 | 内容 | 来源 |
|---|---|---|
| P0 | agent 自定义 systemPrompt（有则用）或 core identity | `memoryContent` \| `buildCoreIdentity()` |
| P1 | 环境信息（OS / CWD / Time / Node） | `buildEnvironment()` |
| P2 | 已显式加载技能的完整 `instructions` | `loadedSkillIds` ∩ `enabled` |
| P3 | `prompt` 型 enabled 技能的完整 `instructions` | 无需 load_skill，按类型自动注入 |
| P4 | `http/shell/mcp/builtin` 型 enabled 技能的 id + description | 渐进式披露，待 function-calling 恢复后由 LLM 调 `load_skill` |

**chat / lite loop 路径**：不含 skill 注入，system prompt 仅含 agent 定义的 `systemPrompt`。

**harness loop 路径**：skill 注入由 harness `ContextManager.buildSystemPrompt()` 负责（P2/P3/P4）。

预算门控：`systemPromptBudgetTokens = 4000`，P0 始终通过，其余按 `length/4` 估算超出则丢弃。

**Skill 注入归属：`ContextManager` 独占，`AgentResolver` 不注入**

`AgentResolver.resolve()` 只负责解析 agent 配置（connection、model、systemPrompt），不注入任何 skill。skill 注入完全由 harness `ContextManager.buildSystemPrompt()` 负责。

**`enabled` 保护机制（多层）：**
- **P2**：`s.loadedSkillIds.includes(sk.id) && sk.enabled` — 已加载但后来被禁用的技能立即排除
- **P3**：`sk.enabled && sk.type === 'prompt'` — 仅注入已启用的 prompt 型技能
- **P4**：`sk.enabled && sk.type !== 'prompt'` — 仅列出已启用的工具型技能
- **`loadSkill()`**：`!skill.enabled` → `{ success: false, error: 'Skill is disabled' }` 硬拒
- **Slash command popup**：`buildSkillCommands()` 过滤 `s.enabled`，禁用技能不出现在输入提示中

**`autoLoad` 处理：**
`autoDetectAndLoadSkills()` 在每个 session 初始化时：
1. 先加载所有 `autoLoad: true && enabled` 技能（标记进 `loadedSkillIds`）
2. 再加载 `triggerPatterns` 匹配当前 prompt 的技能

**`effectiveTools` 已知限制（`agent-loop-executor.ts:175`）：**
当前 `effectiveTools = undefined`（临时禁用 function-calling，原因：部分代理端点在接收工具 schema 时返回 500）。这意味着：
- LLM 不会收到工具 schema，不会产生 `tool_calls`
- Agent loop 始终走单轮文本输出路径
- P4 的 `load_skill` 列表暂时无法被 LLM 主动触发
- P2/P3 直接注入的 skill instructions 仍然有效（LLM 读取后改变行为）
- 待端点工具调用支持确认后，将 `effectiveTools = toolDefs` 恢复即可，其余逻辑无需改动

**Chat input invocation syntax:** `/sk-<id> [--key val]* [[file](path)]* [@glob]* [text]`
- 静态命令 `/skill <id>` — 只加载技能，不发送消息给 LLM
- 动态命令 `/sk-<id> [args]` — 加载技能 + 构建结构化 prompt → `TaskRunner` 作为 flow 任务提交
- File paths from `[name](path)` (MentionPlugin) → read by `AttachmentProcessor`
- Glob patterns `@*.ts` → expanded via `sessionEngine.search()`
- Shell skills check `{{arg}}` placeholders, show wizard if missing

**Seed skills** in `doc/skills/` — import via Settings → Skills → 📂.

### Mission Orchestration System

`packages/llm-runtime/src/mission/` — multi-agent task decomposition, scheduling, and verification.

**Design principle:** LLM handles intent (plan/execute/verify); deterministic `MissionTaskGraphRunner` handles dispatch via TaskGraph.

**Core types** (`packages/common/src/interfaces/llm/mission.ts`):
- `MissionPlan` — VFS-persisted `plan.json`; contains goal + `TodoItem[]` dependency graph + agent pool config
- `TodoItem` — has `dependsOn[]`, `parallel` flag, agent assignment, retry tracking, HITL state
- `HITLRequest` / `IHITLQueue` — human-in-the-loop blocking queue

**Key components:**

| File | Role |
|---|---|
| `mission-service.ts` | Public facade — runs parallel LLM planners, merges `TodoItem[]`, kicks off TaskGraph run |
| `mission-task-graph-runner.ts` | Compiles MissionPlan → TaskGraphRun, delegates to `TaskGraphReconciler` |
| `todo-state.ts` | `TodoStateManager` — atomic read/write of `plan.json` in VFS `missions` module |
| `result-persister.ts` | Saves executor results and summaries to VFS; appends to `journal.md` |

**Execution flow:**
```
MissionService.createMission(goal)
  → parallel LLM planners → merge TodoItem[]
  → TodoStateManager.createMission() → write plan.json to VFS
  → MissionTaskGraphRunner.execute()
      → compile MissionPlan → TaskGraphRun (AgentTask per TodoItem)
      → TaskGraphReconciler.run() → schedule + execute + verify + HITL
```

**VFS layout:** `missions` module — `plan.json` + `results/<todoId>.md` + `journal.md`

### Session Dependency Graph

`packages/llm-runtime/src/session-graph/` — file-based cross-session dependency execution.

Each VFS file is a "session" whose content is the agent task prompt. Dependencies are declared in `_filename/session-meta.json`. `SessionTaskGraphRunner` projects the dependency tree into a TaskGraphRun, executed by `TaskGraphReconciler`.

**Key components:**

| File | Role |
|---|---|
| `session-task-graph-runner.ts` | `SessionTaskGraphRunner` — projects dependency tree into TaskGraphRun |
| `session-meta-store.ts` | `SessionMetaStore` — read/write `session-meta.json` and `result.md` in each file's assetdir |
| `session-flow-factory.ts` | `createSessionFlow` + `resolveDependencyTree` — topo-sort + cycle detection |
| `types.ts` | `SessionMeta`, `SessionType`, `SessionStatus`, `GraphExecutionOptions` |

Execution delegates to `TaskGraphReconciler` for scheduling, retry, and verification.

**`session-meta.json` location:** `_<filename>/session-meta.json` (assetdir of the owner file)

## Harness & Agent 设计参考（开发维护）

### Tool Model — ToolMeta 与执行规则

每个工具由三部分组成：`ToolMeta`（注册元信息）、`ToolDefinition`（LLM 函数 schema）、`ToolHandler`（执行函数）。

```typescript
interface ToolMeta {
    id: string                               // 工具名，需与 ToolDefinition.name 一致
    sideEffect: 'none' | 'local' | 'external'  // ← 驱动并行策略和权限检查
    timeoutMs: number
    type: 'builtin' | 'plugin' | 'mcp'
    enabled: boolean
    skillLoaderArgKey?: string               // 若设置，成功时 executor 自动标记 skill 已加载
}

type ToolHandler = (
    args: Record<string, unknown>,
    context: ToolExecutionContext            // { cwd, signal, timeoutMs, vfs? }
) => Promise<string>                         // 必须返回字符串；异常必须内部捕获
```

**`sideEffect` 的影响：**

| sideEffect | 执行方式 | 权限检查 |
|---|---|---|
| `'none'` | 并行执行（`Promise.all`） | 无 |
| `'local'` | 串行执行（`for` 循环） | 拦截 `agent:permission:request` |
| `'external'` | 串行执行 | 拦截 `agent:permission:request` |

**重要设计**：`effectiveTools = undefined`（`agent-loop-executor.ts:175`）—— 工具定义**不**通过 function-calling schema 传给 LLM，而是由 Skill `instructions` 注入 system prompt。这是为了避免代理端点 500 错误。若 LLM 仍返回 `tool_calls`（如本地模型），结果会被静默丢弃。

**ToolHandler 契约**：所有异常必须在 handler 内部 `try/catch` 并返回错误字符串。Handler 不得抛出异常——agent loop 依赖工具永不崩溃。

### Agent Loop 逐步流程

`AgentLoopExecutor.run()` 每次迭代：

```
1. Flush pending injections（inject() 注入的 user message）
2. Budget Check（超任意维度 → BudgetExhaustedError → status:'partial'）
3. Context Compress（ratio ≥ compressionThreshold=0.75 时触发）
4. Build messages（system prompt + history + compressionSummary 前置）
5. LLM Call via ErrorRecoveryService.callWithRecovery()
6. Update usage（含 tool call 计数）

分支 A — 有 tool_calls：
  → Plan Confirm（enablePlanConfirm && roundNumber===1）
      → intercept 'agent:plan:confirm'
      → false → cancel；string → inject "[Plan adjustment]..." 重规划；true → 继续
  → Permission Check（sideEffect !== 'none' → intercept 'agent:permission:request'）
      → false → tool 收到 "Permission denied" 字符串
  → 读操作并行（sideEffect=none，Promise.all）
  → 写操作串行（sideEffect≠none，for 循环，逐个 permission check）
  → After-tool Back-pressure check
  → emit 'agent:step:complete'
  → GOTO 1

分支 B — 无 tool_calls：
  → Before-final Back-pressure check
  → 通过 → 设置 finalResponse，break
  → 失败 → inject 修正指令 → GOTO 1
```

### Context 压缩 — 4 层渐进策略

| 层 | 阈值 | 名称 | 操作 |
|---|---|---|---|
| L1 | ≥ 0.70 | `history_snip` | 截断 >2000 chars 的消息：保留头 30 行 + 尾 10 行，插入 `[... N lines snipped ...]` |
| L2 | ≥ 0.80 | `cache_prune` | 移除旧 assistant 消息（保留最后 10 条"安全区" + 含 tool_calls 或 >400 chars 的消息） |
| L3 | ≥ 0.85 | `llm_summarize` | 取前 60% 消息调 LLM 摘要（≤1024 tokens），失败则 regex 提取。摘要存 `compressionSummary`，保留后 40% |
| L4 | ≥ 0.95 | `sliding_window` | 只保留最后 6 条消息（`SLIDING_WINDOW_SIZE=6`），追加截断提示 |

Token 估算：`Math.ceil(charLength / 4)`（`CHARS_PER_TOKEN = 4`，非精确 tokenizer）。

System prompt 预算：`systemPromptBudgetTokens = 4000`，超出优先级低的 section 被丢弃（优先级 0 始终保留）。

### Error Recovery — 5 类错误处理

| 类别 | 检测条件 | 处理策略 |
|---|---|---|
| Rate Limit | HTTP 429 | 指数退避：`baseDelayMs * 2^(n-1)`，最多 `maxApiRetries=5` 次 |
| Context Too Large | HTTP 413 | 调 `onCompressionNeeded()`（强制 L3 压缩），然后重试 |
| Service Overload | HTTP 529 | 切换到 `fallbackConnectionId`（一次性），后续请求用 fallback |
| Output Truncated | `finish_reason === 'length'` | 无延迟重试，最多 `maxTruncationRetries=3`，耗尽后接受截断响应 |
| Other Errors | 其余 | 立即 re-throw |

Fallback 一旦激活（`fallbackActive=true`）持续生效；调 `resetFallback()` 可恢复主连接。

### Budget Controller — 6 维度

| 维度 | 配置字段 | 默认上限 |
|---|---|---|
| 轮次 | `maxRounds` | 100 |
| 输入 Token | `maxInputTokens` | 5,000,000 |
| 输出 Token | `maxOutputTokens` | 1,000,000 |
| 费用 | `maxCostUsd` | $10.00 |
| 时长 | `maxDurationMs` | 3,600,000（1h） |
| 工具调用次数 | `maxToolCalls` | 500 |

`WARN_THRESHOLD = 0.8` — 任意维度达到 80% 时，每次循环前 emit `agent:budget:warning`。

Token 定价：默认 `$0.000003/输入` + `$0.000015/输出`（Sonnet 级别）。由 `AgentDeviceDriver.init()` 从连接元数据覆盖。

### Back-Pressure

```typescript
interface BackPressureRule {
    name: string
    afterTools: string[]    // 触发此规则的工具名列表
    command: string         // shell 命令；exit 0 = 通过
    timeoutMs: number
    onlyOnFinal: boolean    // true = 只在分支B（无 tool_calls）前执行
}
```

- `checkAfterTool(toolName, cwd)` — 运行 `!onlyOnFinal` 的匹配规则
- `checkBeforeFinal(cwd)` — 运行 `onlyOnFinal === true` 的规则
- 浏览器安全：`child_process` 动态 import 失败时所有规则直接通过

### Sub-Agent Router — 上下文防火墙

```typescript
SubAgentRouter.delegate(task: SubAgentTask): Promise<SubAgentResult>
```

- 默认允许工具：`['file_read', 'glob_search', 'grep_search']`（只读）
- 默认最大轮次：`DEFAULT_MAX_TURNS = 10`
- 独立消息历史——不继承父 agent 上下文，不污染父 context window
- 可通过 `task.allowedTools` 覆盖许可工具列表
- 不在许可列表的工具返回 `'Error: tool not allowed in sub-agent context'`

### Agent Events — Canonical Types

Canonical `AgentEvent` 定义在 `common/src/interfaces/agent/agent-event.ts`（15 变体）：

```
// 流式内容
stream:content  stream:thinking

// 轮次边界
round:start  round:end

// 工具执行
tool:queued  tool:running  tool:success  tool:error

// 任务生命周期
finished  error

// HITL 暂停
await_signal
```

Harness 内部的旧事件（`agent:task:start`、`agent:llm:start`、`agent:budget:warning` 等）在 `IAgentRuntime` 的 `on()` 接口上仍然可用，但 ILoop 协程只 yield canonical `AgentEvent`。

### SessionActor — 事件桥接

`SessionActor`（`llm-runtime/src/core/session-actor.ts`）将 ILoop 协程产出的 canonical `AgentEvent` 桥接至 `SessionEventBus`：

| ILoop yield | SessionEvent / UI 效果 |
|---|---|
| `stream:content` | `message:updated` field=`output`（增量渲染） |
| `stream:thinking` | `message:updated` field=`thought` |
| `tool:queued` / `tool:running` | 创建 tool 子节点 |
| `tool:success` / `tool:error` | 更新 tool 子节点状态 |
| `round:start` / `round:end` | 轮次边界标记 |
| `finished` | 会话完成，汇总 token 用量 |
| `error` | 错误展示 |
| `await_signal` | 暂停等待用户输入（HITL / plan confirm） |

事件统一为 `SessionEvent`（canonical `AgentEvent` | `MessageProjectionEvent` | `SessionStructuralEvent`）。

### 扩展点 Recipes

#### 添加新 Built-in Tool

通用工具（无运行时服务依赖）→ 加入 `@itookit/tools`（见 `packages/tools/CLAUDE.md`）：

1. 在 `packages/tools/src/tools/MyTool/` 下创建 `prompt.ts` + `MyToolTool.ts`
2. 使用 `buildTool(def)` 实现，在 `packages/tools/src/index.ts` 的 `BUILTIN_TOOLS` 注册

Harness 能力工具（需 `ISkillService` 等运行时引用）→ 放在 `coreutils`：

```typescript
// packages/coreutils/src/tool/my-tool.ts
export const myToolMeta: ToolMeta = {
    id: 'my_tool',
    sideEffect: 'local',
    timeoutMs: 30_000,
    type: 'builtin',
    enabled: true,
};
export const myToolDefinition: ToolDefinition = { /* LLM function schema */ };
export const myToolHandler: ToolHandler = async (args, ctx) => {
    try {
        return 'result string';
    } catch (e) {
        return `Error: ${e instanceof Error ? e.message : String(e)}`;
    }
};
```

#### 添加新 Skill 类型（用户侧）

- **prompt 型**：`instructions` markdown + `tools: []` — **P3 自动注入**，无需 `load_skill`，即写即用
  - 适合：编码规范、领域知识、审查规则等纯指令类 skill
  - `autoLoad: true` 可在 session 初始化时立即进入 `loadedSkillIds`（走 P2）
- **http 型**：添加 `endpoint`, `method`, `headers`, `parameters`；`SkillToolBinding.executionType = 'http'`
  - LLM 需显式调用 `load_skill` 才能注册工具
- **shell 型**：`SkillToolBinding.executionType = 'shell'`，`command` 用 `{{argName}}` 模板
  - 同上，需 `load_skill` 触发 `registerShellTool()`

`SkillDeviceDriver.loadSkill()` 自动处理 http/shell 工具注册（幂等）。用户 skill 通过 `LLMDeviceDriver` 写入 VFS，`syncSkillsToHarness()` 同步到 harness（包含 `enabled` 状态）。

#### 扩展 Agent Loop

- 新 ILoop executor：实现 `ILoop` 接口，通过 `ExecutorRegistry.register()` 注册。详见 `packages/llm-runtime/CLAUDE.md`
- 新 ILoopMiddleware：实现 `ILoopMiddleware` 接口（`beforeExchange`/`afterExchange`/`onToolCalls`/`onError`），通过 `createLoopExecutor(preset, config, harness)` 注入。详见 `packages/llm-runtime/src/core/middleware-pipeline.ts`
- 新 TaskGraph TaskKind：实现 `TaskExecutor` 接口，注册到 `HarnessContributionRegistry`。内置 7 种（agent/route/transform/reduce/human/spawn/subflow），详见 `packages/llm-runtime/src/task-graph/builtins.ts`
- 新 Plugin：实现 `ILLMPlugin`，通过 `ExtensionRegistry.register()` 注册。内置 3 个（session/vcs/history），详见 `packages/llm-runtime/src/plugins/`
- 新 back-pressure 规则：`agentDriver.setLoopConfig({ backPressureRules: [...existing, newRule] })`
- Mid-run 注入：`runtime.inject(message)` — 下次循环迭代开始时作为 `role:'user'` 消息插入

#### Per-task 参数覆盖

```typescript
// 在 AgentTaskRequest 中
{
    prompt: '...',
    budgetOverride: { maxRounds: 20, maxCostUsd: 2 },  // 覆盖全局 budget
    modelOverride: 'my-connection-id',                   // 覆盖连接
    modelIdOverride: 'claude-opus-4-5',                  // 覆盖模型 ID
    systemPromptOverride: '...',                          // 替换 identity section
    workingDirectory: '/path/to/cwd',                    // shell 工具工作目录
}
```

### Chat Persistence Format

Each `.chat` file is a `ChatManifest` JSON with a named-branch message graph: `branches: Record<branchName, headNodeId>`. Individual messages are stored as `/.{sessionId}/.{nodeId}.json` (hidden dirs inside the chat module).

### FSNode Types

Discriminated union: `FSNode = FSFileNode | FSDirectoryNode | FSSeqFileNode | FSDeviceNode | FSSymlinkNode` — all fields `readonly`. `FSFileNode` carries `size` and `assetDirId`; others do not. Type-narrow before accessing type-specific fields.

### Event System

`IModuleFS` extends `FSEventEmitter` — `on(eventType, callback): () => void` returns an unsubscriber. `IVFSManager` has typed `on<E extends VFSManagerEventType>(...)` for `node:created`, `node:updated`, `node:deleted`, `module:mounted`, `module:unmounted`. Note: `node:deleted` payload has `nodeIds[]` + `moduleId` but **no `path`** field.

## VFS Path Naming Conventions

### Module isolation

Each **module** is a chroot-isolated namespace. A module's `/` maps to `/module/<name>/` in the system tree. Paths passed to `IModuleFS` are always module-relative (start with `/`). Modules never see each other's files directly — cross-module access goes through `IVFSManager`.

### File/directory name prefixes

Four categories, enforced by `validateFilename` + `AccessController`:

| Prefix | Example | Who creates | Default listing | Sync | Notes |
|---|---|---|---|---|---|
| `name` | `notes.md`, `folder/` | user | ✅ visible | ✅ | Normal files |
| `.name` | `.connections/`, `.nodeId.json` | `isSystem` modules only | ❌ hidden | ❌ | Access-controlled by `AccessController`; non-system modules get EACCES |
| `_name/` | `_note.md/` | stdio (auto) | ❌ hidden | ✅ | **Assetdir** — companion dir for `note.md`; lifecycle coupled to owner (auto-renamed/moved/deleted) |
| `__config/` | `__config/history.yaml` | any module code | ❌ hidden | ✅ | **Module-internal config dir** — one per module, no access restriction, files inside use plain names |

**`validateFilename` rules** (`DEFAULT_FILENAME_PATTERN = /^(?!_(?!_))[^/\\][^/\\]*$/`)**:**
- Single `_` prefix → **blocked** (assetdirs are created by stdio internals, not user code)
- Double `__` prefix → **allowed** (`__config/` is the only conventional use)
- `.` prefix → allowed by `validateFilename`, restricted by `AccessController`

### Assetdir details

`_note.md/` is the assetdir for `note.md` — same parent directory, `_` + owner filename. Managed exclusively by `IAssetOperations` (`putAsset`, `getAsset`, etc.). The engine auto-renames/moves/deletes the assetdir when the owner file changes. Never create or rename assetdirs manually.

### `__config/` — module-internal config

Each module may have one `__config/` subdirectory for private metadata (history, caches, internal state). Files inside use **plain names** — no prefix needed:

```
chats/__config/history.yaml     ← prompt history
notes/__config/index.json       ← module-level index
```

`__config/` is accessible to any code (no `isSystem` requirement), excluded from default `getChildren` listings, and included in sync. It is NOT the same as the global `etc` module.

### Module-level system flag

Modules mounted with `isSystem: true` (e.g., `etc`, device modules):
- Can write `.` prefix paths (bypasses `AccessController`)
- Are **excluded from sync** entirely

User workspace modules (no `isSystem`) are synced in full, including their `__config/` dirs and assetdirs.

### `getChildren` options (all default `false`)

```ts
fs.getChildren(path, {
  includeHidden: true,       // include '.' prefix entries
  includeAssetDirs: true,    // include '_' prefix entries (single _ only)
  includeInternalDirs: true, // include '__config/' and other '__' prefix dirs
})
```

Used by: sync walker (all three `true`), `SystemFSExploreEditor` (all three `true`), normal UI (all `false`).

### System root directories

Bootstrap creates `/etc/`, `/dev/`, `/module/` at VFS root. Modules live under `/module/<name>/`. The `etc` module (`CONFIG_MODULE`) stores global config and is auto-mounted at init.

## i18n & Icon Conventions

### 原则：零硬编码字符串和 emoji

所有 UI 文本和图标**必须**通过统一模块管理，**禁止**在组件代码中直接写中文、英文 UI 字符串或 emoji。

### 图标

从 `@itookit/common` 导入，禁止硬编码 emoji：

```ts
import { SKILL_TYPE_META, MCP_TRANSPORT_ICONS, STATUS_META,
         ENTITY_ICONS, ACTION_ICONS, FEEDBACK_ICONS, AGENT_ICON_PALETTE,
         getFileIcon } from '@itookit/common';

// ✅ 正确
const icon = ENTITY_ICONS.skill;         // '⚡'
const meta = SKILL_TYPE_META.prompt;     // { icon: '📝', color: '#10b981' }

// ❌ 禁止
const icon = '⚡';
```

图标定义位置：`packages/common/src/i18n/icons.ts`

### 字符串本地化

使用 `t()` 函数，键名从 `zh-CN.ts` 中取：

```ts
import { t, setLocale } from '@itookit/common';

// 静态字符串
t('action.save')                          // '保存' / 'Save'

// 带插值
t('skill.toast.imported', { count: 3 })  // '已导入 3 个 Skill'
t('skill.import.readError', { filename }) // '{filename}: 读取失败'

// 切换语言（持久化由应用层负责）
setLocale('en');
```

字符串定义位置：
- `packages/common/src/i18n/zh-CN.ts` — 中文（主语言，key 的 source of truth）
- `packages/common/src/i18n/en.ts`    — 英文（必须保持与 zh-CN 完全一致的 key 集）

### 添加新字符串的工作流

1. 在 `zh-CN.ts` 添加新 key（按 domain 分组）
2. 在 `en.ts` 添加**相同 key** 的英文翻译（TypeScript 会静态检查 key 完整性）
3. 在组件中使用 `t('new.key')`
4. 禁止只加一个语言的 key

### 检查遗漏

```bash
# 找出组件中仍有硬编码中文的地方
python3 -c "
import re, sys
for path in sys.argv[1:]:
    with open(path) as f:
        for i, line in enumerate(f, 1):
            if re.search(r'[\u4e00-\u9fff]', line) and \"t('\" not in line and '//' not in line.strip():
                print(f'{path}:{i}: {line.rstrip()}')
" packages/llm-ui/src/editors/*.ts
```

### 语言切换（应用层职责）

`@itookit/common` 只提供 `setLocale(locale)` / `getLocale()`，不负责：
- 检测 `navigator.language`
- 持久化到 localStorage
- 提供设置 UI

这些由 `apps/web-app` 或 `app-settings` 在初始化时处理：

```ts
// apps/web-app/src/main.ts
import { setLocale } from '@itookit/common';
const saved = localStorage.getItem('locale') as 'zh-CN' | 'en' | null;
setLocale(saved ?? (navigator.language.startsWith('zh') ? 'zh-CN' : 'en'));
```

## Conventions

- **`vfs.write(moduleName, path, content)`** has upsert semantics — creates file and intermediate directories automatically. Prefer over check-then-create.
- **Avoid `exists` + `read` patterns** (TOCTOU) — just read and catch not-found errors.
- **Asset directories**: use `IAssetOperations.putAsset(ownerIdOrPath, filename, content)` — never create `_name/` dirs directly.
- **Module-internal data**: write to `/__config/<filename>` (plain filename, no `_` prefix). Any module can create `__config/` without `isSystem`.
- **`toBuffer(content)`** from `@itookit/stdio` converts `string | ArrayBuffer | Uint8Array → ArrayBuffer`.
- **`SubAgentRouter.delegate(task)`** — context firewall: creates a fresh LLM context with filtered tools, runs its own loop, returns only a summary. Used by Mission scheduler and `delegate_task` tool. Prevents context window pollution.
- **`etc` module** (`CONFIG_MODULE = 'etc'`) is auto-mounted at VFS init; stores LLM connections (`/llm/.connections/`), MCP configs (`/llm/.mcp/`), sync config, tags, contacts.
- **DB name** is `'MindOS-v3'` (IndexedDB). Older schemas (`'MindOS-v2'`, `'MindOS'`) are incompatible.
- **Sync** (`apps/sync-server`, SQLite + local files): system modules (`isSystem: true`) excluded; all other modules synced including `__config/` dirs, assetdirs, and hidden files.
