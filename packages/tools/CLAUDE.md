# CLAUDE.md — @itookit/tools

独立工具包，采用 Claude Code 的 `buildTool()` 工厂+按工具分目录的架构模式。

## Architecture

```
src/
├── index.ts                     ← 公共 API + BUILTIN_TOOLS 注册表
├── core/
│   ├── Tool.ts                  ← Tool 接口 + buildTool() 工厂 + TOOL_DEFAULTS
│   ├── lazySchema.ts            ← 延迟 Zod Schema 构造（避免循环导入）
│   └── types.ts                 ← ToolUseContext, ToolResult, ValidationResult 等
├── tools/
│   ├── FileRead/                ← ReadTool — 文件读取（VFS + Node.js）
│   ├── FileWrite/               ← WriteTool — 文件创建/覆盖（VFS + Node.js）
│   ├── FileEdit/                ← EditTool — 字符串替换编辑
│   ├── Glob/                    ← GlobTool — 文件名匹配搜索
│   ├── Grep/                    ← GrepTool — 内容正则搜索
│   ├── Bash/                    ← BashTool — Shell 命令执行（含危险命令拦截）
│   ├── Skill/                   ← SkillTool — 动态加载 Skill（工厂模式）
│   ├── Agent/                   ← AgentTool — 子代理委派（工厂模式）
│   ├── Task/                    ← TaskCreate/Get/List/Update + TaskOutput — 任务管理
│   ├── PlanMode/                ← EnterPlanMode/ExitPlanMode — 计划模式
│   ├── AskUserQuestion/         ← AskUserQuestionTool — 用户问答
│   ├── WebFetch/                ← WebFetchTool — URL 抓取
│   ├── WebSearch/               ← WebSearchTool — 网络搜索（IWebSearchProvider 工厂，P0）
│   ├── MCP/                     ← MCPTool — MCP 协议客户端（IMCPClient 工厂，P0）
│   ├── SendMessage/             ← SendMessageTool — 消息路由（IMessageRouter 工厂，P1）
│   └── ToolSearch/              ← ToolSearchTool — 延迟工具发现（P1）
├── adapters/
│   └── tool-device-driver.ts    ← ToolDeviceDriver — Tool[] → IToolService
└── utils/                       ← 工具函数
```

## 核心模式

### buildTool() 工厂
每个工具用 `buildTool(def)` 创建，提供安全默认值：
- `isConcurrencySafe` → `false`（默认不安全）
- `isReadOnly` → `false`（默认写操作）
- `checkPermissions` → `{ behavior: 'allow' }`
- `userFacingName` → `tool.name`

### 工具目录结构
每个工具子目录至少包含：
```
ToolName/
  prompt.ts       ← 名称常量 + description + prompt 文本
  ToolNameTool.ts ← buildTool() 实现
```

### 静态 vs 动态工具
- **静态工具**: 无运行时依赖，直接 `export const XxxTool = buildTool({...})`，在 `BUILTIN_TOOLS` 数组注册
- **动态工具**: 需要运行时服务（ISkillService/ISubAgentRouter），工厂模式 `createXxxTool(service)` 返回 Tool
- **P0 工具** (WebSearch, MCP): 工厂模式，需要外部服务注入
- **P1 工具** (TaskOutput, SendMessage, ToolSearch): 同样工厂模式

### Tool 接口新增成员

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
- VFS 优先：文件类工具检查 `context.vfs`，有则走浏览器 VFS，无则走 node:fs
- 错误通过 throw 抛出，由 ToolDeviceDriver 捕获并转为 `ToolInvokeResult { success: false }`
- `mapToolResultToToolResultBlockParam()` 将结构化输出转为 LLM 文本
