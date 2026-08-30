# Flow 执行模型与配置工作台设计

> 状态：已实施（2026-08-25 更新配置继承、动态委派与工作台交互）
> 关联：`doc/architecture.md`、`doc/interface-contracts.md`、`doc/event-flows.md`
> 动机：Flow 节点与独立 Agent 配置割裂；systemPrompt 未分块；缺 delegation / history 控制 / 输出过滤

## 1. 目标与原则

1. **Agent = 长期 Node，Flow 节点 = 临时 Node，共享同一份配置结构**（`LlmNodeConfig`），消除两套并行定义。
2. systemPrompt / tools / skills 全部**数组化 + source 分块**，可独立 append / 覆盖 / 审计 / 裁剪。
3. Flow 补齐三项执行能力：**结构化动态委派**、**节点级 history 控制**、**输出过滤**。
4. 保持分层铁律：llm-flow 不依赖 llm-session；app-shell 不依赖 llm-ui（已达成）。
5. 配置行为必须**显式、局部可解释**：不得根据“第一个节点”等易随拓扑变化的条件隐式改变身份或权限。
6. 编辑器必须同时显示“本层设置、继承来源、最终生效值”，避免可填写但运行时不生效的伪配置。

### 1.1 配置层级与覆盖规则

`builtin.agent` 的有效配置按以下固定顺序解析，越靠右优先级越高：

```text
系统默认 → Session Agent → Flow defaults → agentId 引用 → Node 显式设置
```

- 标量字段采用 `node ?? agent ?? flow ?? session ?? system`，包括 connection/model/temperature/maxTokens/thinking/reasoningEffort/approval/maxExchanges。
- 集合字段采用稳定顺序的 union 去重：`Flow ∪ Agent ∪ Node config ∪ Node capabilities`。
- System Prompt 采用有序合成：`Flow → Agent → Node systemPromptId → Node inline prompt`。
- `undefined` 表示继承；`false`、`0` 和空数组是显式值，不得被 truthy/falsy 判断吞掉。
- `agentId` 是一组默认值的快捷引用，不得覆盖 Node 已显式填写的值。

### 1.2 History 与 System Prompt 解耦

`historyPolicy` 只决定对话上下文来源，不再隐式决定是否获得默认 System Prompt：

| historyPolicy | 对话上下文 |
|---|---|
| `inherit` | Session canonical history |
| `upstream` | Task 输入 + 上游节点输出 |
| `none` | 仅 Task 输入，不继承 Session/上游对话 |

System Prompt 由独立的 `systemPromptPolicy` 控制：

| systemPromptPolicy | 行为 |
|---|---|
| `inherit` | 使用 Flow/Agent 默认提示词，并追加节点引用和内联指令（默认） |
| `replace` | 忽略 Flow/Agent 提示词，仅使用节点引用和内联指令 |
| `none` | 不注入任何 System Prompt |

不采用“DAG 第一个节点继承 Session System Prompt”的规则。DAG 可以有多个根、路由和循环；配置语义不得因增加一条边而悄然变化。

---

## 2. 重构前问题（历史动机）

| # | 问题 | 证据 |
|---|------|------|
| P1 | Agent 与 Flow 节点配置**不同构** | Agent 是结构化字段（`AgentDefinition.config.systemPrompt` + `capabilityPolicy.toolIds`）；Flow 节点是扁平 `JsonValue`（`config.prompt` + `config.toolIds` + `capabilities[]` 混在一起） |
| P2 | systemPrompt 单字符串 | `AgentDefinition.systemPrompt: string`（`llm-common/src/llm/agent.ts:24`）；`ContextAssembler.assemble(systemPrompt: string, skillsPrompt: string)`（`llm-tasks/src/core/context-assembler.ts:60-61`） |
| P3 | 节点 prompt / capabilities 被覆盖成死代码 | `bindNode` 里 `prompt: task.input.text` + `capabilities: setup.config.capabilityPolicy?.toolIds`（`llm-session/src/session/session-run-coordinator.ts:304`） |
| P4 | 无动态委派 | `spawn` 仅静态 patch-graph，无法由 Agent 产生 bounded child tasks |
| P5 | 无节点级 history 控制 | 所有 agent 节点 `messages: snapshot.canonicalMessages`（`session-run-coordinator.ts:305`） |
| P6 | 无显式输出过滤 | 仅「root 进 history、中间节点不进」的隐式行为（`conversation-run-coordinator.ts:82-95`） |
| P7 | Agent 未静态引用 skill | `capabilityPolicy = { toolIds, mcpProfileIds }`，缺 `skillIds`（`agent.ts:77`） |

---

## 3. 核心设计：统一节点配置 `LlmNodeConfig`

**回答「Agent 是否该与 Flow 节点同配置」：现在不是，重构后统一。**

