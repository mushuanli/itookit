# 功能模块接口设计文档

> 本文档梳理 Claude Code CLI 中所有功能模块的接口定义、注册机制和交叉耦合关系。
> 生成日期: 2026-05-30

---

## 1. 架构总览

```
┌─────────────────────────────────────────────────────────────────────┐
│                          Plugin (集成枢纽)                           │
│  可同时贡献: commands, agents, skills, hooks, mcpServers, lspServers │
└─────────────────────────────────────────────────────────────────────┘
                                    │
        ┌───────────────────────────┼───────────────────────────┐
        ▼                           ▼                           ▼
┌───────────────┐          ┌───────────────┐          ┌───────────────┐
│   Command /    │          │    Agent      │          │     MCP       │
│   Skill        │          │  Definition   │          │   Server      │
│ (Command 联合   │          │ (AgentDef     │          │  Connection   │
│  判别类型)      │          │  联合类型)     │          │  (联合类型)    │
└───────┬───────┘          └───────┬───────┘          └───────┬───────┘
        │                          │                          │
        │  SkillTool               │  AgentTool               │  MCPTool 模板
        │  (Tool 接口)              │  (Tool 接口)              │  展开 + 桥接
        ▼                          ▼                          ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        Tool 接口 (统一执行抽象)                       │
│              src/Tool.ts — buildTool() 工厂函数                       │
│              所有可被模型调用的能力最终都实现 Tool 接口                   │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     Hook 引擎 (跨组件生命周期拦截)                      │
│       PreToolUse / PostToolUse / UserPromptSubmit / Stop / ...       │
└─────────────────────────────────────────────────────────────────────┘
```

### 关键结论

- **没有跨组件的统一基类/接口**（没有 `Component`、`PluginItem` 等顶层抽象）
- **`Tool` 接口是唯一的事实标准执行抽象** — 所有可被模型调用的组件最终都通过 Tool 接口暴露
- **Plugin 是最接近"统一入口"的概念** — 一个 Plugin 可同时贡献多种组件类型
- 各组件的注册、加载、启用/禁用逻辑各自独立实现

---

## 2. Tool 接口

### 2.1 核心定义

**文件**: `src/Tool.ts:362-695`

```typescript
type Tool<
  Input extends AnyObject = AnyObject,
  Output = unknown,
  P extends ToolProgressData = ToolProgressData,
> = {
  // === 身份 ===
  name: string
  aliases?: string[]
  searchHint?: string

  // === 执行 ===
  call(
    args: z.infer<Input>,
    context: ToolUseContext,
    canUseTool: CanUseToolFn,
    parentMessage: AssistantMessage,
    onProgress?: ToolCallProgress<P>,
  ): Promise<ToolResult<Output>>

  // === 描述 ===
  description(
    input: z.infer<Input>,
    options: { isNonInteractiveSession; toolPermissionContext; tools },
  ): Promise<string>

  prompt(options: {
    getToolPermissionContext: () => Promise<ToolPermissionContext>
    tools: Tools
    agents: AgentDefinition[]
    allowedAgentTypes?: string[]
  }): Promise<string>

  // === Schema ===
  readonly inputSchema: Input
  readonly inputJSONSchema?: ToolInputJSONSchema
  outputSchema?: z.ZodType<unknown>

  // === 权限 ===
  isEnabled(): boolean
  isConcurrencySafe(input: z.infer<Input>): boolean
  isReadOnly(input: z.infer<Input>): boolean
  isDestructive?(input: z.infer<Input>): boolean
  interruptBehavior?(): 'cancel' | 'block'
  validateInput?(input: z.infer<Input>, context: ToolUseContext): Promise<ValidationResult>
  checkPermissions(input: z.infer<Input>, context: ToolUseContext): Promise<PermissionResult>
  preparePermissionMatcher?(input: z.infer<Input>): Promise<(pattern: string) => boolean>

  // === 元数据 ===
  isMcp?: boolean
  isLsp?: boolean
  shouldDefer?: boolean
  alwaysLoad?: boolean
  mcpInfo?: { serverName: string; toolName: string }
  maxResultSizeChars: number
  strict?: boolean
  isTransparentWrapper?(): boolean

  // === UI 渲染 ===
  userFacingName(input: Partial<z.infer<Input>> | undefined): string
  userFacingNameBackgroundColor?(input: ...): keyof Theme | undefined
  getToolUseSummary?(input: ...): string | null
  getActivityDescription?(input: ...): string | null
  renderToolUseMessage(input: ..., options: ...): React.ReactNode
  renderToolUseTag?(input: ...): React.ReactNode
  renderToolResultMessage?(content: ..., progressMessages: ..., options: ...): React.ReactNode
  renderToolUseProgressMessage?(progressMessages: ..., options: ...): React.ReactNode
  renderToolUseQueuedMessage?(): React.ReactNode
  renderToolUseRejectedMessage?(input: ..., options: ...): React.ReactNode
  renderToolUseErrorMessage?(result: ..., options: ...): React.ReactNode
  renderGroupedToolUse?(toolUses: ..., options: ...): React.ReactNode | null
  extractSearchText?(out: Output): string
  isResultTruncated?(output: Output): boolean

  // === 分类器 ===
  isSearchOrReadCommand?(input: ...): { isSearch: boolean; isRead: boolean; isList?: boolean }
  isOpenWorld?(input: z.infer<Input>): boolean
  requiresUserInteraction?(): boolean
  toAutoClassifierInput(input: z.infer<Input>): unknown

  // === 序列化 ===
  mapToolResultToToolResultBlockParam(content: Output, toolUseID: string): ToolResultBlockParam
  backfillObservableInput?(input: Record<string, unknown>): void

  // === 路径 ===
  getPath?(input: z.infer<Input>): string
  inputsEquivalent?(a: z.infer<Input>, b: z.infer<Input>): boolean
}
```

