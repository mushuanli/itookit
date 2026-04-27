# MindOS v3.1 架构设计文档

## 1. 系统概览

MindOS 是一个基于 pnpm monorepo 的 AI 操作系统，以**虚拟文件系统（VFS）**为核心抽象，在其上构建 LLM 会话、Agent 调度、Mission 编排等能力。前端为纯浏览器 SPA，底层存储为 IndexedDB（浏览器）或 SQLite+FS（Node/Electron）。

### 1.1 核心理念

- **一切皆文件**：LLM 连接配置、Skill 定义、Chat 会话、Agent 定义均以文件形式存储在 VFS 中
- **模块隔离**：通过 chroot 机制实现模块间文件隔离，每个工作区对应一个 VFS 模块
- **分层解耦**：从存储后端 → VFS 引擎 → 服务层 → UI 适配层 → 编辑器工厂，层层接口抽象

### 1.2 技术栈

| 层 | 技术 |
|---|---|
| 构建工具 | pnpm workspace + tsup (逻辑包) / vite (UI 包) |
| 前端框架 | 原生 TypeScript + Web Components 风格 |
| 编辑器 | CodeMirror 6（Markdown 编辑） |
| 存储 | IndexedDB（浏览器）/ SQLite（Node/Electron） |
| LLM 通信 | fetch + SSE streaming |
| 类型系统 | TypeScript 严格模式 |

---

## 2. 包架构总览

```
packages/
├── common/            共享接口、类型、工具函数、i18n
├── vfslib/            VFS 引擎核心 + 适配器
├── vfsdriver-indexeddb/  IndexedDB 存储后端
├── vfsdriver-fs/      SQLite + 本地文件系统后端
├── vfs-ui/            文件树 UI 组件
├── device-llm/        LLM API 通信层（多 Provider）
├── llm-kernel/        执行引擎核心（Executor + Orchestrator）
├── llm-harness/       多轮 Agent 循环 + 内置工具 + Skill 系统
├── llm-engine/        会话管理 + VFS 持久化 + Mission 编排
├── llm-ui/            Chat UI 组件 + Agent/Skill 编辑器
├── mdxeditor/         CodeMirror 6 Markdown 编辑器
├── memory-manager/    工作区顶层容器
├── app-settings/      设置模块 + Skill 引擎
├── app-shell/         启动引导 + 路由 + 策略装配
└── apps/
    ├── web-app/       浏览器 SPA 入口
    └── sync-server/   Hono HTTP 同步服务器
```

### 2.1 包依赖关系（自底向上）

```
                    ┌──────────────────────────────────────┐
                    │          apps/web-app                │
                    │    (入口 + IndexedDB backend)         │
                    └──────────────┬───────────────────────┘
                                   │
                    ┌──────────────┴───────────────────────┐
                    │          app-shell                   │
                    │    (initApp 引导 + 策略装配)          │
                    └──────────────┬───────────────────────┘
                                   │
        ┌──────────────┬───────────┼───────────┬──────────────┐
        │              │           │           │              │
   memory-manager  llm-ui      vfs-ui    app-settings    mdxeditor
        │              │           │           │              │
        └──────────────┴───────────┼───────────┴──────────────┘
                                   │
        ┌──────────────────────────┼──────────────────────────┐
        │              │           │           │              │
   llm-engine     llm-harness   llm-kernel   device-llm   vfslib
        │              │           │           │              │
        └──────────────┴───────────┼───────────┴──────────────┘
                                   │
                    ┌──────────────┴───────────────┐
                    │           common             │
                    │   (接口 + 类型 + i18n + 工具)  │
                    └──────────────────────────────┘
```

---

## 3. VFS（虚拟文件系统）

### 3.1 分层架构

```
┌─────────────────────────────────────────────┐
│  ISessionEngine (UI 消费接口)                │
│  ├─ VFSModuleEngine    (文件工作区适配器)     │
│  └─ LLMSessionEngine   (Chat 会话适配器)     │
├─────────────────────────────────────────────┤
│  IVFSManager / IModuleFS (服务接口)          │
│  ├─ VFSManager          (模块生命周期)        │
│  ├─ ModuleFS            (chroot 文件操作)     │
│  └─ ConfigService       (配置读写)           │
├─────────────────────────────────────────────┤
│  VFSEngine (引擎核心)                        │
│  ├─ PathResolver        (路径解析)           │
│  ├─ AccessController    (访问控制)           │
│  ├─ EventBus            (事件总线)           │
│  ├─ PluginPipeline      (插件管线)           │
│  └─ DeviceRegistry      (设备注册表)         │
├─────────────────────────────────────────────┤
│  IStorageBackend (存储后端接口)               │
│  ├─ IndexedDBBackend    (浏览器)             │
│  └─ LocalFSBackend      (Node/Electron)      │
└─────────────────────────────────────────────┘
```

### 3.2 核心接口

#### IVFSManager — 系统级管理器

系统管理者和框架内部的接口，负责模块生命周期、跨模块协调和子服务入口。

```typescript
interface IVFSManager {
  // 生命周期
  initialize(): Promise<void>;
  dispose(): Promise<void>;

  // 子服务
  readonly mounts: IMountService;       // 挂载管理
  readonly devices: IDeviceManager;     // 设备管理
  readonly plugins: IPluginManager;     // 插件管理
  readonly maintenance: IMaintenanceService;  // 维护 (gc/fsck/backup)
  readonly sync: ISyncService | null;   // 同步服务 (可选)

  // 模块管理
  mount(moduleName: string, options?: ModuleMountOptions): Promise<void>;
  unmount(moduleName: string, removeData?: boolean): Promise<void>;
  getEngine(moduleName: string): IModuleFS;

  // 跨模块操作
  read(moduleName: string, path: string): Promise<FileContent>;
  write(moduleName: string, path: string, content: FileContent): Promise<void>;
  exists(moduleName: string, path: string): Promise<boolean>;
  search(query: VFSSearchQuery): Promise<FSSearchResult>;

  // 事件
  on(eventType, handler): () => void;
}
```

#### IModuleFS — 模块文件系统

面向模块/Agent 的唯一入口，已过 chroot 隔离。

