# Skill 系统设计

> 版本: 3.2 | 包: `common` + `llm-harness` + `device-llm` + `app-shell`

## 一、概述

Skill = Markdown 指令 + 可选工具 + 触发策略。核心设计理念：**将大模型视为拥有有限工作记忆的处理器——通过 YAML 建立索引，通过四层路由控制上下文，通过作用域实现目录级隔离。**

### 两大存储体系

| 体系 | 存储 | 管理器 | 作用域 |
|------|------|--------|--------|
| `LLMSkill` | VFS `__config:/llm/.skills/<id>.yaml` | `LLMDeviceDriver` | 全局（始终可见） |
| `SkillDefinition` | 运行时内存 (`SkillDeviceDriver`) + 文件系统 `_agent/skills/` | `SkillDeviceDriver` | 由 `scopeLevel` 决定 |

**桥接**: `llmSkillToSkillDef()` + `syncSkillsToHarness()` 在启动和 `llmDriver.onChange()` 时将 VFS 技能同步为 `SkillDefinition`。

---

## 二、核心类型

> 定义在 `packages/common/src/interfaces/skills/skill-types.ts`

### 2.1 SkillDefinition

```typescript
interface SkillDefinition {
    // ── 必填 ──
    id: string;
    name: string;
    description: string;
    type: SkillType;          // 'builtin' | 'http' | 'shell' | 'prompt' | 'mcp' | 'custom'
    enabled: boolean;
    instructions: string;     // 注入到 system prompt 的 Markdown
    tools: SkillToolBinding[];
    triggerPatterns: string[];
    autoLoad: boolean;
    priority: number;

    // ── 可选 (原有) ──
    icon?: string;
    endpoint?: string;
    method?: 'GET' | 'POST' | 'PUT';
    headers?: Record<string, string>;
    parameters?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
    createdAt?: number;
    modifiedAt?: number;

    // ── 新增 (全部可选，向后兼容) ──

    /** 触发策略 */
    triggerStrategy?: 'reference' | 'action';

    /** 存储来源 */
    source?: 'vfs' | 'filesystem';

    /** 作用域层级 */
    scopeLevel?: 'vfs' | 'global-fs' | 'parent-fs' | 'local-fs';

    /** 作用域根目录 (CWD 变更时判断可见性) */
    scopeRoot?: string;

    /** 禁止模型自动调用 (L1 静默层) */
    disableModelInvocation?: boolean;

    /** Glob 模式列表 (L4 空间联动) */
    globs?: string[];

    /** 压缩保护指令 */
    compact?: CompactSection | null;

    /** 修正日志配置 */
    correctionLog?: SkillCorrectionLog;

    /** 参考文档路径 */
    referencePaths?: string[];

    /** 输出模板路径 */
    templatePath?: string;

    /** 文件系统根目录 */
    fsRoot?: string;

    /** Subagent 委托 */
    supportsSubagent?: boolean;
    subagentRole?: string;
}
```

### 2.2 Skill 类型 (SkillType)

| 类型 | 执行方式 | Prompt 注入 |
|------|---------|------------|
| `prompt` | 直接注入 `instructions`，无工具 | P3 自动注入（无需 `load_skill`） |
| `shell` | `spawn('sh', ['-c', command])` + `{{arg}}` 模板 | P4 渐进式 → `load_skill` → 工具注册 |
| `http` | `fetch(endpoint, { body })` | P4 渐进式 → `load_skill` |
| `mcp` | MCP 协议 | P4 渐进式 → `load_skill` |
| `builtin` | 引用已注册工具 | P4 渐进式 → `load_skill` |
| `custom` | 用户自定义 | P4 渐进式 → `load_skill` |

### 2.3 辅助类型

```typescript
interface CompactSection {
    marker: string;        // 区域标题
    redLines: string[];    // [红线] 前缀的关键规则
    rawContent: string;    // 原始 Markdown
}

interface SkillCorrectionLog {
    path: string;          // 例: "docs/agent-corrections.md"
    enabled: boolean;
}

interface SkillGlobPattern {
    pattern: string;       // 例: "src/controllers/*.ts"
    autoMount: boolean;    // 默认 true
    autoUnmount: boolean;  // 默认 true
}

interface SkillRouteLayer {
    silent: SkillDefinition[];        // L1: action skills
    index: SkillDefinition[];         // L2: unloaded reference
    dynamicMount: SkillDefinition[];  // L3: loaded reference
    spatial: SkillDefinition[];       // L4: glob-mounted
}

interface SkillMatchContext {
    openFiles?: string[];
    cwd?: string;
    recentUserMessages?: string[];
}
```

