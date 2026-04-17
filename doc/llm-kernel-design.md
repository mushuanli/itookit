# llm-kernel 认知架构设计

> **版本**：v2.0
> **状态**：设计稿（待实施）
> **背景**：在已完成 llm-kernel 基础执行引擎、MCPExecutor、ReActOrchestrator 的基础上，向认知级架构演进。

---

## 一、现状与问题

### 1.1 已完成的基础架构

```
packages/llm-kernel/src/
├── core/           ExecutionContext（已注入 deviceManager）
├── executors/      Agent / MCP / Skill / Http / Tool / Script
├── orchestrators/  Serial / Parallel / DAG / Loop / Router / ReAct
└── runtime/        ExecutionRuntime（全局单例）
```

**已实现能力**：
- `AgentExecutor`：LLM 调用，通过 `context.deviceManager` 访问设备驱动
- `MCPExecutor` / `SkillExecutor`：工具调用
- `ReActOrchestrator`：LLM + 工具调用交替循环
- `ExecutorRegistry`：可插拔执行器注册（loop/dag/react 已修复注册）

### 1.2 认知级需求的差距

| 维度 | 现状（执行引擎） | 认知级需求 |
|---|---|---|
| 理解输入 | 原始字符串传入 | 意图识别 / 实体抽取 / 模态感知 |
| 记忆管理 | 外部传 history 数组 | 上下文预算 / 摘要压缩 / 多类记忆 |
| 规划能力 | 手工拼 OrchestratorConfig | 目标分解 / 计划生成 / 动态修订 |
| 工具路由 | 静态配置 type/mode | 语义匹配 / 能力发现 / 组合推断 |
| 质量判断 | 无 | 输出评估 / 安全检查 / 置信度 |
| 失败恢复 | catch → status=failed | 策略切换 / 降级 / 自我修正 |
| 推理策略 | ReAct 固化 | ReAct/CoT/ToT/Critic/Reflection 可插拔 |
| 自我感知 | 无 | 元认知：知道自己知道什么 |
| 人工介入 | 无 | 关键节点暂停 → 人工审核 → 继续 |

---

## 二、新架构总览

### 2.1 分层模型

```
┌────────────────────────────────────────────────────────────────┐
│  L0  Intake Layer（感知层）                                      │
│  InputNormalizer │ IntentClassifier │ ContextAssembler         │
└───────────────────────────┬────────────────────────────────────┘
                            │ Problem { intent, entities, goal }
┌───────────────────────────▼────────────────────────────────────┐
│  L1  Cognition Layer（认知层）                                   │
│  WorkingMemory │ LongTermMemory │ GoalDecomposer │ Planner     │
└───────────────────────────┬────────────────────────────────────┘
                            │ ExecutionPlan { steps, strategy }
┌───────────────────────────▼────────────────────────────────────┐
│  L2  Strategy Layer（策略层）      ← 新增核心层                   │
│  IStrategy: ReAct │ PlanExecute │ Reflection │ Critic │ ToT   │
│  StrategySelector (rule + LLM) │ StrategyRouter                │
└───────────────────────────┬────────────────────────────────────┘
                            │ OrchestratorConfig + hints
┌───────────────────────────▼────────────────────────────────────┐
│  L3  Orchestration Layer（编排层）  ← 现有，增强                  │
│  Serial │ Parallel │ DAG │ Loop │ Router │ StateMachine        │
│  + 新增 Critic │ Checkpoint │ EventDriven                      │
└───────────────────────────┬────────────────────────────────────┘
                            │ ExecutorConfig
┌───────────────────────────▼────────────────────────────────────┐
│  L4  Executor Layer（执行层）      ← 现有，补完                   │
│  Agent │ MCP │ Skill │ Http │ Tool │ Script                   │
│  + 新增 SubAgent │ Judge │ Memory                             │
└───────────────────────────┬────────────────────────────────────┘
                            │ IDeviceManager (via context)
┌───────────────────────────▼────────────────────────────────────┐
│  L5  Capability Layer（能力层，device-llm 区域）                  │
│  LLM Driver │ MCP Server │ Skill Registry                     │
└────────────────────────────────────────────────────────────────┘

────── 横切关注点（贯穿 L0~L4）──────────────────────────────────
  JudgmentEngine │ CapabilityRegistry │ Metacognition │ Telemetry
─────────────────────────────────────────────────────────────────
```