```typescript
interface IModuleFS extends FSEventEmitter {
  readonly moduleId: string;
  readonly capabilities: FSCapabilities;

  // 可选能力子接口
  readonly assets?: IAssetOperations;   // 资产目录操作
  readonly tags?: ITagOperations;       // 标签操作
  readonly seq?: ISeqFileOperations;    // SeqFile (行追加)
  readonly refs?: IRefOperations;       // 双向引用
  readonly watcher?: IWatchOperations;  // 文件监听

  // 读取
  getNode(idOrPath: string): Promise<FSNode | null>;
  getChildren(idOrPath: string, options?: ListOptions): Promise<FSNode[] | DirEntry[]>;
  readContent(idOrPath: string, options?: ReadOptions): Promise<FileContent>;
  resolvePath(path: string): Promise<string | null>;
  exists(idOrPath: string): Promise<boolean>;
  search(query: FSSearchQuery): Promise<FSSearchResult>;

  // 写入
  createFile(options: CreateFileOptions): Promise<FSNode>;
  createDirectory(options: CreateDirectoryOptions): Promise<FSNode>;
  writeContent(idOrPath: string, content: FileContent): Promise<void>;
  rename(idOrPath: string, newName: string): Promise<void>;
  move(idsOrPaths: string[], targetParentIdOrPath: string | null): Promise<void>;
  delete(idsOrPaths: string[]): Promise<void>;

  // 链接 & 设备
  symlink(linkPath: string, targetPath: string): Promise<FSNode>;
  readlink(idOrPath: string): Promise<string>;
  openDevice?(idOrPath: string, options?: Record<string, unknown>): Promise<IDeviceHandle>;

  // 事务
  transaction?<T>(fn: (tx: IFSTransaction) => Promise<T>): Promise<T>;
}
```

### 3.3 节点类型（FSNode）

```
FSNode = FSFileNode | FSDirectoryNode | FSSeqFileNode | FSDeviceNode | FSSymlinkNode
```

| 类型 | 说明 | 特有字段 |
|---|---|---|
| `FSFileNode` | 普通文件 | `size`, `assetDirId` |
| `FSDirectoryNode` | 目录 | 子节点 |
| `FSSeqFileNode` | 顺序追加文件（日志流） | — |
| `FSDeviceNode` | 设备文件 | `handlerId` |
| `FSSymlinkNode` | 符号链接 | `target` |

### 3.4 路径命名约定

| 前缀 | 示例 | 用途 | 可见性 |
|---|---|---|---|
| `name` | `notes.md` | 用户文件/目录 | 默认可见 |
| `.name` | `.connections/` | 隐藏文件（仅 system 模块可写） | 默认隐藏 |
| `_name/` | `_note.md/` | 资产目录（自动管理） | 默认隐藏 |
| `__config/` | `__config/history.yaml` | 模块内部配置 | 默认隐藏 |

### 3.5 目录结构

```
/  (VFS root)
├── etc/                    ← 全局配置模块 (CONFIG_MODULE, isSystem)
│   └── llm/
│       ├── .connections/   ← LLM 连接配置
│       ├── .providers/     ← Provider 定义
│       ├── .mcp/           ← MCP 服务器配置
│       └── .skills/        ← Skill 定义
├── dev/                    ← 设备文件
│   ├── null, zero, random  ← 内置设备
│   └── llm/
│       └── connection/<id> ← LLM 连接设备
└── module/                 ← 业务模块
    ├── chats/              ← Chat 工作区
    ├── notes/              ← 笔记工作区
    ├── agents/             ← Agent 配置
    ├── missions/           ← Mission 数据
    └── ...
```

### 3.6 事件系统

#### VFS 事件（IModuleFS 级别）

```
node:created   → { nodeId, path }
node:updated   → { nodeId, path, changedFields }
node:deleted   → { nodeIds[] }
node:moved     → { nodeIds[], targetParentId, oldParentId }
node:renamed   → { nodeId, oldName, newName }
node:copied    → { nodeId, path }
```

#### VFS Manager 事件

```
node:created     → { nodeId, path, moduleId }
node:updated     → { nodeId, path, moduleId }
node:deleted     → { nodeIds[], moduleId }
module:mounted   → { moduleName }
module:unmounted → { moduleName }
mount:added      → { mountPath, mountId }
mount:removed    → { mountPath, mountId }
```

### 3.7 存储后端

**接口层次：**

```
IStorageBackend  (基础三件套: inode + content + meta)
├─ IRecordStore     (可选) 通用记录查询
├─ IHighLevelStore  (可选) 高级批量操作
└─ ISyncableStore   (可选) 同步/变更日志
```

**实现：**

| 包 | 实现 | 适用环境 |
|---|---|---|
| `@itookit/vfsdriver-indexeddb` | IndexedDB 三层存储 | 浏览器 |
| `@itookit/vfsdriver-fs` | SQLite + 本地文件系统 | Node/Electron |

### 3.8 存储后端接口

```typescript
interface IStorageBackend {
  // Inode 操作
  createInode(parentId, name, type, options?): Promise<InodeRecord>;
  getInode(id): Promise<InodeRecord | null>;
  updateInode(id, changes): Promise<void>;
  deleteInode(id): Promise<void>;
  getChildren(parentId): Promise<InodeRecord[]>;

  // Content 操作
  readContent(inodeId): Promise<ArrayBuffer | null>;
  writeContent(inodeId, data): Promise<void>;

  // 元数据
  getMetadata(inodeId): Promise<MetaRecord | null>;
  setMetadata(inodeId, meta): Promise<void>;
}
```

---

## 4. ISessionEngine — UI/后端契约

### 4.1 接口定义

`ISessionEngine` 是 UI 包与后端之间唯一的抽象契约。

```typescript
interface ISessionEngine {
  init(): Promise<void>;
  getChildren(parentId: string): Promise<EngineNode[]>;
  readContent(id: string): Promise<string | ArrayBuffer>;
  getNode(id: string): Promise<EngineNode | null>;
  search(query: EngineSearchQuery): Promise<EngineNode[]>;

  createFile(name, parentId, content?): Promise<EngineNode>;
  createDirectory(name, parentId): Promise<EngineNode>;
  createAsset(ownerNodeId, filename, content): Promise<EngineNode>;
  writeContent(id, content): Promise<void>;
  rename(id, newName): Promise<void>;
  move(ids[], targetParentId): Promise<void>;
  delete(ids[]): Promise<void>;
  setTags(id, tags[]): Promise<void>;

  on(event: EngineEventType, callback): () => void;
}
```