---

## 三、ISkillService 接口

> 定义在 `packages/common/src/interfaces/skills/skill-service.ts`，由 `SkillDeviceDriver` 实现。

```typescript
interface ISkillService {
    // ── 生命周期 ──
    listSkills(): SkillDefinition[];
    getSkill(id: string): SkillDefinition | undefined;
    getSkillNames(): string[];
    loadSkill(id: string): Promise<SkillLoadResult>;
    unloadSkill(id: string): Promise<void>;
    getLoadedSkills(): SkillDefinition[];
    getUnloadedSkills(): SkillDefinition[];
    autoDetectSkills(prompt: string): string[];

    // ── CRUD ──
    saveSkill(skill: SkillDefinition): Promise<void>;
    deleteSkill(id: string): Promise<void>;
    onChange(listener: () => void): () => void;

    // ── 四层路由 ──
    getRouteLayers(): SkillRouteLayer;
    semanticMatchSkills(userMessage: string, context?: SkillMatchContext): string[];
    mountByGlob(filePath: string): void;
    unmountByGlob(filePath: string): void;
    registerFromDirectory(dirPath: string): Promise<SkillLoadResult[]>;

    // ── Compact Instructions ──
    parseCompactInstructions(skillId: string): ParsedCompactInstructions;
    getCompactInstructions(): string;

    // ── 作用域管理 ──
    setCwd(cwd: string): Promise<void>;
    getScopedSkills(): SkillDefinition[];
    refreshScopedSkills(): Promise<SkillLoadResult[]>;
}
```

---

## 四、触发策略：两大 Skill 类型

### 类型 A：参考型技能 (Reference Skill)

自动按需加载。通过语义匹配、globs、triggerPatterns 触发。

```yaml
# _agent/skills/rest-api/SKILL.md
---
name: rest-api-guidelines
description: REST API 设计规范
trigger-strategy: reference
globs: ["src/controllers/*.ts", "src/api/*.ts"]
---
# REST API 设计规范
...
```

- ✅ 进入 L2 索引层（id + description，~50-100 token）
- ✅ 语义匹配命中后自动加载到 L3（完整 instructions）
- ✅ globs 匹配文件打开时挂载到 L4（空间联动）

### 类型 B：行动型技能 (Action Skill)

纯手动命令触发——连 description 都不进入主上下文。

```yaml
# _agent/skills/deploy/SKILL.md
---
name: deploy-staging
description: 部署到 Staging 环境
trigger-strategy: action
disable-model-invocation: true
---
# 部署步骤
1. 确认分支...
```

- ❌ 不进入系统 Prompt（L1 静默层，0 token）
- ❌ LLM 无法通过 `load_skill` 加载
- ✅ 用户通过 `/sk-deploy-staging` 显式调用

---

## 五、四层路由拦截机制

各层级对 Token 消耗的影响：

```
┌──────────────────────────────────────────────┐
│ L1 静默层                                      │
│ action + disableModelInvocation               │
│ 完全不进入 Prompt → 0 Tokens                    │
├──────────────────────────────────────────────┤
│ L2 索引层                                      │
│ unloaded reference skills                    │
│ 仅 id + description → ~50-100 Tokens/skill    │
├──────────────────────────────────────────────┤
│ L3 动态挂载层                                   │
│ loaded reference skills (load_skill / 语义)    │
│ 完整 instructions → 按需                       │
├──────────────────────────────────────────────┤
│ L4 空间联动层                                   │
│ glob-mounted skills                          │
│ 完整 instructions + 动态回收                    │
└──────────────────────────────────────────────┘
```

### System Prompt 构建 (ContextManager)

```
P0: Agent systemPrompt / core identity       ← 始终通过
P1: 环境信息 (OS / CWD / Time / Node)          ← 始终通过
P2: L3 动态挂载层 — loaded skills 完整 instructions
P3: L4 空间联动层 — glob-mounted skills 完整 instructions
P4: L2 索引层 — unloaded reference skills id+description
    预算门控: systemPromptBudgetTokens = 4000
    P0 始终通过，其余按 length/4 估算超出则丢弃
```

