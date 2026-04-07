# @itookit/device-skills

Skill 管理设备驱动。实现渐进式工具暴露（Progressive Tool Disclosure）——Agent 平时只看到核心工具，当任务需要时通过 `load_skill` 元工具动态加载 Skill，Skill 的工具随即注册到 `device-tools` 中。

## 设计定位

```
llm-kernel / AgentLoopExecutor
        │ 调用 skill:load via ISkillService
        ▼
@itookit/device-skills
  SkillDeviceDriver  ←  IDeviceDriver（VFS 设备层接入点）
  SkillService       ←  ISkillService（Skill 注册 & 生命周期管理）
        │ 依赖接口（DIP 边界）
        ▼
IToolService（来自 @itookit/common）
        │ 由 @itookit/device-tools 的 ToolService 实现
        ▼
device-tools（运行时注入，编译期不依赖）
```

`device-skills` **不依赖** `@itookit/device-tools`——它只依赖 `IToolService` 接口。这一 DIP 边界使 Skill 系统可独立测试，也允许将来替换工具执行后端。

---

## 核心类

### `SkillDeviceDriver`

实现 `IDeviceDriver`，是 Skill 系统接入 VFS 设备层的入口。

- 构造时需传入 `IToolService` 实例（由外层注入，通常是 `ToolDeviceDriver.getService()`）
- `close()` 自动卸载当前会话所有已加载的 Skill（清理工具注册）
- 所有功能通过 `ioctl(ctx, command, params)` 暴露，命令常量见 `SKILL_IOCTL`
- 提供 `getService()` 供直接集成场景使用

```typescript
import { ToolDeviceDriver } from '@itookit/device-tools';
import { SkillDeviceDriver } from '@itookit/device-skills';

const toolDriver = new ToolDeviceDriver();
const skillDriver = new SkillDeviceDriver(toolDriver.getService());
```

### `SkillService`

实现 `ISkillService`，Skill 注册与生命周期管理的核心。

- Skill 注册表：`Map<id, SkillDefinition>`
- 已加载 Skill 跟踪：`Set<id>`（loadedSkills）
- `loadSkill(id)` — 将 Skill 的所有工具绑定注册到 `IToolService`，返回 `SkillLoadResult`
- `unloadSkill(id)` — 从 `IToolService` 注销 Skill 的所有工具
- `autoDetectSkills(prompt)` — 基于 `triggerPatterns`（正则）匹配任务 prompt，返回应加载的 Skill ID 列表
- `getLoadedSkills()` / `getUnloadedSkills()` — 用于向 LLM 注入"已加载技能"和"可用技能"两个 Prompt Section
- `onChange(listener)` — 变更监听，供 UI 响应 Skill 状态变化

---

## Skill 定义模型

`SkillDefinition`（来自 `@itookit/common`）是 Skill 系统的核心数据结构：

```typescript
interface SkillDefinition {
  id: string;                    // 唯一标识，如 'docker', 'git-advanced'
  name: string;                  // 人类可读名称
  description: string;           // 显示在 AvailableSkillsSection 中，供 LLM 决策是否加载
  type: SkillType;               // 'builtin' | 'http' | 'mcp' | 'custom'
  enabled: boolean;
  instructions: string;          // 加载后注入系统提示词的 Markdown 指令
  tools: SkillToolBinding[];     // 此 Skill 附带的工具列表
  triggerPatterns: string[];     // 触发自动加载的正则模式
  autoLoad: boolean;             // true = 会话初始化时自动加载
  priority: number;              // 加载优先级（越小越优先）
  endpoint?: string;             // HTTP Skill 专用
  method?: 'GET' | 'POST' | 'PUT';
  headers?: Record<string, string>;
}
```

### Skill 工具绑定

`SkillToolBinding` 描述 Skill 附带的单个工具：

| `executionType` | 含义 |
|------|------|
| `'builtin'` | 引用 device-tools 已有内置工具（不创建新 handler） |
| `'http'` | 通过 `fetch` 调用 Skill 的 `endpoint`，将工具参数作为请求体 |
| `'handler'` | 预留给未来的插件系统（当前不支持） |