### 4.2 两种实现

| 实现 | 用途 | 存储 |
|---|---|---|
| `VFSModuleEngine` | 标准文件工作区 | 直接适配 `IVFSManager` → `ISessionEngine` |
| `LLMSessionEngine` | Chat 会话工作区 | `.chat` 文件 + 隐藏 assetdir 消息图 |

### 4.3 LLMSessionEngine — Chat 持久化格式

每个 `.chat` 文件是一个 `ChatManifest` JSON：

```
my-session.chat               ← ChatManifest JSON
_my-session.chat/             ← 资产目录
├── 000_00000_s.chat          ← 系统节点
├── 000_00001_u.chat          ← 用户消息
├── 000_00002_a.chat          ← 助手消息
└── settings.yaml             ← 会话设置
```

`ChatManifest` 包含 `branches: Record<branchName, headNodeId>` 支持命名分支消息图。

---

## 5. LLM 通信层（device-llm）

### 5.1 职责

- 封装各 Provider (OpenAI/Anthropic/Gemini) 的 API 调用
- 统一消息格式和响应结构
- 处理 SSE 流式响应
- MCP 协议支持
- Skill/工具系统

### 5.2 核心组件

```
LLMDeviceDriver  ← IDeviceDriver 实现，VFS 设备注册
    ├─ LLMDriver        ← 核心调用引擎
    │   └─ LLMChain     ← 单个请求的完整生命周期
    ├─ LLMConnection[]  ← 存储在 VFS /llm/.connections/
    ├─ MCPServerConnection[] ← MCP 客户端管理
    └─ SkillRegistry    ← Skill 存储与检索
```

### 5.3 Provider 系统

```
BaseProvider  (抽象基类)
├─ OpenAIProvider
├─ AnthropicProvider
└─ GeminiProvider

registerProvider() / getProvider() / createProvider()
```

### 5.4 LLMDeviceDriver — ioctl 命令

设备通过 `ioctl` 命令模式暴露 CRUD 操作，供 Settings UI 调用：

| 命令 | 功能 |
|---|---|
| `list-connections` | 列出所有连接（无 apiKey） |
| `get-connection` | 获取单个连接元数据 |
| `get-full-connection` | 获取完整连接（含 apiKey，仅 Settings） |
| `save-connection` | 保存连接配置 |
| `delete-connection` | 删除连接 |
| `test-connection-params` | 测试连接可用性 |
| `list-providers` | 列出 Provider |
| `save-provider` | 保存 Provider |
| `list-mcp-servers` | 列出 MCP 服务器 |
| `save-mcp-server` | 保存 MCP 配置 |
| `...skills...` | Skill 的 CRUD |

---

## 6. 执行引擎（llm-kernel）

### 6.1 职责

- 执行器管理（Agent、HTTP、Tool、Script）
- 编排器管理（Serial、Parallel、Router、Loop、DAG）
- 事件驱动架构
- 插件化扩展
- 无 UI 依赖

### 6.2 执行器（Executor）

```
BaseExecutor
├─ AgentExecutor     ← LLM Agent 执行
├─ HttpExecutor      ← HTTP 请求执行
├─ ToolExecutor      ← 工具调用执行
└─ ScriptExecutor    ← 脚本执行
```

### 6.3 编排器（Orchestrator）

```
BaseOrchestrator
├─ SerialOrchestrator     ← 串行执行
├─ ParallelOrchestrator   ← 并行执行
├─ RouterOrchestrator     ← 条件路由
├─ LoopOrchestrator       ← 循环执行
└─ DAGOrchestrator        ← DAG 依赖图执行
```

### 6.4 运行时组件

| 组件 | 说明 |
|---|---|
| `ExecutionRuntime` | 执行运行时，管理执行上下文 |
| `StateMachine` | 状态机，管理执行状态流转 |
| `MemoryStore` | 内存存储，跨执行器共享状态 |
| `PluginManager` | 插件管理器 |
| `EventBus` | 内核事件总线 |

---

## 7. Agent 循环引擎（llm-harness）

### 7.1 整体架构

```
createHarness({ llmDriver, ttyDriver? })
    │
    ├─ LLMServiceAdapter   ← IDeviceDriver → ILLMService
    ├─ ToolDeviceDriver    ← 内置工具注册 + 执行
    ├─ SkillDeviceDriver   ← Skill 注册 + 加载
    └─ AgentDeviceDriver   ← AgentLoopExecutor 装配
         ├─ AgentLoopExecutor  ← 核心循环
         ├─ BudgetController   ← 6维预算控制
         ├─ ContextManager     ← 系统提示词 + 压缩
         ├─ ErrorRecoveryService ← 5类错误恢复
         ├─ BackPressureValidator ← 反压验证
         └─ SubAgentRouter    ← 子 Agent 调度

HarnessInstance {
    runtime: IAgentRuntime,      // run / abort / on / inject
    config: IAgentRuntimeConfig, // model roles / budget / loop config
    toolService: IToolService,
    skillService: ISkillService,
    agentDriver, toolDriver, skillDriver,
}
```

### 7.2 Agent 循环流程

```
while(true):
    1. Flush pending injections  (Q3: mid-run 用户注入)
    2. Budget Check              (6维任一超限 → BudgetExhaustedError)
    3. Context Compress          (ratio ≥ 0.75 触发)
    4. Build Messages            (system prompt + history + compressionSummary)
    5. LLM Call + Error Recovery
    6. Parse Response

    分支 A — 有 tool_calls:
      → Plan Confirm (Q1: turn===1 且 enablePlanConfirm)
      → Permission Check (sideEffect !== 'none')
      → 读工具并行 (sideEffect=none, Promise.all)
      → 写工具串行 (sideEffect≠none, for loop)
      → After-tool BackPressure check
      → GOTO 1

    分支 B — 无 tool_calls:
      → Before-final BackPressure check
      → 通过 → break, 返回 finalResponse
      → 失败 → inject 修正指令 → GOTO 1
```

### 7.3 四层上下文压缩