### 路由实现 (`getRouteLayers()`)

```typescript
// 位于 SkillDeviceDriver
getRouteLayers(): SkillRouteLayer {
    const all = this.getScopedSkills(); // 仅当前作用域可见

    for (const s of all) {
        if (s.disableModelInvocation) → silent    // L1
        else if (isGlobMounted && isLoaded) → spatial // L4
        else if (isLoaded) → dynamicMount           // L3
        else → index                                 // L2
    }
}
```

### 语义匹配 (semanticMatchSkills)

优先级顺序：
1. **triggerPatterns** — regex 匹配（向后兼容）
2. **关键词重叠** — description 中 ≥2 个关键词命中 → 匹配
3. **Globs** — `openFiles` 中任意文件匹配 `skill.globs` → 匹配

---

## 六、作用域系统

### 6.1 作用域层级 (SkillScopeLevel)

```
vfs        全局 VFS 技能              → 始终可见
global-fs  项目根 _agent/skills/      → 始终可见
parent-fs  祖先目录 _agent/skills/    → 子目录继承
local-fs   当前目录 _agent/skills/    → 本级独有
```

### 6.2 继承规则

```
/project/                          项目根          _agent/skills/ → global-fs
├── src/                           src 目录        _agent/skills/ → parent-fs
│   └── controllers/
│       ├── _agent/skills/         controllers/    _agent/skills/ → parent-fs
│       └── api/
│           └── _agent/skills/     api/            _agent/skills/ → local-fs
│
│   CWD = /project/src/controllers/api/ 时可见:
│     VFS (始终) + global-fs (始终) + controllers (parent-fs) + api (local-fs)
│
│   CWD = /project/src/ 时可见:
│     VFS (始终) + global-fs (始终) + src (parent-fs)
│     ❌ controllers 的 skills 不可见 (不在祖先链)
│     ❌ api 的 local-fs 不可见 (local 不向上传递)
```

### 6.3 可见性判断

```typescript
// SkillDeviceDriver.isSkillInScope()
function isSkillInScope(skill: SkillDefinition): boolean {
    const level = skill.scopeLevel;
    if (!level || level === 'vfs' || level === 'global-fs') return true;

    if (level === 'local-fs') {
        // 仅当 CWD 精确匹配 scopeRoot 时可见
        return cwd === scopeRoot;
    }

    // parent-fs: scopeRoot 是 CWD 的祖先
    return cwd.startsWith(scopeRoot + '/') || cwd === scopeRoot;
}
```

### 6.4 CWD 变更流程

```
ContextManager.initSession(cwd)
  → skillService.setCwd(cwd)
    → findProjectRoot(cwd)        // 向上查找含 _agent/ 的根目录
    → buildScopeEntries(root,cwd) // 构建项目根→祖先→CWD 继承链
    → refreshScopedSkills()
      → 卸载失效 scopeRoots 的 skills
      → 扫描新 scopeRoots 的 _agent/skills/
      → 按 scopeLevel 标记 skill
      → notifyChange() → ContextManager 重建 system prompt
```

---

## 七、文件系统 Skill 格式

### 7.1 目录结构

```
_agent/skills/<skill-name>/
├── SKILL.md           # 必需 — YAML frontmatter + Markdown instructions
├── template.md        # 可选 — 输出模板 (填空题比让 LLM 生成更省 Token)
├── reference.md       # 可选 — 按需加载的背景知识
└── examples/
    └── good-spec.md   # 可选 — 优秀示例 (少样本学习)
```

### 7.2 SKILL.md 格式

```markdown
---
name: rest-api-guidelines
description: 当创建、修改 REST API 时触发
trigger-strategy: reference
globs: ["src/controllers/*.ts"]
disable-model-invocation: false
references: ["reference.md"]
template: template.md
correction-log: docs/agent-corrections.md
priority: 30
---

# REST API 设计规范
(长篇指导原则，允许在压缩时被丢弃)

## Compact Instructions (压缩保留区)
- [红线] 所有 API 路径必须以 `/api/v{version}/` 开头
- [红线] 错误响应必须包含 `error_code` 字段
- [红线] 不得在 URL 中暴露内部 ID
```

