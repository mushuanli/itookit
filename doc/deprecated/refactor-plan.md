# 系统架构优化方案

> 基于 C4 分析 + 全量 common 接口审计 + 跨包依赖扫描，于 2026-07-09 输出。

---

## 问题总览

分析发现 P1~P4 四级问题，优先级定义：**P1** = 死代码/运行错误风险，**P2** = 结构性重复维护成本，**P3** = 分层违规，**P4** = 代码异味。

| # | 级别 | 问题 | 影响行数 | 风险 |
|---|---|---|---|---|
| 1 | P1 | llm-kernel 5 个 Orchestrator 完全死代码 | ~500 行 | 零 |
| 2 | P1 | Mission / SessionGraph 两套依赖图执行引擎 | ~1430 行 | 中 |
| 3 | P1 | HITLQueue 双份实现，engine 版有 bug | ~170 行 | 低 |
| 4 | P2 | LLMSkill + SkillDefinition 两套类型 + 43 行同步胶水 | ~400 行 | 中 |
| 5 | P2 | device-llm 孤儿 SkillRegistry 从未被外部消费 | ~150 行 | 低 |
| 6 | P2 | 4 个独立 EventBus 实现 | ~500 行 | 低 |
| 7 | P2 | common 中 4 个死接口（ILogger/ISettingsWidget/IEntityService/IDocumentAnalyzer） | ~300 行 | 零 |
| 8 | P2 | common 中大量单消费者接口应回归所属包 | ~800 行 | 零 |
| 9 | P3 | llm-ui/app-settings 绕过 common 从 llm-runtime 导入接口 | 3 文件 | 低 |
| 10 | P3 | app-settings 上行依赖 llm-ui（业务层→UI层） | 1 文件 | 低 |
| 11 | P3 | IAgentConfigService 未继承 IConnectionService，方法重复 | ~15 方法 | 低 |
| 12 | P2 | LLMConnection 4 个 @deprecated 字段仍被代码读取 | ~6 处 | 中 |

---

## 实施分阶段计划

按"无风险→低风险→中风险"顺序排列，每个阶段独立可构建。

---

### Phase 1 — 零风险：删除死代码（P1/P2）

**目标**：删除经过验证的零消费者代码，不改变任何接口或运行行为。

#### 1A. 删除 llm-kernel 死 Orchestrators

**验证**：grep 确认 `SerialOrchestrator/ParallelOrchestrator/RouterOrchestrator/LoopOrchestrator/DAGOrchestrator` 在 llm-kernel 外部零调用。

**操作**：
```
删除: packages/llm-kernel/src/orchestrators/
  - base-orchestrator.ts
  - serial.ts  parallel.ts  router.ts  loop.ts  dag.ts
  - index.ts

修改: packages/llm-kernel/src/index.ts
  删除以下导出行:
    - BaseOrchestrator, SerialOrchestrator, ParallelOrchestrator
    - RouterOrchestrator, LoopOrchestrator, DAGOrchestrator
    - getOrchestratorRegistry, registerOrchestrator, createOrchestrator
    - export type { LoopConfig }
    - validateOrchestratorConfig, isValidOrchestrationMode
    （保留 Executor/Runtime/Worker/Plugin 相关导出）

修改: packages/llm-kernel/src/core/interfaces.ts（若有 orchestrator 类型引用则删除）
修改: packages/llm-kernel/src/plugins/ （若有 registerOrchestrator 调用则删除）
```

**验证命令**：
```bash
pnpm --filter @itookit/llm-kernel build
pnpm --filter @itookit/llm-runtime build  # 下游确认不影响
```

#### 1B. 删除 device-llm 孤儿 SkillRegistry

**验证**：grep 确认 `SkillRegistry / globalSkillRegistry` 在 device-llm 外部零调用。

**操作**：
```
删除: packages/device-llm/src/skills/registry.ts
删除: packages/device-llm/src/skills/types.ts  （本地 SkillDefinition stub）

修改: packages/device-llm/src/skills/index.ts
  删除 SkillRegistry / globalSkillRegistry / 本地 SkillDefinition 导出

修改: packages/device-llm/src/index.ts
  删除对 skills/registry 和 skills/types 的导出

注意: packages/device-llm/src/skills/mcp-client.ts 保留（MCPClient 被外部使用）
  确认 mcp-client.ts 未导入 registry.ts 或 types.ts（已验证 ok）
```