| 层 | 阈值 | 名称 | 操作 |
|---|---|---|---|
| L1 | ≥ 0.70 | `history_snip` | 截断 >2000 chars 的消息 |
| L2 | ≥ 0.80 | `cache_prune` | 移除旧 assistant 消息 |
| L3 | ≥ 0.85 | `llm_summarize` | LLM 摘要前 60% 消息 |
| L4 | ≥ 0.95 | `sliding_window` | 仅保留最后 6 条消息 |

### 7.4 五类错误恢复

| 类别 | 检测 | 策略 |
|---|---|---|
| Rate Limit | HTTP 429 | 指数退避，最多 5 次 |
| Context Too Large | HTTP 413 | 强制 L3 压缩后重试 |
| Service Overload | HTTP 529 | 切换 fallback 连接 |
| Output Truncated | `finish_reason === 'length'` | 无延迟重试，最多 3 次 |
| Other Errors | 其他 | 立即 re-throw |

### 7.5 六维预算控制

| 维度 | 默认上限 |
|---|---|
| 轮次 (maxTurns) | 100 |
| 输入 Token (maxInputTokens) | 5,000,000 |
| 输出 Token (maxOutputTokens) | 1,000,000 |
| 费用 (maxCostUsd) | $10.00 |
| 时长 (maxDurationMs) | 1h |
| 工具调用次数 (maxToolCalls) | 500 |

`WARN_THRESHOLD = 0.8` — 任意维度达 80% 时发出 `agent:budget:warning` 事件。

### 7.6 内置工具 (Built-in Tools)

| 工具 ID | sideEffect | 功能 |
|---|---|---|
| `file_read` | none | 读取文件内容 |
| `file_write` | local | 写入文件 |
| `shell_exec` | local | 执行 shell 命令 |
| `glob_search` | none | 文件名搜索 |
| `grep_search` | none | 内容搜索 |
| `load_skill` | local | 加载 Skill |
| `delegate_task` | local | 委派子 Agent |
| `delegate_agent` | local | 委派指定 Agent |
| `write_result` | local | 写入执行结果 |
| `human_input` | external | 请求人类输入 (HITL) |

### 7.7 TTY 设备 — 交互式 Shell

支持跨多轮的持久 shell 会话，解耦执行与交互。

```
ITTYSession        ← 单个进程的读写/信号控制
ITTYSessionManager ← 会话注册表 (add/get/remove/abortAll)
ITTYDriver         ← 工厂 (spawn)，不同平台不同实现

工具:
  shell_session  → 启动持久 shell
  tty_write      → 写入 stdin
  tty_close      → 关闭会话
```

### 7.8 Agent 事件总览

```
// 任务生命周期
agent:task:start / agent:task:end / agent:step:complete

// LLM 调用
agent:llm:start / agent:llm:end / agent:llm:retry / agent:llm:fallback

// 流式内容
agent:stream:content / agent:stream:thinking

// 工具执行
agent:tool:start / agent:tool:success / agent:tool:error / agent:tool:timeout

// 权限
agent:permission:request

// 上下文
agent:context:compressed / agent:skill:loaded

// 预算
agent:budget:warning / agent:budget:exhausted

// 反压
agent:backpressure:check / agent:backpressure:failed

// TTY
agent:tty:open / agent:tty:data / agent:tty:close / agent:tty:error

// 交互
agent:plan:confirm (Q1) / agent:user:injected (Q3)
```

---

## 8. Skill 系统

### 8.1 两层架构

```
LLMSkill (VFS 持久化, device-llm)          SkillDefinition (运行时内存, llm-harness)
├─ id, name, type, enabled                 ├─ 继承 LLMSkill 字段
├─ instructions (Markdown)                 ├─ tools: SkillToolBinding[]
├─ endpoint, method, headers (http)        ├─ triggerPatterns[]
├─ command (shell)                         ├─ autoLoad, priority
└─ parameters                              └─ 额外运行时行为
         │                                         │
         └── syncSkillsToHarness() 同步 ──────────┘
```

### 8.2 Skill 类型

| 类型 | 执行方式 | System Prompt 注入 |
|---|---|---|
| `prompt` | 直接注入 `instructions` | **P3 自动注入**（无需 load_skill） |
| `shell` | `spawn('sh', ['-c', command])` | P4 描述 → load_skill → 工具注册 |
| `http` | `fetch(endpoint, { body })` | P4 描述 → load_skill → 工具注册 |
| `mcp` | MCP 协议 | P4 描述 → load_skill |
| `builtin` | 引用已有工具 | P4 描述 → load_skill |

### 8.3 System Prompt 优先级分层

| 优先级 | 内容 | 来源 |
|---|---|---|
| P0 | Agent 自定义 systemPrompt 或 core identity | 始终通过 |
| P1 | 环境信息 (OS/CWD/Time/Node) | `buildEnvironment()` |
| P2 | 已显式加载技能的完整 `instructions` | `loadedSkillIds` ∩ `enabled` |
| P3 | `prompt` 型 enabled 技能的 `instructions` | 自动注入，无需 load_skill |
| P4 | `http/shell/mcp/builtin` 型技能的 id+description | 渐进式披露 |

预算门控：`systemPromptBudgetTokens = 4000`，P0 始终通过，其余按 `length/4` 估算超出则丢弃。

---

## 9. 会话管理（llm-engine）

### 9.1 会话引擎初始化流程

```
initializeLLMEngine({
    agentService,      // IAgentConfigService
    sessionEngine,     // ILLMSessionEngine
    harnessRuntime?,   // IAgentRuntime (可选)
    harnessSkillService?, // ISkillService (可选)
    harnessToolService?,  // IToolService (可选)
})
    │
    ├─ initializeKernel({ plugins, config })
    ├─ agentService.init()
    ├─ sessionEngine.init()
    ├─ initializePromptHistory(vfs)   // 非关键
    ├─ createSessionManager(...)
    └─ 注入 harness (如有)
         ├─ initHarnessAdapter(runtime)
         └─ sessionManager.setHarnessAdapter(adapter)
```

### 9.2 双执行路径

| 路径 | 触发条件 | 特性 |
|---|---|---|
| Kernel 路径 | 默认 (`useHarness=false`) | 单轮、自动继续、流式 |
| Harness 路径 | `ChatSessionSettings.useHarness=true` | 多轮 Agent 循环、工具调用、上下文压缩、HITL |

### 9.3 TaskRunner