```mermaid
flowchart TB
    subgraph Entities["配置实体（一等资源，可独立管理）"]
        SP["SystemPrompt 库<br/>(settings 管理)<br/>content: string[]"]
        TOOL["Tool<br/>(独立实体)"]
        SKILL["Skill<br/>(settings 管理)"]
        CONN["Connection<br/>(settings 管理)"]
    end
    subgraph Persistent["长期 Node（可复用，有版本）"]
        A["AgentDefinition<br/>= LlmNodeConfig（引用 entities）+ 元数据<br/>持久化于 FS_MODULE_AGENTS"]
    end
    subgraph Ephemeral["临时 Node（随 flow revision 冻结）"]
        F["Flow 节点 (builtin.agent)<br/>= LlmNodeConfig（引用 entities + 内联增量）<br/>+ 节点字段(plugin/inputs/dependencies)"]
    end
    A --> SP
    A --> TOOL
    A --> SKILL
    A --> CONN
    F --> SP
    F --> TOOL
    F --> SKILL
    F --> CONN
```

**核心：Agent 与 Flow 节点共享同一 `LlmNodeConfig`，且 systemPrompt / tools / skill / connection 都是「配置实体 + id 引用」，改实体处处生效。**

### 3.1 `LlmNodeConfig`（llm-common 定义，两侧共用）

```ts
export type HistoryPolicy = 'inherit' | 'none' | 'upstream';
export type SystemPromptPolicy = 'inherit' | 'replace' | 'none';

/** System Prompt 库中的可复用指令片段（settings 中管理）。 */
export interface SystemPromptDefinition {
    id: string;
    name: string;
    description?: string;
    content: string[];          // 多段 system 消息（底层多个 role:'system'）
}

/** 统一节点配置：Agent（长期）与 Flow 节点（临时）共用。 */
export interface LlmNodeConfig {
    // ── 引用配置实体（改一处，处处生效）──
    systemPromptId?: string;     // 引用 SystemPrompt 库实体
    toolIds?: string[];          // 直接引用 tool（tool 是独立实体）
    skillIds?: string[];         // 引用 skill
    mcpProfileIds?: string[];    // 引用 MCP profile
    connectionId?: string;       // 引用 connection

    // ── 内联增量（追加到引用之后）──
    systemPrompt?: string[];     // 节点任务指令（追加 system 段）

    // ── 模型 ──
    modelTier?: ModelTier;
    modelName?: string;
    temperature?: number;
    thinking?: boolean;
    reasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh';
    maxTokens?: number;

    // ── 执行策略 ──
    maxExchanges?: number;
    approval?: 'none' | 'external' | 'all';
    historyPolicy?: HistoryPolicy;        // 默认 'inherit'
    systemPromptPolicy?: SystemPromptPolicy; // 默认 'inherit'，与 history 解耦
    persistOutput?: boolean;              // 默认 false
    recordToolCalls?: boolean;            // 默认 true
    recordThinking?: boolean;             // 默认 false

    // ── 记忆（仅长期 Node/Agent 持有；flow 节点不继承）──
    memoryPolicy?: {
        namespaceId: string;
        readScopes: string[];
        writeScopes: string[];
        retrievalLimit?: number;
    };
}
```

### 3.2 两侧形态

```ts
// 长期 Node（Agent）—— 命名组合：引用一套配置实体 + 元数据 + 版本
export interface AgentDefinition {
    id: string;
    version?: string;
    name: string;
    type: AgentType;                       // 'agent' | 'composite' | 'tool' | 'workflow'
    icon?: string;
    description?: string;
    tags?: string[];
    config: LlmNodeConfig;                 // ← 引用 systemPromptId/toolIds/skillIds/connectionId
    interface?: AgentInterfaceDef;
    defaultPrompts?: PromptPreset[];
    createdAt?: number;
    modifiedAt?: number;
}

// 临时 Node（Flow）—— builtin.agent 节点的 config
export interface FlowAgentNodeConfig extends Partial<LlmNodeConfig> {
    agentId?: string;                      // 快捷方式：一次性继承该 Agent 的整套引用
    instruction?: string;                  // 节点任务指令（规范字段）
    delegation?: DelegationConfig;         // 结构化动态委派
    subtasks?: SubtaskDecl;                // deprecated，仅兼容旧数据
}
```

**关键语义：引用 + 内联增量（resolve 时合成）**

```
节点有效配置 = resolve(引用) ⊕ 内联增量
  systemPrompt = resolve(systemPromptId).content  ⊕  内联 systemPrompt[]   （数组 concat）
  tools        = resolve(toolIds)                 （纯引用，tool 是独立实体）
  skills       = resolve(skillIds)                （纯引用）
  connection   = resolve(connectionId)            （纯引用）
  策略(historyPolicy/persistOutput 等) = 节点显式值 ?? agentId 继承值 ?? 默认
```

- 节点可直接 `systemPromptId + toolIds + skillIds + connectionId` 精确组合，也可 `agentId` 一次性继承某个 Agent 的整套引用（`agentId` 是「命名的配置快照」快捷方式）。
- `agentId` 缺失 → 回退 session 当前 Agent（兼容现状）。
- 不引入 ToolSet 实体：节点直接 `toolIds` 引用 tool；SystemPrompt 作为 settings 里的「库」管理，不进 nav 顶层。
- `systemPrompt` 保持数组，底层为多个 `role:'system'` 消息；provider 适配：Chat/Responses/Anthropic 原样多 system，Gemini 合并。
- `instruction` 是 Flow 节点的一条任务指令；`systemPrompt[]` 是可复用身份/约束片段。二者虽然最终都形成 system 消息，但用途不同。旧 `prompt` 仅作为读取兼容字段，节点下次编辑时迁移为 `instruction`。
- 配置层统一使用 `modelName` 表示精确模型 id；`model` 仅保留在 provider/task request 内部以及旧 Flow 的兼容读取路径。