### 2.2 工厂函数

**文件**: `src/Tool.ts:783-792`

```typescript
function buildTool<D extends AnyToolDef>(def: D): BuiltTool<D>
```

`ToolDef` 类型省略了 7 个可默认方法（`isEnabled`、`isConcurrencySafe`、`isReadOnly`、`isDestructive`、`checkPermissions`、`toAutoClassifierInput`、`userFacingName`），`buildTool()` 自动填充安全默认值：

| 方法 | 默认值 | 说明 |
|------|--------|------|
| `isEnabled` | `() => true` | 默认启用 |
| `isConcurrencySafe` | `() => false` | 默认不安全（fail-closed） |
| `isReadOnly` | `() => false` | 默认会写入（fail-closed） |
| `isDestructive` | `() => false` | 默认非破坏性 |
| `checkPermissions` | `{ behavior: 'allow' }` | 默认放行，交给通用权限系统 |
| `toAutoClassifierInput` | `''` | 默认跳过分类器 |
| `userFacingName` | 返回 `name` | 默认用工具名 |

### 2.3 工具集合类型

```typescript
type Tools = readonly Tool[]
```

---

## 3. Command / Skill 接口

### 3.1 判别联合类型

**文件**: `src/types/command.ts:205-206`

```typescript
type Command = CommandBase & (PromptCommand | LocalCommand | LocalJSXCommand)
```

Skill 就是 `type: 'prompt'` 的 Command。所有 Skill 最终统一为 `Command` 类型。

### 3.2 CommandBase — 公共字段

**文件**: `src/types/command.ts:175-203`

```typescript
type CommandBase = {
  name: string
  description: string
  aliases?: string[]
  isEnabled?: () => boolean               // 默认 true
  isHidden?: boolean                       // 默认 false
  isMcp?: boolean
  argumentHint?: string
  whenToUse?: string                       // Skill spec 中的使用场景描述
  version?: string
  disableModelInvocation?: boolean         // 禁止模型调用
  userInvocable?: boolean                  // 用户是否可 / 调用
  loadedFrom?: 'commands_DEPRECATED' | 'skills' | 'plugin' | 'managed' | 'bundled' | 'mcp'
  kind?: 'workflow'
  immediate?: boolean                      // 不等待 stop point 直接执行
  isSensitive?: boolean                    // 参数从历史中脱敏
  userFacingName?: () => string            // 默认返回 name
  availability?: ('claude-ai' | 'console')[]
  hasUserSpecifiedDescription?: boolean
  source: SettingSource | 'builtin' | 'mcp' | 'plugin' | 'bundled'
}
```

### 3.3 PromptCommand — Prompt 类型 Skill

**文件**: `src/types/command.ts:25-57`