`TaskRunner` 统一封装两种路径，对外暴露一致的接口：

```typescript
interface TaskRunnerOptions {
    sessionId: string;
    prompt: string;
    overrides?: {
        useHarness?: boolean;
        modelOverride?: string;
        systemPromptOverride?: string;
        // ...
    };
}
```

### 9.4 SessionManager

管理多会话并发：

```
SessionManager
├─ SessionState[]          ← 每个 Chat 的运行时状态
├─ TaskRunner              ← 执行调度
├─ AgentResolver           ← Agent 配置解析
├─ AttachmentProcessor     ← 附件处理
├─ SessionEventBus         ← 会话事件
├─ SessionRecovery         ← 崩溃恢复
├─ TruncationDetector      ← 截断检测
└─ AutoContinueHandler     ← 自动继续
```

### 9.5 HarnessAdapter — 事件映射

将 Agent 事件桥接为 `OrchestratorEvent`（UI 消费）：

| Agent Event | OrchestratorEvent |
|---|---|
| `agent:stream:content` | `node_update` field=`output` |
| `agent:stream:thinking` | `node_update` field=`thought` |
| `agent:tool:start` | `node_start` (新建 tool 子节点) |
| `agent:tool:success` | `node_status(success)` + toolResult |
| `agent:tool:error/timeout` | `node_status(failed)` |
| `agent:context:compressed` | `node_update` metaInfo.compressed |
| `agent:budget:warning` | `node_update` metaInfo.budgetWarning |
| `agent:budget:exhausted` | `error` code=`BUDGET_EXHAUSTED` |
| `agent:tty:open/data/close` | `node_update` metaInfo.tty* |
| `agent:plan:confirm` | `node_update` metaInfo.planConfirm |

### 9.6 Session Dependency Graph

基于文件的跨会话依赖图执行系统：

```
GraphOrchestrator
├─ DependencyGraph     ← 读取 session-meta.json，拓扑排序，检测环
├─ SessionMetaStore    ← 读写 _<filename>/session-meta.json
├─ CompletionAnalyzer  ← LLM 输出质量验证 (advance mode)
└─ 执行模式:
    standard  ← 完成即结束，无重试
    advance   ← CompletionAnalyzer 验证，支持重试
```

每个 VFS 文件是一个 "session"，依赖声明在 `_<filename>/session-meta.json`。
`GraphOrchestrator` 拓扑排序后自底向上按依赖顺序执行。

---

## 10. Mission 编排系统

### 10.1 设计原则

> "LLM 负责意图（plan/execute/verify），确定性 Scheduler 负责调度。"

### 10.2 核心组件

```
MissionService       ← 公共门面
├─ 并行 LLM Planner  ← 多 Agent 并行规划
├─ TodoStateManager  ← plan.json 原子读写 (VFS missions 模块)
├─ MissionScheduler  ← 主循环调度
│   ├─ getReadyTodos()      ← 依赖满足 + status=pending
│   ├─ executeTodo()        ← SubAgentRouter.delegate()
│   └─ runVerifier()        ← SubAgentRouter.delegate()
├─ ResultPersistenceService ← 结果写入 + journal 追加
└─ HITLQueue         ← human_input 阻塞队列
```

### 10.3 执行流程

```
MissionService.createMission(goal)
  → 并行 LLM Planner → merge TodoItem[]
  → TodoStateManager.createMission() → write plan.json
  → MissionScheduler.run() loop:
      getReadyTodos() [deps satisfied + status=pending]
      → executeTodo() → SubAgentRouter → save result
      → runVerifier() → SubAgentRouter
          → verdict: 'done' | 'retry' | 'hitl'
          → 'hitl': HITLQueue.push() → await human → resume
```

### 10.4 核心数据结构

```typescript
interface TodoItem {
    id, title, description: string;
    dependsOn: string[];         // 依赖的 Todo ID
    canParallel: boolean;        // 可并行
    priority: number;            // 1-10
    agentRole: string;           // 语义角色 (researcher/coder/reviewer)
    agentId?: string;            // 指定 Agent
    status: TodoStatus;          // pending→running→verifying→done/failed
    retryCount, maxRetries: number;
    feedback?: string;           // Verifier 反馈
    resultPath?, summaryPath?: string;
}

interface MissionPlan {
    id, goal, context: string;
    status: MissionStatus;       // planning→executing→done/failed
    todos: TodoItem[];
    config: MissionConfig;       // agentPool + plannerIds + maxParallel
    paths: MissionPaths;         // planFile, journalFile, resultsDir...
}
```

### 10.5 VFS 布局

```
missions/
└── <missionId>/
    ├── plan.json
    ├── journal.md
    ├── results/
    │   └── <todoId>.md
    ├── summaries/
    │   └── <todoId>.md
    └── hitl/
        └── <requestId>.json
```

---

## 11. 工作区策略模式

### 11.1 策略类型

```typescript
interface WorkspaceStrategy {
    getFactory(): EditorFactory;                          // 编辑器工厂
    getEngine?(moduleName: string): ISessionEngine;       // 后端引擎 (可选)
}

// 五种策略:
StandardWorkspaceStrategy    → MDxEditor + VFSModuleEngine
ChatWorkspaceStrategy        → LLMWorkspaceEditor + LLMSessionEngine
AgentWorkspaceStrategy       → AgentConfigEditor
SettingsWorkspaceStrategy    → SettingsEditor + SettingsEngine / SkillsEngine
SkillsWorkspaceStrategy      → SkillSettingsEditor + SkillsEngine
```

### 11.2 工作区配置

每个工作区通过 `WorkspaceConfig` 声明：

```typescript
interface WorkspaceConfig {
    elementId: string;           // DOM 容器 ID
    slug: string;                // URL hash 标识
    moduleName: string;          // VFS 模块名
    type: 'standard' | 'chat' | 'agent' | 'settings' | 'skills';
    title: string;
    icon?: string;
    supportedFileTypes?: string[];
    mentionAble?: boolean;       // 是否可被 @mention
    mentionScope?: string[];     // mention 搜索范围
    isSystem?: boolean;
    syncEnabled?: boolean;
    // ...
}
```

---

## 12. App-Shell 启动引导

### 12.1 initApp() 完整启动流程