---

## 4. C4 架构（重构后）

### 4.1 Container 视图

```mermaid
C4Container
    title 重构后 LLM 子系统容器视图

    Person(user, "用户", "Web GUI / Tauri 桌面")

    System_Boundary(apps, "应用层") {
        Container(webapp, "web-app / tauri-app", "TS", "入口：import llm-ui 注入 AppUI")
    }

    Container(shell, "app-shell", "TS", "装配：仅依赖抽象契约 AppUI，不依赖 llm-ui")

    System_Boundary(ui, "UI 层") {
        Container(llmui, "llm-ui", "原生 DOM", "DagWorkbench（节点状态徽标）/ FlowSettingsDialog")
    }

    System_Boundary(biz, "业务层") {
        Container(llmsession, "llm-session", "TS", "SessionRunCoordinator / bindFlowNode（分阶段配置解析）")
        Container(llmflow, "llm-flow", "TS", "DurableFlowExecutor / route / spawn / delegation")
        Container(llmtasks, "llm-tasks", "TS", "DurableAgentProgram / ContextAssembler（分块）")
    }

    System_Boundary(engine, "引擎/能力层") {
        Container(devicellm, "device-llm", "TS", "LLMDeviceDriver / providers")
        Container(kernel, "durable-kernel", "TS", "执行内核")
    }

    ContainerDb(agents, "FS_MODULE_AGENTS", "VFS", "长期 Node 配置（AgentDefinition）")
    ContainerDb(flows, "flows VFS 模块", "VFS", "Flow 定义（含临时 Node）")

    Rel(webapp, shell, "initApp(ui)")
    Rel(shell, llmui, "EditorFactory 抽象", "注入")
    Rel(llmui, llmsession, "FlowCommand / SessionCommand")
    Rel(llmsession, llmflow, "flowToDag / executeDag")
    Rel(llmsession, llmtasks, "buildLlmTaskInput / ContextAssembler")
    Rel(llmflow, kernel, "session.submit")
    Rel(llmtasks, kernel, "llm.chat / tool.call effect")
    Rel(devicellm, kernel, "LLM 资源")
    Rel(llmsession, agents, "AgentResolver 读取")
    Rel(llmsession, flows, "FlowDefinitionStore 读取")
```

### 4.2 Component 视图（Flow 执行内核 + 统一配置）

```mermaid
C4Component
    title Flow 执行内核组件（重构后）

    Container_Boundary(coord, "会话编排") {
        Component(bind, "bindFlowNode", "TS", "identity/prompt/capability/model/delegation 分阶段解析")
        Component(snapshot, "ContextAssembler", "TS", "合成 systemPrompt（引用 + 内联）→ canonicalMessages")
    }

    Container_Boundary(flow, "DAG 编排") {
        Component(exec, "DurableFlowExecutor", "TS", "调度 route/loop/spawn/delegation")
        Component(sub, "DelegationFanOut", "TS", "Agent 声明 items[] → bounded child 实例")
    }

    Container_Boundary(tasks, "LLM 任务层") {
        Component(agent, "DurableAgentProgram", "TS", "llm.agent：messages + tools + history 策略")
    }

    Rel(bind, snapshot, "LlmNodeConfig.systemPrompt（引用+内联）", "合成")
    Rel(bind, exec, "DagRunSpec（含节点策略）")
    Rel(exec, sub, "delegation 声明", "fan-out")
    Rel(sub, agent, "template 实例", "并行派发")
    Rel(agent, snapshot, "canonicalMessages", "读取")
```

---

## 5. 接口契约

| 接口 | 位置 | 说明 |
|------|------|------|
| `LlmNodeConfig` | `llm-common` | 统一节点配置（引用 + 内联增量；Agent 与 Flow 节点共享） |
| `SystemPromptDefinition` | `llm-common` | SystemPrompt 库实体（`id/name/content: string[]`，settings 管理） |
| `HistoryPolicy` | `llm-common` | `'inherit' \| 'none' \| 'upstream'` |
| `FlowAgentNodeConfig` | `llm-common/flow-definition` | Flow 节点 config（extends Partial<LlmNodeConfig> + agentId/instruction/delegation） |
| `FlowDraft.systemPrompt?/toolIds?` | `llm-common/flow-definition` | flow 级公共引用（作为未指定 agentId 时的默认基座） |

**systemPrompt 合成（引用 + 内联增量，数组 concat）**：

```
节点 systemPrompt[] = resolve(systemPromptId).content  ⊕  内联 systemPrompt[]
底层消息 = 每个元素一个 { role: 'system', content }
```

**tools 合成（纯引用，无 ToolSet 层）**：

```
节点 tools = resolve(toolIds)（tool 是独立实体，直接引用）
```

provider 适配：OpenAI Chat / Responses / Anthropic 保留多 system；Gemini 合并为单个 systemInstruction。

**tools/skills 合并（数组 union 去重）**：

```
最终 tools = 基座.toolIds ∪ 节点.toolIds ∪ loadedSkill.tools
```

---

## 6. 事件流