### 7.3 正向映射

| YAML key | SkillDefinition 字段 |
|----------|---------------------|
| `name` | `id`, `name` |
| `description` | `description` |
| `trigger-strategy` | `triggerStrategy`, `autoLoad` (reference → true) |
| `disable-model-invocation` | `disableModelInvocation` |
| `globs` | `globs` |
| `references` | `referencePaths` |
| `template` | `templatePath` |
| `correction-log` | `correctionLog.path` |
| `priority` | `priority` |
| `subagent.role` | `subagentRole`, `supportsSubagent` (true) |

解析时自动提取：
- `## Compact Instructions` → `compact.redLines` + `compact.rawContent`
- `scopeLevel` + `scopeRoot` → 由扫描目录的 `buildScopeEntries()` 填入

---

## 八、Compact Instructions (压缩保护)

长时间对话后系统进行"历史压缩"释放 Token，为防止关键规则被丢弃，引入保护区块。

### 标记格式

```markdown
## Compact Instructions (压缩保留区)
- [红线] 必须捕获所有数据库连接异常
- [红线] 不得修改 `migrations/` 目录的历史文件
```

### 提取逻辑

`compact-extractor.ts` → `extractCompactInstructions()`:
1. 搜索 `## Compact Instructions` 标题
2. 提取到下一个 `##` 或文件结尾
3. 解析 `[红线]` 前缀行为 `redLines`
4. 返回分离的 `body`（不含 compact section）和 `compact` 区块

### 压缩时注入

`ContextManager.applyL3LLMSummarize()`:
```
"Summarize this conversation. Preserve: ...\n\n"
+ "Critical rules that MUST be preserved:\n"
+ skillService.getCompactInstructions()
```

---

## 九、修正日志系统 (Correction Log)

AI 犯错时的自适应进化机制。

### 日志格式 (`docs/agent-corrections.md`)

```markdown
## [2026-05-01] Correction
- **Mistake:** 忽略了事务边界
- **Correction:** 先检查事务状态再执行写操作
- **Rule:** 所有写操作必须包裹在事务中
```

### 配置

```yaml
# SKILL.md frontmatter
correction-log: docs/agent-corrections.md
```

### Prompt 注入

`injectCorrectionsToPrompt()` 在当前 scope 的 skill 加载后，向 system prompt 插入：
```
[Correction Log] Prior mistakes and corrected behavior for <skill-name>:
See docs/agent-corrections.md for the full history.
Apply these rules consistently.
```

---

## 十、Subagent 协同

标记 `supportsSubagent: true` 的 skill 可委托给子代理执行，避免主会话被高消耗任务污染。

### 配置

```yaml
# SKILL.md frontmatter
subagent:
  role: security-reviewer
  model: claude-sonnet-4-6
```

### 委托提示

```typescript
// getDelegationHint() → 在 loadSkill 结果中注入
"[Subagent Available] This skill can delegate to a `security-reviewer` subagent.
 For computationally intensive tasks, prefer delegate_task."
```

### 子代理 System Prompt

`buildSubagentSystemPrompt()`:
```
You are a specialized subagent: security-reviewer

## Instructions
<skill.instructions>

## Critical Rules
- [红线] ...
```

---

## 十一、架构集成

### 11.1 包依赖

```
common      → 所有接口和类型
llm-harness → SkillDeviceDriver, ContextManager, 内置工具, 5 个 skills/ 模块
device-llm  → LLMDeviceDriver (VFS 技能持久化)
app-shell   → bootstrap.ts 装配 + 桥接
llm-ui      → SkillInvocationParser (slash 命令解析)
```

### 11.2 启动流程

```
initApp()
  ├─ createVFS()                   → VFS 文件系统
  ├─ LLMDeviceDriver.init()        → 加载 LLMSkill[] from VFS
  ├─ createHarness()               → SkillDeviceDriver (空 registry)
  ├─ syncSkillsToHarness()         → VFS → harness (LLMSkill → SkillDefinition)
  ├─ skillService.setCwd(cwd)      → 扫描 _agent/skills/ (project root → CWD)
  │   ├─ findProjectRoot(cwd)
  │   ├─ buildScopeEntries(root, cwd)
  │   └─ refreshScopedSkills()
  └─ llmDriver.onChange()          → 后续 VFS 变更自动同步
```