```
initApp(options)
    │
    ├─ 1. createVFS({ rootBackend, modules })
    │      → 创建 VFSEngine + VFSManager + ConfigService
    │      → 注册内置设备 (/dev/null, /dev/zero, /dev/random)
    │      → 挂载业务模块
    │
    ├─ 2. new LLMDeviceDriver(vfs) → init()
    │      → vfs.devices.register(llmDriver)
    │      → llmDriver.createDeviceNodes()
    │      → setKernelDeviceManager(vfs.devices)
    │
    ├─ 3. 核心服务初始化
    │      ├─ createSettingsModule(vfs)
    │      ├─ new VFSAgentService(vfs, llmDriver)
    │      └─ new LLMSessionEngine(vfs)
    │
    ├─ 4. createHarness({ llmDriver })
    │      → LLMServiceAdapter + ToolDeviceDriver + SkillDeviceDriver + AgentDeviceDriver
    │      → setVFSContext (浏览器 VFS 桥接)
    │      → syncSkillsToHarness (VFS → harness Skill 同步)
    │
    ├─ 5. initializeLLMEngine({ agentService, sessionEngine, harness* })
    │      → initializeKernel + SessionManager
    │      → HarnessAdapter 装配
    │
    ├─ 6. 策略工厂创建
    │      ├─ StandardWorkspaceStrategy × 2 (standard, agent)
    │      ├─ ChatWorkspaceStrategy
    │      ├─ SettingsWorkspaceStrategy × 2 (settings, skills)
    │      └─ FILE_REGISTRY (文件类型 → 编辑器映射)
    │
    ├─ 7. 路由系统
    │      ├─ routeMap: slug → elementId
    │      ├─ hash-based routing (#/slug/resourceId)
    │      ├─ popstate listener
    │      └─ NAVIGATION_EVENTS listener
    │
    ├─ 8. 初始导航
    │      → 解析 location.hash → loadWorkspace → MemoryManager
    │
    └─ 9. 返回 AppHandle { vfs, navigate(), addWorkspace() }
```

### 12.2 VFS ToolContext 适配

在浏览器环境中，`node:fs` 不可用。APP-Shell 通过 `createVFSToolContext(vfs)` 将 VFS 暴露为 `ToolVFSContext`，使 `file_read`、`file_write` 等工具可操作虚拟文件系统。

### 12.3 LLMSkill → SkillDefinition 桥接

`syncSkillsToHarness()` 在启动和每次 `llmDriver.onChange()` 时，将 VFS 中持久化的 `LLMSkill` 同步为 harness 运行时的 `SkillDefinition`。

---

## 13. MDX 编辑器（mdxeditor）

CodeMirror 6 驱动的 Markdown/MDX 编辑器，支持编辑/预览双模式。

### 13.1 核心架构

```
MDxEditor (实现 IEditor)
├─ CodeMirrorAdapter   ← CodeMirror 6 编辑器适配
├─ MDxRenderer         ← marked + 扩展实现的实时预览
├─ PluginManager       ← 插件生命周期管理
├─ EventBus            ← 编辑器内部事件
├─ ServiceContainer    ← DI 容器
├─ CommandRegistry     ← 编辑器命令注册
├─ NavigationManager   ← 标题导航/大纲
├─ SaveManager         ← 自动保存/脏跟踪
├─ SearchManager       ← 搜索 + 高亮
└─ ModeManager         ← 编辑/渲染模式切换
```

### 13.2 插件体系（20+ 插件）

| 类别 | 插件 | 功能 |
|---|---|---|
| 语法扩展 | `FoldablePlugin` | 可折叠块 |
| | `MathJaxPlugin` | LaTeX 数学公式 |
| | `MermaidPlugin` | Mermaid 图表 |
| | `PlantumlPlugin` | PlantUML 图表 |
| | `VegaPlugin` | Vega 可视化 |
| | `CalloutPlugin` | Callout/提示块 |
| | `SvgPlugin` | SVG 内联渲染 |
| 交互 | `AutoSavePlugin` | 自动保存 |
| | `ClipboardPlugin` | 剪贴板处理 |
| | `CodeBlockControlsPlugin` | 代码块操作 |
| | `TablePlugin` | 表格编辑 |
| | `TaskListPlugin` | 任务列表 |
| | `UploadPlugin` | 文件上传 |
| 自动完成 | `AutocompletePlugin` | 通用自动完成 |
| | `MentionPlugin` | @-mention 文件引用 |
| | `TagPlugin` | #-tag 自动完成 |
| 记忆 | `ClozePlugin` | 完形填空/Anki |
| | `ClozeControlsPlugin` | Cloze 复习控制 |
| | `MemoryPlugin` | 间隔重复 |
| 工具 | `ToolbarPlugin` | 工具栏 |
| | `FormattingPlugin` | 格式化 |
| | `TitleBarPlugin` | 标题栏 |
| | `SourceJumpPlugin` | 源码跳转 |

### 13.3 流式渲染

`StreamingDiffer` 实现实时 diff，在 LLM 流式输出时增量更新预览内容，避免整体重绘。

---

## 14. UI 层（vfs-ui、llm-ui、memory-manager）

### 13.1 vfs-ui

文件树 UI 组件库：

```
VFSUIShell          ← 主组件，实现 ISessionUI
├─ VFSService       ← VFS 操作封装
├─ FileTypeRegistry ← 文件类型 → 编辑器/图标解析
├─ FileMentionSource / DirectoryMentionSource  ← @mention 支持
└─ connectEditorLifecycle ← 编辑器生命周期桥接
```

### 14.2 llm-ui

Chat 和 Agent 配置 UI，采用 Ports/Adapters 架构。

**核心编辑器：**

```
LLMWorkspaceEditor       ← Chat 主编辑器 (实现 IEditor)
├─ ChatInputView         ← 消息输入框 + 附件
├─ HistoryView           ← 流式消息历史
├─ BranchIndicatorView   ← 分支切换
├─ StatusIndicatorView   ← 连接/用量状态
├─ FloatingNavPanel      ← 文件大纲 + 历史
├─ StreamController      ← 流式内容更新
├─ NodeRenderer          ← 消息节点渲染
├─ SessionEventHandler   ← 会话事件处理
└─ EventBinder           ← DOM 事件绑定
```

**输入系统插件：**