### 2.2 核心设计原则

1. **策略与编排分离**：`IStrategy` 决定"用什么方法"，`Orchestrator` 决定"按什么顺序"
2. **判定器是一等公民**：`IJudge` 与 `IExecutor` 同级，可任意插拔，人工判定器同构
3. **能力语义注册**：工具通过 `CapabilityRegistry` 语义描述，不依赖硬编码 type 字符串
4. **判断前置**：`JudgmentEngine` 在执行前后均介入，不是事后补救
5. **元认知驱动循环**：`MetacognitionLayer` 是循环终止和策略切换的唯一决策者
6. **向后兼容**：现有 `ExecutionRuntime` + Executor + Orchestrator 继续工作，`CognitiveRuntime` 是可选升级

---

## 三、判定器驱动执行流（核心）

### 3.1 完整执行流

```
输入
 │
 ├─── Phase 0: Pre-Filter（前置过滤，fail-fast）─────────────────
 │    [并行执行，任一拦截立即返回 Rejection]
 │    ├─ SafetyFilter   (rule-based, sync)  → 违规内容 → 立即拒绝
 │    ├─ NoiseFilter    (rule-based, sync)  → 去重/规范化
 │    └─ ScopeFilter    (rule + small LLM)  → 超出服务范围 → 拒绝
 │
 ├─── Phase 1: Understand（理解）────────────────────────────────
 │    IntentClassifier → Intent { type, confidence }
 │    ContextAssembler → 注入 memories + history
 │    WorkingMemory.budget check
 │
 ├─── Phase 2: Route & Plan（路由与规划）────────────────────────
 │    IntelligentRouter:
 │    ├─ GoalDecomposer    → Goal[]
 │    ├─ CapabilityMatcher → 匹配工具/Executor（语义）
 │    ├─ StrategySelector  → ReAct | PlanExecute | Direct | ...
 │    └─ PlanBuilder       → ExecutionPlan { steps[] }
 │
 ├─── Phase 3: Execute with Gates（带门控的执行）────────────────
 │    [For each step in plan:]
 │    │
 │    ├─ [Pre-Judges：顺序，快速失败]
 │    │   ├─ ContextSufficiencyJudge  → 上下文是否充足？
 │    │   ├─ FeasibilityJudge         → 这步是否可以执行？
 │    │   └─ [失败 → 跳过执行，直接生成 feedback]
 │    │
 │    ├─ [Execute]  Executor.run(step)
 │    │
 │    ├─ [Post-Judges：并行组 + 顺序组]
 │    │   Group A（cheap，并行）:
 │    │   ├─ FormatJudge     → 格式是否正确
 │    │   └─ LengthJudge     → 长度是否合理
 │    │   [Group A 全部 pass 后执行 Group B]
 │    │   Group B（expensive，顺序）:
 │    │   ├─ RelevanceJudge  → 是否切题（小 LLM）
 │    │   ├─ FactualJudge    → 事实有无依据（可选）
 │    │   ├─ QualityJudge    → 质量评分 ≥ threshold？
 │    │   └─ HumanJudge      → 关键节点人工审核（可选，异步）
 │    │
 │    ├─ [Verdict Aggregation]
 │    │   ALL pass → accumulate result → next step
 │    │   ANY fail →
 │    │     FeedbackGenerator.generate(failedVerdicts)
 │    │       → StructuredFeedback { mustFix[], suggestion, examples }
 │    │     LoopDetector.check() → 循环？→ Escalate
 │    │     attempt < MAX_RETRY？
 │    │       yes → Router.retry(problem + feedback) → [回到 Pre-Judges]
 │    │       no  → blocking=true → Escalate
 │    │              blocking=false → Accept partial + warning
 │    │
 ├─── Phase 4: Finalize（收尾）──────────────────────────────────
 │    [Final Output Judges]
 │    ├─ CompletenessJudge  → 所有子目标是否覆盖？
 │    ├─ CoherenceJudge     → 各步骤结果是否一致？
 │    └─ FinalSafetyJudge   → 综合输出是否安全？
 │    [Post-Filter]
 │    ├─ RedactionFilter    → 脱敏（PII 等）
 │    └─ FormattingFilter   → 规范化输出格式
 │
 └─── Output: Result { content, qualityReport, auditTrail, warnings? }
```