**验证命令**：
```bash
pnpm --filter @itookit/device-llm build
```

#### 1C. 删除 common 中 4 个死接口

**验证**：
- `ISettingsWidget`：grep 确认无外部消费者
- `IEntityService/EntityChangeEvent`：grep 确认零消费者
- `IDocumentAnalyzer`：唯一引用是 `common/utils/MarkdownAnalyzer.ts`（内部实现）→ 内化不导出
- `ILogger`：唯一引用是 `common/utils/MemoryLogger.ts` + `getLogger()`

**操作**：
```
删除文件（或保留但不从 index.ts 导出）:
  packages/common/src/interfaces/ISettingsWidget.ts       → 删除文件
  packages/common/src/interfaces/llm/entity-service.ts   → 删除文件
  packages/common/src/interfaces/IDocumentAnalyzer.ts    → 删除文件
  packages/common/src/interfaces/ILogger.ts              → 保留（MemoryLogger 内部用），但从 index.ts 移除导出

修改: packages/common/src/interfaces/llm/index.ts
  删除: export * from './entity-service'

修改: packages/common/src/index.ts
  删除: ISettingsWidget, IEntityService, EntityChangeEvent, IDocumentAnalyzer
  删除: ILogger, LogLevel, LogLevelNames, LogEntry, LogFilter, LoggerStats, ModuleLog
  保留: MarkdownAnalyzer（llm-runtime/attachment-processor.ts 使用）
  保留: GCResult（确认是否有外部使用，若无则一并删除）
  保留: DocumentInfo, ReferenceExtractionResult, AnalysisContext（同上确认）
```

**验证命令**：
```bash
pnpm --filter @itookit/common build
pnpm -r typecheck  # 全量类型检查
```

#### 1D. 合并 HITLQueue（删除 engine 版 bug 版本）

**验证**：llm-runtime 版 HITLQueue 在 abort 时调用 `resolve('')` 而非 `reject()`，会导致 mission scheduler 误以为 HITL 通过。

**操作**：
```
搜索: packages/llm-runtime/src/services/hitl-queue.ts 的消费者
  → llm-runtime/src/mission/mission-scheduler.ts: import { HITLQueue }

修改: packages/llm-runtime/src/mission/mission-scheduler.ts
  import { HITLQueue } from '@itookit/llm-harness'
  （llm-runtime 已依赖 llm-harness，无需新增 dep）

删除: packages/llm-runtime/src/services/hitl-queue.ts

修改: packages/llm-runtime/src/index.ts（若导出了此类则删除该导出）
```

**验证命令**：
```bash
pnpm --filter @itookit/llm-runtime build
```

---

### Phase 2 — 低风险：接口归位与去重（P2/P3）

**目标**：纠正 common 中单消费者接口的错误归属；修复绕行导入。

#### 2A. 修复绕行导入（3 处）

llm-ui 和 app-settings 通过 llm-runtime 导入本应直接从 common 拿的接口：

```
修改: packages/llm-ui/src/shell/SlashCommandRouter.ts
  - import type { IAgentConfigService } from '@itookit/llm-runtime'
  + import type { IAgentConfigService } from '@itookit/common'

修改: packages/llm-ui/src/shell/AgentProvider.ts
  - import type { IAgentConfigService } from '@itookit/llm-runtime'
  + import type { IAgentConfigService } from '@itookit/common'

修改: packages/app-settings/src/editors/RecoverySettingsEditor.ts
  - import { IAgentManagementService } from '@itookit/llm-runtime'
  + import { IAgentManagementService } from '@itookit/common'
```

可选：如果 llm-runtime 的 re-export shim（`services/agent-service.ts`）只是透传 common 类型，可删除该 shim 文件。

**验证命令**：
```bash
pnpm --filter @itookit/llm-ui typecheck
pnpm --filter @itookit/app-settings typecheck
```

#### 2B. 修复 app-settings 上行依赖 llm-ui（P3）

**问题**：`app-settings/src/factories/settingsFactory.ts` 导入 `MCPSettingsEditor` 等 UI 组件自 `@itookit/llm-ui`，造成业务层→UI层的上行依赖。

**方案**：使用依赖注入——app-settings 定义编辑器注册接口，app-shell 注入具体实现。