```typescript
type PromptCommand = {
  type: 'prompt'
  progressMessage: string
  contentLength: number
  argNames?: string[]
  allowedTools?: string[]
  model?: string
  source: SettingSource | 'builtin' | 'mcp' | 'plugin' | 'bundled'
  pluginInfo?: { pluginManifest: PluginManifest; repository: string }
  disableNonInteractive?: boolean
  hooks?: HooksSettings
  skillRoot?: string
  context?: 'inline' | 'fork'             // inline: 展开到当前对话; fork: 子 Agent 执行
  agent?: string                           // fork 模式下的 Agent 类型
  effort?: EffortValue
  paths?: string[]                         // Glob 模式限制文件路径
  getPromptForCommand(args: string, context: ToolUseContext): Promise<ContentBlockParam[]>
}
```

### 3.4 LocalCommand — 本地异步命令

**文件**: `src/types/command.ts:74-78`

```typescript
type LocalCommand = {
  type: 'local'
  supportsNonInteractive: boolean
  load: () => Promise<{ call: LocalCommandCall }>
}
```

其中 `LocalCommandCall` 签名为：
```typescript
type LocalCommandCall = (
  args: string,
  context: LocalJSXCommandContext,
) => Promise<LocalCommandResult>
```

### 3.5 LocalJSXCommand — 本地 JSX 命令

**文件**: `src/types/command.ts:144-152`

```typescript
type LocalJSXCommand = {
  type: 'local-jsx'
  load: () => Promise<{ call: LocalJSXCommandCall }>
}
```

### 3.6 加载来源

```typescript
loadedFrom: 'commands_DEPRECATED'  // ~/.claude/commands/
           | 'skills'              // ~/.claude/skills/ + <project>/.claude/skills/
           | 'plugin'              // 第三方/内置插件
           | 'managed'             // 远程托管
           | 'bundled'             // 内置 bundle
           | 'mcp'                 // MCP 服务器提供
```

---

## 4. Agent 接口

### 4.1 AgentDefinition 联合类型

**文件**: `src/tools/AgentTool/loadAgentsDir.ts:106-165`

```typescript
type AgentDefinition =
  | BuiltInAgentDefinition
  | CustomAgentDefinition
  | PluginAgentDefinition
```

### 4.2 BaseAgentDefinition — 公共字段

**文件**: `src/tools/AgentTool/loadAgentsDir.ts:106-133`

```typescript
type BaseAgentDefinition = {
  agentType: string                      // Agent 名称标识
  whenToUse: string                      // 使用场景描述（何时应使用此 Agent）
  tools?: string[]                       // 允许使用的工具列表
  disallowedTools?: string[]             // 禁止使用的工具列表
  skills?: string[]                      // 预加载的 Skill 名称
  mcpServers?: AgentMcpServerSpec[]      // Agent 专属 MCP 服务器
  hooks?: HooksSettings                  // Agent 启动时注册的 Hook
  color?: AgentColorName                 // UI 颜色
  model?: string                         // 模型选择（'inherit' 表示继承）
  effort?: EffortValue                   // 努力级别
  permissionMode?: PermissionMode        // 权限模式
  maxTurns?: number                      // 最大轮次
  filename?: string                      // 原始文件名（不含扩展名）
  baseDir?: string                       // 基础目录
  criticalSystemReminder_EXPERIMENTAL?: string
  requiredMcpServers?: string[]          // 必须的 MCP 服务器（不满足则 Agent 不可用）
  background?: boolean                   // 始终在后台运行
  initialPrompt?: string                 // 首轮预填充内容
  memory?: 'user' | 'project' | 'local'  // 持久记忆范围
  isolation?: 'worktree' | 'remote'      // 隔离模式
  pendingSnapshotUpdate?: { snapshotTimestamp: string }
  omitClaudeMd?: boolean                 // 是否省略 CLAUDE.md 层级
}
```

### 4.3 三种子类型

```typescript
// 内置 Agent — 动态 prompt，无静态 systemPrompt
type BuiltInAgentDefinition = BaseAgentDefinition & {
  source: 'built-in'
  baseDir: 'built-in'
  getSystemPrompt: (params: { toolUseContext: ... }) => string
}

// 自定义 Agent — 从 Markdown/JSON 加载
type CustomAgentDefinition = BaseAgentDefinition & {
  source: SettingSource
  getSystemPrompt: () => string
  filename?: string
  baseDir?: string
}

// 插件 Agent
type PluginAgentDefinition = BaseAgentDefinition & {
  source: 'plugin'
  getSystemPrompt: () => string
  plugin: string
  filename?: string
}
```