### 3.2 与业界方案对比

| 特性 | Simple Chain | ReAct | AutoGen | LangGraph | **本方案** |
|---|:---:|:---:|:---:|:---:|:---:|
| 任意插入判定器 | ❌ | ❌ | ❌ | 有限 | ✅ |
| 质量不达标有反馈重试 | ❌ | ❌ | 部分 | 需自定义 | ✅ 原生 |
| 多层安全过滤 | 手动 | 手动 | 手动 | 手动 | ✅ 内置 |
| 智能语义路由 | ❌ | ❌ | 角色分工 | 状态机 | ✅ 动态 |
| 步骤前置判定 | ❌ | ❌ | ❌ | 有限 | ✅ |
| 结构化反馈生成 | ❌ | ❌ | 非正式 | 需自定义 | ✅ 原生 |
| 人工判定器（异步）| ❌ | ❌ | ❌ | 需自定义 | ✅ 同构 |
| 判定失败提前退出 | ❌ | ❌ | ❌ | 需自定义 | ✅ |
| 全流程可观测 | ❌ | 部分 | 部分 | ✅ | ✅ |

---

## 四、核心接口设计

### 4.1 判定器（IJudge）

```ts
// @file: llm-kernel/src/judgment/interface.ts

interface IJudge {
    readonly id: string;
    readonly name: string;
    readonly priority: number;      // 数字小 = 优先执行（快速失败）
    readonly cost: 'free' | 'cheap' | 'expensive' | 'human';
    readonly mode: 'pre' | 'post' | 'both';

    /** 触发条件（不满足则跳过此判定器） */
    triggerCondition?: (ctx: JudgeInput) => boolean;

    evaluate(input: JudgeInput): Promise<JudgeVerdict>;
}

interface JudgeVerdict {
    pass: boolean;
    score: number;              // 0-1
    threshold: number;          // 通过门槛
    blocking: boolean;          // true=必须修复, false=警告
    feedback: StructuredFeedback | null;  // 失败时必须提供
    overrideOutput?: string;    // 人工修改内容时替换输出
}

interface StructuredFeedback {
    issue: string;              // 问题描述（机器可读）
    detail: string;             // 具体说明（人类可读）
    suggestion: string;         // 改进建议（给 Router 的可操作指令）
    examples?: string[];        // 期望输出示例（少样本）
}

// 判定器执行优先级（fail-fast 原则）
// 优先级 1（sync，纳秒）：格式/长度/正则
// 优先级 2（本地，毫秒）：安全分类、毒性检测
// 优先级 3（规则，毫秒）：业务规则、合规检查
// 优先级 4（小LLM，秒）：相关性、完整性
// 优先级 5（强LLM，秒~10s）：事实核查、质量评估
// 优先级 10（human，分~时）：人工审核
```

### 4.2 判定引擎（IJudgmentEngine）

```ts
// @file: llm-kernel/src/judgment/engine.ts

interface IJudgmentEngine {
    addJudge(judge: IJudge): void;
    removeJudge(id: string): void;

    /** 并行执行同优先级，顺序执行跨优先级，任一失败跳过更高级 */
    evaluate(input: JudgeInput, phase: 'pre' | 'post'): Promise<JudgmentResult>;
}

interface JudgmentResult {
    pass: boolean;
    score: number;
    verdicts: JudgeVerdict[];
    action: 'proceed' | 'retry' | 'block' | 'escalate';
    aggregatedFeedback?: StructuredFeedback;  // 多个失败合并
}
```

### 4.3 策略层（IStrategy）

