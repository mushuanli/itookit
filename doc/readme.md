# MetaMind — 技术文档

> 认知加速与外部化操作系统（Externalized Cognitive Operating System）

MetaMind 是一个**本地优先、AI 原生的知识工作台**。它将刻意学习、高质量思考沉淀与 AI 自动化执行连接为一个闭环系统。

是一个**“认知加速与外部化操作系统”（Externalized Cognitive Operating System）**。

在通用人工智能（AGI）指数级增长的时代，人类面临的挑战不再是信息的获取，而是认知带宽的限制。信息洪流导致认知熵增：宝贵的思考被遗忘、重复劳动吞噬时间、以及高质量的思维模型缺乏系统性训练。

这款产品旨在解决“信息丰富”与“心智贫乏”的悖论：AI使数据获取成本趋近于零，但高质量思考和心智带宽成为最稀缺的资源。

**愿景：** 在AI时代，将人类的“元认知”能力（对自身思维的思考）系统化、可训练、可复用，从而实现人类思维效率的指数级增长。

**产品定位：** 一个连接**刻意学习、高质量思考沉淀**和**AI自动化执行**的闭环系统。它不是取代人类思维，而是将人类最宝贵的“提问能力”和“判断能力”进行最大化杠杆。

MetaMind围绕两大核心支柱：**思维的刻意练习** 和 **思维的复用/杠杆**，构建四大模块。

MetaMind的终极目标是成为用户**“外部化的大脑前额叶”**，管理着人类的决策、规划和认知负荷。
将人类的瞬时洞察转化为可复用的、高杠杆的AI指令和自主智能体，实现思维的自动化、规模化和持续优化。
我们不再是知识的保管员，而是知识的架构师、训练师和指挥官。认知驱动器是为那些致力于在信息噪音中提炼最高质量洞察的专业人士所设。
---
好的，这是根据您提供的内容整理的简要、有条理的文档：

---

### **MetaMind 产品概述**

#### **一、 核心理念**
MetaMind 是一个 **“认知加速与外部化操作系统”** 。它旨在解决AI时代“信息丰富”与“心智贫乏”的悖论，核心挑战从**信息获取**转变为**认知带宽**的管理。

#### **二、 解决的问题**
- **认知熵增**：信息洪流导致宝贵思考被遗忘、重复劳动、思维模型缺乏系统训练。
- **资源稀缺**：数据成本趋零，但高质量思考与心智带宽成为最稀缺资源。

#### **三、 产品愿景**
在AGI时代，将人类的 **“元认知”能力**（对自身思维的思考）系统化、可训练、可复用，从而实现人类思维效率的指数级增长。

#### **四、 产品定位**
一个连接 **刻意学习**、**高质量思考沉淀** 和 **AI自动化执行** 的闭环系统。其核心不是取代人类，而是最大化杠杆人类的 **“提问能力”** 与 **“判断能力”**。

#### **五、 核心支柱与模块**
围绕两大核心支柱构建四大功能模块：
1.  **思维的刻意练习**
2.  **思维的复用/杠杆**

#### **六、 终极目标**
成为用户的 **“外部化的大脑前额叶”** ，管理人类的决策、规划和认知负荷。实现：
- 将瞬时洞察转化为可复用的、高杠杆的AI指令与自主智能体。
- 实现思维的**自动化、规模化和持续优化**。

#### **七、 目标用户**
致力于在信息噪音中提炼高质量洞察的**专业人士**。用户角色从“知识的保管员”转变为 **“知识的架构师、训练师和指挥官”**。

---

---

## 目录