### 4.4 Agent 注册结果

```typescript
type AgentDefinitionsResult = {
  activeAgents: AgentDefinition[]        // 去重后的活跃 Agent
  allAgents: AgentDefinition[]           // 所有 Agent
  failedFiles?: Array<{ path: string; error: string }>
  allowedAgentTypes?: string[]
}
```

### 4.5 Agent 覆盖优先级

同名 Agent 按优先级覆盖（高→低）：
1. managed (企业管控)
2. flagSettings (特性开关)
3. projectSettings (项目设置)
4. userSettings (用户设置)
5. plugin (插件)
6. built-in (内置)

### 4.6 6 个内置 Agent

| Agent | 模型 | 限制 | 用途 |
|-------|------|------|------|
| Explore | Haiku | 只读搜索 | 代码库探索、搜索 |
| Plan | Haiku | 只读规划 | 架构设计 |
| general-purpose | Sonnet | 全工具 | 通用任务 |
| verification | Haiku | /tmp 写入 | 代码验证 |
| claude-code-guide | Haiku | 只读搜索 | 文档查询 |
| statusline-setup | Haiku | 配置工具 | 状态行设置 |

---

## 5. MCP 接口

### 5.1 配置作用域

**文件**: `src/services/mcp/types.ts:10-21`

```typescript
type ConfigScope = 'local' | 'user' | 'project' | 'dynamic' | 'enterprise' | 'claudeai' | 'managed'
```

优先级（低→高）：
```
user → project → local → dynamic → enterprise → claudeai → managed
```

### 5.2 传输类型

**文件**: `src/services/mcp/types.ts:23-26`

```typescript
type Transport = 'stdio' | 'sse' | 'sse-ide' | 'http' | 'ws' | 'sdk'
```

### 5.3 服务器配置 — 判别联合

**文件**: `src/services/mcp/types.ts:124-135`

```typescript
type McpServerConfig =
  | McpStdioServerConfig        // { type?: 'stdio', command, args, env? }
  | McpSSEServerConfig          // { type: 'sse', url, headers?, oauth? }
  | McpSSEIDEServerConfig       // { type: 'sse-ide', url, ideName }
  | McpWebSocketIDEServerConfig // { type: 'ws-ide', url, ideName }
  | McpHTTPServerConfig         // { type: 'http', url, headers?, oauth? }
  | McpWebSocketServerConfig    // { type: 'ws', url, headers? }
  | McpSdkServerConfig          // { type: 'sdk', name }
  | McpClaudeAIProxyServerConfig // { type: 'claudeai-proxy', url, id }
```

带作用域：
```typescript
type ScopedMcpServerConfig = McpServerConfig & {
  scope: ConfigScope
  pluginSource?: string         // 插件提供的服务器标识
}
```

### 5.4 连接状态 — 判别联合

**文件**: `src/services/mcp/types.ts:180-226`

```typescript
type MCPServerConnection =
  | ConnectedMCPServer   // { type: 'connected', client, name, capabilities, cleanup }
  | FailedMCPServer      // { type: 'failed', name, config, error? }
  | NeedsAuthMCPServer   // { type: 'needs-auth', name, config }
  | PendingMCPServer     // { type: 'pending', name, config, reconnectAttempt? }
  | DisabledMCPServer    // { type: 'disabled', name, config }
```

### 5.5 MCP → Tool 桥接

MCP 工具通过**模板展开**转为 `Tool` 接口：

```
MCP 工具声明 → { ...MCPTool, name: 规范化名称, mcpInfo, call: 委托到 MCP 客户端, ... }
```

关键文件: `src/services/mcp/client.ts:1766-1770`

### 5.6 MCP → Skill 桥接

MCP 服务器的 prompts 通过 `mcpSkillBuilders` 注册表转为 Skill（Command）：

```typescript
// 文件: src/skills/mcpSkillBuilders.ts
registerMCPSkillBuilders(builders)
getMCPSkillCommands(): Command[]
```

---

## 6. Plugin 接口

### 6.1 LoadedPlugin

**文件**: `src/types/plugin.ts:48-70`

