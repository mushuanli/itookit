# @itookit/tools 开发说明

独立工具包，采用 `buildTool()` 工厂 + 按工具分目录的架构模式。平台能力由宿主注入：文件读写走 `ToolVFSContext`，命令执行走 `INativeShell`（本包不 spawn 进程），Grep/Glob 在无 VFS 时回退到 Node 文件系统遍历。

## 目录结构

```
src/
├── index.ts                     ← 公共 API + BUILTIN_TOOLS 注册表
├── core/
│   ├── Tool.ts                  ← Tool 接口 + buildTool() 工厂 + TOOL_DEFAULTS
│   ├── lazySchema.ts            ← 延迟 Zod Schema 构造（避免循环导入）
│   ├── globToRegex.ts           ← glob → RegExp
│   └── types.ts                 ← ToolUseContext, ToolResult, INativeShell 等
├── tools/
│   ├── FileRead/                ← ReadTool — 文件读取
│   ├── FileWrite/               ← WriteTool — 文件创建/覆盖
│   ├── FileEdit/                ← EditTool — 字符串替换编辑
│   ├── Glob/                    ← GlobTool — 文件名匹配搜索
│   ├── Grep/                    ← GrepTool — 内容正则搜索
│   ├── Bash/                    ← BashTool — Shell 命令执行（含危险命令拦截）
│   ├── Skill/                   ← SkillTool — 动态加载 Skill（工厂模式）
│   ├── Agent/                   ← AgentTool — 子代理委派（工厂模式）
│   ├── Task/                    ← TaskCreate/Get/List/Update + TaskOutput/TaskStop — 任务管理
│   ├── PlanMode/                ← EnterPlanMode/ExitPlanMode — 计划模式
│   ├── AskUserQuestion/         ← AskUserQuestionTool — 用户问答
│   ├── WebFetch/                ← WebFetchTool — URL 抓取
│   ├── WebSearch/               ← WebSearchTool — 网络搜索（IWebSearchProvider 工厂）
│   ├── MCP/                     ← MCPTool — MCP 协议客户端（IMCPClient 工厂）
│   ├── SendMessage/             ← SendMessageTool — 消息路由（IMessageRouter 工厂）
│   └── ToolSearch/              ← ToolSearchTool — 延迟工具发现
└── adapters/
    └── tool-device-driver.ts    ← ToolDeviceDriver — Tool[] → IToolService
```

## 核心模式

### buildTool() 工厂
每个工具用 `buildTool(def)` 创建，提供安全默认值：
- `isConcurrencySafe` → `false`（默认不安全）
- `isReadOnly` → `false`（默认写操作）
- `interruptBehavior` → `'block'`
- `checkPermissions` → `{ behavior: 'allow' }`
- `userFacingName` → `tool.name`

### 工具目录结构
每个工具子目录包含 `prompt.ts`（名称常量 + description + prompt 文本）与 `buildTool()` 实现文件（单个工具用 `XxxTool.ts`，多工具同目录用 `XxxTools.ts`，如 `Task/TaskTools.ts`）。

### 静态 vs 工厂工具
- **静态工具**：无运行时依赖，直接 `export const XxxTool = buildTool({...})`，注册进 `BUILTIN_TOOLS`
- **工厂工具**：需要运行时服务或外部注入，`createXxxTool(service)` 返回 Tool，由宿主通过 `ToolDeviceDriver.registerToolInstance()` 注册
  - `createSkillTool(ISkillService)`、`createAgentTool(ISubAgentRouter)`、`createWebSearchTool(IWebSearchProvider)`、`createBashTool(INativeShell)`、`createAskUserQuestionTool(callback)`
  - `createMCPTools` / `createSingleMCPTool(IMCPClient)`、`createTaskOutputTool` / `createTaskStopTool(ITaskStore)`、`createSendMessageTool(IMessageRouter)`、`createToolSearchTool(getTools)`

### Tool 接口可选成员

| 成员 | 类型 | 用途 |
|---|---|---|
| `shouldDefer` | `boolean` | 为 true 时带 `defer_loading` 标记发送，需 ToolSearch 先调用 |
| `interruptBehavior` | `() => 'cancel' \| 'block'` | 用户提交新消息时的中断行为 |
| `isSearchOrReadCommand` | `(input) => 'search' \| 'read' \| 'list' \| 'none'` | UI 折叠分类 |

`ToolDeviceDriver.invoke()` 处理 `interruptBehavior`。

## 添加新工具

1. 在 `tools/` 下创建子目录
2. 添加 `prompt.ts`（导出 `NAME` + `DESCRIPTION`）
3. 添加 `XxxTool.ts`，使用 `buildTool()` 实现
4. 在 `index.ts` 中导入并注册到 `BUILTIN_TOOLS`

## Conventions

- `satisfies ToolDef<InputSchema, OutputType>` 确保类型安全
- `lazySchema()` 包裹所有 Zod schema 避免模块加载时循环依赖
- 文件读写工具（FileRead/FileWrite/FileEdit）要求 `context.vfs`，缺失时抛错；Grep/Glob 优先用 `context.shell` 的 ripgrep/fd，其次 `context.vfs`，最后 Node 手动遍历
- 错误通过 throw 抛出，由 ToolDeviceDriver 捕获并转为 `ToolInvokeResult { success: false }`
- `mapToolResultToToolResultBlockParam()` 将结构化输出转为 LLM 文本

## 命令

```bash
pnpm --filter @itookit/tools build       # tsup
pnpm --filter @itookit/tools typecheck
pnpm --filter @itookit/tools test        # vitest
```

相关文档：[开发模式](../../doc/dev-patterns.md) `#tools`、[接口契约](../../doc/interface-contracts.md)