```typescript
// packages/common/src/interfaces/ISettingsEditorRegistry.ts（新建）
export interface ISettingsEditorSlot {
  type: 'connection' | 'provider' | 'mcp' | 'cost' | 'skill';
  factory: (container: HTMLElement) => void;
}

// app-settings 暴露注册接口
// app-shell bootstrap.ts 中：
//   import { ConnectionSettingsEditor } from '@itookit/llm-ui';
//   settingsModule.registerEditor('connection', container => new ConnectionSettingsEditor(container));
```

**操作**（中等改动）：
```
新建: packages/common/src/interfaces/ISettingsEditorRegistry.ts
修改: packages/app-settings/src/factories/settingsFactory.ts
  删除 llm-ui 导入，改用注入的 factory
修改: packages/app-shell/src/bootstrap.ts
  在 createSettingsModule() 后注册 llm-ui 编辑器
删除: packages/app-settings 的 peerDependency @itookit/llm-ui
```

**验证命令**：
```bash
pnpm --filter @itookit/app-settings build
pnpm --filter @itookit/app-shell build
```

#### 2C. IAgentConfigService 继承 IConnectionService

**问题**：`IAgentConfigService` 重复声明了 `IConnectionService` 中 ~11 个相同签名的方法。

**修改**：`interfaces/llm/agent.ts`
```typescript
// 修改前
export interface IAgentConfigService {
    init(): Promise<void>;
    getAgentConfig(agentId: string): ...;
    getAgents(): ...;
    getConnections(): ...;  // 与 IConnectionService 重复
    getConnection(id): ...;  // 重复
    getDefaultConnection(): ...;  // 重复
    getProviders(): ...;  // 重复
    getFullProvider(id): ...;  // 重复
    getProvider(id): ...;  // 重复
    saveProvider(p): ...;  // 重复
    deleteProvider(id): ...;  // 重复
    getFullConnection(id): ...;  // 重复
    saveConnection(conn): ...;  // 重复
    onChange(...): ...;  // 重复
    listAgents(): ...;
    findAgent(id): ...;
}

// 修改后
export interface IAgentConfigService extends IConnectionService {
    init(): Promise<void>;
    getAgentConfig(agentId: string): ...;
    getAgents(): ...;
    listAgents(): ...;
    findAgent(id): ...;
    // 删除所有 IConnectionService 中已有的方法
}
```

**影响**：`VFSAgentService`（llm-runtime 实现者）和任何 `IAgentConfigService` 的 mock 需检查方法完整性。

**验证命令**：
```bash
pnpm --filter @itookit/common build
pnpm -r typecheck
```

#### 2D. 单消费者接口回归所属包

下列接口仅被一个包消费，不应占据 common 的命名空间：

| common 接口 | 唯一消费包 | 操作 |
|---|---|---|
| `ISRSService, SRSItemData, SRSCardRef, SRSStats` | `mdx` | 移至 mdx 包内 |
| `ISessionUI, SessionUIOptions, SessionManagerEvent/Callback, MenuItem, ContextMenuBuilder/Config, FileCreationConfig` | `vfs-ui` | 移至 vfs-ui 包内 |
| `IMentionSource, HoverPreviewData` | `vfs-ui` | 移至 vfs-ui 包内 |
| `IAutocompleteSource, Suggestion` | `vfs-ui` | 移至 vfs-ui 包内 |
| `RestorableItem, RestoreStatus` | `app-settings` | 移至 app-settings 包内 |
| `ToolVFSContext` | `tools` | 移至 tools 包内 |

**操作模板**（以 srs/ → mdx 为例）：
```
复制: common/src/interfaces/srs/ → packages/mdx/src/interfaces/srs/（或直接内联）
修改: packages/mdx/src/… 中相关导入 → 本地路径
删除: common/src/interfaces/srs/
修改: common/src/index.ts 删除 SRS 导出
```

> **注意**：`IBackPressureValidator, IBudgetController, IErrorRecoveryService, IContextManager` 等 agent/ 下接口虽然主要被 llm-harness 消费，但由于 `IAgentRuntime`、`AgentTaskRequest` 等核心接口引用了这些类型（如 `RecoveryOptions.onCompressionNeeded`），不建议移出 common，保持现状。

**验证命令**：
```bash
pnpm -r build  # 全量构建
```