```ts
// @file: llm-kernel/src/strategies/interface.ts

interface IStrategy {
    readonly id: string;
    readonly description: string;

    /** 策略适用性评估（快速规则判断，0-1） */
    canHandle(problem: Problem): StrategyFit;

    /** 将目标和能力转化为 OrchestratorConfig */
    buildOrchestrator(
        plan: ExecutionPlan,
        capabilities: CapabilityInfo[],
        context: CognitionContext
    ): Promise<OrchestratorConfig>;

    /** 执行后评估：是否满足 / 需继续 / 切换策略 */
    evaluate(result: ExecutionResult, context: CognitionContext): Promise<StrategyEvaluation>;
}

interface StrategyEvaluation {
    satisfied: boolean;
    confidence: number;
    action: 'complete' | 'continue' | 'switch' | 'escalate' | 'fallback';
    switchTo?: string;
    refinement?: string;    // 给下轮的改进 prompt
}

// 内置策略
// DirectResponseStrategy    - 单次 LLM 调用，无工具，简单 QA
// ReActStrategy             - LLM → 工具 → 观察 → 循环（已有，迁移）
// PlanAndExecuteStrategy    - 先生成完整计划 → 逐步执行
// ReflectionStrategy        - 执行 → 自我评估 → 修正 → 再执行
// CriticExecutorStrategy    - Executor 生成 → Critic 评估 → 修正
// TreeOfThoughtStrategy     - 并行探索多路径 → 选最优
```

### 4.4 能力注册表（ICapabilityRegistry）

```ts
// @file: llm-kernel/src/capabilities/registry.ts

interface CapabilityManifest {
    id: string;
    name: string;
    description: string;          // 自然语言描述，供 LLM 理解和匹配
    category: 'llm' | 'tool' | 'mcp' | 'skill' | 'http' | 'code';
    inputSchema: JSONSchema;
    outputSchema: JSONSchema;
    costHint: { latency: 'fast' | 'medium' | 'slow'; tokens?: number };
    tags: string[];
    examples?: Array<{ input: string; output: string }>;
}

interface ICapabilityRegistry {
    register(manifest: CapabilityManifest, factory: () => IExecutor): void;

    /** 语义搜索：根据任务描述找最匹配的能力 */
    discover(query: string, context?: Problem): Promise<CapabilityInfo[]>;

    /** 生成 LLM 可理解的工具描述列表 */
    toToolDescriptions(): ToolDefinition[];

    /** 能力组合推断 */
    suggest(goal: string): Promise<CapabilityComposition[]>;
}
```

### 4.5 工作记忆（IWorkingMemory）

```ts
// @file: llm-kernel/src/cognition/working-memory.ts

interface TokenBudget {
    total: number;      // context window 总 token
    used: number;       // 已占用
    reserved: number;   // 为输出预留
    available: number;  // 可用于历史/记忆注入
}

interface IWorkingMemory {
    readonly budget: TokenBudget;

    add(item: MemoryItem, priority?: number): void;

    /** 当 available 不足时，摘要压缩低优先级内容 */
    prune(targetTokens: number): void;

    /** 组装为 LLM 的 messages 列表 */
    assemble(): ChatMessage[];

    snapshot(): WorkingMemorySnapshot;
}
```

### 4.6 元认知层（IMetacognitionLayer）

```ts
// @file: llm-kernel/src/metacognition/layer.ts

interface MetaAssessment {
    progress: number;           // 0-1 目标完成度
    confidence: number;         // 0-1 当前输出置信度
    stuckDetected: boolean;     // 是否陷入循环（相邻2次score无提升）
    resourcesExhausted: boolean;// token/步数耗尽
    qualityScore: number;
    anomalies: string[];
}

type RecoveryAction =
    | { type: 'retry'; maxAttempts: number }
    | { type: 'switch-strategy'; to: string }
    | { type: 'simplify'; hint: string }
    | { type: 'escalate'; to: 'human' | 'upstream-agent' }
    | { type: 'abort'; reason: string };

interface IMetacognitionLayer {
    assess(state: CognitionContext): Promise<MetaAssessment>;
    shouldContinue(assessment: MetaAssessment): boolean;
    onFailure(error: Error, state: CognitionContext): Promise<RecoveryAction>;
    checkStrategySwitch(current: IStrategy, assessment: MetaAssessment): IStrategy | null;
}
```

---

## 五、人工判定器（Human-in-the-Loop）

### 5.1 设计原理

人工判定器与自动判定器**完全同构**（均实现 `IJudge`），但行为不同：