---

## IOCTL API

所有命令常量定义在 `SKILL_IOCTL` 对象中：

| 命令 | 参数 | 返回值 | 说明 |
|------|------|--------|------|
| `skill:list` | — | `SkillDefinition[]` | 列出所有已注册 Skill |
| `skill:get` | `{ id: string }` | `SkillDefinition \| undefined` | 获取指定 Skill |
| `skill:getNames` | — | `string[]` | 获取所有 Skill 名称 |
| `skill:load` | `{ id: string }` | `SkillLoadResult` | 加载 Skill，注册其工具 |
| `skill:unload` | `{ id: string }` | `{ success: true }` | 卸载 Skill，注销其工具 |
| `skill:getLoaded` | — | `SkillDefinition[]` | 获取已加载的 Skill（按优先级排序） |
| `skill:getUnloaded` | — | `SkillDefinition[]` | 获取未加载的 Skill（供 LLM 提示） |
| `skill:autoDetect` | `{ prompt: string }` | `string[]` | 根据 prompt 自动检测应加载的 Skill |
| `skill:save` | `SkillDefinition` | `{ success: true }` | 保存 Skill（内存） |
| `skill:delete` | `{ id: string }` | `{ success: true }` | 删除 Skill（先卸载） |

---

## HTTP 工具 Handler

`type='http'` 的 Skill 工具通过 `fetch` 调用远程端点：

```
Agent → ToolService.invoke()
  → SkillService 注册的 HTTP handler
  → fetch(skill.endpoint, { method, headers, body: JSON.stringify(args) })
  → 解析响应（JSON 或纯文本）
  → 返回字符串给 ToolService → ToolInvokeResult.output 喂回 LLM
```

错误处理：HTTP 非 2xx、AbortError、网络异常均捕获为字符串返回，不抛出异常。

---

## 渐进式暴露机制

Skill 系统实现了 Agent 工具空间的渐进式暴露：

```
初始状态（autoLoad=true 的 Skill 已加载）：
  core_tools = [file_read, glob_search, grep_search, shell_exec, file_write]
  system_prompt += "以下 Skill 可用（调用 load_skill 加载）:
    - docker: Docker 容器管理
    - git-advanced: 高级 Git 操作"

Agent 决定需要 Docker → tool_call: load_skill({ skill_id: 'docker' })
  → 向 ToolService 注册: docker_run, docker_ps, docker_logs
  → 下一轮 LLM 调用工具列表自动包含这些新工具
```

---

## 使用示例

```typescript
import { ToolDeviceDriver } from '@itookit/device-tools';
import { SkillDeviceDriver } from '@itookit/device-skills';

const toolDriver = new ToolDeviceDriver();
const skillDriver = new SkillDeviceDriver(toolDriver.getService());
const skillService = skillDriver.getService();

// 注册 Skill
await skillService.saveSkill({
  id: 'docker',
  name: 'Docker 管理',
  description: '管理 Docker 容器、镜像',
  type: 'http',
  enabled: true,
  instructions: '## Docker 工具\n使用 docker_run 运行容器。',
  tools: [
    {
      toolId: 'docker_run',
      definition: { type: 'function', function: { name: 'docker_run', description: 'Run a container', parameters: { type: 'object', properties: { image: { type: 'string' } }, required: ['image'] } } },
      executionType: 'http',
      sideEffect: 'external',
      timeoutMs: 60_000,
    },
  ],
  triggerPatterns: ['docker', 'container', '容器'],
  autoLoad: false,
  priority: 10,
  endpoint: 'http://localhost:8080/tools/docker',
  method: 'POST',
});

// 自动检测并加载 Skill
const prompt = '请帮我把应用打包成 Docker 镜像';
const toLoad = skillService.autoDetectSkills(prompt);
await Promise.all(toLoad.map(id => skillService.loadSkill(id)));

// 此后 toolService.getToolDefinitions() 会包含 docker_run
```