---

### Phase 3 — 中风险：清理 @deprecated 字段（P2）

**目标**：移除 `LLMConnection` 上 4 个已废弃字段，以及 `AgentConfig.modelName`。

#### 3A. 审计所有使用点

```bash
# 在所有包和 apps 中搜索废弃字段的读取
grep -rn "\.apiKey\b\|conn\.model\b\|\.availableModels\b" packages/ apps/ --include="*.ts" | grep -v "node_modules|\.d\.ts|// @deprecated"
```

已知读取点（需逐一修改）：
- `device-llm/src/constants/llm-loader.ts:237` — `apiKey: def.apiKey`（此处 def 来自 YAML 文件格式，可能是 `LLMConnectionDef` 而非 `LLMConnection`，需细查）
- `device-llm/src/device/connection-manager.ts:143` — `updated.availableModels !== undefined`（兼容读）
- `common/src/interfaces/llm/connection.ts:368` — `toConnectionMeta` 读 `conn.model` 作 fallback

#### 3B. 迁移步骤

```
1. 在 connection-manager.ts 中移除对 availableModels 的读取（模型由 Provider.models 管理）
2. 在 toConnectionMeta() 中移除 conn.model fallback
3. 在 connection.ts 接口定义中删除 4 个 @deprecated 字段
4. VFS 中存储的旧数据中这些字段会被静默忽略（TypeScript 结构类型兼容，多余字段不报错）
```

**风险**：VFS 旧数据若有 `apiKey` 存于 LLMConnection（不应有，apiKey 应存于 Provider），移除字段后读取时 TS 会报错但 JS 运行时不会崩溃。建议添加一次性迁移读取，将旧格式 connection.apiKey 迁移到关联 provider.apiKey。

**验证命令**：
```bash
pnpm --filter @itookit/device-llm build
pnpm -r typecheck
```

---

### Phase 4 — 中风险：Skill 类型统一（P2）

**目标**：消除 `LLMSkill`（VFS 持久化）与 `SkillDefinition`（harness 运行时）的双体系，删除 `syncSkillsToHarness` 43 行胶水代码。

#### 4A. 字段对比

| 字段 | LLMSkill | SkillDefinition | 归宿 |
|---|---|---|---|
| id, name, description, icon, type, enabled | ✅ | ✅ | 保留 |
| instructions | `optional string` | `required string` | 统一为 optional |
| tools | `unknown[]`（未用） | `SkillToolBinding[]` | 用 SkillDefinition 版 |
| endpoint, method, headers | ✅ | ✅ | 保留 |
| command | ✅ | ✅（在 SkillToolBinding） | 统一到 tools |
| mcpServerId, mcpToolName | ✅ | ❌（合并进 tools） | 迁移到 SkillToolBinding |
| autoLoad | ✅ | ✅ | 保留 |
| triggerStrategy | `'reference'\|'action'` | `SkillTriggerStrategy`（相同） | 统一用类型别名 |
| globs | `string[]` | `string[]` | 保留 |
| correctionLog | `string`（仅路径） | `SkillCorrectionLog`（对象） | 用 SkillDefinition 版 |
| triggerPatterns | ❌ | ✅ | 保留（harness 运行时字段） |
| scopeLevel, scopeRoot, source | ❌ | ✅ | 保留（harness 运行时字段） |
| disableModelInvocation, compact, subagentRole | ❌ | ✅ | 保留（harness 运行时字段） |

#### 4B. 设计方案

**推荐方案**：以 `SkillDefinition` 为唯一类型（更丰富），`LLMSkill` 字段成为其子集，device-llm 持久化时直接存储 `SkillDefinition`（使 VFS JSON 格式更丰富），旧 `LLMSkill` JSON 数据通过读时迁移兼容。

```typescript
// 修改后：LLMSkill 不再需要（或 LLMSkill = SkillDefinition 的类型别名）
// common/interfaces/llm/agent.ts 中：
export type LLMSkill = SkillDefinition;  // 仅类型别名，方便迁移期兼容
export type LLMSkillType = SkillType;    // 类型别名

// 旧字段迁移（device-llm/SkillManager 加载 VFS 时）:
function migrateOldSkill(raw: any): SkillDefinition {
    // 若 raw.command 存在但 raw.tools 不存在 → 转换为 SkillToolBinding
    // 若 raw.mcpServerId 存在 → 转换为 tools[0].executionType='mcp'
}
```

