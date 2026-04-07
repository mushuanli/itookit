# @itookit/device-tools

Node.js 工具执行设备驱动。将文件读写、Shell 命令、Glob/Grep 搜索等操作封装为 `IDeviceDriver`，通过 ioctl 暴露给 Agent 执行层。

## 设计定位

```
llm-kernel / AgentLoopExecutor
        │ 调用 ToolHandler via IToolService
        ▼
@itookit/device-tools
  ToolDeviceDriver  ←  IDeviceDriver（VFS 设备层接入点）
  ToolService       ←  IToolService（工具注册 & 执行核心）
  PermissionManager ←  三层权限管理
  builtin/          ←  五个内置工具
        │ 仅依赖
        ▼
@itookit/common（IToolService, ToolMeta, ToolPermissionRule 等类型定义）
```

`device-tools` 是纯 Node.js 包，不依赖 VFS，不依赖浏览器 API。所有工具通过 Node.js 内置模块（`fs`、`path`、`child_process`）操作本地文件系统。

---

## 核心类

### `ToolDeviceDriver`

实现 `IDeviceDriver`，是工具系统接入 VFS 设备层的入口。

- 构造时自动注册五个内置工具
- `open()` / `close()` 对应 Agent 会话的打开与关闭，`close()` 会重置会话级权限
- 所有功能通过 `ioctl(ctx, command, params)` 暴露，命令常量见 `TOOL_IOCTL`
- 提供 `getService()` / `getPermissionManager()` 供直接集成（无需经过 VFS 设备层）

```typescript
// 注册到设备管理器
deviceManager.register(new ToolDeviceDriver());

// 或直接集成
const driver = new ToolDeviceDriver({
  defaultPolicy: 'allowed',   // 测试环境放行所有工具
  globalRules: [],
});
const toolService = driver.getService();
```

### `ToolService`

实现 `IToolService`，工具注册与执行的核心。

- 工具注册表：`Map<id, { meta, definition, handler }>`
- `invoke()` — 执行单个工具，内置超时控制（`AbortController` + `setTimeout`）和 `AbortSignal` 取消支持
- `invokeBatch()` — 批量执行，自动按副作用分组：`sideEffect='none'` 的工具并行执行，`local`/`external` 串行
- 工具异常不向外抛出，包装为 `ToolInvokeResult.success=false` 喂回调用方（Agent 循环要求工具异常不传播）

### `PermissionManager`

三层权限评估，评估顺序：

| 层级 | 来源 | 说明 |
|------|------|------|
| 1 | 全局规则（`globalRules` 构造参数） | 安全基线，如读文件放行 |
| 2 | 项目规则（`.executor/permissions.json`） | 项目级定制 |
| 3 | 会话记忆（`sessionGrants` Map） | 用户本次会话已授权 |
| 4 | 副作用推断 | `sideEffect='none'` 默认放行 |
| 5 | 默认策略（`defaultPolicy` 构造参数） | 兜底，默认 `ask_user` |

`grantSession(toolId, scope)` — 记住用户对某工具的授权，同类操作后续不再询问。
`resetSessionGrants()` — 会话结束时清除记忆（由 `ToolDeviceDriver.close()` 调用）。

---

## IOCTL API

所有命令常量定义在 `TOOL_IOCTL` 对象中：

| 命令 | 参数 | 返回值 | 说明 |
|------|------|--------|------|
| `tool:list` | — | `ToolMeta[]` | 列出所有已注册工具 |
| `tool:getMeta` | `{ id: string }` | `ToolMeta \| undefined` | 获取工具元数据 |
| `tool:getDefinitions` | — | `ToolDefinition[]` | 获取已启用工具的 LLM Schema |
| `tool:invoke` | `ToolInvokeRequest` | `ToolInvokeResult` | 执行单个工具 |
| `tool:invokeBatch` | `ToolInvokeRequest[]` | `ToolBatchResult` | 批量执行工具 |
| `tool:register` | `{ meta, definition, handler }` | `{ success: true }` | 动态注册工具 |
| `tool:unregister` | `{ id: string }` | `{ success: true }` | 注销工具 |
| `tool:checkPermission` | `{ toolId, args, cwd? }` | `ToolPermission` | 检查工具权限 |
| `tool:grantPermission` | `{ toolId, scope? }` | `{ success: true }` | 授予会话权限 |

---

## 权限模型

工具按副作用分为三类，影响并行策略和默认权限：

| `sideEffect` | 含义 | 默认策略 | 并行策略 |
|------|------|----------|----------|
| `none` | 纯读操作 | `allowed` | 可并行 |
| `local` | 本地副作用（文件写入等） | `ask_user` | 串行 |
| `external` | 外部副作用（网络等） | `ask_user` | 串行 |

项目级规则文件 `.executor/permissions.json` 格式：

```json
{
  "rules": [
    {
      "toolPattern": "file_write",
      "argPatterns": { "path": "/workspace/*" },
      "action": "allowed",
      "reason": "workspace 目录内写操作已授权"
    }
  ]
}
```

---

## 内置工具

### `file_read` — 文件读取

- `sideEffect: 'none'`，超时 10s
- 参数：`path`（必填）、`offset`（行偏移）、`limit`（最大行数，默认 500）
- 输出带行号，显示文件总行数和已截断提示

### `file_write` — 文件写入

- `sideEffect: 'local'`，超时 10s
- 参数：`path`（必填）、`content`（必填）、`append`（是否追加，默认 false）

### `shell_exec` — Shell 命令执行

- `sideEffect: 'local'`，超时 120s
- 参数：`command`（必填）、`timeout`（秒，默认 60）
- 内置灾难性命令拦截（`rm -rf /`、`mkfs.*`、`dd of=/dev/`、fork bomb 等），硬拒绝不可覆盖
- 输出超 200 行时自动截断（保留首尾各 100 行）
- 支持 `AbortSignal` 取消

### `glob_search` — Glob 文件搜索

- `sideEffect: 'none'`，超时 30s
- 参数：`pattern`（必填）、`path`（基准目录）、`maxResults`（默认 100）
- 自动忽略 `.git`、`node_modules`、`dist`、`build` 等目录

### `grep_search` — 正则内容搜索

- `sideEffect: 'none'`，超时 30s
- 参数：`pattern`（必填）、`path`、`include`（扩展名过滤）、`maxResults`（默认 50）、`caseSensitive`（默认 true）
- 自动跳过二进制文件
- 输出格式：`相对路径:行号: 匹配行内容`

---

## 使用示例

### 直接集成（无 VFS）

```typescript
import { ToolDeviceDriver } from '@itookit/device-tools';

const driver = new ToolDeviceDriver();
const toolService = driver.getService();

// 执行文件读取
const result = await toolService.invoke({
  toolId: 'file_read',
  args: { path: '/workspace/src/index.ts' },
  cwd: '/workspace',
});

console.log(result.output);
```

### 批量工具调用（Agent 循环中）

```typescript
const batchResult = await toolService.invokeBatch([
  { toolId: 'file_read',   args: { path: './package.json' }, cwd },
  { toolId: 'glob_search', args: { pattern: '**/*.ts' },     cwd },
  { toolId: 'grep_search', args: { pattern: 'IToolService' }, cwd },
  // 以上三个 sideEffect='none'，将并行执行
  { toolId: 'file_write',  args: { path: './out.txt', content: 'done' }, cwd },
  // 此条 sideEffect='local'，在并行阶段结束后串行执行
]);
```