| 插件 | 功能 |
|---|---|
| `SlashCommandPlugin` | `/command` 命令执行 |
| `MentionPlugin` | @-mention 文件/目录引用 |
| `HarnessPlugin` | Skill 选择器、工具执行 |
| `HistoryPlugin` | Prompt 历史浏览 |
| `TokenMeterPlugin` | Token 计数 |

**Settings 编辑器：**
- `ConnectionSettingsEditor` — LLM 连接配置
- `ProviderSettingsEditor` — Provider 管理
- `MCPSettingsEditor` — MCP 服务器配置
- `SkillSettingsEditor` — Skill 编辑器
- `AgentConfigEditor` — Agent 配置编辑

### 14.3 app-settings

设置模块，管理全局配置和系统工具。

```
createSettingsModule(vfs)
├─ SettingsService    ← 设置 CRUD (VFS ConfigService 持久化)
├─ SettingsEngine     ← 设置页 ISessionEngine 适配器
└─ SkillsEngine       ← Skill 列表 ISessionEngine 适配器
```

**Settings 编辑器（均实现 ISettingsWidget）：**

| 编辑器 | 功能 |
|---|---|
| `AboutSettingsEditor` | 版本、许可 |
| `ContactSettingsEditor` | 联系/支持信息 |
| `LogSettingsEditor` | 日志级别、查看器 |
| `RecoverySettingsEditor` | 数据恢复工具 |
| `StorageSettingsEditor` | 存储概览、迁移、快照、同步、危险区 |
| `TagSettingsEditor` | 全局标签管理 |
| `SystemFSExploreEditor` | 原始 VFS 浏览器（调试） |

### 14.4 memory-manager

工作区顶层容器，粘合 VFS-UI + Editor + BackgroundBrain：

```typescript
class MemoryManager {
    constructor({
        container,        // DOM 容器
        customEngine,     // ISessionEngine (可选)
        moduleName,       // VFS 模块名
        editorFactory,    // EditorFactory
        fileTypes,        // 支持的文件类型
        uiOptions,        // UI 配置
        editorConfig,     // 编辑器配置 (plugins, readOnly, mentionScope)
        aiConfig,         // AI 配置
        onNavigate,       // 导航回调
        onSessionChange,  // 会话变更回调
    })

    start(): Promise<void>;           // 初始化
    openFile(resourceId: string): Promise<void>;
    createAndOpenFile(opts): Promise<string>;
    getActiveSessionId(): string | null;
}
```

每个 `MemoryManager` 实例管理一个工作区的完整生命周期。

---

## 15. 数据流全景

### 15.1 用户发送 Chat 消息

```
用户输入 → ChatInput UI
    │
    ├─ Skill 解析 (/sk-<id> args)
    │   ├─ SkillDeviceDriver.loadSkill()
    │   └─ 构建结构化 prompt
    │
    ├─ Attachment 处理
    │   └─ AttachmentProcessor → read file / expand glob
    │
    ├─ SessionManager.sendMessage(sessionId, prompt, overrides)
    │   │
    │   ├─ 路径选择:
    │   │   ├─ useHarness=true  → harness.runtime.run()
    │   │   └─ useHarness=false → kernel path
    │   │
    │   └─ TaskRunner 执行
    │       │
    │       ├─ AgentLoopExecutor.run()
    │       │   ├─ BudgetController.check()
    │       │   ├─ ContextManager.buildSystemPrompt()
    │       │   │   ├─ P0: Core identity
    │       │   │   ├─ P1: Environment
    │       │   │   ├─ P2: Loaded skills (full instructions)
    │       │   │   ├─ P3: Prompt-type enabled skills (auto-inject)
    │       │   │   └─ P4: Tool-type skills (descriptions only)
    │       │   ├─ LLM Call (via LLMServiceAdapter → LLMDeviceDriver)
    │       │   ├─ Stream → agent:stream:content events
    │       │   └─ Tool calls → ToolDeviceDriver.invoke()
    │       │       └─ VFS ToolContext (浏览器) 或 node:fs (Node)
    │       │
    │       └─ HarnessAdapter → OrchestratorEvent → UI 更新
    │
    └─ LLMSessionEngine 持久化
        ├─ 写入 ChatManifest (branches)
        └─ 写入消息节点到 assetdir
```

### 15.2 文件系统操作流

```
UI (vfs-ui/VFSUIShell)
    │
    ├─ VFSService (业务逻辑)
    │   └─ ISessionEngine (VFSModuleEngine / LLMSessionEngine)
    │       └─ IModuleFS (ModuleFS, chroot 隔离)
    │           └─ VFSEngine
    │               ├─ PathResolver    (路径 → InodeRecord)
    │               ├─ AccessController (权限检查)
    │               ├─ PluginPipeline  (中间件)
    │               └─ IStorageBackend (IndexedDB / SQLite)
    │
    └─ Event → ISessionEngine.on() → UI 响应
```

### 15.3 Mission 编排流

```
MissionService.createMission(goal)
    │
    ├─ LLM Planner Agents (并行)
    │   └─ SubAgentRouter.delegate()
    │       └─ AgentLoopExecutor (独立上下文)
    │
    ├─ merge TodoItem[] → TodoStateManager.createMission()
    │   └─ VFS: write missions/<id>/plan.json
    │
    └─ MissionScheduler.run()
        │
        ├─ getReadyTodos()  ← 依赖图分析
        │
        ├─ executeTodo() (并行/串行)
        │   └─ SubAgentRouter.delegate()
        │       ├─ AgentLoopExecutor
        │       ├─ write_result tool → ResultPersistenceService
        │       └─ human_input tool → HITLQueue
        │
        ├─ runVerifier()
        │   └─ SubAgentRouter.delegate()
        │       └─ LLM verdict: done | retry | hitl
        │
        └─ 循环至全部 done / failed / cancelled
```

---

## 16. 关键设计决策

### 15.1 依赖注入与接口抽象

- 所有跨包依赖通过接口（`@itookit/common`），而非具体实现
- 调用方类型化依赖为 `IVFSManager` / `IModuleFS` / `ISessionEngine`，永远不依赖具体类
- 具体装配仅在 `app-shell/bootstrap.ts` 的 `initApp()` 中进行

### 15.2 effectiveTools = undefined