### 11.3 请求路径

```
用户请求 → ContextManager.autoDetectAndLoadSkills()
  ├─ 跳过 L1 (disableModelInvocation)
  ├─ autoLoad == true → markSkillLoaded
  └─ semanticMatchSkills() → markSkillLoaded

ContextManager.buildSystemPrompt()
  └─ skillService.getRouteLayers()
      └─ getScopedSkills()             ← 仅当前作用域
          ├─ L1 → silent (不输出)
          ├─ L3 → P2 (完整 instructions)
          ├─ L4 → P3 (完整 + spatial label)
          └─ L2 → P4 (id + description)
```

### 11.4 Slash 命令调用

```
/用户输入 → SkillInvocationParser.parseSkillArgs()
  ├─ L1 action skill: 直接注入 instructions 到用户消息
  └─ L2-L4 reference skill: 通过 load_skill 工具加载
```

### 11.5 VFS Skill 同步保护

`syncSkillsToHarness()` 删除 VFS 中被移除的 Skill 时：
- 检查 `source === 'filesystem'` → 跳过（文件系统 Skill 不受 VFS 同步影响）
- `source === 'vfs'` 或 undefined → 正常删除

---

## 十二、Glob 空间联动 (L4)

### 语法

支持：`*` (单级), `**` (多级), `?` (单字符), `{a,b}` (枚举)

```yaml
globs:
  - "src/controllers/*.ts"       # 单级匹配
  - "src/**/*.handler.ts"        # 递归匹配
  - "src/api/{v1,v2}/*.ts"       # 枚举
```

### 生命周期

```
文件打开 → mountByGlob(filePath)
  └─ matchGlob(filePath, skill.globs)
      └─ matched → globMounted.set(skill.id, new Set([filePath]))
                   loaded.add(skill.id)

文件关闭 → unmountByGlob(filePath)
  └─ globMounted.delete(filePath)
      └─ 若该 skill 无更多匹配文件 → loaded.delete(skill.id)
```

---

## 十三、关键文件索引

### 接口 & 类型

| 文件 | 内容 |
|------|------|
| `packages/common/src/interfaces/skills/skill-types.ts` | `SkillDefinition`, `SkillRouteLayer`, `CompactSection`, 所有辅助类型 |
| `packages/common/src/interfaces/skills/skill-service.ts` | `ISkillService` 接口 |
| `packages/common/src/interfaces/skills/fs-skill-types.ts` | `SkillFrontmatter`, `FSSkillDirectory`, `ScopeEntry` |

### 运行时

| 文件 | 内容 |
|------|------|
| `packages/coreutils/src/skill/skill-device-driver.ts` | `SkillDeviceDriver` — 实现 `ISkillService` + 四层路由 + 作用域 |
| `packages/llm-harness/src/executor/context-manager.ts` | `ContextManager` — 系统 Prompt 构建 + 压缩保护 |
| `packages/coreutils/src/tool/load-skill.ts` | `load_skill` 工具 — 拒绝 L1 action skills |
| `packages/coreutils/src/skill/fs-skill-loader.ts` | 文件系统扫描 + 作用域继承链 |
| `packages/coreutils/src/skill/compact-extractor.ts` | Compact Instructions 提取 + 聚合 |
| `packages/coreutils/src/skill/glob-matcher.ts` | Glob → RegExp 匹配器 |
| `packages/llm-harness/src/skills/subagent-skill-bridge.ts` | 子代理委托提示生成 |
| `packages/llm-harness/src/skills/correction-log.ts` | 修正日志读写 + prompt 注入 |
| `packages/app-shell/src/bootstrap.ts` | `initApp()` + `syncSkillsToHarness()` + 初始 CWD 设置 |
| `packages/llm-ui/src/components/input/SkillInvocationParser.ts` | Slash 命令解析，支持 L1 action skill |

### 持久化

| 文件 | 内容 |
|------|------|
| `packages/device-llm/src/device/llm-device-driver.ts` | `LLMDeviceDriver` — VFS 技能 CRUD |
| `packages/app-settings/src/engine/SkillsEngine.ts` | Skills 设置 UI Engine |
| `packages/llm-ui/src/editors/SkillSettingsEditor.ts` | Skill 编辑器 UI |