#### 4C. 操作步骤

```
1. common/interfaces/skills/skill-types.ts
   - instructions 改为 optional（与 LLMSkill 对齐）
   - 在 SkillDefinition 添加 mcpServerId/mcpToolName（从 LLMSkill 合并，或保留在 SkillToolBinding）

2. common/interfaces/llm/agent.ts
   - 删除 LLMSkill interface 定义
   - 添加: export type LLMSkill = SkillDefinition
   - 删除 LLMSkillType，添加: export type LLMSkillType = SkillType

3. device-llm/src/managers/skill-manager.ts（或对应文件）
   - 存储时直接写 SkillDefinition JSON
   - 读取时加 migrateOldSkill() 兼容旧格式

4. app-shell/src/bootstrap.ts
   - 删除 llmSkillToSkillDef() 函数（lines 181-223）
   - 修改 syncSkillsToHarness() → harness.skillService.saveSkill(skill) 直接传 SkillDefinition
   （或完全删除 sync，改为 harness.skillService 直接消费 device-llm 的 ISkillService）

5. llm-ui SkillSettingsEditor、app-settings SkillsEngine
   - 检查用到 LLMSkill-only 字段的地方，改为 SkillDefinition 字段
```

**风险**：VFS 旧数据格式兼容。`migrateOldSkill()` 需覆盖所有旧字段的映射。

**验证命令**：
```bash
pnpm --filter @itookit/common build
pnpm --filter @itookit/device-llm build
pnpm --filter @itookit/llm-harness build
pnpm --filter @itookit/app-shell build
pnpm -r typecheck
```

---

### Phase 5 — 中风险：Mission / SessionGraph 合并（P1）

**目标**：合并两套依赖图执行引擎（共 1430 行），提取公共调度核心。

#### 5A. 代码重叠分析

| 职责 | Mission | SessionGraph |
|---|---|---|
| 依赖图构建 | `MissionScheduler.getReadyTodos()` | `DependencyGraph.buildGraph()` |
| 拓扑排序 | 内联在 scheduler | `DependencyGraph.topologicalSort()` |
| 任务分发 | `SubAgentRouter.delegate()` | `IAgentRuntime.run()` |
| 重试逻辑 | `TodoItem.retryCount` | `GraphExecutionOptions.maxRetries` |
| 结果持久化 | `ResultPersistenceService` | `SessionMetaStore.writeResult()` |
| 完成验证 | LLM verifier + `VerifierVerdict` | `CompletionAnalyzer`（LLM 验证） |
| HITL | `IHITLQueue` | ❌（无） |

实际重叠约 40%（拓扑排序、重试、结果写入、LLM 验证思路相同）。

#### 5B. 推荐方案：提取共享调度核心

```typescript
// packages/llm-runtime/src/scheduler/（新目录）
// dependency-resolver.ts ← 从 DependencyGraph + MissionScheduler 提取
interface DependableTask {
    id: string;
    dependsOn: string[];
    canParallel?: boolean;
}

interface ITaskScheduler<T extends DependableTask> {
    getReadyTasks(tasks: T[], completed: Set<string>): T[];
    topologicalSort(tasks: T[]): T[];
}

// mission/ 和 session-graph/ 都使用 ITaskScheduler
// mission 额外提供: verifier、HITL、LLM planner
// session-graph 额外提供: file-based dep reading、CompletionAnalyzer
```

#### 5C. 保守替代方案（更安全）

若合并风险过高，只做以下低风险整合：

1. **共用 DependencyGraph**：`mission-scheduler.ts` 的 `getReadyTodos()` 逻辑提取为独立函数，session-graph 复用。
2. **共用 ResultPersistenceService 接口**：`IResultPersistenceService` 已在 common 中，让 session-graph 的 `SessionMetaStore` 实现此接口。
3. **不合并文件**，减少风险，仍然消除重复逻辑。

**操作**（保守方案）：
```
修改: packages/llm-runtime/src/scheduler/（新建，约 80 行）
  - dependency-resolver.ts: getReadyTasks(), topologicalSort()

修改: packages/llm-runtime/src/mission/mission-scheduler.ts
  - 导入 getReadyTasks() 替换内联实现

修改: packages/llm-runtime/src/session-graph/dependency-graph.ts
  - 导入 topologicalSort() 替换内联实现
```