```
自动判定器：同步/异步，毫秒~秒级，进程内执行
人工判定器：纯异步，分钟~小时级，需挂起执行状态
```

实现机制：

```
遇到 HumanJudge 节点
  ↓
SummaryGenerator → ExecutionSummary（目标+进度+当前输出+风险+选项）
  ↓
CheckpointManager.save(executionState) → VFS 持久化
  ↓
ReviewStore.create(reviewRequest) + NotificationService.send()
  ↓
返回 { status: 'pending', reviewId } — 执行流挂起，不阻塞进程
  ↓
──── 等待人工响应（分钟~小时）────
  ↓
人工在 Review Queue UI 中操作：
  [批准]       → verdict.pass=true，可附带指令注入后续 context
  [拒绝+原因]  → verdict.pass=false，原因转为 StructuredFeedback → 走重试
  [修改内容]   → verdict.pass=true，overrideOutput 替换执行输出
  [请求澄清]   → 触发子任务让 AI 回答 → 人工再次决策
  ↓
HumanDecisionStore.record() → DecisionBus.emit() → Promise resolves
CheckpointManager.restore() → 执行从挂起点继续
```

### 5.2 接口定义

```ts
// @file: llm-kernel/src/judgment/human-judge.ts

interface HumanJudgeConfig {
    id: string;
    name: string;

    summary: {
        maxLength: number;
        includeRawOutput?: boolean;
        highlightRisks?: boolean;
        template?: string;
    };

    timeout: {
        duration: number;                          // 等待时长 (ms)
        action: 'auto-approve' | 'auto-reject' | 'escalate';
        remindAt?: number[];                       // 提醒时间点
    };

    channels: INotificationChannel[];

    quorum?: {                                     // 多人审批
        required: number;
        pool: string[];
        strategy: 'any' | 'all' | 'majority';
    };

    permissions: {
        canApprove: boolean;
        canReject: boolean;
        canModify: boolean;
        canAddInstruction: boolean;
        canRequestClarification: boolean;
    };

    /** 触发条件：不是每次都触发人工审核 */
    triggerCondition?: (ctx: JudgeInput) => boolean;
}

interface HumanDecision {
    reviewId: string;
    reviewerId: string;
    action: 'approve' | 'reject' | 'modify' | 'request-clarification';
    reason?: string;
    suggestion?: string;
    instruction?: string;       // approve 时附带指令
    modifiedContent?: string;   // modify 时的新内容
    question?: string;          // request-clarification 时的问题
    timestamp: number;
}

// 通知渠道抽象
interface INotificationChannel {
    type: string;
    send(request: ReviewRequest): Promise<void>;
}

// 实现：InAppNotificationChannel（写入 VFS review queue）
//       WebhookNotificationChannel（Slack/企业微信/Jira）
//       EmailNotificationChannel
```

### 5.3 摘要生成（ExecutionSummary）

```ts
interface ExecutionSummary {
    goal: string;                   // 原始任务目标
    progress: StepSummary[];        // 已完成步骤
    currentOutput: {
        content: string;            // 需要审核的输出
        step: string;
        judgesFailed?: string[];    // 哪些自动判定器失败了
    };
    risks: Array<{
        level: 'info' | 'warning' | 'critical';
        description: string;
    }>;
    impact: string;                 // 继续执行的影响
    options: ReviewOption[];
    meta: {
        totalSteps: number;
        completedSteps: number;
        elapsedTime: number;
    };
}
```

### 5.4 典型使用场景

**场景 1：内容发布前审核**
```ts
new HumanJudge({
    id: 'publish-review',
    timeout: { duration: 4 * 3600_000, action: 'auto-reject' },
    channels: [new InAppChannel(), new WebhookChannel(SLACK_URL)],
    permissions: { canApprove: true, canReject: true, canModify: true,
                   canAddInstruction: true, canRequestClarification: false },
    triggerCondition: (ctx) => ctx.problem.tags.includes('publish'),
})
```