### 6.1 Flow 执行（含 delegation / history / 输出过滤）

```mermaid
sequenceDiagram
    participant UI as llm-ui(DagWorkbench)
    participant SRC as SessionRunCoordinator
    participant CRC as ConversationRunCoordinator
    participant FE as DurableFlowExecutor
    participant AP as DurableAgentProgram
    participant CA as ContextAssembler

    UI->>SRC: submit(task, sendIntent.flow)
    SRC->>SRC: loadRevision(flowId, revision)
    SRC->>CRC: executeDag(execution, parameters, createSpec)
    CRC->>CA: assembleContext → snapshot.canonicalMessages
    CRC->>FE: flow.submit(sessionId, flowToDag(revision, bindFlowNode))
    Note over FE: bindFlowNode 分阶段解析 identity/prompt/capability/model/delegation<br/>historyPolicy 决定 messages 来源
    FE->>AP: 每节点 session.submit(taskSpec)
    Note over AP: historyPolicy='none' → messages=[]<br/>'upstream' → applyDependencyMessages<br/>'inherit' → canonicalMessages
    AP->>AP: llm.chat effect（tools 并集）
    opt 节点启用 delegation
        AP->>FE: 工具返回 N 个 payload
        FE->>FE: 受 maxTasks/maxConcurrency/maxDepth 约束地实例化 child
        FE->>AP: 每子任务独立 llm.agent
        FE->>FE: 根据 join.mode 决定是否进入 Flow 根结果
    end
    FE-->>CRC: root 输出
    CRC->>CRC: completeRound（按 persistOutput/recordToolCalls/recordThinking 过滤）
    CRC-->>UI: message:appended（仅持久化的输出）
```

### 6.2 history 控制语义

| `historyPolicy` | messages 来源 | 适用场景 |
|---|---|---|
| `inherit`（默认） | `snapshot.canonicalMessages` | 普通对话节点 |
| `none` | Task 显式输入（不含 Session history / 上游输出） | 隔离的子任务、独立评估 |
| `upstream` | `applyDependencyMessages`（上游节点输出） | 多 Agent 流水线，只传上下文不传会话历史 |

### 6.3 输出过滤语义

| 开关 | false 时行为 |
|---|---|
| `persistOutput` | 节点输出不进会话 history（仅走 DAG 数据流） |
| `recordToolCalls` | `assistantMessage.tool_calls` 剥离后进 history |
| `recordThinking` | thinking 字段剥离后进 history |

---

## 7. UI 可视化（nav / 节点状态）

### 7.1 节点卡片徽标（DagCanvas.renderNode）

在现有节点卡片（`name` + `kind` + `In/Out ports`）基础上，增加一行**策略徽标**（用 `ENTITY_ICONS`/`ACTION_ICONS`，禁止 emoji）：

```html
<article class="dag-node">
  <strong>name</strong>
  <small class="dag-node__kind">Agent</small>
  <!-- 新增策略徽标行 -->
  <div class="dag-node__badges">
    <span class="dag-badge dag-badge--subtask" title="Delegation">↳ 委派</span>   <!-- delegation.enabled 时 -->
    <span class="dag-badge dag-badge--history-inherit" title="继承历史">H:inherit</span>
    <span class="dag-badge dag-badge--persist" title="输出入历史">P</span>       <!-- persistOutput=true -->
  </div>
  <small class="dag-node__ports">In … · Out …</small>
</article>
```

徽标规则：
- **delegation**：节点 `delegation.enabled=true` 时显示「委派」徽标；运行时实例在执行树中显示父实例与序号，不以节点 id 字符串推断层级。
- **history 继承状态**：`H:inherit` / `H:none` / `H:upstream` 三态徽标，颜色区分（inherit 灰 / none 橙 / upstream 蓝）。
- **persistOutput**：`P` 徽标，标识该节点输出会进入会话历史。

### 7.2 Flow 默认设置

Flow 必须提供一组可选默认值，供未显式配置的 Agent 节点继承：

```ts
export interface FlowDefaults {
    agentId?: string;
    connectionId?: string;              // Flow connection slot name
    systemPromptId?: string;
    systemPrompt?: string[];
    toolIds?: string[];
    skillIds?: string[];
    modelName?: string;
    temperature?: number;
    maxTokens?: number;
    thinking?: boolean;
    reasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh';
    approval?: 'none' | 'external' | 'all';
    maxExchanges?: number;
}
```

Connection 仍使用 Flow slot：slot 绑定全局 Connection，节点和 defaults 只引用 slot 名。重命名或删除 slot 时必须检查引用。

### 7.3 Inspector 编辑（专用 Agent 表单）

通用 `SchemaForm` 仅作为未知插件的回退。`builtin.agent` 使用专用 Inspector，按以下区域组织：

1. **身份与任务**：Agent、System Prompt、节点指令、Prompt 合并策略；
2. **模型**：Connection slot、模型与推理参数；
3. **能力**：Tools、Skills，多选并展示继承来源；
4. **上下文与输出**：historyPolicy、persistOutput；
5. **执行策略**：approval、maxExchanges、timeoutMs、maxIterations、workingDirectory、delegation。

实体引用必须使用可搜索选择器，不允许要求用户手写 id 或 JSON 数组。每个可继承字段提供“继承”状态，并展示解析后的来源与生效值。