**验证命令**：
```bash
pnpm --filter @itookit/llm-runtime build
pnpm --filter @itookit/llm-runtime test  # 若有 test 脚本
```

---

## 命名规范整理（不破坏性，可单独 PR）

以下整理可在上述阶段间穿插进行：

| 问题 | 文件 | 修复 |
|---|---|---|
| `chat.ts` 应为 `chat-types.ts` 或纳入 llm 子目录 | `common/src/interfaces/chat.ts` | 重命名为 `llm/chat.ts` |
| 顶层文件 PascalCase，子目录 kebab-case 不统一 | `IFile.ts`, `IEditor.ts` 等 | 保持不动（改动影响 IDE 缓存，ROI 低） |
| `SkillFrontmatter` 用 kebab-case 属性名 | `skills/fs-skill-types.ts` | 加 camelCase 别名或改用类型映射 |
| abstract class 作接口（`IEditor`, `ISessionUI` 等） | 多个文件 | 中期重构，当前不动 |
| `ChatCompletionParams._label` 内部字段泄漏 | `llm/completion.ts` | 移至 `ChatCompletionParams` 内部子类型或注释标注 |

---

## 构建与验证

### 测试覆盖

有测试的包：
- `packages/stdio/tests/` — 17 个测试文件（`pnpm --filter @itookit/stdio test`）
- `packages/device-llm/tests/` — 4 个测试文件（`pnpm --filter @itookit/device-llm test`）

**构建命令速查**：
```bash
pnpm --filter @itookit/<pkg> build       # 单包构建
pnpm --filter './packages/*' build       # 全量库包构建
pnpm -r typecheck                        # 全量类型检查（最快验证）
pnpm --filter @itookit/stdio test       # VFS 单测
```

### 各阶段验证脚本

```bash
# Phase 1（零风险）完成后
pnpm -r typecheck && pnpm --filter './packages/*' build

# Phase 2（低风险）完成后
pnpm -r typecheck

# Phase 3/4/5（中风险）完成后
pnpm --filter './packages/*' build && pnpm --filter @itookit/stdio test
```

---

## 接口设计优化总结（common 包）

完成全部阶段后，common 的变化：

| 状态 | 数量 | 说明 |
|---|---|---|
| **删除**（死代码） | ~600 行 | ISettingsWidget, IEntityService, ILogger, IDocumentAnalyzer, GCResult 等 |
| **移出**（回归所属包） | ~800 行 | SRS→mdx, IMentionSource/ISessionUI→vfs-ui, ToolVFSContext→tools, RestorableItem→app-settings |
| **简化**（去重方法） | ~15 个方法 | IAgentConfigService extends IConnectionService |
| **统一**（类型别名） | LLMSkill, LLMSkillType | = SkillDefinition, SkillType |
| **删除 @deprecated** | 4+1 字段 | LLMConnection 废弃字段, AgentConfig.modelName |
| **净减少** | **约 1400 行** | common 包体积和概念负担显著降低 |

common 应保持的原则：
- **只放跨 2+ 包**的接口，单消费者接口不进 common
- **无实现**，仅接口/类型/工具函数
- **无抽象类**，均改为 `interface`（中长期目标）

---

## 风险矩阵

| 阶段 | 风险 | 缓解 |
|---|---|---|
| Phase 1 | 零 | 纯删除已验证零消费者代码 |
| Phase 2A（绕行导入） | 极低 | 类型别名等效，不改运行行为 |
| Phase 2B（app-settings 解耦） | 低 | 功能不变，仅改注入方式 |
| Phase 2C（接口继承） | 低 | TypeScript 结构类型兼容，实现者检查方法完整性 |
| Phase 2D（接口移出） | 低 | 仅修改 import 路径 |
| Phase 3（@deprecated 字段） | 中 | VFS 旧数据兼容：字段删除后 JSON 多余字段被忽略，但需验证所有读取点 |
| Phase 4（Skill 统一） | 中 | 需要 VFS 数据迁移读取，需覆盖 LLMSkill→SkillDefinition 所有字段映射 |
| Phase 5（Mission/SessionGraph） | 中 | 保守方案仅提取共用工具函数，不重组调用链 |