**场景 2：生产环境操作（需双人确认）**
```ts
new HumanJudge({
    id: 'production-gate',
    timeout: { duration: 30 * 60_000, action: 'auto-reject' },
    quorum: { required: 2, pool: ['admin-1', 'admin-2', 'admin-3'], strategy: 'any' },
    permissions: { canApprove: true, canReject: true, canModify: false,
                   canAddInstruction: false, canRequestClarification: true },
})
```

**场景 3：长任务里程碑检查点**
```ts
new HumanJudge({
    id: 'milestone-review',
    timeout: { duration: 24 * 3600_000, action: 'auto-approve' }, // 24h后自动继续
    permissions: { canApprove: true, canReject: false,            // 只能确认或加指令
                   canModify: false, canAddInstruction: true,
                   canRequestClarification: true },
    triggerCondition: (ctx) => ctx.completedSteps % 5 === 0,      // 每5步触发
})
```

---

## 六、目录结构

```
packages/llm-kernel/src/
│
├── core/                         # 已有，保持
│   ├── types.ts                  # ExecutorType(+mcp,skill) / OrchestrationMode(+react)
│   ├── interfaces.ts
│   ├── execution-context.ts      # 已注入 deviceManager
│   └── device-registry.ts
│
├── perception/                   # 新增 L0
│   ├── input-normalizer.ts       # 统一输入格式
│   ├── intent-classifier.ts      # 意图分类（规则优先，LLM 兜底）
│   └── context-assembler.ts      # 组装上下文
│
├── cognition/                    # 新增 L1
│   ├── working-memory.ts         # Token 预算 + 摘要压缩
│   ├── memory-store.ts           # 多类记忆接口（episodic/semantic/procedural）
│   ├── goal-decomposer.ts        # 目标分解
│   └── planner.ts                # 执行计划生成
│
├── strategies/                   # 新增 L2（核心）
│   ├── interface.ts              # IStrategy, StrategyEvaluation
│   ├── selector.ts               # RuleBasedSelector + LLMSelector（CompositeSelector）
│   ├── direct-response.ts        # 单次 LLM，无工具
│   ├── react.ts                  # 迁移自 orchestrators/react.ts
│   ├── plan-execute.ts           # 先规划，后执行
│   ├── reflection.ts             # 执行 → 自评 → 修正
│   ├── critic-executor.ts        # Executor + Critic 对抗
│   └── tree-of-thought.ts        # 多路径并行探索
│
├── orchestrators/                # 已有，扩充
│   ├── serial.ts / parallel.ts / dag.ts / loop.ts / router.ts
│   ├── critic.ts                 # 新增：Critic 对抗循环编排器
│   ├── checkpoint.ts             # 新增：带持久化断点的循环
│   └── event-driven.ts           # 新增：等待外部事件
│
├── executors/                    # 已有，扩充
│   ├── agent-executor.ts         # 已有（returnToolCalls 模式）
│   ├── mcp-executor.ts           # 已有
│   ├── skill-executor.ts         # 已有
│   ├── http-executor.ts / tool-executor.ts / script-executor.ts
│   ├── sub-agent-executor.ts     # 新增：委托给完整认知流程
│   ├── judge-executor.ts         # 新增：内嵌判定节点
│   └── memory-executor.ts        # 新增：显式记忆存取
│
├── judgment/                     # 新增（横切）
│   ├── interface.ts              # IJudge, JudgeVerdict, StructuredFeedback
│   ├── engine.ts                 # IJudgmentEngine 实现
│   ├── human-judge.ts            # HumanJudge（异步 + 持久化）
│   ├── feedback-generator.ts     # 多判定器失败 → 聚合反馈
│   ├── loop-detector.ts          # 检测无效重试循环
│   └── rules/
│       ├── safety.ts             # 安全内容过滤
│       ├── relevance.ts          # 相关性
│       ├── format.ts             # 格式验证
│       ├── quality.ts            # 质量评分（LLM-based）
│       ├── factual.ts            # 事实核查
│       └── completion.ts         # 任务完成度
│
├── capabilities/                 # 新增（横切）
│   ├── registry.ts               # ICapabilityRegistry
│   ├── manifest.ts               # CapabilityManifest
│   └── composer.ts               # 能力组合推断
│
├── metacognition/                # 新增（横切）
│   ├── layer.ts                  # IMetacognitionLayer
│   ├── assessor.ts               # MetaAssessment 计算
│   └── recovery.ts               # 失败恢复策略
│
├── checkpoint/                   # 新增（支持 HumanJudge）
│   ├── manager.ts                # CheckpointManager（VFS 持久化）
│   └── review-store.ts           # HumanDecisionStore
│
└── runtime/
    ├── execution-runtime.ts      # 已有，保持（基础执行）
    └── cognitive-runtime.ts      # 新增：完整认知流程入口
```