对应配置字段：
- `systemPromptId`（下拉：SystemPrompt 库）
- `toolIds`（多选：tool 列表）
- `skillIds`（多选：skill 列表）
- `connectionId`（下拉：connection）
- `agentId`（可选快捷方式：一次性继承整套 Agent 引用）
- `historyPolicy`（enum：inherit / none / upstream）
- `persistOutput`（boolean）
- `delegation`（基础区：启用、工具名、Child Agent/指令；高级区：上下文、fan-out、结果、失败与请求限制）

选择 `agentId` 后，inspector 展示该 Agent 的整套引用（只读）；也可直接逐项指定 `systemPromptId/toolIds/skillIds/connectionId` 精确组合。

### 7.4 Flow 输入参数与运行表单

`FlowParameter` 是 Flow 的公开签名。运行前 UI 根据声明生成表单并完成 required/type/default 校验；节点编辑器通过变量选择器插入 `${params.<name>}`，用户无需记忆模板语法。

基础类型为 `string/number/boolean/json`；后续 UI schema 可扩展 `text/select/file/files/secret`，secret 不得进入 revision、日志或普通参数默认值。

### 7.5 工作台交互

- 单击选择，双击编辑；右侧 Inspector 直接编辑常用字段，复杂配置进入完整 Dialog。
- 未选节点时展示 Flow 概览、defaults、参数、connections 和校验问题，而非只有 edge 列表。
- Node 卡片展示继承状态、Agent/模型、history、persistOutput 和错误徽标，不显示原始 JSON。
- Edge 使用端口下拉和类型检查，不要求手填 output/input。
- 支持未保存提示、离开保护、撤销/重做状态、快捷键、多选与批量操作。

### 7.6 侧边栏 / 导航（vfs-ui 层面）

Flow 运行产生的临时子任务，若 `persistOutput=true`，在会话文件树中以子节点/徽标显示；否则不进入导航树（仅运行时执行树中可见）。

### 7.7 Spawn 与动态委派

两种机制共享节点模板编辑器，但语义严格分离：

- `builtin.spawn`：确定性的静态 patch-graph，配置预定义 nodes/edges，本身不是 LLM Harness。
- `builtin.agent.delegation`：LLM 调用声明工具产生 `items[]`，每项实例化一个 Agent 模板。

```ts
type DelegationContextSource = 'session' | 'parent' | 'upstream' | 'isolated';

interface DelegationConfig {
    enabled: boolean;
    toolName?: string;                     // default: delegate_tasks
    toolDescription?: string;
    template: {
        agentId?: string;
        systemPromptId?: string;
        instruction?: string;
        contextSource: DelegationContextSource;
        includeParentSystemPrompt?: boolean;
        includeToolResults?: boolean;
        connectionId?: string;
        modelName?: string;
        toolIds?: string[];
        skillIds?: string[];
        approval?: 'none' | 'external' | 'all';
        workingDirectory?: string;
    };
    fanout: { maxTasks: number; maxConcurrency: number; maxDepth: number; order: 'parallel' | 'sequential' };
    join: { mode: 'all' | 'none' };
    failure: { policy: 'fail-fast' | 'continue' | 'retry'; maxAttempts?: number; backoffMs?: number };
    budget?: { maxTokens?: number; timeoutMs?: number }; // 每次 LLM request 的限制
}
```

动态实例必须在创建前完成与普通节点相同的 Flow/Agent/SystemPrompt/Tool/Skill 解析。`parent` 继承父 Harness 消息；`session` 继承会话；`upstream` 只接收数据依赖输出；`isolated` 不接收会话或上游正文，仅保留解析后的 child system instructions 和 payload。默认限制集中在 `DELEGATION_DEFAULTS`：8 个任务、4 并发、1 层深度。

委派深度由执行器内显式 runtime map 维护；动态节点 id 包含父执行迭代，不能用于推断深度。并发 lane 使用 `kind='control'` 的 DAG 边，仅参与调度；只有 `kind='data'` 的边会把输出注入模型上下文。

`join.mode='all'` 表示子节点输出进入 Flow 根结果，`none` 表示排除输出；两者都会等待已经启动的子任务完成。`failure.policy='fail-fast'` 在首个最终失败后取消同组兄弟并使 Flow 失败，`continue` 保留其他任务，`retry` 先按 retry policy 重试，耗尽后按 fail-fast 处理。

当前没有运行时 USD 扣费器，因此不暴露 `maxCostUsd`。接入定价快照与 `chargeBudget(..., 'usd', amount)` 后才能重新提供费用上限。

### 7.8 外部 Harness 对照与后续编排设计

#### 7.8.1 结论：保留 DAG，补齐 TaskGroup 控制面

Codex 与 Claude Code 的共同模式不是为每种并行行为增加一种新节点，而是把能力分层：

1. `spawn` 创建有稳定身份的子任务；
2. dependency / DAG 决定任务何时可运行；
3. `await` / join 决定调用方何时继续；
4. task handle 提供 status、follow-up、cancel、retry 和 transcript；
5. team/task board 仅用于需要多个自治 Agent 协作的高阶场景。