```typescript
type LoadedPlugin = {
  name: string
  manifest: PluginManifest
  path: string
  source: string
  repository: string
  enabled?: boolean
  isBuiltin?: boolean
  sha?: string                          // Git commit SHA

  // === 可贡献的组件路径 ===
  commandsPath?: string
  commandsPaths?: string[]
  commandsMetadata?: Record<string, CommandMetadata>
  agentsPath?: string
  agentsPaths?: string[]
  skillsPath?: string
  skillsPaths?: string[]
  outputStylesPath?: string
  outputStylesPaths?: string[]

  // === 可贡献的配置 ===
  hooksConfig?: HooksSettings
  mcpServers?: Record<string, McpServerConfig>
  lspServers?: Record<string, LspServerConfig>
  settings?: Record<string, unknown>
}
```

### 6.2 BuiltinPluginDefinition

**文件**: `src/types/plugin.ts:18-35`

```typescript
type BuiltinPluginDefinition = {
  name: string
  description: string
  version?: string
  skills?: BundledSkillDefinition[]
  hooks?: HooksSettings
  mcpServers?: Record<string, McpServerConfig>
  isAvailable?: () => boolean
  defaultEnabled?: boolean
}
```

### 6.3 PluginLoadResult

```typescript
type PluginLoadResult = {
  enabled: LoadedPlugin[]
  disabled: LoadedPlugin[]
  errors: PluginError[]         // 25 种错误类型
}
```

### 6.4 Plugin 可贡献的组件类型

```typescript
type PluginComponent = 'commands' | 'agents' | 'skills' | 'hooks' | 'output-styles'
```

---

## 7. Hook 接口

### 7.1 Hook 事件类型

**文件**: `src/entrypoints/agentSdkTypes.ts` (重导出)

```
HookEvent:
  - PreToolUse          # 工具调用前
  - PostToolUse         # 工具调用成功后
  - PostToolUseFailure  # 工具调用失败后
  - UserPromptSubmit    # 用户提交消息
  - SessionStart        # 会话开始
  - Stop                # 会话停止
  - SubagentStart       # 子 Agent 启动
  - SubagentStop        # 子 Agent 停止
  - PreCompact          # 压缩前
  - PostCompact         # 压缩后
  - PermissionDenied    # 权限被拒
  - PermissionRequest   # 权限请求
  - Notification        # 通知
  - CwdChanged          # 工作目录变更
  - FileChanged         # 文件变更
  - WorktreeCreate      # 工作树创建
  - Setup               # 设置
  - Elicitation         # 引出请求
  - ElicitationResult   # 引出结果
```

### 7.2 Hook 命令类型

**文件**: `src/schemas/hooks.ts:216-222`

```typescript
type HookCommand =
  | BashCommandHook   // { type: 'command', command, shell?, timeout?, ... }
  | PromptHook        // { type: 'prompt', prompt, model?, timeout?, ... }
  | AgentHook         // { type: 'agent', prompt, model?, timeout?, ... }
  | HttpHook          // { type: 'http', url, headers?, allowedEnvVars?, ... }
```

### 7.3 Hook 配置结构

```typescript
type HooksSettings = Partial<Record<HookEvent, HookMatcher[]>>

type HookMatcher = {
  matcher?: string      // 权限规则语法过滤（如 "Bash(git *)"）
  hooks: HookCommand[]  // 匹配时执行的 Hook 列表
}
```

### 7.4 Hook 回调接口

**文件**: `src/types/hooks.ts:211-226`

```typescript
type HookCallback = {
  type: 'callback'
  callback: (
    input: HookInput,
    toolUseID: string | null,
    abort: AbortSignal | undefined,
    hookIndex?: number,
    context?: HookCallbackContext,
  ) => Promise<HookJSONOutput>
  timeout?: number
  internal?: boolean
}
```

### 7.5 Hook 执行结果

**文件**: `src/types/hooks.ts:260-275`

```typescript
type HookResult = {
  message?: Message
  systemMessage?: Message
  blockingError?: HookBlockingError
  outcome: 'success' | 'blocking' | 'non_blocking_error' | 'cancelled'
  preventContinuation?: boolean
  stopReason?: string
  permissionBehavior?: 'ask' | 'deny' | 'allow' | 'passthrough'
  additionalContext?: string
  updatedInput?: Record<string, unknown>
  updatedMCPToolOutput?: unknown
  permissionRequestResult?: PermissionRequestResult
  retry?: boolean
}
```

---

## 8. 执行管线

### 8.1 Tool 执行管线

**文件**: `src/services/tools/toolOrchestration.ts`