---

## 七、关键风险与应对

| 风险 | 严重性 | 应对 |
|---|:---:|---|
| 判定器本身误判 | 高 | 多数决（≥2/3 pass）；Judge 有置信度字段；人工监督采样 |
| 反馈质量差 → 重试无效 | 高 | 结构化反馈模板 + 示例驱动；反馈本身经质量检查 |
| 延迟爆炸 | 中 | 规则判定先行；并行执行同优先级；缓存 Judge 结果 |
| 无限循环 | 高 | MAX_RETRY=3（经验值）；LoopDetector；Escalation 路径必须存在 |
| 过度过滤（误杀正常输出）| 中 | 判定器有置信度阈值；灰度发布；rule-based 严格测试 |
| HumanJudge 阻塞业务 | 中 | triggerCondition 限制触发频率；timeout 自动 approve/reject |
| Checkpoint 状态不一致 | 中 | VFS 事务写入；恢复前验证 checksum |

---

## 八、实施路线图

| 阶段 | 内容 | 价值 | 依赖 |
|---|---|---|---|
| **P0（当前）** | 已完成：MCPExecutor、SkillExecutor、ReActOrchestrator、loop/dag/react 注册修复 | 工具调用可用 | ✅ |
| **P1** | `IJudge` + `IJudgmentEngine` + 基础规则（Safety/Format/Quality）| 内置质量门控 | P0 |
| **P1** | `ICapabilityRegistry` + `CapabilityManifest` | 语义工具发现 | P0 |
| **P2** | `StructuredFeedback` + `FeedbackGenerator` + Router 重试 | 质量反馈闭环 | P1 |
| **P2** | `IWorkingMemory` + Token Budget 管理 | 告别手工裁剪 history | P1 |
| **P2** | `HumanJudge` + `CheckpointManager` + Review Queue UI | 关键节点人工介入 | P1 |
| **P3** | `IMetacognitionLayer` + 策略切换 | 取代 engine 层 auto-continue | P2 |
| **P3** | `IStrategy` + `StrategySelector` + 多策略实现 | 推理模式可插拔 | P2 |
| **P4** | `IPerceptionLayer` + Intent Classification | 真正的智能路由入口 | P3 |
| **P4** | `SubAgentExecutor` + 多 agent 协作 | CrewAI 风格任务分工 | P3 |

---

## 九、与 llm-engine 的职责边界

| 职责 | llm-kernel | llm-engine |
|---|---|---|
| 单次 LLM 调用 | AgentExecutor | — |
| 工具调用路由 | ReActOrchestrator | — |
| 任务队列 + 并发 | — | TaskRunner |
| 质量门控 | JudgmentEngine | — |
| 历史构建 | WorkingMemory（新） | buildHistoryForTask |
| 续写（auto-continue）| MetacognitionLayer（新，P3） | AutoContinueHandler（当前） |
| VFS 持久化 | CheckpointManager（仅检查点）| LLMSessionEngine（消息树）|
| 会话状态 | — | SessionManager |
| UI 事件 | — | TaskRunner + SessionEventBus |

---

## 十、参考资料

| 来源 | 借鉴要点 |
|---|---|
| Microsoft Semantic Kernel | Plugin manifest、语义函数描述、Planner |
| OpenAI Agents SDK | Agent handoff、Guardrails 前置 |
| Anthropic Constitutional AI | Critique-Revise 范式 |
| LangGraph | 有状态图、Checkpoint、条件路由 |
| AutoGen | Critic-Executor 多 agent |
| DSPy | 声明式程序，优化器与执行分离 |
| ACT-R / LIDA | 工作记忆预算、注意力机制 |
| BabyAGI | 任务优先级队列、子任务生成 |