当前 `agent-loop-executor.ts:175` 中 `effectiveTools = undefined`，LLM 不接收 function-calling schema。原因是部分代理端点在接收工具 schema 时返回 500。Skill 通过 system prompt 注入指令替代。待端点支持恢复后，只需恢复 `effectiveTools = toolDefs`，其余逻辑不变。

### 15.3 浏览器 VFS 桥接

`createVFSToolContext(vfsManager)` 将 VFS 暴露给 harness 文件工具，使 `file_read`/`file_write`/`glob_search`/`grep_search` 在浏览器中操作 IndexedDB 内的虚拟文件系统，无需 `node:fs`。

### 15.4 Context 防火墙

`SubAgentRouter.delegate()` 创建独立的 `AgentLoopExecutor` 实例，拥有独立的消息历史，不继承父 Agent 上下文，不污染父 context window。默认只允许只读工具（`file_read`, `glob_search`, `grep_search`），最大 10 轮。

### 15.5 Plan Confirm (Q1) & Mid-run Injection (Q3)

- **Q1 Plan Confirm**: 首轮有工具调用时，发出 `agent:plan:confirm` 事件，UI 可 approve/reject/redirect。拦截器返回 `false`=取消，`true`=批准，`string`=修改指令后重规划。
- **Q3 Mid-run Injection**: `agentRuntime.inject(message)` 将用户指令排队，下次循环迭代开始时作为 user 消息插入。

---

## 17. 扩展点

### 16.1 添加新工作区类型

1. 在 `apps/web-app/src/config/modules.ts` 的 `WORKSPACES` 数组中添加配置
2. 如需要新策略，实现 `WorkspaceStrategy` 接口
3. 在 `initApp()` 的 strategies map 中注册

### 16.2 添加新内置工具

1. 在 `packages/llm-harness/src/tools/` 创建文件，导出 `meta`、`definition`、`handler`
2. 加入 `BUILTIN_TOOLS` 数组

### 16.3 添加新 VFS 存储后端

实现 `IStorageBackend` 接口（inode CRUD + content CRUD + metadata），在 `createVFS()` 时注入。

### 16.4 添加新 LLM Provider

继承 `BaseProvider`，实现 `chat()` 和 `stream()` 方法，通过 `registerProvider()` 注册。

### 16.5 添加新 Skill 类型

- `prompt` 型：直接写 `instructions` markdown，P3 自动注入
- `http` 型：配置 `endpoint` + `parameters`，需 `load_skill` 注册工具
- `shell` 型：配置 `command` 模板（支持 `{{argName}}`），需 `load_skill` 注册工具

---

## 18. 文件清单（关键源文件索引）

| 包 | 关键文件 | 说明 |
|---|---|---|
| common | `src/interfaces/fs/services/vfs-manager.ts` | IVFSManager 接口定义 |
| common | `src/interfaces/fs/services/module-fs.ts` | IModuleFS 接口定义 |
| common | `src/interfaces/ISessionEngine.ts` | ISessionEngine 接口定义 |
| common | `src/interfaces/agent/agent-types.ts` | Agent 事件类型和载荷 |
| common | `src/interfaces/agent/agent-service.ts` | IAgentRuntime 接口 |
| common | `src/interfaces/llm/mission.ts` | Mission 类型定义 |
| common | `src/interfaces/tools/tool-types.ts` | 工具元数据类型 |
| common | `src/interfaces/skills/skill-types.ts` | Skill 定义类型 |
| common | `src/interfaces/tty/tty-types.ts` | TTY 接口定义 |
| vfslib | `src/engine/vfs-engine.ts` | VFSEngine 核心 |
| vfslib | `src/services/vfs-manager.ts` | VFSManager 实现 |
| vfslib | `src/services/module-fs.ts` | ModuleFS 实现 |
| vfslib | `src/factory.ts` | createVFS 工厂 |
| vfslib | `src/adapter-session/VFSModuleEngine.ts` | VFS→ISessionEngine 适配器 |
| device-llm | `src/device/llm-device-driver.ts` | LLMDeviceDriver 实现 |
| device-llm | `src/core/driver.ts` | LLMDriver 核心调用 |
| llm-kernel | `src/index.ts` | initializeKernel |
| llm-kernel | `src/executors/` | 四种 Executor |
| llm-kernel | `src/orchestrators/` | 五种 Orchestrator |
| llm-harness | `src/factory.ts` | createHarness 装配工厂 |
| llm-harness | `src/executor/agent-loop-executor.ts` | AgentLoopExecutor 核心循环 |
| llm-harness | `src/executor/context-manager.ts` | ContextManager 系统提示词+压缩 |
| llm-harness | `src/executor/budget-controller.ts` | 六维预算控制 |
| llm-harness | `src/executor/error-recovery.ts` | 五类错误恢复 |
| llm-harness | `src/drivers/agent-device-driver.ts` | AgentDeviceDriver |
| llm-harness | `src/drivers/tool-device-driver.ts` | 内置工具注册+执行 |
| llm-harness | `src/drivers/skill-device-driver.ts` | Skill 注册+加载 |
| llm-engine | `src/index.ts` | initializeLLMEngine |
| llm-engine | `src/session/session-manager.ts` | SessionManager |
| llm-engine | `src/session/task-runner.ts` | TaskRunner 双路径 |
| llm-engine | `src/persistence/session-engine.ts` | LLMSessionEngine |
| llm-engine | `src/adapters/harness-adapter.ts` | HarnessAdapter 事件映射 |
| llm-engine | `src/mission/mission-service.ts` | Mission 服务门面 |
| llm-engine | `src/mission/mission-scheduler.ts` | Mission 调度器 |
| llm-engine | `src/session-graph/graph-orchestrator.ts` | 会话依赖图编排 |
| llm-ui | `src/shell/LLMWorkspaceEditor.ts` | Chat 编辑器 |
| llm-ui | `src/editors/AgentConfigEditor.ts` | Agent 配置编辑器 |
| vfs-ui | `src/shell/VFSUIShell.ts` | 文件树 UI 主组件 |
| memory-manager | `src/core/MemoryManager.ts` | 工作区容器 |
| app-settings | `src/engine/SettingsEngine.ts` | 设置引擎 |
| app-settings | `src/engine/SkillsEngine.ts` | Skill 引擎 |
| app-shell | `src/bootstrap.ts` | initApp 启动引导 |