```
runTools(toolCalls, context)
  ├── 分区: 串行工具 vs 并行工具
  ├── 串行: 逐个执行
  └── 并行: 并发执行（受 isConcurrencySafe 控制）

runToolUse(toolCall, context)
  ├── 1. 权限检查 (checkPermissions)
  ├── 2. 输入验证 (validateInput)
  ├── 3. PreToolUse Hook
  ├── 4. tool.call()
  ├── 5. PostToolUse Hook
  └── 6. 结果处理
```

### 8.2 Command/Skill 执行

```
用户输入 /skill args
  → commands handler
  → findCommand(name)
  → PromptCommand: getPromptForCommand(args, context) → 注入对话
  → LocalCommand: load().call(args, context) → 本地执行
  → LocalJSXCommand: load().call(onDone, context, args) → 渲染 UI
```

### 8.3 Agent 执行

```
模型调用 Agent 工具
  → AgentTool.call(args, context)
  → 查找 AgentDefinition
  → 创建子 Agent 上下文（过滤工具、注入 prompt）
  → 子 Agent 循环执行
  → 返回结果给主 Agent
```

---

## 9. 权限系统接口

### 9.1 PermissionResult

**文件**: `src/types/permissions.ts:251-266`

```typescript
type PermissionResult<Input> =
  | PermissionAllowDecision<Input>    // { behavior: 'allow', updatedInput?, ... }
  | PermissionAskDecision<Input>      // { behavior: 'ask', message, ... }
  | PermissionDenyDecision            // { behavior: 'deny', message, ... }
  | { behavior: 'passthrough', message, ... }
```

### 9.2 PermissionMode

```typescript
type PermissionMode = 'acceptEdits' | 'bypassPermissions' | 'default' | 'dontAsk' | 'plan' | 'auto' | 'bubble'
```

### 9.3 权限规则

```typescript
type PermissionRule = {
  source: 'userSettings' | 'projectSettings' | 'localSettings' | 'flagSettings' | 'policySettings' | 'cliArg' | 'command' | 'session'
  ruleBehavior: 'allow' | 'deny' | 'ask'
  ruleValue: { toolName: string; ruleContent?: string }
}
```

---

## 10. 注册表汇总

| 注册表 | 函数 | 文件 |
|--------|------|------|
| Tool 注册 | `getAllBaseTools()` → `getTools()` → `assembleToolPool()` | `src/tools.ts` |
| Command 注册 | `getCommands(cwd)` | `src/commands.ts:476` |
| Agent 注册 | `getAgentDefinitionsWithOverrides(cwd)` | `src/tools/AgentTool/loadAgentsDir.ts:296` |
| MCP 配置 | `getAllMcpConfigs()` | `src/services/mcp/config.ts` |
| MCP 连接 | `connectToMcpServer()` | `src/services/mcp/client.ts` |
| Plugin 加载 | `loadPlugins()` | `src/utils/plugins/` |
| Hook 配置 | `HooksSchema` → `settings.json` 中的 `hooks` 字段 | `src/schemas/hooks.ts` |

### 10.1 Tool 注册流程

```
getAllBaseTools()                     → 全量内置工具 (60+)
  ├── conditions: feature flags, env vars, platform
  └── 同步返回: readonly Tool[]

getTools(permissionContext)           → 当前可用工具
  ├── filterToolsByDenyRules()        → 去被 deny 的工具
  ├── isEnabled()                     → 去功能开关关闭的工具
  └── REPL 模式过滤                   → 隐藏被 REPL 包裹的基础工具

assembleToolPool(permCtx, mcpTools)  → 合并内置 + MCP
  ├── 分区排序（内置优先）
  └── uniqBy('name')                  → 内置优先去重
```

### 10.2 Command 注册流程

```
getCommands(cwd)
  ├── bundledSkills                   (内置 bundle)
  ├── builtinPluginSkills             (内置插件)
  ├── skillDirCommands                (.claude/skills/ 目录)
  ├── workflowCommands                (Workflow 工具生成)
  ├── pluginCommands                  (第三方插件)
  ├── pluginSkills                    (插件 skill)
  ├── COMMANDS()                      (内置命令)
  └── dynamicSkills                   (运行中发现)
       ↓
  meetsAvailabilityRequirement()      → 按 auth/provider 过滤
  isCommandEnabled()                  → 按功能开关过滤
```

---

## 11. 核心上下文类型

### 11.1 ToolUseContext

**文件**: `src/Tool.ts:158-300`