Codex 支持并行 subagent、等待汇总、检查子线程、向运行中子任务追加指令及停止任务，并允许为自定义子 Agent 设置独立模型、指令和权限。Claude Code 将普通 subagent、后台任务、Agent Teams 和 Dynamic Workflows 分开：独立任务并行，团队任务通过共享任务列表和依赖协调，大规模任务由可恢复脚本编排。

参考：

- [OpenAI Codex Subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents)
- [OpenAI Codex Long-running work](https://learn.chatgpt.com/docs/long-running-work)
- [OpenAI Codex Hooks](https://learn.chatgpt.com/docs/hooks)
- [OpenAI Codex Worktrees](https://learn.chatgpt.com/docs/environments/git-worktrees)
- [Claude Code parallel agents](https://code.claude.com/docs/en/agents)
- [Claude Code Agent Teams](https://code.claude.com/docs/en/agent-teams)
- [Claude Code Dynamic Workflows](https://code.claude.com/docs/en/workflows)
- [Claude Code Worktrees](https://code.claude.com/docs/en/worktrees)

因此，**DAG 继续作为唯一的执行 IR**。固定依赖、fan-out、fan-in、路由和循环仍用 nodes/edges 表达；不再创建第二套 JavaScript workflow runtime。动态 Agent 委派在 DAG 之上增加 TaskGroup/handle 控制面，必要时把高级编排编译为 DAG/Kernel wait，而不是绕过 DAG 调度。

#### 7.8.2 当前能力基线与实际缺口

当前 Durable Kernel 已具备不少必要原语，不能把“UI 没入口”误判为“底层未实现”：

| 能力 | 当前基线 | 仍需补齐 |
|---|---|---|
| 持久子任务 | Kernel `spawnKey` 提供幂等 child spawn；Task identity 在恢复后保持稳定 | Flow `builtin.spawn` 与 delegation 应统一返回可观察的 group/task handles |
| 动态等待 | Kernel `WaitSpec` 已支持 `task` / `child` / `any` / `all` / `quorum` | Flow 目前仅暴露静态入边和 delegation `join=all/none`，Agent 无 `await_tasks` 工具 |
| 任务控制 | `TaskHandle` 已有 `status/wait/signal/start/respond/cancel/events/history/attempts` | DagWorkbench 缺少 task tree、单任务 follow-up、retry、transcript 和阻塞原因展示 |
| 持久通讯 | Kernel 已有 cross-session outbox/inbox | 未向 Agent 暴露受限 mailbox；没有共享 task board、claim/lease 产品层 |
| 并发 | DAG 无入边节点会并发进入 ready；Kernel 有 worker 全局并发上限；delegation 有组内上限 | 缺 Flow 独立 `maxConcurrency`/pool；`DagRunSpec.maxNodes` 已声明但尚未执行 |
| 生命周期 | Kernel 支持 session suspend/resume、task cancel 和交互恢复 | 缺 Goal 实体、可编辑完成条件、pause/resume 进度 UI 和后台通知 |
| 工作区 | Kernel 有 workspace snapshot/diff/merge 抽象 | 缺 Git worktree adapter、节点隔离策略、自动合并与冲突处理 UI |
| 结构化输出 | Provider 层支持 `responseFormat/json_schema` | `LlmNodeConfig`、Agent Inspector 和 edge contract 尚未暴露 output schema/validation |
| Memory/Context | 已声明 `memoryPolicy`，ContextAssembler 支持可选 memory retrieval | 会话装配尚未注入实际 `retrieveMemory`；缺长任务自动 compaction 生命周期 |
| 扩展点 | 已有 plugin、tool、skill、MCP 和 provider hooks | 缺统一 Harness lifecycle hooks（task/tool/subagent/compact/run）及 hook trust 管理 |

#### 7.8.3 Spawn 依赖边界

`builtin.spawn` 可以定义同一 graph patch 内 spawned nodes 的依赖边；固定已知依赖继续直接画在主 DAG 中。动态 patch 只允许以下依赖目标：

```ts
type SpawnDependencyTarget =
    | { type: 'spawned'; node: string }      // 同批动态节点
    | { type: 'parent' }                     // 发起 spawn 的节点
    | { type: 'upstream'; port: string };    // 预声明的上游输入
```

禁止动态任务随意引用任意全局节点或尚未创建的未来节点。Graph patch 应在应用前校验：

- node/edge id 唯一且 idempotency key 生效；
- edge 完整保留 `kind` 与 `onFailure`；
- 不存在悬空引用、非法端口和动态新增环；
- patch 后总节点数不超过 Flow 限制。

无依赖 spawned nodes 可以并发执行；一个节点有多个入边时，DAG fan-in 天然表示静态 `wait all`，不需要额外 Wait 节点。只有运行时 task handle、`any`、`first-success`、`quorum` 或 timeout 等动态等待才进入 TaskGroup/`await_tasks` API。

#### 7.8.4 分离等待、结果与后台生命周期

当前 `join.mode` 同时承载“是否收集结果”和“是否等待”的名称，但实际 `all/none` 都等待已启动 child。后续规范化为三个互不耦合的策略：

```ts
interface TaskGroupPolicy {
    execution: {
        mode: 'structured' | 'detached';
    };
    wait: {
        mode: 'all' | 'any' | 'first-success' | 'quorum';
        quorum?: number;
        timeoutMs?: number;
    };
    result: {
        mode: 'collect' | 'discard';
        order?: 'declared' | 'completion';
    };
}
```

默认 `structured + all + collect`：父任务/Flow 结束前等待 children，父级取消向下传播。`detached` 必须显式选择，并同时声明 owner session、失败可见位置、结果持久化位置、预算和取消策略，避免 orphan task 与失控费用。

Agent 侧统一提供受权限和配额约束的工具：

```ts
spawn_tasks(input): Promise<{ groupId: string; taskIds: string[] }>;
list_tasks(input): Promise<TaskSummary[]>;
await_tasks(input: {
    taskIds: string[];
    mode: 'all' | 'any' | 'first-success' | 'quorum';
    quorum?: number;
    timeoutMs?: number;
}): Promise<TaskGroupResult>;
send_task(input: { taskId: string; message: string }): Promise<void>;
cancel_task(input: { taskId: string; reason?: string }): Promise<void>;
```

#### 7.8.5 运行界面与人体工程要求

Design 模式继续显示 node/edge/Flow Inspector；Run 模式增加真正的执行树，而不是只有根任务状态和整体取消：

```text
Supervisor                    running
├─ research-api               completed   42s
├─ inspect-tests              blocked     waits: research-api
├─ implement                  running     2m
└─ verify                     pending
```

每个 task 至少显示：

- resolved Agent/model/system prompt/tools/skills/permissions；
- 输入、输出、依赖、阻塞原因和 retry attempt；
- token、elapsed time、预算和后续 cost meter；
- tool calls、interaction/approval、事件与独立 transcript；
- `Open / Send follow-up / Cancel / Retry` 操作。

Flow 级运行策略补充：

```ts
interface FlowRunPolicy {
    maxNodes: number;
    maxConcurrency: number;
    timeoutMs?: number;
    maxTokens?: number;
    workspace?: {
        mode: 'shared' | 'read-only' | 'worktree';
        merge?: 'manual' | 'auto-if-clean' | 'discard';
        cleanup?: 'on-success' | 'always' | 'keep';
    };
}
```

#### 7.8.6 结构化输出、Hooks 与 Goal

多 Agent DAG 不应依赖自然语言猜测上下游格式。`LlmNodeConfig` 后续增加：

```ts
interface StructuredOutputPolicy {
    responseFormat?: {
        type: 'text' | 'json_object' | 'json_schema';
        schema?: JsonValue;
    };
    outputValidation?: {
        retries?: number;
        onInvalid?: 'fail' | 'repair' | 'continue';
    };
}
```

data edge 校验 source output schema 与 target input schema；运行时无效输出按策略 fail/repair/continue，并记录原始响应与校验错误。

Harness hooks 采用小而稳定的事件集合：

```text
run.started / run.completed
task.started / task.completed
agent.spawned / agent.stopped
tool.before / tool.after
approval.requested
context.beforeCompact / context.afterCompact
```

Hook 可以注入上下文、审计、验证或阻止危险工具，但必须具备来源展示、内容 hash 信任、最小权限、timeout、输出上限和禁用入口；不能成为绕过 approval/sandbox 的脚本后门。

Goal 属于 Run 控制面，不属于单个 Agent node：

```ts
interface FlowRunGoal {
    objective: string;
    constraints: string[];
    acceptanceCriteria: string[];
    status: 'active' | 'paused' | 'completed' | 'blocked';
}
```

Goal 支持进度摘要、追加约束、pause/resume 和完成标准验证，但不会扩大原 Flow 的工具、文件、网络或审批权限。

#### 7.8.7 同步优先级与明确不做

| 优先级 | 同步内容 | 说明 |
|---|---|---|
| **P0** | task handles/TaskGroup、`await_tasks`、task tree、单任务 steer/cancel/retry、Flow limits、structured output | 多数已有 Kernel/Provider 原语，优先完成协议接线与 UI |
| **P1** | worktree adapter、Goal、Harness hooks、memory retrieval/自动 compaction、预算统计 | 解决长任务可靠性、隔离和可治理性 |
| **P2** | Composite Flow、受限 Agent mailbox、共享 task board、claim/lease、调度/通知 | 仅在明确建设自治 Agent Teams/自动化产品时引入 |

明确不做：

1. 不新增与 DAG 并列的第二套 workflow runtime；脚本或模板只能编译到 DAG/Kernel 原语。
2. 不默认 detached child；不允许无 owner、无预算、无取消传播的后台任务。
3. 不允许跨 session DAG edge；跨 session 只通过 durable message/artifact 交换。
4. 不把共享 task board 作为普通 Flow 的必要组件；固定依赖仍由 DAG 表达。
5. 不把 Goal、worktree、hooks 等 Run/平台策略继续堆进 `builtin.agent` config。

#### 7.8.8 当前实现状态

当前已落地部分均走统一 DAG/Kernel 路径：

- Delegation 已拆分 `execution / wait / result / failure / budget`，支持 `all / any / first-success / quorum`、结构化取消、显式深度、并发和超时边界；detached 必须配置 deadline。
- 动态 spawn edge 支持 `$parent` 与 `$upstream:<nodeId>` 锚点，保留 `kind / onFailure`；无依赖节点由 DAG scheduler 自然并发。
- Flow Run 已实现 `maxNodes / maxConcurrency / timeoutMs / maxTokens`、Goal、task tree、单任务 signal/cancel、时间与 token 统计。
- Agent 已接入 `responseFormat + outputValidation`（fail/repair/continue）、可配置上下文压缩；Session ContextAssembler 已开放 memory retrieval 注入点。
- Harness hook 使用可信来源、content hash、timeout 和输出上限的 host boundary；Flow 文档不能自行安装 hook 代码。
- Kernel Session 已支持任务恢复/列举、父子取消传播、跨 Session durable mailbox，以及带 CAS claim/renew/expiry lease 的可选 task board。
- worktree 使用 argv-safe Git manager；没有配置 workspace manager 时非 shared 模式 fail closed。
- `builtin.flow` Composite 在执行前递归展开并 namespace 到同一 DAG，带循环检测、参数绑定和入口/出口边重写，不引入嵌套 runtime。

---

## 8. 数据迁移与兼容

1. **AgentDefinition.config.systemPrompt: string → LlmNodeConfig.systemPromptId 引用 SystemPrompt 库**：旧内联 string 迁移为「SystemPrompt 库实体 + `systemPromptId` 引用」，或暂作内联 `systemPrompt: [string]`（向后兼容）。
2. **旧 Flow 节点扁平 config（prompt/model）→ FlowAgentNodeConfig（instruction/modelName）**：编辑时规范化，运行时继续兼容读取；缺 `agentId`/`systemPromptId` 回退 session Agent。
3. **`capabilityPolicy` 增 `skillIds`**：可选，旧数据 `undefined` 视为空数组。
4. **`ContextBlock` 不变**：不扩展 source（systemPrompt 合成走「引用 + 内联」，不进 ContextBlock 分块）。

---

## 9. 分阶段落地

| 阶段 | 内容 | 包 | 验证 |
|---|---|---|---|
| **P1 数据模型** | `LlmNodeConfig`（引用 + 内联）+ `SystemPromptDefinition` + `HistoryPolicy`；`capabilityPolicy.skillIds`；`FlowDraft/Revision.systemPrompt/toolIds`；`FlowAgentNodeConfig` | llm-common | typecheck |
| **P2 运行时（配置统一）** | 固定五层继承；`bindFlowNode` 分阶段 resolve 引用；Node 显式值优先；System Prompt 与 History 解耦 | llm-session / llm-tasks | typecheck + test |
| **P3 三能力** | 节点级 `historyPolicy` / `persistOutput` / `delegation`（结构化 payload + history 隔离） | llm-flow / llm-tasks | test |
| **P4 UI/seed** | Flow defaults + 参数运行表单 + builtin.agent 专用 inspector + 实体选择器；default-flows 改「引用 + 节点增量」 | llm-ui / llm-session | typecheck + UI test |
| **P5 TaskGroup 控制面** | task handles；spawn/list/await/send/cancel tools；wait/result/execution 分离；Flow maxNodes/maxConcurrency；动态 patch 校验 | durable-kernel / llm-flow / llm-tasks | 幂等 spawn、any/all/quorum、取消传播、限制测试 |
| **P6 运行可观察性与隔离** | Run task tree；单任务 steer/retry/transcript；structured output；worktree adapter；token/time/cost 统计 | llm-ui / llm-flow / durable-kernel | UI interaction + schema contract + workspace integration |
| **P7 长任务与扩展** | Goal；Harness hooks；memory retrieval/compaction；Composite Flow；按需 Agent task board/mailbox | llm-session / llm-flow / app-shell | 恢复、信任边界、长期运行与组合 Flow 测试 |

---

## 10. 已决策 / 待确认

**已决策**（本轮评审确定）：

1. **memoryPolicy**：仅 Agent 长期形态持有，flow 临时节点不继承（靠显式文本传参，不靠隐式记忆）。
2. **delegation 通讯模型**：父 Agent 通过声明工具返回结构化 `items[]`；每项成为 child payload。child 上下文由 `contextSource` 明确选择，输出是否进入 Flow 结果由 `join.mode` 决定，不隐式写回已经结束的父 Agent。
3. **systemPrompt / tools 引用模型**：systemPrompt、tool、skill、connection 均为「配置实体 + id 引用」，Agent 与 Flow 节点用 `LlmNodeConfig` 引用；`systemPromptId` 引用 SystemPrompt 库（settings 管理），`toolIds` 直接引用 tool（不引入 ToolSet 层）。
4. **systemPrompt 数组化**：`systemPrompt: string[]`（引用 resolve 结果 ⊕ 内联增量），底层多 system 消息，不拼字符串。
5. **继承顺序**：系统 → Session Agent → Flow defaults → agentId → Node；Node 显式值最高。
6. **System Prompt 与 History 解耦**：不使用“第一个节点”拓扑特判；Prompt 通过 inherit/replace/none 明确控制。
7. **编辑器策略**：`builtin.agent` 使用专用表单；通用 SchemaForm 仅作为插件回退。

**待确认**：

8. **统一大 Node（Composite）**：采用“编译期展开”而不是嵌套 runtime。`builtin.flow` 引用不可变 Flow revision，展开后与父 Flow 共用同一个 DAG scheduler、limits、task tree 与取消域。
