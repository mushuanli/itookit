# Slash Command 系统

## 架构总览

```
用户输入 "/cmd args" + Enter
  │
  ▼
ChatInputView.triggerSend()
  │
  ├─ plugins[i].onInput(text)           ← 输入时弹窗
  └─ plugins[i].onBeforeSend(text)      ← 发送时拦截
       │
       ▼
  SlashCommandPlugin.onBeforeSend()
       │ 正则: /^\/(\S+)\s*(.*)/s
       │ cmdName="cmd", argsStr="args"
       │
       ├─ staticCmd → executeCommand(cmd, args)
       └─ skillCmd  → executeCommand(cmd, args)
            │
            ├─ ctx.setText('')  (unless preserveInput)
            └─ command.execute(args, ctx)
                 │
                 ▼
            SlashCommandCallbacks.onXxx(args)
                 │
                 ▼
            deps.sendCommand.run({ text, files, ... })
                 │
                 ▼
            SendMessageCommand → SessionManager.sendMessage()
                 → TaskRunner.submit(TaskInput)
```

## 关键文件

| 层 | 文件 | 职责 |
|---|---|---|
| 接口 | `components/input/plugins/SlashCommandPlugin.ts` | `SlashCommandDef`, `SlashCommandCallbacks`, `InputPlugin` |
| 注册 | 同上 `buildDefaultCommands()` | 所有静态命令定义（~34 个） |
| 解析 | 同上 `onInput()` / `onBeforeSend()` | `/` 触发弹窗、Enter 时分发命令 |
| 回调 | `shell/SlashCommandRouter.ts` | `buildSlashCallbacks()` — 所有回调实现 |
| 布线 | `shell/LLMWorkspaceEditor.ts` | 创建 `SlashCommandPlugin`，注入 `ChatInputView` |
| 发送 | `commands/SendMessageCommand.ts` | `SendMessageParams` → `SessionManager.sendMessage()` |
| 引擎 | `llm-engine/src/session/session-manager.ts` | `sendMessage()` → `TaskRunner.submit(TaskInput)` |
| 类型 | `llm-engine/src/core/types.ts` | `TaskInput` (含 `origin`, `historyPolicy`) |

## 核心类型

### SlashCommandDef

```ts
interface SlashCommandDef {
    name: string;            // 不含 / 的命令名
    label: string;           // 显示标签
    description: string;
    icon?: string;
    group?: string;          // Common | Refine | Context | View | Tools | Branch | Settings
    execute: (args: string, ctx: InputPluginContext) => void | Promise<void>;
    hasArgs?: boolean;       // 需要参数时设为 true
    argsPlaceholder?: string;
    preserveInput?: boolean; // true = 执行后不清空输入框
}
```

### SlashCommandCallbacks

回调接口，将命令执行委托给 Shell 层。所有回调均为可选（Harness 相关），但常用命令为必选。

```ts
interface SlashCommandCallbacks {
    // Common
    onRetry: () => void;
    onClear: () => void;
    onDeleteLast: () => void;
    onReedit: () => void;
    onNew: (args: string) => void;
    onBtw: (args: string) => void;      // /btw — 旁注请求

    // Refine
    onShorter: () => void;
    onLonger: () => void;
    // ...更多回调
}
```

### SendMessageParams

Slash 命令最终通过 `sendCommand.run(params)` 发送消息：

```ts
interface SendMessageParams {
    text: string;
    files: File[];
    agentId?: string;
    overrides?: ChatOverrides;           // historyLength, useHarness, temperature, ...
    origin?: SessionOrigin;             // 'user' | 'agent' | 'system'
    historyPolicy?: HistoryPolicy;       // 'include' | 'exclude'
}
```

## 消息发送链路的两个特殊字段

| 字段 | 类型 | 作用 |
|---|---|---|
| `origin` | `'user' \| 'agent' \| 'system'` | 控制 UI 视觉样式和初始折叠策略 |
| `historyPolicy` | `'include' \| 'exclude'` | `'exclude'` = 此消息对不进后续 LLM history |