```typescript
type ToolUseContext = {
  options: {
    commands: Command[]
    tools: Tools
    mcpClients: MCPServerConnection[]
    mcpResources: Record<string, ServerResource[]>
    agentDefinitions: AgentDefinitionsResult
    debug: boolean
    verbose: boolean
    mainLoopModel: string
    thinkingConfig: ThinkingConfig
    isNonInteractiveSession: boolean
    maxBudgetUsd?: number
    customSystemPrompt?: string
    appendSystemPrompt?: string
    querySource?: QuerySource
    refreshTools?: () => Tools
  }
  abortController: AbortController
  readFileState: FileStateCache
  getAppState(): AppState
  setAppState(f: (prev: AppState) => AppState): void
  messages: Message[]
  toolDecisions?: Map<string, { source, decision, timestamp }>
  agentId?: AgentId
  agentType?: string
  // ... ~40 其他字段
}
```

### 11.2 ToolPermissionContext

**文件**: `src/Tool.ts:123-138`

```typescript
type ToolPermissionContext = DeepImmutable<{
  mode: PermissionMode
  additionalWorkingDirectories: Map<string, AdditionalWorkingDirectory>
  alwaysAllowRules: ToolPermissionRulesBySource
  alwaysDenyRules: ToolPermissionRulesBySource
  alwaysAskRules: ToolPermissionRulesBySource
  isBypassPermissionsModeAvailable: boolean
  shouldAvoidPermissionPrompts?: boolean
  awaitAutomatedChecksBeforeDialog?: boolean
  prePlanMode?: PermissionMode
}>
```

---

## 12. 模块依赖流

```
entrypoints/cli.tsx
  ├── → commands.ts (getCommands)
  │     ├── → skills/ (加载 skill)
  │     ├── → plugins/ (加载 plugin 命令)
  │     └── → commands/ (内置命令)
  │
  ├── → tools.ts (getAllBaseTools / getTools / assembleToolPool)
  │     ├── → tools/ (44+ Tool 实现)
  │     │     ├── AgentTool → loadAgentsDir → agents/
  │     │     ├── SkillTool → getCommands
  │     │     └── MCPTool → services/mcp/
  │     └── → services/mcp/client.ts (MCP 工具桥接)
  │
  ├── → services/mcp/config.ts (MCP 配置加载)
  ├── → services/mcp/client.ts (MCP 连接管理)
  │
  └── → QueryEngine.ts → query.ts (AI 调用循环)
        └── → services/tools/toolOrchestration.ts (工具执行)
              └── → services/tools/toolExecution.ts (单工具)
                    └── → utils/hooks.ts (Hook 引擎)
```

---

## 13. 设计模式总结

| 模式 | 应用 | 文件 |
|------|------|------|
| **工厂模式** | `buildTool(def)` 填充默认值 | `src/Tool.ts:783` |
| **判别联合** | `Command` / `AgentDefinition` / `MCPServerConnection` / `HookCommand` | 各 types 文件 |
| **模板展开** | MCP 工具转 Tool 接口 | `src/services/mcp/client.ts` |
| **策略模式** | Compact 多策略、权限多模式 | `compact/`, `permissions/` |
| **备忘录模式** | `getAgentDefinitionsWithOverrides` / `getCommands` memoized | 各注册文件 |
| **门面模式** | `Plugin` 统一多种组件的贡献 | `src/types/plugin.ts` |
| **桥接模式** | MCP → Tool, MCP → Skill | `mcp/client.ts`, `mcpSkillBuilders.ts` |
| **观察者模式** | Hook 生命周期事件系统 | `src/utils/hooks.ts` |

---

## 14. 设计评价

### 优点
- `Tool` 接口设计成熟，约 30 个方法覆盖了执行、描述、权限、渲染、序列化全生命周期
- `buildTool()` 工厂函数提供了 fail-closed 的合理默认值
- 判别联合类型在 Command/Agent/MCP 中广泛使用，类型安全
- Plugin 作为集成枢纽可一次性贡献多种组件

### 可改进点
- 无跨组件顶层抽象，新增组件类型需要新的桥接代码
- Tool 接口过于庞大（30+ 方法），可考虑拆分为更细粒度的 trait/接口组合
- 各组件的注册/加载/启用逻辑各自实现，缺乏统一的组件生命周期管理
- MCP → Tool 的模板展开桥接依赖对象展开语法，缺乏编译期类型安全保证