- [产品定位](#产品定位)
- [技术架构](#技术架构)
- [核心包说明](#核心包说明)
- [LLM Harness — Agent 执行引擎](#llm-harness--agent-执行引擎)
- [Skill 系统](#skill-系统)
- [MCP Server 集成](#mcp-server-集成)
- [聊天输入 Skill 调用语法](#聊天输入-skill-调用语法)
- [快速开始](#快速开始)

---

## 产品定位

在 AGI 指数级增长的时代，人类面临的挑战不再是信息获取，而是**认知带宽**的限制。MetaMind 的终极目标是成为用户的「外部化大脑前额叶」，管理决策、规划和认知负荷。

围绕两大支柱：**思维的刻意练习** 与 **思维的复用/杠杆**，将人类瞬时洞察转化为可复用的、高杠杆的 AI 指令和自主智能体。

---

## 技术架构

```
┌─────────────────────────────────────────────────────────────────┐
│                       Application Layer                          │
│  mind-os (apps/web-app)  — Vite SPA，产品入口                   │
└──────────────────────────────┬──────────────────────────────────┘
                               │
    ┌──────────────────────────┼──────────────────────────┐
    ▼                          ▼                          ▼
┌─────────┐            ┌──────────────┐          ┌──────────────┐
│ llm-ui  │            │  llm-runtime  │          │ memory-manager│
│ 聊天 UI │            │ 会话+执行引擎 │          │ 工作区容器   │
└────┬────┘            └──────┬───────┘          └──────────────┘
     │                        │
     │                ┌───────┴────────┐
     │                ▼                ▼
     │        ┌──────────────┐  ┌────────────┐
     │        │  llm-harness │  │ device-llm │
     │        │ Agent多轮执行 │  │ LLM通信层  │
     │        └──────┬───────┘  └─────┬──────┘
     │               │               │
     └───────────────┴───────────────┘
                     │
     ┌───────────────┼────────────────┐
     ▼               ▼                ▼
┌──────────┐  ┌────────────┐  ┌───────────┐
│  tools   │  │  stdio    │  │  common   │
│ 内置工具 │  │ 虚拟文件系统│  │ 共享接口  │
└──────────┘  └────────────┘  └───────────┘
```

**统一执行路径（TaskGraph v3）：**

所有 chat / loop / flow / mission / session-graph 提交编译为 TaskGraphRun，由 TaskGraphReconciler 统一调度。

---

## 核心包说明

| 包 | 职责 |
|---|---|
| `@itookit/common` | 共享接口、类型、工具函数。零运行时依赖，是跨包契约的唯一来源 |
| `@itookit/stdio` | VFS 引擎核心 — POSIX 风格虚拟文件系统，支持 assetdir 隔离与多驱动挂载 |
| `@itookit/device-llm` | LLM API 通信 — OpenAI/Anthropic/Gemini，SSE 流式，MCP 协议，Skill 存储 |
| `@itookit/llm-harness` | **Agent 执行引擎** — 多轮 Agent 循环、HarnessLoopExecutor (ILoop)、HarnessAgentTaskExecutor (TaskExecutor)、六维预算、上下文压缩、错误恢复 |
| `@itookit/llm-runtime` | **会话 + 执行引擎** — 会话管理、VFS 持久化（ChatEngine）、TaskGraph DAG 编排、ILoop 协程、Plugin 系统 |
| `@itookit/tools` | **内置工具** — file_read/write/edit、glob_search、grep_search、shell_exec 等 |
| `@itookit/llm-ui` | Chat UI 组件 — 聊天历史、输入框（含 Slash / Mention / Skill 插件）、Agent 编辑器 |
| `@itookit/memory-manager` | 顶层工作区容器 — VFSUIShell + 编辑器 + BackgroundBrain |

---

## LLM Harness — Agent 执行引擎

`llm-harness` 是整个系统的核心执行引擎，实现**自主多轮 Agent 循环**。

### 核心 Loop 不变式

```
每轮循环：
  1. [Budget Check]      检查六维预算（轮次/输入 token/输出 token/费用/时长/工具调用数）
  2. [Context Compress]  评估上下文使用率，触发时执行四层压缩
  3. [Build Prompt]      动态构建系统提示词（支持渐进式 Skill 暴露）
  4. [LLM Call]          调用 LLM（含五类错误恢复：限流/上下文过大/过载/截断/工具异常）
  5. [Parse Response]
     ├─ Has tool_calls → 权限检查 → 并行/串行执行 → 结果回馈 → GOTO 1
     └─ No tool_calls  → 反压验证 → 通过退出 / 失败注入错误 → GOTO 1
```

### 四层上下文压缩

| 层级 | 触发 urgency | 策略 | 信息损失 |
|---|---|---|---|
| L1 HISTORY_SNIP | ≥ 0.70 | 截断大型工具输出（保留头尾各 N 行） | 极低 |
| L2 CACHE_PRUNE | ≥ 0.80 | 移除低价值中间消息 | 低 |
| L3 LLM_SUMMARIZE | ≥ 0.85 | 用 summarizer 模型对旧对话做结构化摘要 | 中等 |
| L4 SLIDING_WINDOW | ≥ 0.95 | 激进截断，只保留最近 6 条 | 高（仅极端情况） |

### 内置工具

| 工具 | 副作用 | 描述 |
|---|---|---|
| `file_read` | none | 读取文件，支持行偏移/限制 |
| `file_write` | local | 写入文件，自动创建目录 |
| `shell_exec` | local | 执行 shell 命令，含危险命令拦截 |
| `glob_search` | none | glob 模式文件搜索 |
| `grep_search` | none | 正则内容搜索，返回 `path:行号` 格式 |
| `load_skill` | none | 动态加载 Skill，注入工具和指令 |
| `delegate_task` | none | 委托子代理执行（独立上下文，防止主代理污染） |

### 快速接入

```typescript
import { createHarness, NodeShellRunner } from '@itookit/llm-harness';
import { LLMDeviceDriver } from '@itookit/device-llm';

const llmDriver = new LLMDeviceDriver(vfs, {
    shellRunner: new NodeShellRunner(), // Node.js 环境提供 shell 执行能力
});

const harness = await createHarness({ llmDriver });

// 监听事件
harness.runtime.on('agent:tool:start', ({ toolId, callId }) =>
    console.log(`Running: ${toolId} [${callId}]`));

harness.runtime.on('agent:budget:warning', ({ resource, usedRatio }) =>
    console.warn(`⚠️ ${resource} at ${(usedRatio * 100).toFixed(0)}%`));

// 权限控制
harness.runtime.onIntercept('agent:permission:request', async ({ toolId, args }) => {
    return await askUser(`Allow ${toolId}?`);
});

// 执行任务
const result = await harness.runtime.run({
    prompt: '重构 src/auth.ts 的错误处理，确保所有异常都被正确捕获',
    workingDirectory: '/workspace/my-project',
});

console.log(`Status: ${result.status}`);
console.log(`Cost: $${result.usage.costUsd.toFixed(4)}`);
console.log(`Turns: ${result.turns}`);
```

---

## Skill 系统

Skill 是 LLM 能力的可插拔扩展单元。每个 Skill 包含：
- **`instructions`** — 注入 system prompt 的 Markdown 指令
- **`tools`** — 附带的工具绑定（builtin / http / shell / mcp）
- **`triggerPatterns`** — 触发自动加载的关键词正则

### Skill 类型

| 类型 | 图标 | 用途 | 执行方式 |
|---|---|---|---|
| **`prompt`** | 📝 | Markdown 指令注入（最常用） | 仅 system prompt，无工具 |
| **`shell`** | 🖥️ | 本地命令行工具包装 | `spawn('sh', ['-c', cmd])`，支持 `{{arg}}` 模板 |
| **`mcp`** | 🔌 | 引用已配置的 MCP Server 工具 | MCP 协议调用，参数 Schema 自动继承 |
| **`http`** | 🌐 | 远程 REST 端点 | `fetch(endpoint, { body: JSON.stringify(args) })` |
| **`builtin`** | ⚙️ | 引用内置工具（load_skill 等） | 已注册，Skill 只是引用 |

### Shell Skill 示例

```json
{
  "id": "git-log",
  "name": "Git 历史",
  "type": "shell",
  "enabled": true,
  "instructions": "## Git 日志查询\n使用 git_log 工具查询提交历史。",
  "tools": [{
    "toolId": "git_log",
    "executionType": "shell",
    "command": "git log --oneline -{{n}} -- {{path}}",
    "sideEffect": "none"
  }],
  "triggerPatterns": ["git", "commit", "history"]
}
```

### Prompt Skill 示例（最常见）

```json
{
  "id": "code-review",
  "name": "代码审查规范",
  "type": "prompt",
  "enabled": true,
  "instructions": "# 代码审查规范\n\n- 每个函数不超过 30 行\n- 圈复杂度不超过 10\n- 所有公开 API 必须有 JSDoc\n- 错误处理不得吞掉异常"
}
```

### MCP Skill 示例

```json
{
  "id": "search-codebase",
  "name": "搜索代码库",
  "type": "mcp",
  "mcpServerId": "mcp-server-id-123",
  "mcpToolName": "search",
  "enabled": true,
  "instructions": "## 代码搜索\n使用 search 工具在代码库中查找相关内容。"
}
```

### IShellRunner — 平台隔离

`shell` 类型 Skill 的执行通过 `IShellRunner` 接口隔离，不同环境注入不同实现：

```typescript
// Node.js / Electron
import { NodeShellRunner } from '@itookit/llm-harness';
new LLMDeviceDriver(vfs, { shellRunner: new NodeShellRunner() });

// Tauri（未来）
import { TauriShellRunner } from '@/shell/tauri-shell-runner';
new LLMDeviceDriver(vfs, { shellRunner: new TauriShellRunner() });

// 浏览器（默认）— 返回"不支持"提示，不报错
new LLMDeviceDriver(vfs);
```

---

## MCP Server 集成

MetaMind 支持完整的 [MCP (Model Context Protocol)](https://modelcontextprotocol.io) 集成。

### 配置 MCP Server

在设置界面的 **MCP Servers** 标签页中添加服务器：

| 传输协议 | 适用场景 | 配置字段 |
|---|---|---|
| **Stdio** | 本地进程（推荐） | `command` + `args` + `cwd` |
| **SSE** | HTTP 流式服务器 | `endpoint` + `apiKey` |
| **HTTP** | REST 端点 | `endpoint` + `apiKey` |

### MCP Server vs HTTP Skill

| 维度 | HTTP Skill | MCP Skill |
|---|---|---|
| 端点配置 | 每个 Skill 手动填写 | 在 MCP Server 里统一管理 |
| 认证 | 每个 Skill 手动填写 | 自动继承 MCP Server 配置 |
| 参数 Schema | 手动写 JSON Schema | 自动从 MCP Server 工具定义继承 |
| 适用场景 | 独立 REST API | MCP 协议暴露的工具集 |

**建议：** 如果目标服务支持 MCP 协议，优先使用 **MCP Skill**（配置更简洁，一处维护）。

---

## 聊天输入 Skill 调用语法

在聊天输入框中，Skill 可以通过 Slash 命令直接调用，支持丰富的参数语法。

### 基本语法

```
/skill-name [--key value]* [[name](path)]* [@file|@*.glob]* [free text]
```

### 调用示例

| 输入 | 效果 |
|---|---|
| `/review` | 弹出 Skill 选择面板，选择 review skill 并进入调用模式 |
| `/review [auth.ts](./auth.ts)` | 对 auth.ts 执行 code review |
| `/review [auth.ts](./auth.ts) 重点关注安全漏洞` | 带指令的文件 review |
| `/review @src/*.ts` | 对 src/ 下所有 TS 文件 review（glob 展开） |
| `/translate --lang ja Hello world` | 翻译，具名参数 |
| `/git-log --n 20 --path src/` | Shell skill，填充 `{{n}}` 和 `{{path}}` 占位符 |
| `/weather --city Beijing --unit c` | HTTP/MCP skill，具名参数映射到 API body |

### 参数类型解析

```
/review [auth.ts](./src/auth.ts) @src/*.ts --focus security 检查 JWT 实现
         │                        │           │               │
         │                        │           │               └── free text → prompt 的 Task 字段
         │                        │           └── --key value → args map
         │                        └── glob pattern → sessionEngine.search() 展开
         └── Markdown link → filePath（AttachmentProcessor 读取内容）
```

### Slash 弹出面板

输入 `/` 触发命令面板，技能在面板中按加载状态分组：
- 在 `Skills (loaded)` 组的技能已激活
- 在 `Skills` 组的技能选择后自动加载

**注意：** 输入命令名并加空格后（如 `/review `），弹出面板自动关闭，进入参数输入模式。`@` 触发文件选择器可在此模式下正常使用。

### 缺参数 Wizard

Shell Skill 有 `{{arg}}` 占位符时，若调用未提供该参数：

```
用户: /git-log
系统: 提示 "Missing: --n, --path"
       输入框自动填充: /git-log --n ___ --path ___
用户: 修改 ___ → /git-log --n 20 --path src/
       按 Enter 执行
```

---

## 快速开始

### 开发环境

```bash
# 启动开发服务器
pnpm dev

# 构建所有包
pnpm build

# 类型检查
pnpm typecheck

# 单包构建
pnpm --filter @itookit/llm-harness build
```

### 构建工具

| 包类型 | 构建工具 | 输出格式 |
|---|---|---|
| 逻辑包（`common`, `stdio`, `llm-harness`, `llm-runtime`, `tools`） | **tsup** | CJS + ESM + `.d.ts` |
| UI 包（`llm-ui`, `vfs-ui`, `memory-manager`, `app-settings`, `mdx`） | **vite build** | ESM |

### 添加新 Skill（示例）

```typescript
import { createHarness } from '@itookit/llm-harness';

const harness = await createHarness({ llmDriver });

// 注册 Prompt Skill（只注入指令，无工具）
await harness.skillService.saveSkill({
    id: 'ts-style',
    name: 'TypeScript 代码规范',
    type: 'prompt',
    enabled: true,
    instructions: `
# TypeScript 编码规范
- strict 模式，函数必须有显式返回类型
- 优先使用纯函数
- 圈复杂度 ≤ 10
    `.trim(),
    tools: [],
    triggerPatterns: ['typescript', 'refactor', 'review'],
    autoLoad: false,
    priority: 10,
});

// 注册 Shell Skill
await harness.skillService.saveSkill({
    id: 'lint',
    name: 'ESLint',
    type: 'shell',
    enabled: true,
    instructions: '## ESLint\n使用 lint 工具检查代码规范。',
    tools: [{
        toolId: 'run_eslint',
        executionType: 'shell',
        command: 'npx eslint {{path}} --format compact',
        sideEffect: 'none',
        timeoutMs: 30000,
        definition: {
            name: 'run_eslint',
            description: '运行 ESLint 检查指定路径',
            parameters: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: '要检查的文件路径或 glob 模式' },
                },
                required: ['path'],
            },
        },
    }],
    triggerPatterns: ['lint', 'eslint', 'style'],
    autoLoad: false,
    priority: 20,
});
```

---

## 相关文档

| 文档 | 内容 |
|---|---|
| [`doc/harness.md`](./harness.md) | Agent 执行调度器综合设计方案（详细架构） |
| [`doc/harness-api.md`](./harness-api.md) | Harness 接口设计文档 |
| [`doc/product.md`](./product.md) | 产品需求与功能规划 |
| [`CLAUDE.md`](../CLAUDE.md) | 开发环境配置与架构约定（供 AI 助手参考） |

---

*MetaMind — 我们不再是知识的保管员，而是知识的架构师、训练师和指挥官。*