这两个字段贯穿整条链路：`SendMessageParams` → `SessionManager.sendMessage()` → `TaskInput` → `SessionGroup` → 持久化 `ChatNode.meta`。

## 新增 Slash Command 流程

### 简单命令（无参数，如 `/clear`）

**步骤：**

**1. 在 `SlashCommandCallbacks` 接口添加回调签名**（`SlashCommandPlugin.ts`）：
```ts
onMyCommand: () => void;
```

**2. 在 `buildDefaultCommands()` 注册命令**（`SlashCommandPlugin.ts`）：
```ts
{
    name: 'mycmd',
    label: '/mycmd',
    description: 'Do something useful',
    icon: '🔧',
    group: 'Common',
    execute: () => cb.onMyCommand(),
}
```

**3. 在 `buildSlashCallbacks()` 实现回调**（`SlashCommandRouter.ts`）：
```ts
onMyCommand: () => {
    // 实现逻辑，可访问 deps.sessionManager, deps.bus, deps.sendCommand 等
},
```

### 带参数命令（如 `/btw <message>`）

**1. 添加回调签名**：
```ts
onMyCommand: (args: string) => void;
```

**2. 注册命令（设 `hasArgs: true`）**：
```ts
{
    name: 'mycmd',
    label: '/mycmd',
    description: 'Do something with argument',
    icon: '🔧',
    group: 'Common',
    hasArgs: true,
    argsPlaceholder: 'message...',
    execute: (args) => cb.onMyCommand(args),
}
```

**3. 实现回调 — 校验参数后调用 sendCommand**：
```ts
onMyCommand: (args: string) => {
    if (!args.trim()) {
        Toast.error('Usage: /mycmd <message>');
        return;
    }
    deps.sendCommand.run({
        text: args.trim(),
        files: [],
        overrides: { historyLength: 0 },  // 可选：不带历史
        historyPolicy: 'exclude',         // 可选：输出不进后续历史
    });
},
```

### 需要扩展 SendMessageParams 的情况

如果命令需要传递 `origin`、`historyPolicy` 或其他新字段到引擎层：

1. 在 `SendMessageParams` 添加字段
2. 在 `SendMessageCommand.execute()` 解构并传至 `sessionManager.sendMessage()`
3. 在 `SessionManager.sendMessage()` 签名添加参数，传到 `TaskRunner.submit(TaskInput)`
4. 在 `TaskInput` 接口添加对应字段（`llm-engine/src/core/types.ts`）

## 解析流程细节

### onInput — 弹窗触发

```
文本以 "/" 开头 → showCommands(afterSlash) → 打开/过滤命令面板
"/" 后含空格   → 关闭面板（用户已选命令正在输参数）
其他           → 关闭面板
```

### onBeforeSend — 命令分发

```
文本以 "/" 开头 → 正则拆分为 cmdName + argsStr
  先在静态命令中查找 → 找到则 executeCommand(cmd, args)
  再在动态 Skill 命令查找 → 找到则 executeCommand(cmd, args)
  都没找到 → 不做拦截，当作普通文本发送

返回 false → 阻止后续 triggerSend（即不发普通消息）
```

### executeCommand

```ts
if (!command.preserveInput) ctx.setText('');  // 清空输入框
command.execute(args, ctx);                    // 执行回调
```

## 分组约定

| 分组 | 用途 | 示例 |
|---|---|---|
| Common | 高频操作 | `/new`, `/retry`, `/clear`, `/btw` |
| Refine | 改写最后回复 | `/shorter`, `/summarize` |
| Context | 上下文控制 | `/history`, `/fresh` |
| View | 折叠/导航 | `/fold`, `/top` |
| Tools | 导出 | `/copy`, `/export` |
| Branch | 分支管理 | `/branch`, `/switch` |
| Settings | 配置 | `/agent`, `/model` |
