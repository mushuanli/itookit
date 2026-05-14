diff --git a/a.md b/a.md
index 7aac200..e69de29 100644
--- a/a.md
+++ b/a.md
@@ -1,6766 +0,0 @@
-
-
-# 审查分析：综合设计方案 vs llm-kernel 代码
-
-## 1. 定位与设计哲学差异
-
-两者解决的是**根本不同层次的问题**，虽然表面上都涉及"LLM 执行"。
-
-| 维度 | 综合设计方案（Executor Scheduler） | llm-kernel 代码 |
-|------|--------------------------------------|-----------------|
-| **核心隐喻** | "给 LLM 装安全带的 Agent 循环" | "通用执行引擎 + 可组合编排器" |
-| **设计目标** | 一个 LLM Agent 完成一个任务（多轮工具调用循环） | 多种执行器（Agent/HTTP/Script/Tool）的通用编排框架 |
-| **LLM 的角色** | LLM 是"大脑"，每轮决策调什么工具 | LLM 是众多执行器类型之一，与 HTTP/Script 平级 |
-| **抽象层级** | 高度专注于 Agent 场景 | 通用编排层，Agent 只是一个 ExecutorType |
-| **核心循环** | 显式的 `while(true)` agent loop | 由编排器（Serial/Parallel/DAG）驱动的执行图 |
-
-**关键洞察**：综合方案是一个**垂直切片**（深入 Agent 场景），llm-kernel 是一个**水平平台**（支撑多种执行模式）。两者不是竞争关系，而是互补关系——llm-kernel 缺少的恰恰是综合方案的核心能力，反之亦然。
-
----
-
-## 2. 逐维度对比
-
-### 2.1 核心循环 / 执行模型
-
-**综合方案的 ExecutionLoop**：
-
-```
-while(true) {
-  compress_context_if_needed()
-  response = call_llm(system_prompt, messages, tools)
-  if no tool_calls → return final_response
-  results = execute_tools(tool_calls)
-  feed_results_back_to_messages()
-}
-```
-
-这是一个**自主决策循环**——LLM 每轮自己决定做什么，执行后反馈，再决策，直到认为完成。
-
-**llm-kernel 的 AgentExecutor**：
-
-```
-execute(input, context) {
-  messages = buildMessages(input, context)
-  response = call_llm(messages)
-  if tool_calls → execute_tools()
-  return result
-}
-```
-
-这是一个**单轮执行**——调用一次 LLM，处理工具调用，返回结果。**没有循环**。多轮行为需要外部编排器（如 LoopOrchestrator）驱动。
-
-**分析**：
-
-| 维度 | 综合方案 | llm-kernel |
-|------|---------|------------|
-| 自主多轮 | ✅ 内置 while(true) | ❌ 需外部 LoopOrchestrator 包装 |
-| 工具结果反馈 | ✅ 自动喂回 LLM | ⚠️ 工具执行后结果存在 context.variables，但不会自动拼入下一轮 messages |
-| 退出判断 | ✅ LLM 无工具调用即退出 | ❌ 由编排器的 exitCondition 表达式控制 |
-| 灵活性 | 专注 Agent 场景 | 可编排任意执行器组合 |
-
-**llm-kernel 的关键缺陷**：`AgentExecutor.execute()` 是单次调用。工具执行的结果存在 `context.variables.set('tool_result_xxx', result)` 中，但**下一次 `buildMessages()` 并不会读取这些结果并拼入消息历史**。这意味着 LLM 看不到自己上一轮工具调用的结果——这是 Agent 循环中最关键的反馈闭环的断裂。
-
-要让 llm-kernel 支持真正的多轮 Agent 行为，需要：
-1. 在 LoopOrchestrator 中手动将工具结果注入 history 变量
-2. 或者在 AgentExecutor 内部自己做循环
-
-两种方式都不优雅，且容易出错。
-
----
-
-### 2.2 上下文管理
-
-**综合方案**：四层压缩策略是核心竞争力。
-
-| 层 | 策略 | 成本 | 信息损失 |
-|----|------|------|----------|
-| 1 | 截断大型工具输出（head+tail） | 零 | 极低 |
-| 2 | 移除低价值中间消息 | 零 | 低 |
-| 3 | LLM 摘要 | 一次 API 调用 | 中 |
-| 4 | 激进滑动窗口 | 零 | 高 |
-
-通过 `urgency` 参数渐进触发，前面能搞定就不动后面。
-
-**llm-kernel**：
-
-上下文管理基本**不存在**。
-
-- `ContextVariables` 只是一个简单的 `Map<string, any>`，没有 token 估算
-- `MemoryStore` 是一个通用 KV 存储（带 TTL 和标签），不是对话历史管理
-- `ScopedMemoryStore` 提供层级隔离，但与 LLM 上下文窗口管理无关
-- `AgentExecutor.buildMessages()` 从 `context.variables.get('history')` 读取历史，但**没有压缩、截断或摘要机制**
-- 没有 token 预算感知——如果 history 太长直接 413 崩溃
-
-**缺陷严重程度**：**高**。这是 llm-kernel 作为 Agent 框架的最大短板。任何稍微复杂的任务（超过 5-10 轮工具调用）都会撑爆上下文窗口。
-
----
-
-### 2.3 系统提示词管理
-
-**综合方案**：
-
-```typescript
-PromptBuilder.build(session)
-  → CoreIdentitySection (priority 0, 不可截断)
-  → EnvironmentSection (priority 1)
-  → SkillInstructionsSection (priority 2)
-  → MemorySection (priority 3)
-  → AvailableSkillsSection (priority 4)
-```
-
-每个 Section 有 `priority`、`shouldInclude()`、`render()` 和 `renderTruncated()`。Builder 按优先级分配 token 预算，超预算时先尝试截断版本再跳过。
-
-**llm-kernel**：
-
-```typescript
-// AgentExecutorConfig 中的 systemPrompt 是一个静态字符串
-systemPrompt?: string;
-```
-
-没有动态组装，没有 Section 概念，没有 token 预算控制。系统提示词在配置时写死，运行时不变。
-
-**影响**：
-- 无法根据已加载的 Skill 动态注入指令
-- 无法根据当前环境（OS、工作目录、时间）调整提示词
-- 无法在 token 紧张时自动截断低优先级的提示词内容
-
----
-
-### 2.4 工具系统
-
-**综合方案**：
-
-```
-ITool 接口：
-  name, description, sideEffect, timeoutMs
-  getDefinition() → JSON Schema
-  isAvailable(session) → boolean
-  execute(args, session) → string
-
-ToolExecutor：
-  读操作并行 / 写操作串行
-  权限检查（3 层：全局/项目/会话）
-  超时控制
-  错误包装为 ToolResult（不抛异常）
-
-SkillRegistry + LoadSkillTool：
-  渐进式暴露——平时只暴露核心工具
-  LLM 可调用 load_skill 动态加载更多工具
-```
-
-**llm-kernel**：
-
-```
-ToolDefinition 接口：
-  name, description, parameters
-  handler: (args, context) => Promise<any>
-  requiresConfirmation?, timeout?
-
-ToolExecutor（独立执行器）：
-  验证参数
-  超时控制
-  事件发射
-
-AgentExecutor 内部的工具执行：
-  从 config.tools 查找 handler
-  解析参数 JSON
-  执行并存结果到 context.variables
-```
-
-**对比**：
-
-| 维度 | 综合方案 | llm-kernel |
-|------|---------|------------|
-| 工具作为一等公民 | ✅ ITool 协议，独立模块 | ⚠️ ToolDefinition 只是配置对象，handler 是函数 |
-| 副作用分类 | ✅ None/Local/External | ❌ 没有 |
-| 读写并行策略 | ✅ 读并行/写串行 | ❌ 全部串行执行 |
-| 权限管理 | ✅ 3 层权限 + 会话记忆 | ⚠️ `requiresConfirmation` 标记，但没有实现权限检查流程 |
-| 渐进式暴露 | ✅ Skill + load_skill 元工具 | ❌ 所有工具在配置时一次性注入 |
-| 错误处理 | ✅ 包装为 ToolResult 喂回 LLM | ⚠️ 发事件通知，但不喂回 LLM |
-| MCP 支持 | 作为扩展点预留 | ✅ 有 MCP 工具调用类型识别（`toolCall.type === 'mcp'`） |
-| Computer Use | ❌ | ✅ 有 Computer Use 类型识别 |
-| 危险命令检测 | ✅ fork bomb / rm -rf / 等 | ❌ |
-
-**llm-kernel 的亮点**：支持 MCP 和 Computer Use 工具类型，虽然实现都是 stub（`not implemented`），但类型系统已经准备好了。综合方案完全没考虑这两个方向。
-
-**llm-kernel 的核心问题**：工具执行结果不会自动喂回 LLM。`executeSingleToolCall` 把结果存到 `context.variables.set('tool_result_xxx', result)` 然后发个事件就结束了。LLM 永远不知道工具执行了什么。
-
----
-
-### 2.5 错误处理与韧性
-
-**综合方案**：
-
-```
-429 RateLimit     → 指数退避重试（支持 Retry-After header）
-413 ContextTooLarge → 强制压缩后重试
-529 ServiceOverload → 切换 fallback 模型
-MaxTokens 截断   → 静默重试（最多 N 次）
-工具异常         → 包装为 is_error=true 的 ToolResult 喂回 LLM
-```
-
-五种错误分别有独立的恢复路径。
-
-**llm-kernel**：
-
-```typescript
-// AgentExecutor.handleError()
-if (error.name === 'AbortError') → cancelled
-else → failed (单一路径)
-
-// AgentExecutor.isRecoverable()
-return code >= 500 || code === 429; // 只判断，不重试
-```
-
-```typescript
-// HttpExecutor.fetchWithRetry()
-if (retryOn?.includes(response.status)) → retry with delay
-// 这是整个代码库唯一有重试逻辑的地方
-```
-
-**分析**：
-- AgentExecutor **没有任何重试逻辑**。429 限流、服务过载、输出截断——全部直接返回 `status: 'failed'`
-- `isRecoverable()` 方法虽然判断了错误是否可恢复，但**没有任何代码使用这个判断来做重试**
-- 没有 fallback 模型切换
-- 没有上下文压缩后重试
-- HttpExecutor 有基本的重试，但 AgentExecutor 没有
-
-**严重程度**：**高**。生产环境下 LLM API 限流是常态，没有重试逻辑的 Agent 基本不可用。
-
----
-
-### 2.6 编排能力
-
-这是 llm-kernel 的核心优势所在。
-
-**llm-kernel**：
-
-| 编排器 | 功能 | 实现质量 |
-|--------|------|----------|
-| SerialOrchestrator | 串行执行子节点，支持路由跳转 | 完整 |
-| ParallelOrchestrator | 并发执行，支持并发限制和合并策略 | 完整 |
-| RouterOrchestrator | 规则路由 + LLM 路由 | 完整 |
-| LoopOrchestrator | 循环执行，支持退出条件和迭代变量 | 完整 |
-| DAGOrchestrator | 有向无环图执行，拓扑排序、环检测、并发控制 | 完整且设计精良 |
-
-**综合方案**：
-
-没有编排器概念。所有编排都在 `ExecutionLoop.loop()` 这一个循环里完成。Sub-Agent 通过 `SubAgentRouter` 实现，但本质上是递归调用同一个循环。
-
-**分析**：
-
-llm-kernel 的编排层设计得非常好：
-- `BaseOrchestrator` 提供了 `executeChild()` 和 `mergeResults()` 的通用实现
-- DAGOrchestrator 实现了完整的拓扑排序、环检测、依赖收集、失败跳过
-- 通过 `IExecutorFactory` 递归创建子执行器，支持嵌套编排
-- 所有编排器通过注册表插件化
-
-但这些编排能力对于**单一 Agent 任务**来说用处不大。Agent 场景的核心是"LLM 自主决策调什么工具"，不是"预定义的执行图"。
-
-**互补点**：如果要构建**多 Agent 协作**场景（如一个 Agent 规划任务 → 多个 Agent 并行执行子任务 → 汇总），llm-kernel 的编排层是天然的基础设施。综合方案要做这个得从头建。
-
----
-
-### 2.7 事件系统
-
-**综合方案**：
-
-```typescript
-HookManager：
-  12 种事件类型（TASK_START/END, TOOL_START/SUCCESS/ERROR, PERMISSION_REQUEST...）
-  支持 sync/async handler
-  BackPressureValidator：验证失败 → 将错误注入消息历史 → LLM 自动修正
-```
-
-**llm-kernel**：
-
-```typescript
-EventEmitter（自定义实现）：
-  类型安全的事件注册/触发
-  支持 once、off
-  异步事件支持
-  
-ExecutorEvents：
-  executor:start, executor:complete, executor:error
-  tool:start, tool:complete, tool:error
-  llm:start, llm:complete, llm:error
-  orchestrator:start, orchestrator:complete
-```
-
-**对比**：
-
-| 维度 | 综合方案 | llm-kernel |
-|------|---------|------------|
-| 类型安全 | ⚠️ 事件参数用 `any` | ✅ 泛型 `EventMap` |
-| 事件丰富度 | ✅ 12 种 | ✅ 10+ 种 |
-| Back-Pressure | ✅ 验证失败自动喂回 LLM | ❌ 纯通知，无反馈机制 |
-| 权限交互 | ✅ PERMISSION_REQUEST 事件可阻塞等待用户确认 | ❌ |
-| Hook 能力 | ✅ 可拦截/修改执行流 | ❌ 只能观察 |
-
-llm-kernel 的事件系统是纯观察性的（fire-and-forget），综合方案的 Hook 系统可以**拦截和修改执行流程**（如权限确认、反压验证）。这是两者在设计哲学上的重要差异。
-
----
-
-### 2.8 模型管理
-
-**综合方案**：
-
-```typescript
-ModelRegistry：
-  primary   → 主要推理（贵/聪明）
-  fallback  → 降级备选（主力不可用时）
-  summarizer → 上下文摘要（可用便宜模型）
-  subAgent  → 子任务执行（快/便宜）
-```
-
-四种角色，每种可配置不同的模型和费率。
-
-**llm-kernel**：
-
-```typescript
-// AgentExecutorConfig
-model?: string;           // 单一模型
-provider?: string;
-// 通过 LLMProviderRegistry 查找
-
-// 没有多模型角色概念
-```
-
-**分析**：llm-kernel 每个 AgentExecutor 实例只能用一个模型。要实现"贵模型做主 Agent、便宜模型做子任务"需要创建多个配置不同的 Executor 实例，然后用编排器组合。能做到但很啰嗦。综合方案的 ModelRegistry 更直观。
-
----
-
-## 3. llm-kernel 的独特优势（综合方案缺少的）
-
-### 3.1 通用执行器框架
-
-```
-ExecutorType：
-  agent | tool | http | script | composite | mcp
-
-IExecutor 接口统一了所有执行类型
-→ 一个 HTTP 调用和一个 Agent 推理在编排层面是等价的
-```
-
-这意味着可以构建如下工作流：
-
-```
-DAG:
-  HTTP获取数据 → Agent分析数据 → Script生成报告 → HTTP发送通知
-```
-
-综合方案无法做到这一点——它的世界里只有"LLM + 工具"。
-
-### 3.2 DAG 编排
-
-llm-kernel 的 DAGOrchestrator 实现了：
-
-- 拓扑排序
-- 环检测
-- 并发执行（respecting 依赖）
-- 失败节点跳过（downstream 标记为 skipped）
-- 节点级结果合并
-
-这是工作流引擎级别的能力，综合方案完全没有。
-
-### 3.3 条件路由
-
-RouterOrchestrator 支持：
-
-- 规则路由（基于条件表达式匹配）
-- LLM 路由（让 LLM 选择下一步走哪个分支）
-
-综合方案的路由逻辑完全由 LLM 在工具调用中隐式完成，没有显式的路由机制。
-
-### 3.4 表达式引擎
-
-```typescript
-ExpressionEvaluator：
-  支持变量引用：${variable}
-  支持条件表达式：${output.status} === 'success'
-  支持模板字符串插值
-```
-
-用于编排器的条件判断和变量传递。综合方案没有这个需求（因为没有编排层）。
-
----
-
-## 4. 综合设计：TypeScript 完整实现
-
-基于以上分析，以下是取两者之长的综合实现。
-
-**核心策略**：
-- 采用 llm-kernel 的**通用执行器 + 编排器**架构作为底层
-- 用综合方案的 **Agent 循环、上下文管理、权限系统、反压机制**重写 AgentExecutor
-- 保留 llm-kernel 的事件系统但增强为可拦截的 Hook 系统
-- 保留 llm-kernel 的编排器但增加 Agent 特有的子 Agent 支持
-
-### 项目结构
-
-```
-src/
-├── index.ts                          # 公共 API 导出
-│
-├── types/                            # 核心类型定义
-│   ├── index.ts
-│   ├── common.ts                     # 基础类型
-│   ├── messages.ts                   # LLM 消息类型
-│   ├── tools.ts                      # 工具相关类型
-│   ├── executor.ts                   # 执行器类型
-│   ├── orchestrator.ts               # 编排器类型
-│   └── events.ts                     # 事件类型
-│
-├── core/                             # 核心引擎
-│   ├── execution-loop.ts             # Agent 核心循环
-│   ├── session.ts                    # 会话状态管理
-│   ├── session-manager.ts            # 会话生命周期
-│   └── budget-controller.ts          # 预算控制
-│
-├── context/                          # 上下文管理
-│   ├── context-manager.ts            # 上下文管理器
-│   ├── compressor.ts                 # 四层压缩策略
-│   ├── prompt-builder.ts             # 动态提示词构建
-│   ├── prompt-sections.ts            # 提示词段落实现
-│   └── memory-store.ts               # 记忆存储
-│
-├── llm/                              # LLM 适配层
-│   ├── gateway.ts                    # LLM 网关协议
-│   ├── adapters/
-│   │   ├── anthropic.ts
-│   │   ├── openai.ts
-│   │   └── ollama.ts
-│   ├── model-registry.ts             # 多模型角色注册
-│   └── streaming-parser.ts           # 流式响应解析
-│
-├── tools/                            # 工具系统
-│   ├── tool-executor.ts              # 工具执行框架
-│   ├── permission-manager.ts         # 权限管理
-│   ├── builtin/
-│   │   ├── file-read.ts
-│   │   ├── file-write.ts
-│   │   ├── shell-exec.ts
-│   │   ├── glob-search.ts
-│   │   ├── grep-search.ts
-│   │   └── load-skill.ts             # 元工具：动态加载 Skill
-│   └── mcp/
-│       └── mcp-bridge.ts             # MCP 协议桥接
-│
-├── skills/                           # Skill 系统
-│   └── skill-registry.ts
-│
-├── orchestrators/                    # 编排器
-│   ├── base.ts
-│   ├── serial.ts
-│   ├── parallel.ts
-│   ├── router.ts
-│   ├── loop.ts
-│   ├── dag.ts
-│   └── sub-agent.ts                  # 子 Agent 路由
-│
-├── hooks/                            # Hook / 事件系统
-│   ├── hook-manager.ts
-│   └── back-pressure.ts              # 反压验证器
-│
-├── utils/                            # 工具函数
-│   ├── tokens.ts                     # Token 估算
-│   ├── expressions.ts                # 表达式引擎
-│   └── errors.ts                     # 异常层次
-│
-└── factory.ts                        # 组件组装工厂
-```
-
----
-
-### 4.1 核心类型定义
-
-```typescript
-// types/common.ts
-
-/**
- * 执行状态枚举
- */
-export enum ExecutionStatus {
-  Pending = 'pending',
-  Running = 'running',
-  Completed = 'completed',
-  Failed = 'failed',
-  Cancelled = 'cancelled',
-  Partial = 'partial',
-}
-
-/**
- * 工具副作用分类
- * 决定并发策略和权限检查粒度
- */
-export enum SideEffect {
-  /** 纯读操作，可安全并行 */
-  None = 'none',
-  /** 本地副作用（文件写入等），需串行 */
-  Local = 'local',
-  /** 外部副作用（网络请求等），需串行 + 确认 */
-  External = 'external',
-}
-
-/**
- * 权限决策
- */
-export enum Permission {
-  Allowed = 'allowed',
-  Denied = 'denied',
-  AskUser = 'ask_user',
-}
-
-/**
- * 停止原因
- */
-export enum StopReason {
-  EndTurn = 'end_turn',
-  ToolUse = 'tool_use',
-  MaxTokens = 'max_tokens',
-}
-
-/**
- * Token 使用统计
- */
-export interface TokenUsage {
-  inputTokens: number;
-  outputTokens: number;
-  cacheReadTokens: number;
-  cacheWriteTokens: number;
-}
-
-/**
- * 资源使用快照
- */
-export interface UsageSnapshot {
-  turns: number;
-  inputTokens: number;
-  outputTokens: number;
-  costUsd: number;
-  elapsedMs: number;
-  toolCalls: number;
-  startTime: number;
-}
-
-/**
- * 预算限制配置
- */
-export interface BudgetLimits {
-  maxTurns: number;
-  maxInputTokens: number;
-  maxOutputTokens: number;
-  maxCostUsd: number;
-  maxDurationMs: number;
-  maxToolCalls: number;
-}
-
-/**
- * 环境信息
- */
-export interface EnvironmentInfo {
-  os: string;
-  osVersion: string;
-  cwd: string;
-  shell: string;
-  nodeVersion: string;
-  currentTime: string;
-}
-```
-
-```typescript
-// types/messages.ts
-
-/**
- * 统一消息格式
- * 抹平 Anthropic（content blocks）和 OpenAI（message + tool_calls）的差异
- */
-export interface Message {
-  role: 'user' | 'assistant' | 'tool' | 'system';
-  content: string;
-  toolCalls?: ToolCall[];
-  toolCallId?: string;
-  isError?: boolean;
-  isTruncated?: boolean;
-  metadata?: Record<string, unknown>;
-}
-
-export interface ToolCall {
-  id: string;
-  name: string;
-  arguments: Record<string, unknown>;
-}
-
-export interface ToolResult {
-  callId: string;
-  output: string;
-  isError: boolean;
-}
-```
-
-```typescript
-// types/tools.ts
-
-import { SideEffect } from './common';
-import { ToolCall, ToolResult } from './messages';
-
-/**
- * 工具的 JSON Schema 定义，发送给 LLM
- */
-export interface ToolDefinition {
-  name: string;
-  description: string;
-  parameters: Record<string, unknown>; // JSON Schema
-}
-
-/**
- * 工具协议
- *
- * 所有工具（内置、MCP、Skill 附带）实现此接口。
- * ISP: 接口精简，只要求必要的属性和方法。
- */
-export interface ITool {
-  readonly name: string;
-  readonly description: string;
-  readonly sideEffect: SideEffect;
-  readonly timeoutMs: number;
-
-  getDefinition(): ToolDefinition;
-  isAvailable(session: ISession): boolean;
-  execute(args: Record<string, unknown>, session: ISession): Promise<string>;
-}
-
-/**
- * 权限规则
- */
-export interface PermissionRule {
-  toolPattern: string;
-  argPatterns?: Record<string, string>;
-  action: Permission;
-  reason: string;
-}
-
-/**
- * Skill 定义
- */
-export interface SkillDefinition {
-  name: string;
-  description: string;
-  instructions: string;
-  tools: ITool[];
-  triggerPatterns: string[];
-  autoLoad: boolean;
-  priority: number;
-}
-```
-
-```typescript
-// types/executor.ts
-
-import { ExecutionStatus, UsageSnapshot } from './common';
-import { Message } from './messages';
-
-/**
- * 执行器类型
- * 来自 llm-kernel 的通用执行器概念
- */
-export enum ExecutorType {
-  Agent = 'agent',
-  Tool = 'tool',
-  Http = 'http',
-  Script = 'script',
-  Composite = 'composite',
-}
-
-/**
- * 任务请求
- */
-export interface TaskRequest {
-  prompt: string;
-  context?: Record<string, unknown>;
-  workingDirectory?: string;
-  modelOverride?: string;
-  budgetOverride?: Partial<BudgetLimits>;
-}
-
-/**
- * 任务结果
- */
-export interface TaskResult {
-  sessionId: string;
-  status: ExecutionStatus;
-  response: string;
-  usage: UsageSnapshot;
-  turns: number;
-  incompleteReason?: string;
-}
-
-/**
- * 执行步骤（供外部消费进度）
- */
-export interface ExecutionStep {
-  type: 'tool_execution' | 'final_response' | 'compression' | 'sub_agent';
-  content?: string;
-  toolCalls?: ToolCall[];
-  toolResults?: ToolResult[];
-  timestamp: number;
-}
-
-/**
- * 通用执行器接口
- * 来自 llm-kernel，让 Agent / HTTP / Script 在编排层面可互换
- */
-export interface IExecutor {
-  readonly type: ExecutorType;
-  execute(input: unknown, context: IExecutionContext): Promise<TaskResult>;
-  abort(): void;
-}
-
-/**
- * 执行上下文
- * 编排器在多个执行器之间传递数据的载体
- */
-export interface IExecutionContext {
-  variables: Map<string, unknown>;
-  parentResult?: TaskResult;
-  metadata: Record<string, unknown>;
-}
-```
-
-```typescript
-// types/orchestrator.ts
-
-import { IExecutor, IExecutionContext, TaskResult } from './executor';
-
-/**
- * 编排器类型
- */
-export enum OrchestratorType {
-  Serial = 'serial',
-  Parallel = 'parallel',
-  Router = 'router',
-  Loop = 'loop',
-  DAG = 'dag',
-  SubAgent = 'sub_agent',
-}
-
-/**
- * 编排节点定义
- */
-export interface OrchestratorNode {
-  id: string;
-  executorType: ExecutorType;
-  config: Record<string, unknown>;
-  dependencies?: string[];
-}
-
-/**
- * 路由规则
- */
-export interface RouteRule {
-  condition: string; // 表达式，如 "${status} === 'error'"
-  target: string;    // 目标节点 ID
-}
-
-/**
- * DAG 边定义
- */
-export interface DAGEdge {
-  from: string;
-  to: string;
-  condition?: string;
-}
-
-/**
- * 编排器接口
- */
-export interface IOrchestrator {
-  readonly type: OrchestratorType;
-  execute(context: IExecutionContext): Promise<TaskResult>;
-  abort(): void;
-}
-
-/**
- * 合并策略（并行编排器用）
- */
-export type MergeStrategy = 'all' | 'first' | 'majority' | 'custom';
-```
-
-```typescript
-// types/events.ts
-
-import { ToolCall, ToolResult, Message } from './messages';
-import { TaskResult, ExecutionStep } from './executor';
-import { TokenUsage, UsageSnapshot } from './common';
-
-/**
- * Hook 事件枚举
- *
- * 与 llm-kernel 的纯观察性事件不同，
- * 部分事件支持拦截和修改执行流程。
- */
-export enum HookEvent {
-  // 任务生命周期
-  TaskStart = 'task:start',
-  TaskEnd = 'task:end',
-  StepComplete = 'step:complete',
-
-  // LLM 调用
-  LLMCallStart = 'llm:call:start',
-  LLMCallEnd = 'llm:call:end',
-  LLMRetry = 'llm:retry',
-  LLMFallback = 'llm:fallback',
-
-  // 工具执行
-  ToolStart = 'tool:start',
-  ToolSuccess = 'tool:success',
-  ToolError = 'tool:error',
-  ToolTimeout = 'tool:timeout',
-
-  // 权限（可拦截）
-  PermissionRequest = 'permission:request',
-
-  // 上下文管理
-  ContextCompressed = 'context:compressed',
-  SkillLoaded = 'skill:loaded',
-
-  // 预算
-  BudgetWarning = 'budget:warning',
-  BudgetExhausted = 'budget:exhausted',
-
-  // 反压验证（可拦截）
-  BackPressureCheck = 'backpressure:check',
-  BackPressureFailed = 'backpressure:failed',
-
-  // 编排器
-  OrchestratorStart = 'orchestrator:start',
-  OrchestratorComplete = 'orchestrator:complete',
-  SubAgentSpawn = 'subagent:spawn',
-  SubAgentComplete = 'subagent:complete',
-}
-
-/**
- * 事件载荷类型映射
- */
-export interface HookEventMap {
-  [HookEvent.TaskStart]: { task: TaskRequest };
-  [HookEvent.TaskEnd]: { result: TaskResult };
-  [HookEvent.StepComplete]: { step: ExecutionStep };
-
-  [HookEvent.LLMCallStart]: { model: string; messageCount: number };
-  [HookEvent.LLMCallEnd]: { model: string; usage: TokenUsage; stopReason: string };
-  [HookEvent.LLMRetry]: { attempt: number; reason: string; delayMs: number };
-  [HookEvent.LLMFallback]: { from: string; to: string; reason: string };
-
-  [HookEvent.ToolStart]: { call: ToolCall };
-  [HookEvent.ToolSuccess]: { call: ToolCall; result: string; durationMs: number };
-  [HookEvent.ToolError]: { call: ToolCall; error: Error };
-  [HookEvent.ToolTimeout]: { call: ToolCall; timeoutMs: number };
-
-  [HookEvent.PermissionRequest]: { tool: string; args: Record<string, unknown> };
-
-  [HookEvent.ContextCompressed]: { layer: number; beforeTokens: number; afterTokens: number };
-  [HookEvent.SkillLoaded]: { skill: string };
-
-  [HookEvent.BudgetWarning]: { resource: string; usedRatio: number };
-  [HookEvent.BudgetExhausted]: { resource: string; used: number; limit: number };
-
-  [HookEvent.BackPressureCheck]: { type: string; command: string };
-  [HookEvent.BackPressureFailed]: { type: string; errors: string };
-
-  [HookEvent.OrchestratorStart]: { type: string; nodeCount: number };
-  [HookEvent.OrchestratorComplete]: { type: string; result: TaskResult };
-  [HookEvent.SubAgentSpawn]: { taskSummary: string; model: string };
-  [HookEvent.SubAgentComplete]: { taskSummary: string; resultSummary: string };
-}
-
-/**
- * Hook 处理器
- * 返回值：
- * - void/undefined: 继续执行
- * - false: 取消/拒绝（用于 PermissionRequest 等可拦截事件）
- * - string: 注入修正内容（用于 BackPressureFailed）
- */
-export type HookHandler<E extends HookEvent> =
-  (payload: HookEventMap[E]) => void | boolean | string | Promise<void | boolean | string>;
-```
-
-```typescript
-// types/index.ts — 统一导出
-
-export * from './common';
-export * from './messages';
-export * from './tools';
-export * from './executor';
-export * from './orchestrator';
-export * from './events';
-
-/**
- * Session 协议
- * 所有模块通过此接口与会话状态交互（LoD）
- */
-export interface ISession {
-  readonly sessionId: string;
-  readonly task: TaskRequest;
-  readonly environment: EnvironmentInfo;
-  readonly usage: UsageSnapshot;
-  readonly messages: Message[];
-  readonly loadedSkills: Set<string>;
-  readonly currentModel: ModelConfig;
-  readonly isCompressed: boolean;
-  readonly compressionSummary: string | null;
-  readonly estimatedContextTokens: number;
-  readonly tokenBudget: number;
-
-  recordLLMResponse(response: LLMResponse): void;
-  recordToolResults(results: ToolResult[]): void;
-  recordTruncation(): void;
-  switchToFallbackModel(): void;
-  buildResult(): TaskResult;
-  buildPartialResult(reason: string): TaskResult;
-  toJSON(): Record<string, unknown>;
-}
-
-/**
- * 模型配置
- */
-export interface ModelConfig {
-  provider: string;
-  modelId: string;
-  maxOutputTokens: number;
-  maxContextTokens: number;
-  temperature: number;
-  costPerInputToken: number;
-  costPerOutputToken: number;
-}
-
-/**
- * 模型注册表
- */
-export interface ModelRegistryConfig {
-  primary: ModelConfig;
-  fallback?: ModelConfig;
-  summarizer?: ModelConfig;
-  subAgent?: ModelConfig;
-}
-
-/**
- * LLM 响应（统一格式）
- */
-export interface LLMResponse {
-  text: string;
-  toolCalls: ToolCall[];
-  usage: TokenUsage;
-  isTruncated: boolean;
-  stopReason: StopReason;
-  model: string;
-}
-
-/**
- * LLM 网关协议
- */
-export interface ILLMGateway {
-  chat(params: LLMChatParams): Promise<LLMResponse>;
-  chatStream?(params: LLMChatParams): AsyncIterable<StreamEvent>;
-}
-
-export interface LLMChatParams {
-  system: string;
-  messages: Message[];
-  tools: ToolDefinition[];
-  model: ModelConfig;
-}
-
-/**
- * 流式事件
- */
-export type StreamEvent =
-  | { type: 'content_block_start'; index: number; blockType: 'text' | 'tool_use'; toolName?: string; toolId?: string }
-  | { type: 'content_delta'; index: number; text?: string; partialJson?: string }
-  | { type: 'content_block_stop'; index: number }
-  | { type: 'message_stop'; usage: TokenUsage; stopReason: StopReason };
-```
-
----
-
-### 4.2 异常层次
-
-```typescript
-// utils/errors.ts
-
-export class ExecutorError extends Error {
-  constructor(message: string, public readonly code: string) {
-    super(message);
-    this.name = 'ExecutorError';
-  }
-}
-
-export class LLMError extends ExecutorError {
-  constructor(message: string, code: string, public readonly statusCode?: number) {
-    super(message, code);
-    this.name = 'LLMError';
-  }
-}
-
-export class RateLimitError extends LLMError {
-  constructor(
-    message: string,
-    public readonly retryAfterMs?: number,
-  ) {
-    super(message, 'RATE_LIMIT', 429);
-    this.name = 'RateLimitError';
-  }
-}
-
-export class ContextTooLargeError extends LLMError {
-  constructor(message: string) {
-    super(message, 'CONTEXT_TOO_LARGE', 413);
-    this.name = 'ContextTooLargeError';
-  }
-}
-
-export class ServiceOverloadError extends LLMError {
-  constructor(message: string) {
-    super(message, 'SERVICE_OVERLOAD', 529);
-    this.name = 'ServiceOverloadError';
-  }
-}
-
-export class MaxRetriesExhaustedError extends LLMError {
-  constructor(public readonly attempts: number) {
-    super(`LLM call failed after ${attempts} attempts`, 'MAX_RETRIES');
-    this.name = 'MaxRetriesExhaustedError';
-  }
-}
-
-export class BudgetExhaustedError extends ExecutorError {
-  constructor(
-    public readonly resource: string,
-    public readonly used: number,
-    public readonly limit: number,
-  ) {
-    super(
-      `Budget exhausted: ${resource} used ${used.toFixed(2)} / limit ${limit.toFixed(2)}`,
-      'BUDGET_EXHAUSTED',
-    );
-    this.name = 'BudgetExhaustedError';
-  }
-}
-
-export class ToolNotFoundError extends ExecutorError {
-  constructor(public readonly toolName: string) {
-    super(`Unknown tool: ${toolName}`, 'TOOL_NOT_FOUND');
-    this.name = 'ToolNotFoundError';
-  }
-}
-
-export class ToolExecutionError extends ExecutorError {
-  constructor(
-    public readonly toolName: string,
-    public readonly cause: Error,
-  ) {
-    super(`Tool '${toolName}' failed: ${cause.message}`, 'TOOL_EXECUTION');
-    this.name = 'ToolExecutionError';
-  }
-}
-
-export class AbortError extends ExecutorError {
-  constructor() {
-    super('Execution aborted', 'ABORTED');
-    this.name = 'AbortError';
-  }
-}
-```
-
----
-
-### 4.3 工具函数
-
-```typescript
-// utils/tokens.ts
-
-/**
- * 粗略估算文本的 token 数。
- *
- * 精确计算需要模型特定 tokenizer（如 tiktoken），
- * 但对预算管理和压缩决策而言粗略估算足够。
- *
- * 经验法则：英文约 4 字符/token，CJK 约 1.5 字符/token。
- */
-export function estimateTokens(text: string): number {
-  if (!text) return 0;
-
-  let cjkCount = 0;
-  for (const ch of text) {
-    const code = ch.codePointAt(0)!;
-    if (code >= 0x4e00 && code <= 0x9fff) cjkCount++;
-  }
-
-  const nonCjkLength = text.length - cjkCount;
-  const estimated = nonCjkLength / 4 + cjkCount / 1.5;
-  return Math.max(1, Math.round(estimated));
-}
-
-/**
- * 截断文本到指定行数，保留首尾。
- */
-export function truncateLines(
-  text: string,
-  maxLines: number,
-  headLines = Math.floor(maxLines / 2),
-  tailLines = maxLines - headLines,
-): string {
-  const lines = text.split('\n');
-  if (lines.length <= maxLines) return text;
-
-  const head = lines.slice(0, headLines).join('\n');
-  const tail = lines.slice(-tailLines).join('\n');
-  const snipped = lines.length - headLines - tailLines;
-
-  return `${head}\n\n... [${snipped} lines truncated] ...\n\n${tail}`;
-}
-```
-
-```typescript
-// utils/expressions.ts
-
-/**
- * 简单的表达式求值器。
- * 用于编排器的条件判断和变量插值。
- *
- * 支持：
- * - 变量引用：${variable}
- * - 简单比较：${a} === 'b'
- * - 模板字符串插值
- */
-export class ExpressionEvaluator {
-  /**
-   * 插值模板字符串中的 ${variable} 引用
-   */
-  static interpolate(template: string, vars: Map<string, unknown>): string {
-    return template.replace(/\$\{([^}]+)\}/g, (_, key: string) => {
-      const trimmed = key.trim();
-      const value = vars.get(trimmed);
-      return value !== undefined ? String(value) : `\${${trimmed}}`;
-    });
-  }
-
-  /**
-   * 评估简单的布尔表达式
-   * 仅支持 ===, !==, >, <, >=, <=, 以及 true/false 字面量
-   */
-  static evaluate(expression: string, vars: Map<string, unknown>): boolean {
-    const interpolated = this.interpolate(expression, vars);
-
-    if (interpolated === 'true') return true;
-    if (interpolated === 'false') return false;
-
-    const operators = ['===', '!==', '>=', '<=', '>', '<'] as const;
-    for (const op of operators) {
-      const idx = interpolated.indexOf(op);
-      if (idx === -1) continue;
-
-      const left = interpolated.slice(0, idx).trim();
-      const right = interpolated.slice(idx + op.length).trim();
-      const leftVal = this.parseValue(left);
-      const rightVal = this.parseValue(right);
-
-      switch (op) {
-        case '===': return leftVal === rightVal;
-        case '!==': return leftVal !== rightVal;
-        case '>': return Number(leftVal) > Number(rightVal);
-        case '<': return Number(leftVal) < Number(rightVal);
-        case '>=': return Number(leftVal) >= Number(rightVal);
-        case '<=': return Number(leftVal) <= Number(rightVal);
-      }
-    }
-
-    // 无操作符时，truthy 检查
-    return Boolean(interpolated);
-  }
-
-  private static parseValue(raw: string): string | number | boolean {
-    // 去掉引号
-    if ((raw.startsWith("'") && raw.endsWith("'")) ||
-        (raw.startsWith('"') && raw.endsWith('"'))) {
-      return raw.slice(1, -1);
-    }
-    if (raw === 'true') return true;
-    if (raw === 'false') return false;
-    if (raw === 'null' || raw === 'undefined') return '';
-    const num = Number(raw);
-    if (!isNaN(num)) return num;
-    return raw;
-  }
-}
-```
-
----
-
-### 4.4 Hook 系统（增强版：支持拦截）
-
-```typescript
-// hooks/hook-manager.ts
-
-import { HookEvent, HookEventMap, HookHandler } from '../types';
-
-/**
- * 增强版 Hook 管理器。
- *
- * 与 llm-kernel 的纯观察性事件不同，支持两种模式：
- * 1. 通知模式（fire-and-forget）：TOOL_START, STEP_COMPLETE 等
- * 2. 拦截模式（wait-for-response）：PERMISSION_REQUEST, BACK_PRESSURE_CHECK 等
- *
- * 拦截模式下，handler 的返回值会影响执行流程。
- */
-export class HookManager {
-  private handlers = new Map<HookEvent, Array<HookHandler<any>>>();
-
-  /**
-   * 注册事件处理器
-   */
-  on<E extends HookEvent>(event: E, handler: HookHandler<E>): () => void {
-    if (!this.handlers.has(event)) {
-      this.handlers.set(event, []);
-    }
-    this.handlers.get(event)!.push(handler);
-
-    // 返回取消注册函数
-    return () => this.off(event, handler);
-  }
-
-  /**
-   * 注册一次性处理器
-   */
-  once<E extends HookEvent>(event: E, handler: HookHandler<E>): () => void {
-    const wrapped: HookHandler<E> = async (payload) => {
-      this.off(event, wrapped);
-      return handler(payload);
-    };
-    return this.on(event, wrapped);
-  }
-
-  /**
-   * 移除处理器
-   */
-  off<E extends HookEvent>(event: E, handler: HookHandler<E>): void {
-    const list = this.handlers.get(event);
-    if (!list) return;
-    const idx = list.indexOf(handler);
-    if (idx !== -1) list.splice(idx, 1);
-  }
-
-  /**
-   * 触发通知事件（不等待返回值）
-   */
-  async emit<E extends HookEvent>(event: E, payload: HookEventMap[E]): Promise<void> {
-    const list = this.handlers.get(event);
-    if (!list?.length) return;
-
-    for (const handler of list) {
-      try {
-        await handler(payload);
-      } catch (err) {
-        // Hook 异常不应影响主流程
-        console.error(`Hook error [${event}]:`, err);
-      }
-    }
-  }
-
-  /**
-   * 触发可拦截事件，返回第一个非 void 的返回值。
-   *
-   * 用于 PermissionRequest（返回 boolean）、
-   * BackPressureFailed（返回修正内容 string）等场景。
-   */
-  async intercept<E extends HookEvent>(
-    event: E,
-    payload: HookEventMap[E],
-  ): Promise<boolean | string | undefined> {
-    const list = this.handlers.get(event);
-    if (!list?.length) return undefined;
-
-    for (const handler of list) {
-      try {
-        const result = await handler(payload);
-        if (result !== undefined && result !== null) {
-          return result as boolean | string;
-        }
-      } catch (err) {
-        console.error(`Hook intercept error [${event}]:`, err);
-      }
-    }
-    return undefined;
-  }
-
-  /**
-   * 清除所有处理器
-   */
-  clear(): void {
-    this.handlers.clear();
-  }
-}
-```
-
-```typescript
-// hooks/back-pressure.ts
-
-import { HookManager } from './hook-manager';
-import { HookEvent } from '../types';
-import { ISession } from '../types';
-import { exec } from 'child_process';
-import { promisify } from 'util';
-
-const execAsync = promisify(exec);
-
-/**
- * 反压验证器配置
- */
-export interface BackPressureRule {
-  /** 规则名称 */
-  name: string;
-  /** 触发条件：在哪些工具执行后触发 */
-  afterTools: string[];
-  /** 验证命令 */
-  command: string;
-  /** 超时（毫秒） */
-  timeoutMs: number;
-  /** 是否只在最终响应前验证（而非每轮） */
-  onlyOnFinal: boolean;
-}
-
-/**
- * 反压验证器。
- *
- * 核心思想（来自方案 B）：
- * Agent 说"我改完了"之后，自动跑一遍 typecheck/build/test。
- * 如果失败，将错误信息注入消息历史，让 LLM 继续修正。
- * 成功则静默通过（避免上下文膨胀）。
- */
-export class BackPressureValidator {
-  constructor(
-    private rules: BackPressureRule[],
-    private hooks: HookManager,
-  ) {}
-
-  /**
-   * 在工具执行后检查是否需要反压验证
-   */
-  async checkAfterTool(
-    toolName: string,
-    session: ISession,
-  ): Promise<BackPressureResult | null> {
-    const applicable = this.rules.filter(
-      r => !r.onlyOnFinal && r.afterTools.includes(toolName),
-    );
-    return this.runChecks(applicable, session);
-  }
-
-  /**
-   * 在 LLM 给出最终响应前检查
-   */
-  async checkBeforeFinal(session: ISession): Promise<BackPressureResult | null> {
-    const applicable = this.rules.filter(r => r.onlyOnFinal);
-    return this.runChecks(applicable, session);
-  }
-
-  private async runChecks(
-    rules: BackPressureRule[],
-    session: ISession,
-  ): Promise<BackPressureResult | null> {
-    for (const rule of rules) {
-      await this.hooks.emit(HookEvent.BackPressureCheck, {
-        type: rule.name,
-        command: rule.command,
-      });
-
-      try {
-        const { stdout, stderr } = await execAsync(rule.command, {
-          cwd: session.environment.cwd,
-          timeout: rule.timeoutMs,
-        });
-
-        // 成功：静默通过，不占用上下文
-        continue;
-
-      } catch (err: any) {
-        const errorOutput = this.formatError(err);
-
-        await this.hooks.emit(HookEvent.BackPressureFailed, {
-          type: rule.name,
-          errors: errorOutput,
-        });
-
-        return {
-          passed: false,
-          ruleName: rule.name,
-          errorMessage: errorOutput,
-        };
-      }
-    }
-
-    return null; // 全部通过
-  }
-
-  private formatError(err: any): string {
-    const parts: string[] = [];
-    if (err.stdout) parts.push(`STDOUT:\n${err.stdout}`);
-    if (err.stderr) parts.push(`STDERR:\n${err.stderr}`);
-    if (!parts.length) parts.push(err.message || String(err));
-
-    const combined = parts.join('\n\n');
-    // 截断过长的错误输出，避免上下文膨胀
-    const lines = combined.split('\n');
-    if (lines.length > 60) {
-      return [
-        ...lines.slice(0, 30),
-        `\n... [${lines.length - 60} lines truncated] ...\n`,
-        ...lines.slice(-30),
-      ].join('\n');
-    }
-    return combined;
-  }
-}
-
-export interface BackPressureResult {
-  passed: boolean;
-  ruleName: string;
-  errorMessage: string;
-}
-```
-
----
-
-### 4.5 预算控制器
-
-```typescript
-// core/budget-controller.ts
-
-import {
-  BudgetLimits,
-  UsageSnapshot,
-  TokenUsage,
-  ModelConfig,
-  HookEvent,
-} from '../types';
-import { BudgetExhaustedError } from '../utils/errors';
-import { HookManager } from '../hooks/hook-manager';
-
-const DEFAULT_LIMITS: BudgetLimits = {
-  maxTurns: 100,
-  maxInputTokens: 5_000_000,
-  maxOutputTokens: 1_000_000,
-  maxCostUsd: 10.0,
-  maxDurationMs: 3_600_000,
-  maxToolCalls: 500,
-};
-
-export class BudgetController {
-  private limits: BudgetLimits;
-
-  constructor(
-    limits: Partial<BudgetLimits> = {},
-    private hooks?: HookManager,
-  ) {
-    this.limits = { ...DEFAULT_LIMITS, ...limits };
-  }
-
-  /**
-   * 创建新的使用快照
-   */
-  createSnapshot(): UsageSnapshot {
-    return {
-      turns: 0,
-      inputTokens: 0,
-      outputTokens: 0,
-      costUsd: 0,
-      elapsedMs: 0,
-      toolCalls: 0,
-      startTime: Date.now(),
-    };
-  }
-
-  /**
-   * 更新使用量
-   */
-  updateUsage(
-    snapshot: UsageSnapshot,
-    tokenUsage: TokenUsage,
-    model: ModelConfig,
-    toolCallCount: number,
-  ): void {
-    snapshot.turns += 1;
-    snapshot.inputTokens += tokenUsage.inputTokens;
-    snapshot.outputTokens += tokenUsage.outputTokens;
-    snapshot.costUsd +=
-      tokenUsage.inputTokens * model.costPerInputToken +
-      tokenUsage.outputTokens * model.costPerOutputToken;
-    snapshot.elapsedMs = Date.now() - snapshot.startTime;
-    snapshot.toolCalls += toolCallCount;
-  }
-
-  /**
-   * 检查预算，超限则抛出异常。
-   * 接近预算时发出警告事件。
-   */
-  checkOrThrow(snapshot: UsageSnapshot): void {
-    const checks: Array<[string, number, number]> = [
-      ['turns', snapshot.turns, this.limits.maxTurns],
-      ['inputTokens', snapshot.inputTokens, this.limits.maxInputTokens],
-      ['outputTokens', snapshot.outputTokens, this.limits.maxOutputTokens],
-      ['costUsd', snapshot.costUsd, this.limits.maxCostUsd],
-      ['elapsedMs', Date.now() - snapshot.startTime, this.limits.maxDurationMs],
-      ['toolCalls', snapshot.toolCalls, this.limits.maxToolCalls],
-    ];
-
-    for (const [resource, used, limit] of checks) {
-      const ratio = used / limit;
-
-      // 80% 警告
-      if (ratio >= 0.8 && ratio < 1.0) {
-        this.hooks?.emit(HookEvent.BudgetWarning, { resource, usedRatio: ratio });
-      }
-
-      // 超限
-      if (used >= limit) {
-        this.hooks?.emit(HookEvent.BudgetExhausted, { resource, used, limit });
-        throw new BudgetExhaustedError(resource, used, limit);
-      }
-    }
-  }
-
-  /**
-   * 获取各维度剩余预算比例
-   */
-  remainingBudget(snapshot: UsageSnapshot): Record<string, number> {
-    return {
-      turns: 1 - snapshot.turns / this.limits.maxTurns,
-      inputTokens: 1 - snapshot.inputTokens / this.limits.maxInputTokens,
-      outputTokens: 1 - snapshot.outputTokens / this.limits.maxOutputTokens,
-      costUsd: 1 - snapshot.costUsd / this.limits.maxCostUsd,
-      duration: 1 - (Date.now() - snapshot.startTime) / this.limits.maxDurationMs,
-      toolCalls: 1 - snapshot.toolCalls / this.limits.maxToolCalls,
-    };
-  }
-
-  /**
-   * 最紧张的资源
-   */
-  mostConstrainedResource(snapshot: UsageSnapshot): { resource: string; remaining: number } {
-    const remaining = this.remainingBudget(snapshot);
-    let minResource = 'turns';
-    let minValue = 1;
-
-    for (const [resource, value] of Object.entries(remaining)) {
-      if (value < minValue) {
-        minValue = value;
-        minResource = resource;
-      }
-    }
-
-    return { resource: minResource, remaining: minValue };
-  }
-}
-```
-
----
-
-### 4.6 会话状态管理
-
-```typescript
-// core/session.ts
-
-import {
-  ISession,
-  TaskRequest,
-  TaskResult,
-  Message,
-  ToolCall,
-  ToolResult,
-  EnvironmentInfo,
-  UsageSnapshot,
-  ModelConfig,
-  LLMResponse,
-  ExecutionStatus,
-} from '../types';
-import { estimateTokens } from '../utils/tokens';
-import * as os from 'os';
-import * as path from 'path';
-import { randomUUID } from 'crypto';
-
-export class Session implements ISession {
-  readonly sessionId: string;
-  readonly task: TaskRequest;
-  readonly environment: EnvironmentInfo;
-  readonly messages: Message[];
-  readonly loadedSkills: Set<string>;
-  usage: UsageSnapshot;
-
-  // 上下文压缩状态
-  isCompressed = false;
-  compressionSummary: string | null = null;
-  compressionCutoff = 0;
-  truncationCount = 0;
-
-  // 模型状态
-  currentModel: ModelConfig;
-  private fallbackModel: ModelConfig | null;
-  private fallbackActivated = false;
-
-  constructor(params: {
-    task: TaskRequest;
-    primaryModel: ModelConfig;
-    fallbackModel?: ModelConfig;
-    usage?: UsageSnapshot;
-    sessionId?: string;
-  }) {
-    this.sessionId = params.sessionId ?? randomUUID();
-    this.task = params.task;
-    this.currentModel = params.primaryModel;
-    this.fallbackModel = params.fallbackModel ?? null;
-    this.messages = [{ role: 'user', content: params.task.prompt }];
-    this.loadedSkills = new Set();
-    this.usage = params.usage ?? {
-      turns: 0,
-      inputTokens: 0,
-      outputTokens: 0,
-      costUsd: 0,
-      elapsedMs: 0,
-      toolCalls: 0,
-      startTime: Date.now(),
-    };
-    this.environment = Session.detectEnvironment(params.task.workingDirectory);
-  }
-
-  get estimatedContextTokens(): number {
-    let total = 0;
-    for (const msg of this.messages) {
-
-```typescript
-      total += estimateTokens(msg.content);
-      if (msg.toolCalls) {
-        for (const call of msg.toolCalls) {
-          total += estimateTokens(JSON.stringify(call.arguments));
-        }
-      }
-    }
-    return total;
-  }
-
-  get tokenBudget(): number {
-    return this.currentModel.maxContextTokens;
-  }
-
-  /**
-   * 建议的压缩分割点：保留最近 40% 的消息
-   */
-  get suggestedCutoffPoint(): number {
-    const keep = Math.max(4, Math.floor(this.messages.length * 0.4));
-    return this.messages.length - keep;
-  }
-
-  recordLLMResponse(response: LLMResponse): void {
-    this.messages.push({
-      role: 'assistant',
-      content: response.text,
-      toolCalls: response.toolCalls.length > 0 ? response.toolCalls : undefined,
-    });
-
-    this.usage.turns += 1;
-    this.usage.inputTokens += response.usage.inputTokens;
-    this.usage.outputTokens += response.usage.outputTokens;
-    this.usage.costUsd +=
-      response.usage.inputTokens * this.currentModel.costPerInputToken +
-      response.usage.outputTokens * this.currentModel.costPerOutputToken;
-    this.usage.elapsedMs = Date.now() - this.usage.startTime;
-  }
-
-  recordToolResults(results: ToolResult[]): void {
-    for (const result of results) {
-      this.messages.push({
-        role: 'tool',
-        content: result.output,
-        toolCallId: result.callId,
-        isError: result.isError,
-      });
-    }
-    this.usage.toolCalls += results.length;
-  }
-
-  recordTruncation(): void {
-    this.truncationCount += 1;
-  }
-
-  switchToFallbackModel(): void {
-    if (this.fallbackModel && !this.fallbackActivated) {
-      this.currentModel = this.fallbackModel;
-      this.fallbackActivated = true;
-    }
-  }
-
-  buildResult(): TaskResult {
-    let finalResponse = '';
-    for (let i = this.messages.length - 1; i >= 0; i--) {
-      const msg = this.messages[i];
-      if (msg.role === 'assistant' && (!msg.toolCalls || msg.toolCalls.length === 0)) {
-        finalResponse = msg.content;
-        break;
-      }
-    }
-
-    return {
-      sessionId: this.sessionId,
-      status: ExecutionStatus.Completed,
-      response: finalResponse,
-      usage: { ...this.usage },
-      turns: this.usage.turns,
-    };
-  }
-
-  buildPartialResult(reason: string): TaskResult {
-    return {
-      sessionId: this.sessionId,
-      status: ExecutionStatus.Partial,
-      response: `Task incomplete: ${reason}`,
-      usage: { ...this.usage },
-      turns: this.usage.turns,
-      incompleteReason: reason,
-    };
-  }
-
-  toJSON(): Record<string, unknown> {
-    return {
-      sessionId: this.sessionId,
-      task: this.task,
-      messages: this.messages,
-      loadedSkills: [...this.loadedSkills],
-      usage: this.usage,
-      isCompressed: this.isCompressed,
-      compressionSummary: this.compressionSummary,
-      compressionCutoff: this.compressionCutoff,
-      environment: this.environment,
-    };
-  }
-
-  static fromJSON(
-    data: Record<string, unknown>,
-    primaryModel: ModelConfig,
-    fallbackModel?: ModelConfig,
-  ): Session {
-    const session = new Session({
-      task: data.task as TaskRequest,
-      primaryModel,
-      fallbackModel,
-      usage: data.usage as UsageSnapshot,
-      sessionId: data.sessionId as string,
-    });
-
-    // Restore messages (replace the initial user message)
-    session.messages.length = 0;
-    session.messages.push(...(data.messages as Message[]));
-
-    // Restore loaded skills
-    for (const skill of (data.loadedSkills as string[]) ?? []) {
-      session.loadedSkills.add(skill);
-    }
-
-    // Restore compression state
-    session.isCompressed = (data.isCompressed as boolean) ?? false;
-    session.compressionSummary = (data.compressionSummary as string) ?? null;
-    session.compressionCutoff = (data.compressionCutoff as number) ?? 0;
-
-    return session;
-  }
-
-  static detectEnvironment(cwd?: string): EnvironmentInfo {
-    return {
-      os: os.platform(),
-      osVersion: os.release(),
-      cwd: cwd ?? process.cwd(),
-      shell: process.env.SHELL ?? process.env.COMSPEC ?? 'unknown',
-      nodeVersion: process.version,
-      currentTime: new Date().toISOString(),
-    };
-  }
-}
-```
-
-```typescript
-// core/session-manager.ts
-
-import { Session } from './session';
-import { ModelConfig } from '../types';
-import * as fs from 'fs';
-import * as path from 'path';
-
-/**
- * 会话生命周期管理器。
- * 支持持久化、恢复、清理。
- */
-export class SessionManager {
-  private storageDir: string;
-
-  constructor(storageDir?: string) {
-    this.storageDir = storageDir ?? path.join(os.homedir(), '.executor', 'sessions');
-    fs.mkdirSync(this.storageDir, { recursive: true });
-  }
-
-  save(session: Session): void {
-    const filepath = path.join(this.storageDir, `${session.sessionId}.json`);
-    const tmpPath = filepath + '.tmp';
-    const data = JSON.stringify(session.toJSON(), null, 2);
-    fs.writeFileSync(tmpPath, data, 'utf-8');
-    fs.renameSync(tmpPath, filepath); // 原子写入
-  }
-
-  load(sessionId: string, primaryModel: ModelConfig, fallbackModel?: ModelConfig): Session | null {
-    const filepath = path.join(this.storageDir, `${sessionId}.json`);
-    if (!fs.existsSync(filepath)) return null;
-
-    try {
-      const raw = fs.readFileSync(filepath, 'utf-8');
-      const data = JSON.parse(raw);
-      return Session.fromJSON(data, primaryModel, fallbackModel);
-    } catch {
-      return null;
-    }
-  }
-
-  listRecent(limit = 20): Array<{
-    sessionId: string;
-    taskPreview: string;
-    createdAt: number;
-    turns: number;
-  }> {
-    const files = fs.readdirSync(this.storageDir)
-      .filter(f => f.endsWith('.json'))
-      .map(f => ({
-        name: f,
-        mtime: fs.statSync(path.join(this.storageDir, f)).mtimeMs,
-      }))
-      .sort((a, b) => b.mtime - a.mtime)
-      .slice(0, limit);
-
-    return files.map(f => {
-      try {
-        const data = JSON.parse(
-          fs.readFileSync(path.join(this.storageDir, f.name), 'utf-8'),
-        );
-        return {
-          sessionId: data.sessionId,
-          taskPreview: (data.task?.prompt ?? '').slice(0, 100),
-          createdAt: data.usage?.startTime ?? f.mtime,
-          turns: data.usage?.turns ?? 0,
-        };
-      } catch {
-        return {
-          sessionId: f.name.replace('.json', ''),
-          taskPreview: '(corrupted)',
-          createdAt: f.mtime,
-          turns: 0,
-        };
-      }
-    });
-  }
-
-  delete(sessionId: string): void {
-    const filepath = path.join(this.storageDir, `${sessionId}.json`);
-    if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
-  }
-
-  cleanupOld(maxAgeDays = 30): number {
-    const cutoff = Date.now() - maxAgeDays * 86_400_000;
-    let cleaned = 0;
-
-    for (const f of fs.readdirSync(this.storageDir)) {
-      const filepath = path.join(this.storageDir, f);
-      if (fs.statSync(filepath).mtimeMs < cutoff) {
-        fs.unlinkSync(filepath);
-        cleaned++;
-      }
-    }
-    return cleaned;
-  }
-}
-
-import * as os from 'os';
-```
-
----
-
-### 4.7 上下文管理
-
-```typescript
-// context/context-manager.ts
-
-import { ISession, Message, HookEvent, ILLMGateway } from '../types';
-import { ContextCompressor } from './compressor';
-import { PromptBuilder } from './prompt-builder';
-import { SkillRegistry } from '../skills/skill-registry';
-import { MemoryStore } from './memory-store';
-import { HookManager } from '../hooks/hook-manager';
-
-export interface ContextConfig {
-  maxContextTokens: number;
-  /** 上下文使用率达到此比例时开始压缩 */
-  compressionThreshold: number;
-}
-
-export class ContextManager {
-  constructor(
-    private promptBuilder: PromptBuilder,
-    private compressor: ContextCompressor,
-    private skills: SkillRegistry,
-    private memory: MemoryStore,
-    private hooks: HookManager,
-    private config: ContextConfig,
-  ) {}
-
-  /**
-   * 构建系统提示词
-   */
-  buildSystemPrompt(session: ISession): string {
-    return this.promptBuilder.build(session);
-  }
-
-  /**
-   * 构建发送给 LLM 的消息列表。
-   * 如果上下文被压缩过，头部包含摘要。
-   */
-  buildMessages(session: ISession): Message[] {
-    if (!session.isCompressed || !session.compressionSummary) {
-      return [...session.messages];
-    }
-
-    const messages: Message[] = [
-      {
-        role: 'user',
-        content: `[Previous conversation summary]\n${session.compressionSummary}`,
-      },
-      {
-        role: 'assistant',
-        content: 'Understood. I will continue based on this context.',
-      },
-    ];
-
-    // 保留压缩点之后的消息
-    const recent = session.messages.slice(session.compressionCutoff);
-    messages.push(...recent);
-
-    return messages;
-  }
-
-  /**
-   * 检查是否需要压缩，如需要则执行。
-   *
-   * 每次 LLM 调用前和每次工具执行后调用。
-   */
-  async maybeCompress(session: ISession): Promise<void> {
-    const ratio = session.estimatedContextTokens / session.tokenBudget;
-    if (ratio < this.config.compressionThreshold) return;
-
-    await this.compressor.compress(session, ratio);
-
-    await this.hooks.emit(HookEvent.ContextCompressed, {
-      layer: this.compressor.lastLayerUsed,
-      beforeTokens: this.compressor.lastBeforeTokens,
-      afterTokens: session.estimatedContextTokens,
-    });
-  }
-
-  /**
-   * 强制压缩（413 错误后调用）
-   */
-  async forceCompress(session: ISession): Promise<void> {
-    await this.compressor.compress(session, 1.0);
-  }
-}
-```
-
-```typescript
-// context/compressor.ts
-
-import { ISession, Message, ILLMGateway, ModelConfig, ModelRegistryConfig } from '../types';
-import { estimateTokens, truncateLines } from '../utils/tokens';
-
-/**
- * 四层上下文压缩器。
- *
- * 参考 Claude Code 的分层策略，按"信息保质期"递进：
- * 1. 截断大型工具输出（零成本，几乎无信息损失）
- * 2. 移除低价值中间消息（零成本，低信息损失）
- * 3. LLM 摘要（一次 API 调用，中等信息损失）
- * 4. 激进滑动窗口（零成本，高信息损失）
- *
- * urgency 参数控制压缩激进度：
- * - 0.7~0.8: 仅做 Layer 1
- * - 0.8~0.85: Layer 1 + 2
- * - 0.85~0.95: Layer 1 + 2 + 3
- * - 0.95+: 全部四层
- */
-export class ContextCompressor {
-  lastLayerUsed = 0;
-  lastBeforeTokens = 0;
-
-  constructor(
-    private llm: ILLMGateway,
-    private models: ModelRegistryConfig,
-  ) {}
-
-  async compress(session: ISession, urgency: number): Promise<void> {
-    this.lastBeforeTokens = session.estimatedContextTokens;
-    this.lastLayerUsed = 0;
-
-    // Layer 1: 截断大型工具输出
-    if (urgency >= 0.7) {
-      this.truncateLargeOutputs(session);
-      this.lastLayerUsed = 1;
-      // 检查是否已经足够
-      if (session.estimatedContextTokens / session.tokenBudget < 0.7) return;
-    }
-
-    // Layer 2: 移除低价值中间消息
-    if (urgency >= 0.8) {
-      this.pruneIntermediateMessages(session);
-      this.lastLayerUsed = 2;
-      if (session.estimatedContextTokens / session.tokenBudget < 0.7) return;
-    }
-
-    // Layer 3: LLM 摘要
-    if (urgency >= 0.85) {
-      await this.summarizeHistory(session);
-      this.lastLayerUsed = 3;
-      if (session.estimatedContextTokens / session.tokenBudget < 0.7) return;
-    }
-
-    // Layer 4: 激进滑动窗口
-    if (urgency >= 0.95) {
-      this.aggressiveSlidingWindow(session);
-      this.lastLayerUsed = 4;
-    }
-  }
-
-  /**
-   * Layer 1: 截断大型工具输出。
-   *
-   * 最低成本、最少信息损失。
-   * 工具输出中最有价值的信息通常在开头（命令回显）和结尾（错误/总结）。
-   */
-  private truncateLargeOutputs(session: ISession): void {
-    const threshold = 2000; // tokens
-
-    for (const msg of session.messages) {
-      if (msg.role !== 'tool') continue;
-      if (msg.isTruncated) continue;
-
-      const tokens = estimateTokens(msg.content);
-      if (tokens <= threshold) continue;
-
-      msg.content = truncateLines(msg.content, 40, 20, 20);
-      msg.isTruncated = true;
-    }
-  }
-
-  /**
-   * Layer 2: 移除低价值中间消息。
-   *
-   * "信息保质期"最短的消息：
-   * - 纯文本的 assistant 回复（没有工具调用，通常是中间思考过程）
-   * - 短于 100 token 的 assistant 回复
-   *
-   * 保留最后 10 条消息不动。
-   */
-  private pruneIntermediateMessages(session: ISession): void {
-    const safeZone = 10; // 保留最后 10 条
-    const prunable: number[] = [];
-
-    const boundary = session.messages.length - safeZone;
-    for (let i = 0; i < boundary; i++) {
-      const msg = session.messages[i];
-      if (
-        msg.role === 'assistant' &&
-        (!msg.toolCalls || msg.toolCalls.length === 0) &&
-        estimateTokens(msg.content) < 100
-      ) {
-        prunable.push(i);
-      }
-    }
-
-    // 只修剪最多 30% 的可修剪消息，避免过度丢失上下文
-    const maxPrune = Math.max(1, Math.floor(prunable.length * 0.3));
-    const toPrune = prunable.slice(0, maxPrune);
-
-    // 从后往前删除，避免索引偏移
-    for (let i = toPrune.length - 1; i >= 0; i--) {
-      session.messages.splice(toPrune[i], 1);
-    }
-  }
-
-  /**
-   * Layer 3: LLM 摘要。
-   *
-   * 用便宜的摘要模型对旧对话生成结构化摘要。
-   * 摘要 prompt 明确列出必须保留的信息类别。
-   */
-  private async summarizeHistory(session: ISession): Promise<void> {
-    const model = this.models.summarizer ?? this.models.primary;
-    const cutoff = session.suggestedCutoffPoint;
-
-    if (cutoff <= 0) return;
-
-    const toSummarize = session.messages.slice(0, cutoff);
-    const formatted = this.formatMessagesForSummary(toSummarize);
-
-    // 限制摘要输入长度
-    const maxChars = 15000;
-    const truncatedInput =
-      formatted.length > maxChars
-        ? formatted.slice(0, maxChars) + '\n\n... [input truncated for summarization]'
-        : formatted;
-
-    try {
-      const response = await this.llm.chat({
-        system:
-          'You are a conversation summarizer. Be concise but preserve critical details.',
-        messages: [
-          {
-            role: 'user',
-            content: [
-              'Summarize the following conversation history. You MUST preserve:',
-              '1. The original task/goal the user requested',
-              '2. All file paths that were read, created, or modified',
-              '3. Key decisions made and their rationale',
-              '4. Any errors encountered and how they were resolved',
-              '5. Current progress and remaining work items',
-              '6. Any explicit user constraints or preferences',
-              '',
-              'Discard: verbose tool outputs, repeated discussions, formatting-heavy code blocks.',
-              '',
-              '---',
-              truncatedInput,
-            ].join('\n'),
-          },
-        ],
-        tools: [],
-        model,
-      });
-
-      (session as any).isCompressed = true;
-      (session as any).compressionSummary = response.text;
-      (session as any).compressionCutoff = cutoff;
-    } catch {
-      // 摘要失败时 fallback 到基于正则的关键信息提取
-      const fallbackSummary = this.extractKeyInfoFallback(toSummarize);
-      (session as any).isCompressed = true;
-      (session as any).compressionSummary = fallbackSummary;
-      (session as any).compressionCutoff = cutoff;
-    }
-  }
-
-  /**
-   * Layer 4: 激进滑动窗口。
-   *
-   * 只保留最近 6 条消息（约 3 轮对话）。
-   * 信息损失最大，仅在极端情况下使用。
-   */
-  private aggressiveSlidingWindow(session: ISession): void {
-    const keepLast = 6;
-    if (session.messages.length > keepLast) {
-      const removed = session.messages.splice(0, session.messages.length - keepLast);
-      // 如果之前没有摘要，用激进方式生成一个最小摘要
-      if (!(session as any).compressionSummary) {
-        (session as any).isCompressed = true;
-        (session as any).compressionSummary = `[Context collapsed - ${removed.length} messages removed. Recent context retained.]`;
-        (session as any).compressionCutoff = 0;
-      }
-    }
-  }
-
-  private formatMessagesForSummary(messages: Message[]): string {
-    return messages
-      .map((msg) => {
-        const role = msg.role.toUpperCase();
-        const content =
-          msg.content.length > 500 ? msg.content.slice(0, 500) + '...' : msg.content;
-        return `[${role}]: ${content}`;
-      })
-      .join('\n\n');
-  }
-
-  /**
-   * 摘要 LLM 调用失败时的降级方案：
-   * 用正则提取文件路径、错误信息、关键决策。
-   */
-  private extractKeyInfoFallback(messages: Message[]): string {
-    const filePaths = new Set<string>();
-    const errors: string[] = [];
-    const decisions: string[] = [];
-
-    const filePattern = /(?:\/[\w.-]+)+\.\w+/g;
-    const errorPattern = /(?:error|failed|exception|traceback)[:：].{0,200}/gi;
-
-    for (const msg of messages) {
-      // 提取文件路径
-      const pathMatches = msg.content.match(filePattern);
-      if (pathMatches) pathMatches.forEach((p) => filePaths.add(p));
-
-      // 提取错误信息
-      const errorMatches = msg.content.match(errorPattern);
-      if (errorMatches) errors.push(...errorMatches.slice(0, 3));
-
-      // 提取决策（assistant 消息的前两行通常是决策摘要）
-      if (msg.role === 'assistant' && msg.content.length > 50) {
-        const firstLine = msg.content.split('\n')[0];
-        if (firstLine.length > 20 && firstLine.length < 200) {
-          decisions.push(firstLine);
-        }
-      }
-    }
-
-    const parts: string[] = ['[Fallback summary - LLM summarization failed]'];
-
-    if (filePaths.size > 0) {
-      parts.push(`Files involved: ${[...filePaths].join(', ')}`);
-    }
-    if (errors.length > 0) {
-      parts.push(`Errors encountered:\n${errors.slice(0, 5).join('\n')}`);
-    }
-    if (decisions.length > 0) {
-      parts.push(`Key actions:\n${decisions.slice(0, 10).join('\n')}`);
-    }
-
-    return parts.join('\n\n');
-  }
-}
-```
-
-```typescript
-// context/prompt-builder.ts
-
-import { ISession, ToolDefinition } from '../types';
-import { estimateTokens } from '../utils/tokens';
-
-/**
- * 提示词段落协议。
- *
- * 每个段落独立贡献一段系统提示词。
- * Builder 按优先级排列，在 token 预算内组装。
- */
-export interface IPromptSection {
-  /** 优先级，越小越优先。0 = 不可省略。 */
-  readonly priority: number;
-  /** 当前会话是否需要包含此段落 */
-  shouldInclude(session: ISession): boolean;
-  /** 渲染完整内容 */
-  render(session: ISession): string;
-  /** 在预算不足时渲染截断版本，返回 null 表示跳过 */
-  renderTruncated(session: ISession, maxTokens: number): string | null;
-}
-
-/**
- * 动态系统提示词构建器。
- *
- * 与静态字符串的区别：
- * - 根据当前环境动态拼接（OS、CWD、时间）
- * - 按需注入已加载的 Skill 指令
- * - 注入 Memory 文件内容
- * - token 预算分配：高优先级段落优先，超预算时截断或跳过低优先级段落
- */
-export class PromptBuilder {
-  constructor(
-    private sections: IPromptSection[],
-    private tokenBudget: number = 4000,
-  ) {
-    // 按优先级排序
-    this.sections = [...sections].sort((a, b) => a.priority - b.priority);
-  }
-
-  build(session: ISession): string {
-    const parts: string[] = [];
-    let remaining = this.tokenBudget;
-
-    for (const section of this.sections) {
-      if (!section.shouldInclude(session)) continue;
-
-      const content = section.render(session);
-      const tokens = estimateTokens(content);
-
-      if (tokens <= remaining) {
-        parts.push(content);
-        remaining -= tokens;
-      } else if (remaining > 50) {
-        // 尝试截断版本
-        const truncated = section.renderTruncated(session, remaining);
-        if (truncated) {
-          parts.push(truncated);
-          remaining -= estimateTokens(truncated);
-        }
-        // 预算耗尽后不再处理后续 sections
-        break;
-      } else {
-        break;
-      }
-    }
-
-    return parts.join('\n\n');
-  }
-}
-```
-
-```typescript
-// context/prompt-sections.ts
-
-import { IPromptSection } from './prompt-builder';
-import { ISession, ToolDefinition } from '../types';
-import { SkillRegistry } from '../skills/skill-registry';
-import { MemoryStore } from './memory-store';
-
-/**
- * 核心身份段落。Priority 0，不可省略。
- */
-export class CoreIdentitySection implements IPromptSection {
-  readonly priority = 0;
-
-  shouldInclude(): boolean {
-    return true;
-  }
-
-  render(): string {
-    return [
-      'You are an AI assistant running locally with access to tools for file I/O, shell commands, and other local resources.',
-      '',
-      'RULES:',
-      '- Read existing code before modifying it.',
-      '- Explain your reasoning before taking action.',
-      '- Confirm before making destructive changes (deleting files, dropping tables, etc.).',
-      '- When a tool call fails, analyze the error and try an alternative approach rather than repeating the same action.',
-      '- Do not over-comment code. Write clear, self-documenting code.',
-    ].join('\n');
-  }
-
-  renderTruncated(): string {
-    return this.render(); // 核心身份不可截断
-  }
-}
-
-/**
- * 环境信息段落。Priority 1。
- */
-export class EnvironmentSection implements IPromptSection {
-  readonly priority = 1;
-
-  shouldInclude(): boolean {
-    return true;
-  }
-
-  render(session: ISession): string {
-    const env = session.environment;
-    return [
-      '## Environment',
-      `- OS: ${env.os} ${env.osVersion}`,
-      `- Working Directory: ${env.cwd}`,
-      `- Shell: ${env.shell}`,
-      `- Node.js: ${env.nodeVersion}`,
-      `- Time: ${env.currentTime}`,
-    ].join('\n');
-  }
-
-  renderTruncated(session: ISession): string {
-    const env = session.environment;
-    return `## Environment\nOS: ${env.os}, CWD: ${env.cwd}`;
-  }
-}
-
-/**
- * 已加载 Skill 指令段落。Priority 2。
- */
-export class SkillInstructionsSection implements IPromptSection {
-  readonly priority = 2;
-
-  constructor(private skills: SkillRegistry) {}
-
-  shouldInclude(session: ISession): boolean {
-    return session.loadedSkills.size > 0;
-  }
-
-  render(session: ISession): string {
-    const loaded = this.skills.getLoadedSkills(session);
-    if (loaded.length === 0) return '';
-
-    const parts = ['## Active Skills'];
-    for (const skill of loaded) {
-      parts.push(`### ${skill.name}\n${skill.instructions}`);
-    }
-    return parts.join('\n\n');
-  }
-
-  renderTruncated(session: ISession, maxTokens: number): string | null {
-    const loaded = this.skills.getLoadedSkills(session);
-    if (loaded.length === 0) return null;
-
-    // 只保留第一个 skill 的前几行
-    const first = loaded[0];
-    const lines = first.instructions.split('\n').slice(0, 5);
-    return `## Active Skills\n### ${first.name}\n${lines.join('\n')}\n...`;
-  }
-}
-
-/**
- * Memory 文件段落。Priority 3。
- */
-export class MemorySection implements IPromptSection {
-  readonly priority = 3;
-
-  constructor(private memory: MemoryStore) {}
-
-  shouldInclude(session: ISession): boolean {
-    return true; // 总是尝试加载，render 时判断有无内容
-  }
-
-  render(session: ISession): string {
-    const memories = this.memory.loadRelevant(session.task, session.environment.cwd);
-    if (memories.length === 0) return '';
-
-    const parts = ['## Project Context'];
-    for (const mem of memories) {
-      parts.push(`### ${mem.source}\n${mem.content}`);
-    }
-    return parts.join('\n\n');
-  }
-
-  renderTruncated(session: ISession, maxTokens: number): string | null {
-    const memories = this.memory.loadRelevant(session.task, session.environment.cwd);
-    if (memories.length === 0) return null;
-
-    // 只保留第一个 memory 文件的前 10 行
-    const first = memories[0];
-    const lines = first.content.split('\n').slice(0, 10);
-    return `## Project Context\n### ${first.source}\n${lines.join('\n')}\n...`;
-  }
-}
-
-/**
- * 可用 Skill 列表段落。Priority 4。
- *
- * 告诉 LLM 有哪些 Skill 可以加载，但不注入全部指令。
- * 渐进式暴露的关键实现。
- */
-export class AvailableSkillsSection implements IPromptSection {
-  readonly priority = 4;
-
-  constructor(private skills: SkillRegistry) {}
-
-  shouldInclude(session: ISession): boolean {
-    const unloaded = this.skills.getUnloadedSkills(session);
-    return unloaded.length > 0;
-  }
-
-  render(session: ISession): string {
-    const unloaded = this.skills.getUnloadedSkills(session);
-    if (unloaded.length === 0) return '';
-
-    const lines = [
-      '## Available Skills (not yet loaded)',
-      'Use the `load_skill` tool to activate a skill when needed:',
-      '',
-    ];
-
-    for (const skill of unloaded) {
-      lines.push(`- **${skill.name}**: ${skill.description}`);
-    }
-
-    return lines.join('\n');
-  }
-
-  renderTruncated(): string | null {
-    return null; // 可以安全跳过
-  }
-}
-```
-
-```typescript
-// context/memory-store.ts
-
-import * as fs from 'fs';```typescript
-import * as path from 'path';
-import { TaskRequest } from '../types';
-
-export interface Memory {
-  source: string;
-  content: string;
-  scope: 'global' | 'project' | 'session';
-  tags: string[];
-}
-
-/**
- * 持久化记忆存储。
- *
- * 三级作用域：
- * 1. Global (~/.executor/memory/): 跨项目共享的知识
- * 2. Project (.executor/memory/): 项目级知识
- * 3. Convention files (CLAUDE.md, AGENTS.md 等): 约定优于配置
- *
- * Memory 文件是 Markdown 格式，人类可读可编辑。
- */
-export class MemoryStore {
-  private globalDir: string;
-
-  constructor(globalDir?: string) {
-    this.globalDir = globalDir ?? path.join(require('os').homedir(), '.executor', 'memory');
-  }
-
-  loadRelevant(task: TaskRequest, cwd: string): Memory[] {
-    const memories: Memory[] = [];
-
-    // 1. 全局记忆
-    memories.push(...this.loadFromDirectory(this.globalDir, 'global'));
-
-    // 2. 项目记忆（向上查找 .executor/memory/）
-    const projectDir = this.findProjectMemoryDir(cwd);
-    if (projectDir) {
-      memories.push(...this.loadFromDirectory(projectDir, 'project'));
-    }
-
-    // 3. 约定文件
-    const conventionFiles = ['CLAUDE.md', 'AGENTS.md', '.cursorrules', 'INSTRUCTIONS.md'];
-    for (const filename of conventionFiles) {
-      const filepath = path.join(cwd, filename);
-      if (fs.existsSync(filepath)) {
-        try {
-          const content = fs.readFileSync(filepath, 'utf-8');
-          memories.push({
-            source: filepath,
-            content,
-            scope: 'project',
-            tags: ['convention'],
-          });
-        } catch {
-          // skip unreadable files
-        }
-      }
-    }
-
-    return memories;
-  }
-
-  saveMemory(content: string, name: string, scope: 'global' | 'project', cwd: string): void {
-    const directory =
-      scope === 'global' ? this.globalDir : path.join(cwd, '.executor', 'memory');
-
-    fs.mkdirSync(directory, { recursive: true });
-    const filepath = path.join(directory, `${name}.md`);
-    fs.writeFileSync(filepath, content, 'utf-8');
-  }
-
-  private loadFromDirectory(directory: string, scope: 'global' | 'project'): Memory[] {
-    if (!fs.existsSync(directory)) return [];
-
-    const memories: Memory[] = [];
-    const files = fs.readdirSync(directory).filter(f => f.endsWith('.md')).sort();
-
-    for (const file of files) {
-      try {
-        const filepath = path.join(directory, file);
-        const content = fs.readFileSync(filepath, 'utf-8');
-        memories.push({ source: filepath, content, scope, tags: [] });
-      } catch {
-        continue;
-      }
-    }
-    return memories;
-  }
-
-  private findProjectMemoryDir(cwd: string): string | null {
-    let current = cwd;
-    for (let i = 0; i < 10; i++) {
-      const candidate = path.join(current, '.executor', 'memory');
-      if (fs.existsSync(candidate)) return candidate;
-      const parent = path.dirname(current);
-      if (parent === current) break;
-      current = parent;
-    }
-    return null;
-  }
-}
-```
-
----
-
-### 4.8 工具系统
-
-```typescript
-// tools/tool-executor.ts
-
-import {
-  ITool,
-  ISession,
-  ToolCall,
-  ToolResult,
-  ToolDefinition,
-  SideEffect,
-  HookEvent,
-} from '../types';
-import { PermissionManager } from './permission-manager';
-import { HookManager } from '../hooks/hook-manager';
-import { ToolNotFoundError } from '../utils/errors';
-import { Permission } from '../types';
-
-/**
- * 工具执行框架。
- *
- * 核心设计：
- * 1. 读写分离并行策略（读操作并行、写操作串行）
- * 2. 三层权限检查（全局/项目/会话）
- * 3. 错误包装为 ToolResult 喂回 LLM（不抛异常）
- * 4. 超时控制
- */
-export class ToolExecutor {
-  private tools: Map<string, ITool>;
-
-  constructor(
-    tools: ITool[],
-    private permissions: PermissionManager,
-    private hooks: HookManager,
-  ) {
-    this.tools = new Map(tools.map(t => [t.name, t]));
-  }
-
-  /**
-   * 注册额外工具（Skill 加载时调用）
-   */
-  registerTool(tool: ITool): void {
-    this.tools.set(tool.name, tool);
-  }
-
-  /**
-   * 获取当前可用工具的定义列表。
-   * 渐进式暴露：只返回 isAvailable 为 true 的工具。
-   */
-  getToolDefinitions(session: ISession): ToolDefinition[] {
-    const definitions: ToolDefinition[] = [];
-    for (const tool of this.tools.values()) {
-      if (tool.isAvailable(session)) {
-        definitions.push(tool.getDefinition());
-      }
-    }
-    return definitions;
-  }
-
-  /**
-   * 批量执行工具调用。
-   *
-   * 并行策略：
-   * - SideEffect.None 的工具可以并行执行
-   * - SideEffect.Local/External 的工具串行执行
-   * - 混合时：先并行读，再串行写
-   */
-  async executeBatch(calls: ToolCall[], session: ISession): Promise<ToolResult[]> {
-    const { reads, writes } = this.partitionBySideEffect(calls);
-    const results: ToolResult[] = [];
-
-    // 并行执行读操作
-    if (reads.length > 0) {
-      const readResults = await Promise.allSettled(
-        reads.map(call => this.executeSingle(call, session)),
-      );
-
-      for (let i = 0; i < reads.length; i++) {
-        const settled = readResults[i];
-        if (settled.status === 'fulfilled') {
-          results.push(settled.value);
-        } else {
-          results.push({
-            callId: reads[i].id,
-            output: `Error: ${settled.reason?.message ?? 'Unknown error'}`,
-            isError: true,
-          });
-        }
-      }
-    }
-
-    // 串行执行写操作
-    for (const call of writes) {
-      const result = await this.executeSingle(call, session);
-      results.push(result);
-    }
-
-    return results;
-  }
-
-  /**
-   * 执行单个工具调用。
-   * 所有异常都被捕获并包装为 ToolResult，不向外传播。
-   */
-  private async executeSingle(call: ToolCall, session: ISession): Promise<ToolResult> {
-    const tool = this.tools.get(call.name);
-    if (!tool) {
-      return {
-        callId: call.id,
-        output: `Error: Unknown tool '${call.name}'. Available tools: ${[...this.tools.keys()].join(', ')}`,
-        isError: true,
-      };
-    }
-
-    // 权限检查
-    const permission = await this.permissions.check(tool, call.arguments, session);
-
-    if (permission === Permission.Denied) {
-      return {
-        callId: call.id,
-        output: `Permission denied: ${tool.name} is not allowed in current context.`,
-        isError: true,
-      };
-    }
-
-    if (permission === Permission.AskUser) {
-      const approved = await this.hooks.intercept(HookEvent.PermissionRequest, {
-        tool: tool.name,
-        args: call.arguments,
-      });
-      if (approved === false) {
-        return {
-          callId: call.id,
-          output: `User denied permission for ${tool.name}.`,
-          isError: true,
-        };
-      }
-    }
-
-    // 执行
-    await this.hooks.emit(HookEvent.ToolStart, { call });
-    const startTime = Date.now();
-
-    try {
-      const output = await this.withTimeout(
-        tool.execute(call.arguments, session),
-        tool.timeoutMs,
-        tool.name,
-      );
-
-      const durationMs = Date.now() - startTime;
-      await this.hooks.emit(HookEvent.ToolSuccess, { call, result: output, durationMs });
-
-      return { callId: call.id, output, isError: false };
-    } catch (err: any) {
-      if (err.name === 'TimeoutError') {
-        await this.hooks.emit(HookEvent.ToolTimeout, {
-          call,
-          timeoutMs: tool.timeoutMs,
-        });
-        return {
-          callId: call.id,
-          output: `Error: Tool '${tool.name}' timed out after ${tool.timeoutMs}ms. Try a simpler approach or break the task down.`,
-          isError: true,
-        };
-      }
-
-      await this.hooks.emit(HookEvent.ToolError, { call, error: err });
-      return {
-        callId: call.id,
-        output: `Error executing ${tool.name}: ${err.message ?? String(err)}`,
-        isError: true,
-      };
-    }
-  }
-
-  private partitionBySideEffect(calls: ToolCall[]): {
-    reads: ToolCall[];
-    writes: ToolCall[];
-  } {
-    const reads: ToolCall[] = [];
-    const writes: ToolCall[] = [];
-
-    for (const call of calls) {
-      const tool = this.tools.get(call.name);
-      if (tool && tool.sideEffect === SideEffect.None) {
-        reads.push(call);
-      } else {
-        writes.push(call);
-      }
-    }
-
-    return { reads, writes };
-  }
-
-  private withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
-    return new Promise<T>((resolve, reject) => {
-      const timer = setTimeout(() => {
-        const err = new Error(`${label} timed out after ${ms}ms`);
-        err.name = 'TimeoutError';
-        reject(err);
-      }, ms);
-
-      promise
-        .then(value => {
-          clearTimeout(timer);
-          resolve(value);
-        })
-        .catch(err => {
-          clearTimeout(timer);
-          reject(err);
-        });
-    });
-  }
-}
-```
-
-```typescript
-// tools/permission-manager.ts
-
-import { ITool, ISession, Permission, PermissionRule, SideEffect } from '../types';
-import * as fs from 'fs';
-import * as path from 'path';
-
-/**
- * 三层权限管理器。
- *
- * 评估顺序：全局规则 → 项目规则 → 会话记忆 → 副作用推断 → 默认策略
- */
-export class PermissionManager {
-  private sessionGrants = new Map<string, Permission>();
-
-  constructor(
-    private globalRules: PermissionRule[],
-    private defaultPolicy: Permission = Permission.AskUser,
-  ) {}
-
-  async check(
-    tool: ITool,
-    args: Record<string, unknown>,
-    session: ISession,
-  ): Promise<Permission> {
-    // 1. 全局规则（最高优先级）
-    for (const rule of this.globalRules) {
-      if (this.matches(rule, tool, args)) return rule.action;
-    }
-
-    // 2. 项目规则
-    const projectRules = this.loadProjectRules(session.environment.cwd);
-    for (const rule of projectRules) {
-      if (this.matches(rule, tool, args)) return rule.action;
-    }
-
-    // 3. 会话记忆
-    const sessionKey = this.makeSessionKey(tool, args);
-    if (this.sessionGrants.has(sessionKey)) {
-      return this.sessionGrants.get(sessionKey)!;
-    }
-
-    // 4. 无副作用的工具直接放行
-    if (tool.sideEffect === SideEffect.None) {
-      return Permission.Allowed;
-    }
-
-    // 5. 默认策略
-    return this.defaultPolicy;
-  }
-
-  /**
-   * 授权本次会话中的某类操作
-   */
-  grantSessionPermission(toolName: string, scope = '*'): void {
-    this.sessionGrants.set(`${toolName}:${scope}`, Permission.Allowed);
-  }
-
-  /**
-   * 用户确认授权后，记住同类操作以免重复询问
-   */
-  rememberGrant(tool: ITool, args: Record<string, unknown>): void {
-    const key = this.makeSessionKey(tool, args);
-    this.sessionGrants.set(key, Permission.Allowed);
-  }
-
-  private matches(
-    rule: PermissionRule,
-    tool: ITool,
-    args: Record<string, unknown>,
-  ): boolean {
-    // 简单的 glob 匹配（* 通配符）
-    if (!this.globMatch(tool.name, rule.toolPattern)) return false;
-
-    if (rule.argPatterns) {
-      for (const [key, pattern] of Object.entries(rule.argPatterns)) {
-        if (!(key in args)) return false;
-        if (!this.globMatch(String(args[key]), pattern)) return false;
-      }
-    }
-
-    return true;
-  }
-
-  private makeSessionKey(tool: ITool, args: Record<string, unknown>): string {
-    // 对于文件操作，按目录粒度记忆授权
-    if ('path' in args && typeof args.path === 'string') {
-      const directory = path.dirname(args.path);
-      return `${tool.name}:${directory}`;
-    }
-    return `${tool.name}:*`;
-  }
-
-  private loadProjectRules(cwd: string): PermissionRule[] {
-    const rulesPath = path.join(cwd, '.executor', 'permissions.json');
-    if (!fs.existsSync(rulesPath)) return [];
-
-    try {
-      const data = JSON.parse(fs.readFileSync(rulesPath, 'utf-8'));
-      return (data.rules ?? []) as PermissionRule[];
-    } catch {
-      return [];
-    }
-  }
-
-  private globMatch(value: string, pattern: string): boolean {
-    if (pattern === '*') return true;
-    if (!pattern.includes('*')) return value === pattern;
-
-    const regex = new RegExp(
-      '^' + pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$',
-    );
-    return regex.test(value);
-  }
-}
-```
-
----
-
-### 4.9 内置工具实现
-
-```typescript
-// tools/builtin/file-read.ts
-
-import { ITool, ISession, ToolDefinition, SideEffect } from '../../types';
-import * as fs from 'fs';
-import * as path from 'path';
-
-export class FileReadTool implements ITool {
-  readonly name = 'file_read';
-  readonly description = 'Read the contents of a file at the given path.';
-  readonly sideEffect = SideEffect.None;
-  readonly timeoutMs = 10_000;
-
-  getDefinition(): ToolDefinition {```typescript
-    return {
-      name: this.name,
-      description: this.description,
-      parameters: {
-        type: 'object',
-        properties: {
-          path: {
-            type: 'string',
-            description: 'Absolute or relative file path to read',
-          },
-          offset: {
-            type: 'integer',
-            description: 'Line number to start reading from (0-indexed)',
-            default: 0,
-          },
-          limit: {
-            type: 'integer',
-            description: 'Maximum number of lines to read',
-            default: 500,
-          },
-        },
-        required: ['path'],
-      },
-    };
-  }
-
-  isAvailable(): boolean {
-    return true;
-  }
-
-  async execute(args: Record<string, unknown>, session: ISession): Promise<string> {
-    const filePath = this.resolvePath(String(args.path), session);
-    const offset = Number(args.offset ?? 0);
-    const limit = Number(args.limit ?? 500);
-
-    if (!fs.existsSync(filePath)) {
-      return `Error: File not found: ${filePath}`;
-    }
-
-    const stat = fs.statSync(filePath);
-    if (!stat.isFile()) {
-      return `Error: Not a file: ${filePath}`;
-    }
-
-    let content: string;
-    try {
-      content = fs.readFileSync(filePath, 'utf-8');
-    } catch (err: any) {
-      if (err.code === 'EACCES') return `Error: Permission denied: ${filePath}`;
-      return `Error: ${err.message}`;
-    }
-
-    const lines = content.split('\n');
-    const totalLines = lines.length;
-    const selected = lines.slice(offset, offset + limit);
-
-    const parts: string[] = [`File: ${filePath} (${totalLines} lines total)`];
-
-    if (offset > 0 || offset + limit < totalLines) {
-      parts.push(`Showing lines ${offset}-${Math.min(offset + limit, totalLines) - 1}`);
-    }
-
-    parts.push('');
-    selected.forEach((line, i) => {
-      parts.push(`${String(offset + i).padStart(4)} | ${line}`);
-    });
-
-    if (offset + limit < totalLines) {
-      parts.push(`\n... ${totalLines - offset - limit} more lines not shown`);
-    }
-
-    return parts.join('\n');
-  }
-
-  private resolvePath(raw: string, session: ISession): string {
-    if (path.isAbsolute(raw)) return raw;
-    return path.join(session.environment.cwd, raw);
-  }
-}
-```
-
-```typescript
-// tools/builtin/file-write.ts
-
-import { ITool, ISession, ToolDefinition, SideEffect } from '../../types';
-import * as fs from 'fs';
-import * as path from 'path';
-
-export class FileWriteTool implements ITool {
-  readonly name = 'file_write';
-  readonly description =
-    'Write or edit a file. Supports full content replacement and surgical edits using search/replace blocks.';
-  readonly sideEffect = SideEffect.Local;
-  readonly timeoutMs = 30_000;
-
-  getDefinition(): ToolDefinition {
-    return {
-      name: this.name,
-      description: this.description,
-      parameters: {
-        type: 'object',
-        properties: {
-          path: {
-            type: 'string',
-            description: 'File path to write to',
-          },
-          content: {
-            type: 'string',
-            description: 'Full file content (for new files or full replacement)',
-          },
-          edits: {
-            type: 'array',
-            description: 'Surgical edits as search/replace pairs',
-            items: {
-              type: 'object',
-              properties: {
-                search: { type: 'string' },
-                replace: { type: 'string' },
-              },
-              required: ['search', 'replace'],
-            },
-          },
-          createDirs: {
-            type: 'boolean',
-            description: 'Create parent directories if they do not exist',
-            default: true,
-          },
-        },
-        required: ['path'],
-      },
-    };
-  }
-
-  isAvailable(): boolean {
-    return true;
-  }
-
-  async execute(args: Record<string, unknown>, session: ISession): Promise<string> {
-    const filePath = this.resolvePath(String(args.path), session);
-    const content = args.content as string | undefined;
-    const edits = args.edits as Array<{ search: string; replace: string }> | undefined;
-    const createDirs = args.createDirs !== false;
-
-    if (content !== undefined && edits !== undefined) {
-      return "Error: Provide either 'content' or 'edits', not both.";
-    }
-    if (content === undefined && edits === undefined) {
-      return "Error: Must provide either 'content' or 'edits'.";
-    }
-
-    if (createDirs) {
-      fs.mkdirSync(path.dirname(filePath), { recursive: true });
-    }
-
-    if (content !== undefined) {
-      return this.writeFull(filePath, content);
-    }
-    return this.applyEdits(filePath, edits!);
-  }
-
-  private writeFull(filePath: string, content: string): string {
-    const existed = fs.existsSync(filePath);
-    fs.writeFileSync(filePath, content, 'utf-8');
-    const lines = content.split('\n').length;
-    const action = existed ? 'Updated' : 'Created';
-    return `${action}: ${filePath} (${lines} lines)`;
-  }
-
-  private applyEdits(
-    filePath: string,
-    edits: Array<{ search: string; replace: string }>,
-  ): string {
-    if (!fs.existsSync(filePath)) {
-      return `Error: Cannot apply edits to non-existent file: ${filePath}`;
-    }
-
-    let content = fs.readFileSync(filePath, 'utf-8');
-    let applied = 0;
-    const failed: string[] = [];
-
-    for (const edit of edits) {
-      if (content.includes(edit.search)) {
-        content = content.replace(edit.search, edit.replace);
-        applied++;
-      } else {
-        failed.push(edit.search.slice(0, 80));
-      }
-    }
-
-    fs.writeFileSync(filePath, content, 'utf-8');
-
-    const parts = [`Applied ${applied}/${edits.length} edits to ${filePath}`];
-    if (failed.length > 0) {
-      parts.push(`Failed to match ${failed.length} patterns:`);
-      for (const f of failed) {
-        parts.push(`  - '${f}...'`);
-      }
-    }
-    return parts.join('\n');
-  }
-
-  private resolvePath(raw: string, session: ISession): string {
-    if (path.isAbsolute(raw)) return raw;
-    return path.join(session.environment.cwd, raw);
-  }
-}
-```
-
-```typescript
-// tools/builtin/shell-exec.ts
-
-import { ITool, ISession, ToolDefinition, SideEffect } from '../../types';
-import { exec } from 'child_process';
-import { truncateLines } from '../../utils/tokens';
-
-export class ShellExecTool implements ITool {
-  readonly name = 'shell_exec';
-  readonly description =
-    'Execute a shell command. Use for running tests, installing packages, searching with grep/find, git operations, etc.';
-  readonly sideEffect = SideEffect.Local;
-  readonly timeoutMs = 120_000;
-
-  /** Patterns that are unconditionally blocked */
-  private static readonly CATASTROPHIC_PATTERNS = [
-    /rm\s+-rf\s+\/(?!\S)/,
-    /mkfs\./,
-    /dd\s+.*of=\/dev\//,
-    /:\(\)\{.*\|.*&\s*\};:/,
-    />(\/dev\/[hs]d|\/dev\/nvme)/,
-  ];
-
-  getDefinition(): ToolDefinition {
-    return {
-      name: this.name,
-      description: this.description,
-      parameters: {
-        type: 'object',
-        properties: {
-          command: {
-            type: 'string',
-            description: 'The shell command to execute',
-          },
-          timeout: {
-            type: 'integer',
-            description: 'Timeout in seconds (default 60)',
-            default: 60,
-          },
-        },
-        required: ['command'],
-      },
-    };
-  }
-
-  isAvailable(): boolean {
-    return true;
-  }
-
-  async execute(args: Record<string, unknown>, session: ISession): Promise<string> {
-    const command = String(args.command);
-    const timeoutSec = Math.min(Number(args.timeout ?? 60), this.timeoutMs / 1000);
-
-    if (this.isCatastrophic(command)) {
-      return `Error: Refused to execute potentially destructive command: ${command}\nThis command matches a blocked pattern.`;
-    }
-
-    return new Promise<string>((resolve) => {
-      const child = exec(command, {
-        cwd: session.environment.cwd,
-        timeout: timeoutSec * 1000,
-        maxBuffer: 10 * 1024 * 1024, // 10 MB
-        env: { ...process.env },
-      });
-
-      let stdout = '';
-      let stderr = '';
-
-      child.stdout?.on('data', (chunk) => {
-        stdout += chunk;
-      });
-      child.stderr?.on('data', (chunk) => {
-        stderr += chunk;
-      });
-
-      child.on('close', (code) => {
-        const parts: string[] = [`Exit code: ${code ?? 'unknown'}`];
-        if (stdout.trim()) {
-          parts.push(`STDOUT:\n${truncateLines(stdout, 200)}`);
-        }
-        if (stderr.trim()) {
-          parts.push(`STDERR:\n${truncateLines(stderr, 200)}`);
-        }
-        resolve(parts.join('\n\n'));
-      });
-
-      child.on('error', (err) => {
-        if (err.message.includes('ETIMEDOUT') || err.message.includes('timeout')) {
-          resolve(`Error: Command timed out after ${timeoutSec}s: ${command}`);
-        } else {
-          resolve(`Error: ${err.message}`);
-        }
-      });
-    });
-  }
-
-  private isCatastrophic(command: string): boolean {
-    return ShellExecTool.CATASTROPHIC_PATTERNS.some((p) => p.test(command));
-  }
-}
-```
-
-```typescript
-// tools/builtin/glob-search.ts
-
-import { ITool, ISession, ToolDefinition, SideEffect } from '../../types';
-import * as fs from 'fs';
-import * as path from 'path';
-import { glob } from 'glob';
-
-export class GlobSearchTool implements ITool {
-  readonly name = 'glob_search';
-  readonly description =
-    'Search for files matching a glob pattern. Useful for finding files by name or extension.';
-  readonly sideEffect = SideEffect.None;
-  readonly timeoutMs = 30_000;
-
-  private static readonly IGNORE_DIRS = new Set([
-    '.git', 'node_modules', '__pycache__', '.venv', 'venv', '.tox', 'dist', 'build',
-  ]);
-
-  getDefinition(): ToolDefinition {
-    return {
-      name: this.name,
-      description: this.description,
-      parameters: {
-        type: 'object',
-        properties: {
-          pattern: {
-            type: 'string',
-            description: "Glob pattern (e.g., '**/*.py', 'src/**/*.ts')",
-          },
-          path: {
-            type: 'string',
-            description: 'Base directory to search from (default: cwd)',
-            default: '.',
-          },
-          maxResults: {
-            type: 'integer',
-            description: 'Maximum number of results to return',
-            default: 100,
-          },
-        },
-        required: ['pattern'],
-      },
-    };
-  }
-
-  isAvailable(): boolean {
-    return true;
-  }
-
-  async execute(args: Record<string, unknown>, session: ISession): Promise<string> {
-    const pattern = String(args.pattern);
-    const base = String(args.path ?? '.');
-    const maxResults = Number(args.maxResults ?? 100);
-
-    const basePath = path.isAbsolute(base)
-      ? base
-      : path.join(session.environment.cwd, base);
-
-    if (!fs.existsSync(basePath)) {
-      return `Error: Directory not found: ${basePath}`;
-    }
-
-    try {
-      const matches = await glob(pattern, {
-        cwd: basePath,
-        ignore: [...GlobSearchTool.IGNORE_DIRS].map(d => `**/${d}/**`),
-        nodir: false,
-        absolute: false,
-      });
-
-      const sorted = matches.sort();
-      const total = sorted.length;
-      const truncated = sorted.slice(0, maxResults);
-
-      const lines = [`Found ${total} matches for '${pattern}' in ${basePath}:`];
-      for (const m of truncated) {
-        const fullPath = path.join(basePath, m);
-        const isDir = fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory();
-        lines.push(`  ${m}${isDir ? '/' : ''}`);
-      }
-
-      if (total > maxResults) {
-        lines.push(`\n... and ${total - maxResults} more results`);
-      }
-
-      return lines.join('\n');
-    } catch (err: any) {
-      return `Error: ${err.message}`;
-    }
-  }
-}
-```
-
-```typescript
-// tools/builtin/grep-search.ts
-
-import { ITool, ISession, ToolDefinition, SideEffect } from '../../types';
-import * as fs from 'fs';
-import * as path from 'path';
-
-export class GrepSearchTool implements ITool {
-  readonly name = 'grep_search';
-  readonly description =
-    'Search file contents using a regular expression pattern. Similar to grep -rn.';
-  readonly sideEffect = SideEffect.None;
-  readonly timeoutMs = 30_000;
-
-  private static readonly IGNORE_DIRS = new Set([
-    '.git', 'node_modules', '__pycache__', '.venv', 'venv', '.tox', 'dist', 'build',
-  ]);
-
-  private static readonly BINARY_EXTENSIONS = new Set([
-    '.png', '.jpg', '.jpeg', '.gif', '.ico', '.pdf', '.zip', '.tar', '.gz',
-    '.exe', '.dll', '.so', '.dylib', '.wasm', '.bin', '.dat',
-  ]);
-
-  getDefinition(): ToolDefinition {
-    return {
-      name: this.name,
-      description: this.description,
-      parameters: {
-        type: 'object',
-        properties: {
-          pattern: {
-            type: 'string',
-            description: 'Regular expression pattern to search for',
-          },
-          path: {
-            type: 'string',
-            description: 'Directory or file to search in (default: cwd)',
-            default: '.',
-          },
-          include: {
-            type: 'string',
-            description: "File extension filter (e.g., '.ts', '.py')",
-          },
-          maxResults: {
-            type: 'integer',
-            description: 'Maximum number of matching lines to return',
-            default: 50,
-          },
-          caseSensitive: {
-            type: 'boolean',
-            description: 'Whether the search is case sensitive',
-            default: true,
-          },
-        },
-        required: ['pattern'],
-      },
-    };
-  }
-
-  isAvailable(): boolean {
-    return true;
-  }
-
-  async execute(args: Record<string, unknown>, session: ISession): Promise<string> {
-    const pattern = String(args.pattern);
-    const base = String(args.path ?? '.');
-    const include = args.include as string |undefined;
-    const maxResults = Number(args.maxResults ?? 50);
-    const caseSensitive = args.caseSensitive !== false;
-
-    const basePath = path.isAbsolute(base)
-      ? base
-      : path.join(session.environment.cwd, base);
-
-    if (!fs.existsSync(basePath)) {
-      return `Error: Path not found: ${basePath}`;
-    }
-
-    let regex: RegExp;
-    try {
-      regex = new RegExp(pattern, caseSensitive ? '' : 'i');
-    } catch (err: any) {
-      return `Error: Invalid regex pattern: ${err.message}`;
-    }
-
-    const matches: string[] = [];
-    let filesSearched = 0;
-
-    const filesToSearch = this.collectFiles(basePath, include);
-
-    for (const filePath of filesToSearch) {
-      if (matches.length >= maxResults) break;
-
-      let content: string;
-      try {
-        content = fs.readFileSync(filePath, 'utf-8');
-      } catch {
-        continue;
-      }
-
-      filesSearched++;
-
-      const lines = content.split('\n');
-      for (let lineNum = 0; lineNum < lines.length; lineNum++) {
-        if (matches.length >= maxResults) break;
-        if (regex.test(lines[lineNum])) {
-          const rel = path.relative(basePath, filePath);
-          matches.push(`  ${rel}:${lineNum + 1}: ${lines[lineNum].trimEnd()}`);
-        }
-      }
-    }
-
-    const header = `Searched ${filesSearched} files for /${pattern}/`;
-    if (matches.length === 0) {
-      return `${header}\nNo matches found.`;
-    }
-
-    const result = [`${header}`, `Found ${matches.length} matches:`, ...matches];
-    if (matches.length >= maxResults) {
-      result.push(`\n... results truncated at ${maxResults} matches`);
-    }
-    return result.join('\n');
-  }
-
-  private collectFiles(basePath: string, includeExt?: string): string[] {
-    const results: string[] = [];
-    const stat = fs.statSync(basePath);
-
-    if (stat.isFile()) {
-      return [basePath];
-    }
-
-    const walk = (dir: string) => {
-      let entries: fs.Dirent[];
-      try {
-        entries = fs.readdirSync(dir, { withFileTypes: true });
-      } catch {
-        return;
-      }
-
-      for (const entry of entries) {
-        if (GrepSearchTool.IGNORE_DIRS.has(entry.name)) continue;
-
-        const fullPath = path.join(dir, entry.name);
-        if (entry.isDirectory()) {
-          walk(fullPath);
-        } else if (entry.isFile()) {
-          const ext = path.extname(entry.name).toLowerCase();
-          if (GrepSearchTool.BINARY_EXTENSIONS.has(ext)) continue;
-          if (includeExt && ext !== includeExt) continue;
-          results.push(fullPath);
-        }
-      }
-    };
-
-    walk(basePath);
-    return results;
-  }
-}
-```
-
-```typescript
-// tools/builtin/load-skill.ts
-
-import { ITool, ISession, ToolDefinition, SideEffect } from '../../types';
-import { SkillRegistry } from '../../skills/skill-registry';
-import { ToolExecutor } from '../tool-executor';
-import { HookManager } from '../../hooks/hook-manager';
-import { HookEvent } from '../../types';
-
-/**
- * 元工具：动态加载 Skill。
- *
- * 这是渐进式暴露的关键实现。
- * LLM 可以在需要时调用此工具加载额外的 Skill，
- * 而不是一次性把所有工具和指令塞进上下文。
- */
-export class LoadSkillTool implements ITool {
-  readonly name = 'load_skill';
-  readonly description =
-    'Load a skill to get access to additional tools and instructions. Use this when you need capabilities not currently available.';
-  readonly sideEffect = SideEffect.None;
-  readonly timeoutMs = 5_000;
-
-  constructor(
-    private skills: SkillRegistry,
-    private toolExecutor: ToolExecutor,
-    private hooks: HookManager,
-  ) {}
-
-  getDefinition(): ToolDefinition {
-    return {
-      name: this.name,
-      description: this.description,
-      parameters: {
-        type: 'object',
-        properties: {
-          skill: {
-            type: 'string',
-            description: 'Name of the skill to load',
-          },
-        },
-        required: ['skill'],
-      },
-    };
-  }
-
-  isAvailable(): boolean {
-    return true;
-  }
-
-  async execute(args: Record<string, unknown>, session: ISession): Promise<string> {
-    const skillName = String(args.skill);
-
-    if (session.loadedSkills.has(skillName)) {
-      return `Skill '${skillName}' is already loaded.`;
-    }
-
-    const skill = this.skills.getSkill(skillName);
-    if (!skill) {
-      const available = this.skills.getAllSkillNames().join(', ');
-      return `Error: Unknown skill '${skillName}'. Available skills: ${available}`;
-    }
-
-    // 加载 Skill 的工具到执行器
-    for (const tool of skill.tools) {
-      this.toolExecutor.registerTool(tool);
-    }
-
-    // 标记为已加载
-    session.loadedSkills.add(skillName);
-
-    await this.hooks.emit(HookEvent.SkillLoaded, { skill: skillName });
-
-    const toolNames = skill.tools.map(t => t.name).join(', ');
-    return [
-      `Loaded skill '${skillName}'.`,
-      `New tools available: ${toolNames}`,
-      '',
-      `Instructions:`,
-      skill.instructions,
-    ].join('\n');
-  }
-}
-```
-
----
-
-### 4.10 Skill 注册表
-
-```typescript
-// skills/skill-registry.ts
-
-import { SkillDefinition, ISession, ITool } from '../types';
-
-/**
- * Skill 注册与管理。
- *
- * 支持两种加载模式：
- * 1. 自动加载（autoLoad: true）：会话开始时立即加载
- * 2. 按需加载：通过 load_skill 工具或 triggerPatterns 自动匹配
- */
-export class SkillRegistry {
-  private skills: Map<string, SkillDefinition>;
-
-  constructor(skills: SkillDefinition[]) {
-    this.skills = new Map(skills.map(s => [s.name, s]));
-  }
-
-  getSkill(name: string): SkillDefinition | undefined {
-    return this.skills.get(name);
-  }
-
-  getAllSkillNames(): string[] {
-    return [...this.skills.keys()];
-  }
-
-  /**
-   * 获取当前会话已加载的 Skills，按优先级排序
-   */
-  getLoadedSkills(session: ISession): SkillDefinition[] {
-    const loaded: SkillDefinition[] = [];
-    for (const name of session.loadedSkills) {
-      const skill = this.skills.get(name);
-      if (skill) loaded.push(skill);
-    }
-    return loaded.sort((a, b) => a.priority - b.priority);
-  }
-
-  /**
-   * 获取尚未加载的 Skills（用于提示词中展示可用列表）
-   */
-  getUnloadedSkills(session: ISession): SkillDefinition[] {
-    const unloaded: SkillDefinition[] = [];
-    for (const [name, skill] of this.skills) {
-      if (!session.loadedSkills.has(name) && !skill.autoLoad) {
-        unloaded.push(skill);
-      }
-    }
-    return unloaded.sort((a, b) => a.priority - b.priority);
-  }
-
-  /**
-   * 获取需要自动加载的 Skills
-   */
-  getAutoLoadSkills(): SkillDefinition[] {
-    return [...this.skills.values()].filter(s => s.autoLoad);
-  }
-
-  /**
-   * 根据任务内容自动检测应加载的 Skills
-   */
-  autoDetectSkills(taskPrompt: string): string[] {
-    const detected: string[] = [];
-    const lower = taskPrompt.toLowerCase();
-
-    for (const [name, skill] of this.skills) {
-      if (skill.autoLoad) {
-        detected.push(name);
-        continue;
-      }
-
-      for (const pattern of skill.triggerPatterns) {
-        if (new RegExp(pattern, 'i').test(lower)) {
-          detected.push(name);
-          break;
-        }
-      }
-    }
-
-    return detected;
-  }
-
-  /**
-   * 收集所有已加载 Skill 的工具
-   */
-  collectTools(session: ISession): ITool[] {
-    const tools: ITool[] = [];
-    const seen = new Set<string>();
-
-    for (const skill of this.getLoadedSkills(session)) {
-      for (const tool of skill.tools) {
-        if (!seen.has(tool.name)) {
-          tools.push(tool);
-          seen.add(tool.name);
-        }
-      }
-    }
-
-    return tools;
-  }
-}
-```
-
----
-
-### 4.11 LLM 网关与适配器
-
-```typescript
-// llm/gateway.ts
-
-import {
-  ILLMGateway,
-  LLMChatParams,
-  LLMResponse,
-  StreamEvent,
-  ModelRegistryConfig,
-  ModelConfig,
-} from '../types';
-
-/**
- * LLM 网关工厂。
- * 根据 provider 创建对应的适配器。
- */
-export class LLMGatewayFactory {
-  static create(config: ModelRegistryConfig): ILLMGateway {
-    const provider = config.primary.provider.toLowerCase();
-
-    switch (provider) {
-      case 'anthropic':
-        return new (require('./adapters/anthropic').AnthropicAdapter)();
-      case 'openai':
-      case 'azure':
-        return new (require('./adapters/openai').OpenAIAdapter)();
-      case 'ollama':
-        return new (require('./adapters/openai').OpenAIAdapter)({
-          baseURL: 'http://localhost:11434/v1',
-        });
-      default:
-        throw new Error(`Unsupported LLM provider: ${provider}`);
-    }
-  }
-}
-```
-
-```typescript
-// llm/model-registry.ts
-
-import { ModelConfig, ModelRegistryConfig } from '../types';
-
-/**
- * 多模型角色注册表。
- *
- * 四种角色：
- * - primary:    主要推理（最聪明的模型）
- * - fallback:   降级备选（主力不可用时）
- * - summarizer: 上下文摘要（可用便宜模型）
- * - subAgent:   子任务执行（快速/便宜模型）
- */
-export class ModelRegistry {
-  constructor(private config: ModelRegistryConfig) {}
-
-  get primary(): ModelConfig {
-    return this.config.primary;
-  }
-
-  get fallback(): ModelConfig {
-    return this.config.fallback ?? this.config.primary;
-  }
-
-  get summarizer(): ModelConfig {
-    return this.config.summarizer ?? this.config.primary;
-  }
-
-  get subAgent(): ModelConfig {
-    return this.config.subAgent ?? this.config.primary;
-  }
-
-  /**
-   * 根据角色名获取模型配置
-   */
-  getModel(role: 'primary' | 'fallback' | 'summarizer' | 'subAgent'): ModelConfig {
-    return this[role];
-  }
-}
-```
-
-```typescript
-// llm/adapters/anthropic.ts
-
-import {
-  ILLMGateway,
-  LLMChatParams,
-  LLMResponse,
-  StreamEvent,
-  ToolCall,
-  TokenUsage,
-  StopReason,
-  Message,
-  ToolDefinition,
-} from '../../types';
-import {
-  RateLimitError,
-  ContextTooLargeError,
-  ServiceOverloadError,
-} from '../../utils/errors';
-
-export class AnthropicAdapter implements ILLMGateway {
-  private client: any;
-
-  constructor(options?: { apiKey?: string }) {
-    // Lazy import to avoid hard dependency
-    const Anthropic = require('@anthropic-ai/sdk').default;
-    this.client = new Anthropic({ apiKey: options?.apiKey });
-  }
-
-  async chat(params: LLMChatParams): Promise<LLMResponse> {
-    const apiMessages = this.convertMessages(params.messages);
-    const apiTools = this.convertTools(params.tools);
-
-    const kwargs: Record<string, unknown> = {
-      model: params.model.modelId,
-      max_tokens: params.model.maxOutputTokens,
-      system: params.system,
-      messages: apiMessages,
-    };
-
-    if (params.model.temperature !== undefined) {
-      kwargs.temperature = params.model.temperature;
-    }
-
-    if (apiTools.length > 0) {
-      kwargs.tools = apiTools;
-    }
-
-    let response: any;
-    try {
-      response = await this.client.messages.create(kwargs);
-    } catch (err: any) {
-      if (err?.status === 429) {
-        const retryAfter = err.headers?.['retry-after'];
-        throw new RateLimitError(
-          err.message ?? 'Rate limit exceeded',
-          retryAfter ? Number(retryAfter) * 1000 : undefined,
-        );
-      }
-      if (err?.status === 413 || (err?.message && /context length|too many tokens/i.test(err.message))) {
-        throw new ContextTooLargeError(err.message);
-      }
-      if (err?.status === 529 || err?.status === 503) {
-        throw new ServiceOverloadError(err.message);
-      }
-      throw err;
-    }
-
-    return this.parseResponse(response);
-  }
-
-  async *chatStream(params: LLMChatParams): AsyncIterable<StreamEvent> {
-    const apiMessages = this.convertMessages(params.messages);
-    const apiTools = this.convertTools(params.tools);
-
-    const kwargs: Record<string, unknown> = {
-      model: params.model.modelId,
-      max_tokens: params.model.maxOutputTokens,
-      system: params.system,
-      messages: apiMessages,
-      stream: true,
-    };
-
-    if (params.model.temperature !== undefined) {
-      kwargs.temperature = params.model.temperature;
-    }
-
-    if (apiTools.length > 0) {
-      kwargs.tools = apiTools;
-    }
-
-    const stream = await this.client.messages.create(kwargs);
-
-    for await (const event of stream) {
-      const mapped = this.mapStreamEvent(event);
-      if (mapped) yield mapped;
-    }
-  }
-
-  private convertMessages(messages: Message[]): any[] {
-    const result: any[] = [];
-
-    for (const msg of messages) {
-      if (msg.role === 'user') {
-        result.push({ role: 'user', content: msg.content });
-      } else if (msg.role === 'assistant') {
-        const contentBlocks: any[] = [];
-        if (msg.content) {
-          contentBlocks.push({ type: 'text', text: msg.content });
-        }
-        if (msg.toolCalls) {
-          for (const tc of msg.toolCalls) {
-            contentBlocks.push({
-              type: 'tool_use',
-              id: tc.id,
-              name: tc.name,
-              input:tc.arguments,
-            });
-          }
-        }
-        result.push({ role: 'assistant', content: contentBlocks });
-      } else if (msg.role === 'tool') {
-        result.push({
-          role: 'user',
-          content: [
-            {
-              type: 'tool_result',
-              tool_use_id: msg.toolCallId,
-              content: msg.content,
-              is_error: msg.isError ?? false,
-            },
-          ],
-        });
-      }
-    }
-
-    return result;
-  }
-
-  private convertTools(tools: ToolDefinition[]): any[] {
-    return tools.map(t => ({
-      name: t.name,
-      description: t.description,
-      input_schema: t.parameters,
-    }));
-  }
-
-  private parseResponse(response: any): LLMResponse {
-    const textParts: string[] = [];
-    const toolCalls: ToolCall[] = [];
-
-    for (const block of response.content) {
-      if (block.type === 'text') {
-        textParts.push(block.text);
-      } else if (block.type === 'tool_use') {
-        toolCalls.push({
-          id: block.id,
-          name: block.name,
-          arguments: block.input,
-        });
-      }
-    }
-
-    const stopReasonMap: Record<string, StopReason> = {
-      end_turn: StopReason.EndTurn,
-      tool_use: StopReason.ToolUse,
-      max_tokens: StopReason.MaxTokens,
-    };
-
-    return {
-      text: textParts.join('\n'),
-      toolCalls,
-      usage: {
-        inputTokens: response.usage.input_tokens,
-        outputTokens: response.usage.output_tokens,
-        cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
-        cacheWriteTokens: response.usage.cache_creation_input_tokens ?? 0,
-      },
-      isTruncated: response.stop_reason === 'max_tokens',
-      stopReason: stopReasonMap[response.stop_reason] ?? StopReason.EndTurn,
-      model: response.model,
-    };
-  }
-
-  private mapStreamEvent(event: any): StreamEvent | null {
-    switch (event.type) {
-      case 'content_block_start':
-        return {
-          type: 'content_block_start',
-          index: event.index,
-          blockType: event.content_block.type === 'tool_use' ? 'tool_use' : 'text',
-          toolName: event.content_block.name,
-          toolId: event.content_block.id,
-        };
-
-      case 'content_block_delta':
-        if (event.delta.type === 'text_delta') {
-          return {
-            type: 'content_delta',
-            index: event.index,
-            text: event.delta.text,
-          };
-        }
-        if (event.delta.type === 'input_json_delta') {
-          return {
-            type: 'content_delta',
-            index: event.index,
-            partialJson: event.delta.partial_json,
-          };
-        }
-        return null;
-
-      case 'content_block_stop':
-        return {
-          type: 'content_block_stop',
-          index: event.index,
-        };
-
-      case 'message_stop':
-        return null; // Handled via message_delta for usage
-
-      case 'message_delta':
-        return {
-          type: 'message_stop',
-          usage: {
-            inputTokens: event.usage?.input_tokens ?? 0,
-            outputTokens: event.usage?.output_tokens ?? 0,
-            cacheReadTokens: 0,
-            cacheWriteTokens: 0,
-          },
-          stopReason: event.delta?.stop_reason === 'max_tokens'
-            ? StopReason.MaxTokens
-            : event.delta?.stop_reason === 'tool_use'
-              ? StopReason.ToolUse
-              : StopReason.EndTurn,
-        };
-
-      default:
-        return null;
-    }
-  }
-}
-```
-
-```typescript
-// llm/adapters/openai.ts
-
-import {
-  ILLMGateway,
-  LLMChatParams,
-  LLMResponse,
-  ToolCall,
-  TokenUsage,
-  StopReason,
-  Message,
-  ToolDefinition,
-} from '../../types';
-import {
-  RateLimitError,
-  ContextTooLargeError,
-  ServiceOverloadError,
-} from '../../utils/errors';
-
-export class OpenAIAdapter implements ILLMGateway {
-  private client: any;
-
-  constructor(options?: { apiKey?: string; baseURL?: string }) {
-    const OpenAI = require('openai').default;
-    this.client = new OpenAI({
-      apiKey: options?.apiKey,
-      baseURL: options?.baseURL,
-    });
-  }
-
-  async chat(params: LLMChatParams): Promise<LLMResponse> {
-    const apiMessages: any[] = [{ role: 'system', content: params.system }];
-    apiMessages.push(...this.convertMessages(params.messages));
-
-    const kwargs: Record<string, unknown> = {
-      model: params.model.modelId,
-      messages: apiMessages,
-      max_tokens: params.model.maxOutputTokens,
-    };
-
-    if (params.model.temperature !== undefined) {
-      kwargs.temperature = params.model.temperature;
-    }
-
-    const apiTools = this.convertTools(params.tools);
-    if (apiTools.length > 0) {
-      kwargs.tools = apiTools;
-    }
-
-    let response: any;
-    try {
-      response = await this.client.chat.completions.create(kwargs);
-    } catch (err: any) {
-      const msg = (err.message ?? '').toLowerCase();
-      const status = err.status ?? err.statusCode;
-
-      if (status === 429 || msg.includes('rate limit')) {
-        throw new RateLimitError(err.message);
-      }
-      if (msg.includes('context length') || msg.includes('maximum context') || status === 413) {
-        throw new ContextTooLargeError(err.message);
-      }
-      if (status === 503 || status === 529) {
-        throw new ServiceOverloadError(err.message);
-      }
-      throw err;
-    }
-
-    return this.parseResponse(response);
-  }
-
-  private convertMessages(messages: Message[]): any[] {
-    const result: any[] = [];
-
-    for (const msg of messages) {
-      if (msg.role === 'user') {
-        result.push({ role: 'user', content: msg.content });
-      } else if (msg.role === 'assistant') {
-        const entry: any = { role: 'assistant' };
-        if (msg.content) entry.content = msg.content;
-        if (msg.toolCalls && msg.toolCalls.length > 0) {
-          entry.tool_calls = msg.toolCalls.map(tc => ({
-            id: tc.id,
-            type: 'function',
-            function: {
-              name: tc.name,
-              arguments: JSON.stringify(tc.arguments),
-            },
-          }));
-        }
-        result.push(entry);
-      } else if (msg.role === 'tool') {
-        result.push({
-          role: 'tool',
-          tool_call_id: msg.toolCallId,
-          content: msg.content,
-        });
-      }
-    }
-
-    return result;
-  }
-
-  private convertTools(tools: ToolDefinition[]): any[] {
-    return tools.map(t => ({
-      type: 'function',
-      function: {
-        name: t.name,
-        description: t.description,
-        parameters: t.parameters,
-      },
-    }));
-  }
-
-  private parseResponse(response: any): LLMResponse {
-    const choice = response.choices[0];
-    const message = choice.message;
-
-    const toolCalls: ToolCall[] = [];
-    if (message.tool_calls) {
-      for (const tc of message.tool_calls) {
-        let args: Record<string, unknown>;
-        try {
-          args = JSON.parse(tc.function.arguments);
-        } catch {
-          args = { _raw: tc.function.arguments };
-        }
-        toolCalls.push({
-          id: tc.id,
-          name: tc.function.name,
-          arguments: args,
-        });
-      }
-    }
-
-    const finishReasonMap: Record<string, StopReason> = {
-      stop: StopReason.EndTurn,
-      tool_calls: StopReason.ToolUse,
-      length: StopReason.MaxTokens,
-    };
-
-    return {
-      text: message.content ?? '',
-      toolCalls,
-      usage: {
-        inputTokens: response.usage?.prompt_tokens ?? 0,
-        outputTokens: response.usage?.completion_tokens ?? 0,
-        cacheReadTokens: 0,
-        cacheWriteTokens: 0,
-      },
-      isTruncated: choice.finish_reason === 'length',
-      stopReason: finishReasonMap[choice.finish_reason] ?? StopReason.EndTurn,
-      model: response.model,
-    };
-  }
-}
-```
-
----
-
-### 4.12 流式响应解析器与工具执行器
-
-```typescript
-// llm/streaming-parser.ts
-
-import {
-  StreamEvent,
-  ToolCall,
-  LLMResponse,
-  TokenUsage,
-  StopReason,
-} from '../types';
-
-interface PendingToolBlock {
-  id: string;
-  name: string;
-  inputJson: string;
-}
-
-/**
- * 流式响应解析器。
- *
- * 核心能力（来自方案 B / Claude Code 的 StreamingToolExecutor）：
- * 当 LLM 还在生成后面的 content block 时，
- * 前面已完成的 tool_use block 可以立即被解析并提交执行。
- *
- * 这不是简单的"等全部完成再解析"，而是边生成边执行。
- */
-export class StreamingParser {
-  private pendingBlocks = new Map<number, PendingToolBlock>();
-  private textParts: string[] = [];
-  private completedToolCalls: ToolCall[] = [];
-  private usage: TokenUsage = {
-    inputTokens: 0,
-    outputTokens: 0,
-    cacheReadTokens: 0,
-    cacheWriteTokens: 0,
-  };
-  private stopReason: StopReason = StopReason.EndTurn;
-
-  /**
-   * 回调：当一个工具调用的输入完整时触发。
-   * 外部可以立即开始执行该工具。
-   */
-  onToolCallReady?: (call: ToolCall) => void;
-
-  /**
-   * 回调：当文本内容到来时触发（用于流式 UI 输出）。
-   */
-  onTextDelta?: (text: string) => void;
-
-  /**
-   * 处理单个流式事件。
-   */
-  processEvent(event: StreamEvent): void {
-    switch (event.type) {
-      case 'content_block_start':
-        if (event.blockType === 'tool_use' && event.toolName && event.toolId) {
-          this.pendingBlocks.set(event.index, {
-            id: event.toolId,
-            name: event.toolName,
-            inputJson: '',
-          });
-        }
-        break;
-
-      case 'content_delta':
-        if (event.partialJson !== undefined) {
-          const block = this.pendingBlocks.get(event.index);
-          if (block) {
-            block.inputJson += event.partialJson;
-          }
-        }
-        if (event.text !== undefined) {
-          this.textParts.push(event.text);
-          this.onTextDelta?.(event.text);
-        }
-        break;
-
-      case 'content_block_stop': {
-        const block = this.pendingBlocks.get(event.index);
-        if (block) {
-          let args: Record<string, unknown>;
-          try {
-            args = JSON.parse(block.inputJson);
-          } catch {
-            args = { _raw: block.inputJson };
-          }
-
-          const call: ToolCall = {
-            id: block.id,
-            name: block.name,
-            arguments: args,
-          };
-
-          this.completedToolCalls.push(call);
-          this.pendingBlocks.delete(event.index);
-
-          // 立即通知外部：这个工具可以开始执行了
-          this.onToolCallReady?.(call);
-        }
-        break;
-      }
-
-      case 'message_stop':
-        this.usage = event.usage;
-        this.stopReason = event.stopReason;
-        break;
-    }
-  }
-
-  /**
-   * 获取最终解析结果（流结束后调用）。
-   */
-  getResponse(): LLMResponse {
-    return {
-      text: this.textParts.join(''),
-      toolCalls: this.completedToolCalls,
-      usage: this.usage,
-      isTruncated: this.stopReason === StopReason.MaxTokens,
-      stopReason: this.stopReason,
-      model: '', // caller fills this
-    };
-  }
-
-  /**
-   * 重置状态（复用解析器实例）
-   */
-  reset(): void {
-    this.pendingBlocks.clear();
-    this.textParts = [];
-    this.completedToolCalls = [];
-    this.usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
-    this.stopReason = StopReason.EndTurn;
-  }
-}
-```
-
----
-
-### 4.13 核心执行循环
-
-```typescript
-// core/execution-loop.ts
-
-import {
-  ILLMGateway,
-  ISession,
-  TaskRequest,
-  TaskResult,
-  ExecutionStep,
-  ToolCall,
-  ToolResult,
-  LLMResponse,
-  HookEvent,
-  ModelConfig,
-  StopReason,
-  SideEffect,
-} from '../types';
-import { ContextManager } from '../context/context-manager';
-import { ToolExecutor } from '../tools/tool-executor';
-import { BudgetController } from './budget-controller';
-import { HookManager } from '../hooks/hook-manager';
-import { BackPressureValidator, BackPressureResult } from '../hooks/back-pressure';
-import { StreamingParser } from '../llm/streaming-parser';
-import {
-  BudgetExhaustedError,
-  RateLimitError,
-  ContextTooLargeError,
-  ServiceOverloadError,
-  MaxRetriesExhaustedError,
-  AbortError,
-} from '../utils/errors';
-
-export interface LoopConfig {
-  maxApiRetries: number;
-  maxTruncationRetries: number;
-  baseRetryDelayMs: number;
-  /** 是否启用流式工具执行（需要 LLM Gateway 支持 chatStream） */
-  enableStreamingExecution: boolean;
-}
-
-const DEFAULT_LOOP_CONFIG: LoopConfig = {
-  maxApiRetries: 5,
-  maxTruncationRetries: 3,
-  baseRetryDelayMs: 1000,
-  enableStreamingExecution: false,
-};
-
-/**
- * 核心 Agent 循环。
- *
- * 综合两套方案的精华：
- * - 方案 A：完整错误分级重试、多维预算控制、async generator 逐步消费
- * - 方案 B：流式工具执行、异常回馈、反压验证、渐进式暴露
- *
- * 循环不变式：
- * 1. 每轮开始前检查预算
- * 2. 每轮开始前检查是否需要上下文压缩
- * 3. LLM 返回工具调用 → 执行工具 → 结果喂回 → 继续循环
- * 4. LLM 返回纯文本 → 反压验证 → 通过则退出循环
- * 5. 所有工具异常包装为 ToolResult 喂回 LLM，不向外传播
- */
-export class ExecutionLoop {
-  private config: LoopConfig;
-  private abortController: AbortController | null = null;
-
-  constructor(
-    private llm: ILLMGateway,
-    private context: ContextManager,
-    private tools: ToolExecutor,
-    private budget: BudgetController,
-    private hooks: HookManager,
-    private backPressure: BackPressureValidator | null,
-    config: Partial<LoopConfig> = {},
-  ) {
-    this.config = { ...DEFAULT_LOOP_CONFIG, ...config };
-  }
-
-  /**
-   * 执行任务，返回最终结果。
-   */
-  async run(session: ISession): Promise<TaskResult> {
-    this.abortController = new AbortController();
-
-    await this.hooks.emit(HookEvent.TaskStart, { task: session.task });
-
-    try {
-      for await (const step of this.loop(session)) {
-        await this.hooks.emit(HookEvent.StepComplete, { step });
-      }
-      return session.buildResult();
-    } catch (err) {
-      if (err instanceof BudgetExhaustedError) {
-        await this.hooks.emit(HookEvent.BudgetExhausted, {
-          resource: err.resource,
-          used: err.used,
-          limit: err.limit,
-        });
-        return session.buildPartialResult(err.message);
-      }
-      if (err instanceof AbortError) {
-        return session.buildPartialResult('Execution aborted by user');
-      }
-      throw err;
-    } finally {
-      await this.hooks.emit(HookEvent.TaskEnd, { result: session.buildResult() });
-      this.abortController = null;
-    }
-  }
-
-  /**
-   * 中止执行
-   */
-  abort(): void {
-    this.abortController?.abort();
-  }
-
-  /**
-   * 核心循环，作为 async generator 逐步产出执行步骤。
-   */
-  private async *loop(session: ISession): AsyncGenerator<ExecutionStep> {
-    while (true) {
-      this.checkAborted();
-
-      // 1. 预算检查
-      this.budget.checkOrThrow(session.usage);
-
-      // 2. 上下文压缩（如需要）
-      await this.context.maybeCompress(session);
-
-      // 3. 构造上下文
-      const systemPrompt = this.context.buildSystemPrompt(session);
-      const messages = this.context.buildMessages(session);
-      const availableTools = this.tools.getToolDefinitions(session);
-
-      // 4. 调用 LLM（带重试和降级）
-      const response = await this.callLLMWithRetry(
-        systemPrompt,
-        messages,
-        availableTools,
-        session,
-      );
-
-      // 5. 记录响应
-      session.recordLLMResponse(response);
-
-      // 6. 解析决策
-      const toolCalls = response.toolCalls;
-
-      if (toolCalls.length === 0) {
-        // LLM 给出了最终回复
-
-        // 6a. 反压验证：在返回最终结果前检查
-        const bpResult = await this.runFinalBackPressure(session);
-        if (bpResult) {
-          // 验证失败：将错误注入消息历史，让 LLM 继续修正
-          session.recordToolResults([{
-            callId: '__backpressure__',
-            output: [
-              `[Back-pressure verification failed: ${bpResult.ruleName}]`,
-              '',
-              'The following errors were found. Please fix them before completing:',
-              '',
-              bpResult.errorMessage,
-            ].join('\n'),
-            isError: true,
-          }]);
-
-          yield {
-            type: 'tool_execution',
-            content: `Back-pressure check failed: ${bpResult.ruleName}`,
-            timestamp: Date.now(),
-          };
-
-          // 继续循环，让 LLM 处理错误
-          continue;
-        }
-
-        yield {
-          type: 'final_response',
-          content: response.text,
-          timestamp: Date.now(),
-        };
-        return;
-      }
-
-      // 7. 执行工具调用
-      let results: ToolResult[];
-
-      if (this.config.enableStreamingExecution && this.llm.chatStream) {
-        // 流式执行模式已经在 callLLMWithRetry 内部处理了
-        // 这里走普通批量执行
-        results = await this.tools.executeBatch(toolCalls, session);
-      } else {
-        results = await this.tools.executeBatch(toolCalls, session);
-      }
-
-      // 8. 记录工具结果
-      session.recordToolResults(results);
-
-      // 8a. 工具执行后的反压检查
-      for (const call of toolCalls) {
-        const bpResult = await this.runToolBackPressure(call.name, session);
-        if (bpResult) {
-          // 将反压错误也注入消息历史
-          session.recordToolResults([{
-            callId: '__backpressure_post_tool__',
-            output: [
-              `[Post-tool verification failed: ${bpResult.ruleName}]`,
-              bpResult.errorMessage,
-            ].join('\n'),
-            isError: true,
-          }]);
-        }
-      }
-
-      yield {
-        type: 'tool_execution',
-        toolCalls,
-        toolResults: results,
-        timestamp: Date.now(),
-      };
-    }
-  }
-
-  /**
-   * 带重试和降级的 LLM 调用。
-   *
-   * 错误分级处理（来自方案 A / Claude Code）：
-   * - 429 RateLimit     → 指数退避重试（尊重 Retry-After header）
-   * - 413 ContextTooLarge → 强制压缩后重试
-   * - 529 ServiceOverload → 切换 fallback 模型
-   * - MaxTokens 截断    → 静默重试（最多 N 次）
-   */
-  private async callLLMWithRetry(
-    systemPrompt: string,
-    messages: any[],
-    tools: any[],
-    session: ISession,
-  ): Promise<LLMResponse> {
-    let currentMessages = messages;
-
-    for (let attempt = 0; attempt < this.config.maxApiRetries; attempt++) {
-      this.checkAborted();
-
-      await this.hooks.emit(HookEvent.LLMCallStart, {
-        model: session.currentModel.modelId,
-        messageCount: currentMessages.length,
-      });
-
-      try {
-        const response = await this.llm.chat({
-          system: systemPrompt,
-          messages: currentMessages,
-          tools,
-          model: session.currentModel,
-        });
-
-        await this.hooks.emit(HookEvent.LLMCallEnd, {
-          model: session.currentModel.modelId,
-          usage: response.usage,
-          stopReason: response.stopReason,
-        });
-
-        // 处理输出截断
-        if (response.isTruncated) {
-          session.recordTruncation();
-          if (session.truncationCount <= this.config.maxTruncationRetries) {
-            await this.hooks.emit(HookEvent.LLMRetry, {
-              attempt: attempt + 1,
-              reason: 'Output truncated (max_tokens reached)',
-              delayMs: 0,
-            });
-            continue;
-          }
-          // 超过截断重试次数，接受不完整响应
-        }
-
-        return response;
-
-      } catch (err) {
-        if (err instanceof RateLimitError) {
-          const delay = err.retryAfterMs ??
-            this.config.baseRetryDelayMs * Math.pow(2, attempt);
-
-          await this.hooks.emit(HookEvent.LLMRetry, {
-            attempt: attempt + 1,
-            reason: `Rate limited (429)`,
-            delayMs: delay,
-          });
-
-          await this.sleep(delay);
-          continue;
-        }
-
-        if (err instanceof ContextTooLargeError) {
-          await this.hooks.emit(HookEvent.LLMRetry, {
-            attempt: attempt + 1,
-            reason: 'Context too large (413), compressing...',
-            delayMs: 0,
-          });
-
-          await this.context.forceCompress(session);
-          currentMessages = this.context.buildMessages(session);
-          continue;
-        }
-
-        if (err instanceof ServiceOverloadError) {
-          const previousModel = session.currentModel.modelId;
-          session.switchToFallbackModel();
-
-          await this.hooks.emit(HookEvent.LLMFallback, {
-            from: previousModel,
-            to: session.currentModel.modelId,
-            reason: 'Service overloaded (529)',
-          });
-
-          continue;
-        }
-
-        // 未知错误，不重试
-        throw err;
-      }
-    }
-
-    throw new MaxRetriesExhaustedError(this.config.maxApiRetries);
-  }
-
-  /**
-   * 最终回复前的反压验证
-   */
-  private async runFinalBackPressure(session: ISession): Promise<BackPressureResult | null> {
-    if (!this.backPressure) return null;
-    return this.backPressure.checkBeforeFinal(session);
-  }
-
-  /**
-   * 工具执行后的反压验证
-   */
-  private async runToolBackPressure(
-    toolName: string,
-    session: ISession,
-  ): Promise<BackPressureResult | null> {
-    if (!this.backPressure) return null;
-    return this.backPressure.checkAfterTool(toolName, session);
-  }
-
-  private checkAborted(): void {
-    if (this.abortController?.signal.aborted) {
-      throw new AbortError();
-    }
-  }
-
-  private sleep(ms: number): Promise<void> {
-    return new Promise(resolve => setTimeout(resolve, ms));
-  }
-}
-```
-
----
-
-### 4.14 编排器
-
-```typescript
-// orchestrators/base.ts
-
-import {
-  IOrchestrator,
-  IExecutionContext,
-  TaskResult,
-  OrchestratorType,
-  ExecutionStatus,
-  HookEvent,
-} from '../types';
-import { HookManager } from '../hooks/hook-manager';
-
-/**
- * 编排器基类。
- *
- * 来自 llm-kernel 的通用编排概念：
- * 让多个执行器（Agent / HTTP / Script）按不同模式协作。
- *
- * 综合方案保留了这个强大的编排层，
- * 同时在 AgentExecutor 内部用 ExecutionLoop 实现了自主多轮循环。
- */
-export abstract class BaseOrchestrator implements IOrchestrator {
-  abstract readonly type: OrchestratorType;
-  protected aborted = false;
-
-  constructor(protected hooks: HookManager) {}
-
-  abstract execute(context: IExecutionContext): Promise<TaskResult>;
-
-  abort(): void {
-    this.aborted = true;
-  }
-
-  /**
-   * 合并多个子结果为一个总结果
-   */
-  protected mergeResults(results: TaskResult[]): TaskResult {
-    const allCompleted = results.every(r => r.status === ExecutionStatus.Completed);
-    const totalUsage = results.reduce(
-      (acc, r) => ({
-        turns: acc.turns + r.usage.turns,
-        inputTokens: acc.inputTokens + r.usage.inputTokens,
-        outputTokens: acc.outputTokens + r.usage.outputTokens,
-        costUsd: acc.costUsd + r.usage.costUsd,
-        elapsedMs: Math.max(acc.elapsedMs, r.usage.elapsedMs),
-        toolCalls: acc.toolCalls + r.usage.toolCalls,
-        startTime: Math.min(acc.startTime, r.usage.startTime),
-      }),
-      {
-        turns: 0,
-        inputTokens: 0,
-        outputTokens: 0,
-        costUsd: 0,
-        elapsedMs: 0,
-        toolCalls: 0,
-        startTime: Date.now(),
-      },
-    );
-
-    return {
-      sessionId: results[0]?.sessionId ?? 'orchestrated',
-      status: allCompleted ? ExecutionStatus.Completed : ExecutionStatus.Partial,
-      response: results.map(r => r.response).join('\n\n---\n\n'),
-      usage: totalUsage,
-      turns: totalUsage.turns,
-    };
-  }
-}
-```
-
-```typescript
-// orchestrators/serial.ts
-
-import { BaseOrchestrator } from './base';
-import {
-  IExecutionContext,
-  TaskResult,
-  OrchestratorType,
-  OrchestratorNode,
-  ExecutionStatus,
-  HookEvent,
-} from '../types';
-import { HookManager } from '../hooks/hook-manager';
-import { ExpressionEvaluator } from '../utils/expressions';
-
-export interface SerialOrchestratorConfig {
-  nodes: OrchestratorNode[];
-  /** 某节点失败时是否继续执行后续节点 */
-  continueOnError: boolean;
-}
-
-/**
- * 串行编排器：按顺序执行子节点。
- */
-export class SerialOrchestrator extends BaseOrchestrator {
-  readonly type = OrchestratorType.Serial;
-
-  constructor(
-    private config: SerialOrchestratorConfig,
-    private executorFactory: IExecutorFactory,
-    hooks: HookManager,
-  ) {
-    super(hooks);
-  }
-
-  async execute(context: IExecutionContext): Promise<TaskResult> {
-    await this.hooks.emit(HookEvent.OrchestratorStart, {
-      type: 'serial',
-      nodeCount: this.config.nodes.length,
-    });
-
-    const results: TaskResult[] = [];
-
-    for (const node of this.config.nodes) {
-      if (this.aborted) break;
-
-      const executor = this.executorFactory.create(node);
-      const input = ExpressionEvaluator.interpolate(
-        String(node.config.input ?? ''),
-        context.variables,
-      );
-
-      try {
-        const result = await executor.execute(input, context);
-        results.push(result);
-
-        // 将结果存入上下文变量，供后续节点使用
-        context.variables.set(`${node.id}.result`, result.response);
-        context.variables.set(`${node.id}.status`, result.status);
-
-      } catch (err: any) {
-        const failedResult: TaskResult = {
-          sessionId: node.id,
-          status: ExecutionStatus.Failed,
-          response: err.message,
-          usage: { turns: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, elapsedMs: 0, toolCalls: 0, startTime: Date.now() },
-          turns: 0,
-        };
-
-        results.push(failedResult);
-        context.variables.set(`${node.id}.status`, 'failed');
-        context.variables.set(`${node.id}.error`, err.message);
-
-        if (!this.config.continueOnError) {
-          break;
-        }
-      }
-    }
-
-    const merged = this.mergeResults(results);
-
-    await this.hooks.emit(HookEvent.OrchestratorComplete, {
-      type: 'serial',
-      result: merged,
-    });
-
-    return merged;
-  }
-}
-```
-
-```typescript
-// orchestrators/parallel.ts
-
-import { BaseOrchestrator } from './base';
-import {
-  IExecutionContext,
-  TaskResult,
-  OrchestratorType,
-  OrchestratorNode,
-  ExecutionStatus,
-  HookEvent,
-  MergeStrategy,
-} from '../types';
-import { HookManager } from '../hooks/hook-manager';
-
-export interface ParallelOrchestratorConfig {
-  nodes: OrchestratorNode[];
-  maxConcurrency: number;
-  mergeStrategy: MergeStrategy;
-}
-
-/**
- * 并行编排器：并发执行子节点，受并发度限制。
- *
- * 来自 llm-kernel 的设计，保留并发控制和多种合并策略。
- */
-export class ParallelOrchestrator extends BaseOrchestrator {
-  readonly type = OrchestratorType.Parallel;
-
-  constructor(
-    private config: ParallelOrchestratorConfig,
-    private executorFactory: IExecutorFactory,
-    hooks: HookManager,
-  ) {
-    super(hooks);
-  }
-
-  async execute(context: IExecutionContext): Promise<TaskResult> {
-    await this.hooks.emit(HookEvent.OrchestratorStart, {
-      type: 'parallel',
-      nodeCount: this.config.nodes.length,
-    });
-
-    const results = await this.executeWithConcurrencyLimit(context);
-
-    let finalResult: TaskResult;
-
-    switch (this.config.mergeStrategy) {
-      case 'first': {
-        const firstSuccess = results.find(r => r.status === ExecutionStatus.Completed);
-        finalResult = firstSuccess ?? results[0];
-        break;
-      }
-      case 'all':
-      default:
-        finalResult = this.mergeResults(results);
-        break;
-    }
-
-    await this.hooks.emit(HookEvent.OrchestratorComplete, {
-      type: 'parallel',
-      result: finalResult,
-    });
-
-    return finalResult;
-  }
-
-  private async executeWithConcurrencyLimit(
-    context: IExecutionContext,
-  ): Promise<TaskResult[]> {
-    const { nodes, maxConcurrency } = this.config;
-    const results: TaskResult[] = new Array(nodes.length);
-    let nextIndex = 0;
-
-    const runNext = async (): Promise<void> => {
-      while (nextIndex < nodes.length && !this.aborted) {
-        const idx = nextIndex++;
-        const node = nodes[idx];
-        const executor = this.executorFactory.create(node);
-
-        try {
-          results[idx] = await executor.execute(
-            context.variables.get(`${node.id}.input`) ?? '',
-            context,
-          );
-        } catch (err: any) {
-          results[idx] = {
-            sessionId: node.id,
-            status: ExecutionStatus.Failed,
-            response: err.message,
-            usage: {
-              turns: 0, inputTokens: 0, outputTokens: 0,
-              costUsd: 0, elapsedMs: 0, toolCalls: 0,
-              startTime: Date.now(),
-            },
-            turns: 0,
-          };
-        }
-
-        context.variables.set(`${node.id}.status`, results[idx].status);
-      }
-    };
-
-    // 启动 maxConcurrency 个并行工作线程
-    const workers = Array.from(
-      { length: Math.min(maxConcurrency, nodes.length) },
-      () => runNext(),
-    );
-
-    await Promise.all(workers);
-    return results;
-  }
-}
-```
-
-```typescript
-// orchestrators/router.ts
-
-import { BaseOrchestrator } from './base';
-import {
-  IExecutionContext,
-  TaskResult,
-  OrchestratorType,
-  OrchestratorNode,
-  RouteRule,
-  ExecutionStatus,
-  HookEvent,
-} from '../types';
-import { HookManager } from '../hooks/hook-manager';
-import { ExpressionEvaluator } from '../utils/expressions';
-
-export interface RouterOrchestratorConfig {
-  nodes: OrchestratorNode[];
-  rules: RouteRule[];
-  /** 没有匹配规则时使用的默认节点 ID */
-  defaultNodeId?: string;
-}
-
-/**
- * 路由编排器：根据条件选择执行路径。
- *
- * 来自 llm-kernel 的设计，支持规则路由。
- * LLM 路由可以通过将一个 AgentExecutor 作为路由器节点来实现。
- */
-export class RouterOrchestrator extends BaseOrchestrator {
-  readonly type = OrchestratorType.Router;
-
-  constructor(
-    private config: RouterOrchestratorConfig,
-    private executorFactory: IExecutorFactory,
-    hooks: HookManager,
-  ) {
-    super(hooks);
-  }
-
-  async execute(context: IExecutionContext): Promise<TaskResult> {
-    await this.hooks.emit(HookEvent.OrchestratorStart, {
-      type: 'router',
-      nodeCount: this.config.nodes.length,
-    });
-
-    const targetNode = this.selectTarget(context);
-
-    if (!targetNode) {
-      return {
-        sessionId: 'router',
-        status: ExecutionStatus.Failed,
-        response: 'No matching route found.',
-        usage: {
-          turns: 0, inputTokens: 0, outputTokens: 0,
-          costUsd: 0, elapsedMs: 0, toolCalls: 0,
-          startTime: Date.now(),
-        },
-        turns: 0,
-        incompleteReason: 'No matching route',
-      };
-    }
-
-    const executor = this.executorFactory.create(targetNode);
-    const input = context.variables.get('input') ?? '';
-    const result = await executor.execute(input, context);
-
-    await this.hooks.emit(HookEvent.OrchestratorComplete, {
-      type: 'router',
-      result,
-    });
-
-    return result;
-  }
-
-  private selectTarget(context: IExecutionContext): OrchestratorNode | undefined {
-    for (const rule of this.config.rules) {
-      if (ExpressionEvaluator.evaluate(rule.condition, context.variables)) {
-        return this.config.nodes.find(n => n.id === rule.target);
-      }
-    }
-
-    // Fallback to default
-    if (this.config.defaultNodeId) {
-      return this.config.nodes.find(n => n.id === this.config.defaultNodeId);
-    }
-
-    // Fallback to first node
-    return this.config.nodes[0];
-  }
-}
-```
-
-```typescript
-// orchestrators/loop.ts
-
-import { BaseOrchestrator } from './base';
-import {
-  IExecutionContext,
-  TaskResult,
-  OrchestratorType,
-  OrchestratorNode,
-  ExecutionStatus,
-  HookEvent,
-} from '../types';
-import { HookManager } from '../hooks/hook-manager';
-import { ExpressionEvaluator } from '../utils/expressions';
-
-export interface LoopOrchestratorConfig {
-  nodes: OrchestratorNode[];
-  maxIterations: number;
-  /** 退出条件表达式，返回 true 时退出循环 */
-  exitCondition?: string;
-  /** 是否收集每次迭代的结果 */
-  collectResults: boolean;
-  /** 迭代间延迟 (ms) */
-  iterationDelayMs: number;
-}
-
-/**
- * 循环编排器：重复执行子节点直到满足退出条件。
- *
- * 来自 llm-kernel 的设计。
- * 注意：这不同于 ExecutionLoop 中的 Agent 循环。
- * Agent 循环是"LLM 自主决策工具调用"，
- * 这个是"预定义的编排循环"。
- */
-export class LoopOrchestrator extends BaseOrchestrator {
-  readonly type = OrchestratorType.Loop;
-
-  constructor(
-    private config: LoopOrchestratorConfig,
-    private executorFactory: IExecutorFactory,
-    hooks: HookManager,
-  ) {
-    super(hooks);
-  }
-
-  async execute(context: IExecutionContext): Promise<TaskResult> {
-    await this.hooks.emit(HookEvent.OrchestratorStart, {
-      type: 'loop',
-      nodeCount: this.config.nodes.length,
-    });
-
-    const allResults: TaskResult[] = [];
-    let lastResult: TaskResult | null = null;
-
-    for (let iteration = 0; iteration < this.config.maxIterations; iteration++) {
-      if (this.aborted) break;
-
-      // 注入迭代变量
-      context.variables.set('_iteration', iteration);
-      context.variables.set('_isFirstIteration', iteration === 0);
-      context.variables.set('_isLastIteration', iteration === this.config.maxIterations - 1);
-
-      // 串行执行所有子节点
-      for (const node of this.config.nodes) {
-        if (this.aborted) break;
-
-        const executor = this.executorFactory.create(node);
-        const input = lastResult?.response ?? context.variables.get('input') ?? '';
-
-        try {
-          lastResult = await executor.execute(input, context);
-          context.variables.set(`${node.id}.result`, lastResult.response);
-
-          if (lastResult.status === ExecutionStatus.Failed) {
-            // 子节点失败，退出循环
-            if (this.config.collectResults) allResults.push(lastResult);
-            const merged = this.mergeResults(allResults.length > 0 ? allResults : [lastResult]);
-            await this.hooks.emit(HookEvent.OrchestratorComplete, { type: 'loop', result: merged });
-            return merged;
-          }
-        } catch (err: any) {
-          lastResult = {
-            sessionId: node.id,
-            status: ExecutionStatus.Failed,
-            response: err.message,
-            usage: {
-              turns: 0, inputTokens: 0, outputTokens: 0,
-              costUsd: 0, elapsedMs: 0, toolCalls: 0,
-              startTime: Date.now(),
-            },
-            turns: 0,
-          };
-          if (this.config.collectResults) allResults.push(lastResult);
-          const merged = this.mergeResults(allResults.length > 0 ? allResults : [lastResult]);
-          await this.hooks.emit(HookEvent.OrchestratorComplete, { type: 'loop', result: merged });
-          return merged;
-        }
-      }
-
-      if (this.config.collectResults && lastResult) {
-        allResults.push(lastResult);
-      }
-
-      // 检查退出条件
-      if (this.config.exitCondition) {
-        context.variables.set('_output', lastResult?.response ?? '');
-        const shouldExit = ExpressionEvaluator.evaluate(
-          this.config.exitCondition,
-          context.variables,
-        );
-        if (shouldExit) break;
-      }
-
-      // 迭代间延迟
-      if (this.config.iterationDelayMs > 0 && iteration < this.config.maxIterations - 1) {
-        await new Promise(resolve => setTimeout(resolve, this.config.iterationDelayMs));
-      }
-    }
-
-    const finalResult = this.config.collectResults
-      ? this.mergeResults(allResults)
-      : lastResult ?? {
-          sessionId: 'loop',
-          status: ExecutionStatus.Completed,
-          response: '',
-          usage: {
-            turns: 0, inputTokens: 0, outputTokens: 0,
-            costUsd: 0, elapsedMs: 0, toolCalls: 0,
-            startTime: Date.now(),
-          },
-          turns: 0,
-        };
-
-    await this.hooks.emit(HookEvent.OrchestratorComplete, { type: 'loop', result: finalResult });
-    return finalResult;
-  }
-}
-```
-
-```typescript
-// orchestrators/dag.ts
-
-import { BaseOrchestrator } from './base';
-import {
-  IExecutionContext,
-  IExecutor,
-  TaskResult,
-  OrchestratorType,
-  OrchestratorNode,
-  DAGEdge,
-  ExecutionStatus,
-  HookEvent,
-} from '../types';
-import { HookManager } from '../hooks/hook-manager';
-
-type DAGNodeState = 'pending' | 'ready' | 'running' | 'completed' | 'failed' | 'skipped';
-
-interface DAGRuntimeNode {
-  definition: OrchestratorNode;
-  state: DAGNodeState;
-  dependencies: string[];
-  dependents: string[];
-  result?: TaskResult;
-}
-
-export interface DAGOrchestratorConfig {
-  nodes: OrchestratorNode[];
-  edges: DAGEdge[];
-  maxConcurrency: number;
-}
-
-/**
- * DAG 编排器：有向无环图执行。
- *
- * 完全保留 llm-kernel 的实现逻辑，包括：
- * - 拓扑排序与环检测
- * - 并发执行（respecting 依赖关系）
- * - 失败节点跳过下游
- * - 多依赖节点的输入合并
- */
-export class DAGOrchestrator extends BaseOrchestrator {
-  readonly type = OrchestratorType.DAG;
-
-  constructor(
-    private config: DAGOrchestratorConfig,
-    private executorFactory: IExecutorFactory,
-    hooks: HookManager,
-  ) {
-    super(hooks);
-  }
-
-  async execute(context: IExecutionContext): Promise<TaskResult> {
-    await this.hooks.emit(HookEvent.OrchestratorStart, {
-      type: 'dag',
-      nodeCount: this.config.nodes.length,
-    });
-
-    // 1. 构建运行时图
-    const nodeMap = this.buildNodeMap();
-
-    // 2. 环检测
-    if (this.hasCycle(nodeMap)) {
-      return {
-        sessionId: 'dag',
-        status: ExecutionStatus.Failed,
-        response: 'DAG contains cycles',
-        usage: {
-          turns: 0, inputTokens: 0, outputTokens: 0,
-          costUsd: 0, elapsedMs: 0, toolCalls: 0,
-          startTime: Date.now(),
-        },
-        turns: 0,
-        incompleteReason: 'Invalid DAG: cycles detected',
-      };
-    }
-
-    // 3. 执行 DAG
-    await this.executeDAG(nodeMap, context);
-
-    // 4. 收集终端节点结果
-    const endNodeIds = this.findEndNodes(nodeMap);
-    const endResults = endNodeIds
-      .map(id => nodeMap.get(id)?.result)
-      .filter((r): r is TaskResult => r != null);
-
-    const hasFailure = Array.from(nodeMap.values()).some(n => n.state === 'failed');
-
-    const finalResult: TaskResult = {
-      sessionId: 'dag',
-      status: hasFailure ? ExecutionStatus.Partial : ExecutionStatus.Completed,
-      response: endResults.length === 1
-        ? endResults[0].response
-        : JSON.stringify(endResults.map(r => r.response)),
-      usage: this.mergeUsages(endResults),
-      turns: endResults.reduce((sum, r) => sum + r.turns, 0),
-    };
-
-    await this.hooks.emit(HookEvent.OrchestratorComplete, { type: 'dag', result: finalResult });
-    return finalResult;
-  }
-
-  private buildNodeMap(): Map<string, DAGRuntimeNode> {
-    const map = new Map<string, DAGRuntimeNode>();
-
-    for (const node of this.config.nodes) {
-      map.set(node.id, {
-        definition: node,
-        state: 'pending',
-        dependencies: [],
-        dependents: [],
-      });
-    }
-
-    for (const edge of this.config.edges) {
-      const from = map.get(edge.from);
-      const to = map.get(edge.to);
-      if (from && to) {
-        from.dependents.push(edge.to);
-        to.dependencies.push(edge.from);
-      }
-    }
-
-    // Mark nodes with no dependencies as ready
-    for (const node of map.values()) {
-      if (node.dependencies.length === 0) {
-        node.state = 'ready';
-      }
-    }
-
-    return map;
-  }
-
-  private hasCycle(nodeMap: Map<string, DAGRuntimeNode>): boolean {
-    const visited = new Set<string>();
-    const stack = new Set<string>();
-
-    const dfs = (id: string): boolean => {
-      visited.add(id);
-      stack.add(id);
-      const node = nodeMap.get(id);
-      if (!node) return false;
-
-      for (const depId of node.dependents) {
-        if (!visited.has(depId)) {
-          if (dfs(depId)) return true;
-        } else if (stack.has(depId)) {
-          return true;
-        }
-      }
-
-      stack.delete(id);
-      return false;
-    };
-
-    for (const id of nodeMap.keys()) {
-      if (!visited.has(id) && dfs(id)) return true;
-    }
-    return false;
-  }
-
-  private findEndNodes(nodeMap: Map<string, DAGRuntimeNode>): string[] {
-    return Array.from(nodeMap.entries())
-      .filter(([, node]) => node.dependents.length === 0)
-      .map(([id]) => id);
-  }
-
-  private async executeDAG(
-    nodeMap: Map<string, DAGRuntimeNode>,
-    context: IExecutionContext,
-  ): Promise<void> {
-    const running = new Set<string>();
-
-    while (true) {
-      if (this.aborted) break;
-
-      const readyIds = Array.from(nodeMap.entries())
-        .filter(([id, node]) => node.state === 'ready' && !running.has(id))
-        .map(([id]) => id);
-
-      if (readyIds.length === 0 && running.size === 0) break;
-
-      const toStart = readyIds.slice(0, this.config.maxConcurrency - running.size);
-
-      const promises = toStart.map(async (nodeId) => {
-        running.add(nodeId);
-        const runtimeNode = nodeMap.get(nodeId)!;
-        runtimeNode.state = 'running';
-
-        try {
-          const input = this.collectInputs(nodeId, nodeMap, context);
-          const executor = this.executorFactory.create(runtimeNode.definition);
-          const result = await executor.execute(input, context);
-
-          runtimeNode.result = result;
-          runtimeNode.state = result.status === ExecutionStatus.Completed ? 'completed' : 'failed';
-
-          context.variables.set(`_output_${nodeId}`, result.response);
-
-          if (runtimeNode.state === 'completed') {
-            this.promoteReadyDependents(nodeId, nodeMap);
-          } else {
-            this.skipDependents(nodeId, nodeMap);
-          }
-        } catch (err: any) {
-          runtimeNode.state = 'failed';
-          runtimeNode.result = {
-            sessionId: nodeId,
-            status: ExecutionStatus.Failed,
-            response: err.message,
-            usage: {
-              turns: 0, inputTokens: 0, outputTokens: 0,
-              costUsd: 0, elapsedMs: 0, toolCalls: 0,
-              startTime: Date.now(),
-            },
-            turns: 0,
-          };
-          this.skipDependents(nodeId, nodeMap);
-        } finally {
-          running.delete(nodeId);
-        }
-      });
-
-      if (promises.length > 0) {
-        await Promise.race(promises);
-      } else if (running.size > 0) {
-        await new Promise(resolve => setTimeout(resolve, 10));
-      }
-    }
-  }
-
-  private collectInputs(
-    nodeId: string,
-    nodeMap: Map<string, DAGRuntimeNode>,
-    context: IExecutionContext,
-  ): string {
-    const node = nodeMap.get(nodeId)!;
-
-    if (node.dependencies.length === 0) {
-      return String(context.variables.get('input') ?? '');
-    }
-
-    if (node.dependencies.length === 1) {
-      return String(context.variables.get(`_output_${node.dependencies[0]}`) ?? '');
-    }
-
-    const merged: Record<string, unknown> = {};
-    for (const depId of node.dependencies) {
-      merged[depId] = context.variables.get(`_output_${depId}`);
-    }
-    return JSON.stringify(merged);
-  }
-
-  private promoteReadyDependents(
-    completedId: string,
-    nodeMap: Map<string, DAGRuntimeNode>,
-  ): void {
-    const completed = nodeMap.get(completedId)!;
-    for (const depId of completed.dependents) {
-      const dep = nodeMap.get(depId);
-      if (!dep || dep.state !== 'pending') continue;
-
-      const allDepsComplete = dep.dependencies.every(
-        d => nodeMap.get(d)?.state === 'completed',
-      );
-      if (allDepsComplete) dep.state = 'ready';
-    }
-  }
-
-  private skipDependents(
-    failedId: string,
-    nodeMap: Map<string, DAGRuntimeNode>,
-  ): void {
-    const queue = [failedId];
-    const visited = new Set<string>();
-
-    while (queue.length > 0) {
-      const id = queue.shift()!;
-      const node = nodeMap.get(id);
-      if (!node) continue;
-
-      for (const depId of node.dependents) {
-        if (visited.has(depId)) continue;
-        visited.add(depId);
-
-        const dep = nodeMap.get(depId);
-        if (dep && (dep.state === 'pending' || dep.state === 'ready')) {
-          dep.state = 'skipped';
-          queue.push(depId);
-        }
-      }
-    }
-  }
-
-  private mergeUsages(results: TaskResult[]): TaskResult['usage'] {
-    return {
-      turns: results.reduce((s, r) => s + (r.usage?.turns ?? 0), 0),
-      inputTokens: results.reduce((s, r) => s + (r.usage?.inputTokens ?? 0), 0),
-      outputTokens: results.reduce((s, r) => s + (r.usage?.outputTokens ?? 0), 0),
-      costUsd: results.reduce((s, r) => s + (r.usage?.costUsd ?? 0), 0),
-      elapsedMs: Math.max(...results.map(r => r.usage?.elapsedMs ?? 0)),
-      toolCalls: results.reduce((s, r) => s + (r.usage?.toolCalls ?? 0), 0),
-      startTime: Math.min(...results.map(r => r.usage?.startTime ?? Date.now())),
-    };
-  }
-}
-```
-
-```typescript
-// orchestrators/index.ts
-
-export { BaseOrchestrator } from './base';
-export { SerialOrchestrator } from './serial';
-export type { SerialOrchestratorConfig } from './serial';
-export { ParallelOrchestrator } from './parallel';
-export type { ParallelOrchestratorConfig } from './parallel';
-export { RouterOrchestrator } from './router';
-export type { RouterOrchestratorConfig } from './router';
-export { LoopOrchestrator } from './loop';
-export type { LoopOrchestratorConfig } from './loop';
-export { DAGOrchestrator } from './dag';
-export type { DAGOrchestratorConfig } from './dag';
-
-import type { IExecutor, IExecutorFactory, OrchestratorNode } from '../types';
-import type { HookManager } from '../hooks/hook-manager';
-import { OrchestratorType } from '../types';
-import { SerialOrchestrator } from './serial';
-import { ParallelOrchestrator } from './parallel';
-import { RouterOrchestrator } from './router';
-import { LoopOrchestrator } from './loop';
-import { DAGOrchestrator } from './dag';
-
-/**
- * 编排器工厂注册表。
- *
- * 与 llm-kernel 的 OrchestratorRegistry 等价，
- * 但遵循综合方案的 DIP 原则——通过接口注入而非全局单例。
- */
-export type OrchestratorCreator = (config: any, factory: IExecutorFactory, hooks: HookManager) => IExecutor;
-
-export class OrchestratorRegistry {
-  private creators = new Map<string, OrchestratorCreator>();
-
-  constructor() {
-    this.registerBuiltins();
-  }
-
-  private registerBuiltins(): void {
-    this.register(OrchestratorType.Serial, (config, factory, hooks) =>
-      new SerialOrchestrator(config, factory, hooks),
-    );
-    this.register(OrchestratorType.Parallel, (config, factory, hooks) =>
-      new ParallelOrchestrator(config, factory, hooks),
-    );
-    this.register(OrchestratorType.Router, (config, factory, hooks) =>
-      new RouterOrchestrator(config, factory, hooks),
-    );
-    this.register(OrchestratorType.Loop, (config, factory, hooks) =>
-      new LoopOrchestrator(config, factory, hooks),
-    );
-    this.register(OrchestratorType.DAG, (config, factory, hooks) =>
-      new DAGOrchestrator(config, factory, hooks),
-    );
-  }
-
-  register(type: string, creator: OrchestratorCreator): void {
-    this.creators.set(type, creator);
-  }
-
-  create(type: string, config: any, factory: IExecutorFactory, hooks: HookManager): IExecutor {
-    const creator = this.creators.get(type);
-    if (!creator) throw new Error(`Unknown orchestrator type: ${type}`);
-    return creator(config, factory, hooks);
-  }
-
-  supports(type: string): boolean {
-    return this.creators.has(type);
-  }
-
-  getRegisteredTypes(): string[] {
-    return Array.from(this.creators.keys());
-  }
-}
-```
-
-```typescript
-// utils/expressions.ts
-
-/**
- * 极简表达式求值器。
- *
- * 用于编排器的路由条件和循环退出条件。
- * 支持：contains:xxx, startsWith:xxx, equals:xxx, regex:xxx
- * 以及简单的 JS 表达式（变量来自 context.variables）。
- *
- * 生产环境应替换为更安全的沙箱实现。
- */
-export class ExpressionEvaluator {
-  static evaluate(expression: string, variables: Map<string, unknown> | ContextVariableAccessor): boolean {
-    const vars = variables instanceof Map
-      ? Object.fromEntries(variables)
-      : typeof (variables as any).toObject === 'function'
-        ? (variables as any).toObject()
-        : {};
-
-    const input = String(vars['input'] ?? vars['_output'] ?? '');
-
-    // 简单前缀匹配
-    if (expression.startsWith('contains:')) {
-      return input.toLowerCase().includes(expression.slice(9).trim().toLowerCase());
-    }
-    if (expression.startsWith('startsWith:')) {
-      return input.startsWith(expression.slice(11).trim());
-    }
-    if (expression.startsWith('equals:')) {
-      return input === expression.slice(7).trim();
-    }
-    if (expression.startsWith('regex:')) {
-      try {
-        return new RegExp(expression.slice(6).trim(), 'i').test(input);
-      } catch {
-        return false;
-      }
-    }
-
-    // Fallback: JS 表达式
-    try {
-      const fn = new Function(...Object.keys(vars), `return Boolean(${expression})`);
-      return fn(...Object.values(vars));
-    } catch {
-      return false;
-    }
-  }
-}
-
-interface ContextVariableAccessor {
-  get(key: string): unknown;
-  toObject?(): Record<string, unknown>;
-}
-```
-
-```typescript
-// sub-agent/sub-agent-router.ts
-
-import type { ILLMGateway } from '../llm/gateway';
-import type { ModelRegistry } from '../models/config';
-import type { Session } from '../core/session';
-import type { ITool, ToolDefinition } from '../models/tools';
-import { SideEffect } from '../models/tools';
-import type { Message, LLMResponse } from '../models/messages';
-
-/**
- * 子 Agent 委托请求。
- */
-export interface SubAgentTask {
-  instruction: string;
-  allowedTools?: string[];
-  responseFormat?: string;
-  maxTurns?: number;
-}
-
-/**
- * 子 Agent 路由器。
- *
- * 核心理念：子 Agent 是**上下文防火墙**。
- *
- * - 拥有完全独立且空白的 Context Window
- * - 只接收一个精确指令
- * - 执行完毕后只返回精炼摘要
- * - 可使用更便宜/更快的模型
- *
- * 效果：
- * 1. 主 Agent 上下文保持干净，停留在"聪明区间"
- * 2. 子 Agent 的大量中间 IO 不会污染主循环
- * 3. 成本降低（便宜模型做搜索，贵模型做决策）
- */
-export class SubAgentRouter {
-  constructor(
-    private readonly llm: ILLMGateway,
-    private readonly models: ModelRegistry,
-    private readonly availableTools: ITool[],
-  ) {}
-
-  async delegate(task: SubAgentTask, parentSession: Session): Promise<string> {
-    const model = this.models.subAgent ?? this.models.primary;
-    const maxTurns = task.maxTurns ?? 15;
-    const tools = this.selectTools(task.allowedTools);
-    const toolDefs = tools.map(t => t.getDefinition());
-    const systemPrompt = this.buildSystemPrompt(task);
-
-    const messages: Message[] = [
-      { role: 'user', content: task.instruction },
-    ];
-
-    for (let turn = 0; turn < maxTurns; turn++) {
-      const response = await this.llm.chat({
-        system: systemPrompt,
-        messages,
-        tools: toolDefs,
-        model,
-      });
-
-      if (response.toolCalls.length === 0) {
-        return response.text;
-      }
-
-      // Record assistant message
-      messages.push({
-        role: 'assistant',
-        content: response.text,
-        toolCalls: response.toolCalls,
-      });
-
-      // Execute tools and record results
-      for (const call of response.toolCalls) {
-        const tool = tools.find(t => t.name === call.name);
-        let output: string;
-
-        if (!tool) {
-          output = `Error: Tool '${call.name}' not available to sub-agent.`;
-        } else {
-          try {
-            output = await tool.execute(call.arguments as Record<string, unknown>, parentSession);
-          } catch (err: any) {
-            output = `Error: ${err?.message ?? String(err)}`;
-          }
-        }
-
-        messages.push({
-          role: 'tool',
-          content: output,
-          toolCallId: call.id,
-        });
-      }
-    }
-
-    return '[Sub-agent reached maximum turns without completing. Partial results may be available above.]';
-  }
-
-  private selectTools(allowedNames?: string[]): ITool[] {
-    if (allowedNames && allowedNames.length > 0) {
-      return this.availableTools.filter(t => allowedNames.includes(t.name));
-    }
-    // Default: read-only tools only
-    return this.availableTools.filter(t => t.sideEffect === SideEffect.None);
-  }
-
-  private buildSystemPrompt(task: SubAgentTask): string {
-    const parts = [
-      'You are a focused research assistant. Your job is to complete a specific task',
-      'and return a concise, well-structured result.',
-      '',
-      'RULES:',
-      '- Be thorough but concise in your final answer',
-      '- Always cite file paths and line numbers when referencing code',
-      '- Do NOT make changes to files—only read and analyze',
-      '- When done, provide your findings as a clear summary',
-    ];
-
-    if (task.responseFormat) {
-      parts.push('', `RESPONSE FORMAT: ${task.responseFormat}`);
-    }
-
-    return parts.join('\n');
-  }
-}
-
-/**
- * Sub-Agent meta-tool exposed to the main Agent.
- *
- * Lets the LLM autonomously decide when to delegate research tasks
- * to a sub-agent with a clean context window.
- */
-export class SubAgentTool implements ITool {
-  readonly name = 'delegate_task';
-  readonly description =
-    'Delegate a focused research or analysis task to a sub-agent with a clean context. ' +
-    'Use this for: searching large codebases, tracing request flows, analyzing patterns, ' +
-    'reading many files. The sub-agent returns a concise summary.';
-  readonly sideEffect = SideEffect.None;
-  readonly timeoutMs = 120_000;
-
-  constructor(private readonly router: SubAgentRouter) {}
-
-  getDefinition(): ToolDefinition {
-    return {
-      name: this.name,
-      description: this.description,
-      parameters: {
-        type: 'object',
-        properties: {
-          instruction: {
-            type: 'string',
-            description: 'Detailed instruction for the sub-agent. Be specific about what to find/analyze.',
-          },
-          response_format: {
-            type: 'string',
-            description: "Expected format of the response (e.g., 'list of file:line pairs', 'summary paragraph')",
-          },
-        },
-        required: ['instruction'],
-      },
-    };
-  }
-
-  isAvailable(): boolean {
-    return true;
-  }
-
-  async execute(args: Record<string, unknown>, session: Session): Promise<string> {
-    const task: SubAgentTask = {
-      instruction: args.instruction as string,
-      responseFormat: args.response_format as string | undefined,
-    };
-    return this.router.delegate(task, session);
-  }
-}
-```
-
-```typescript
-// plugins/plugin-interface.ts
-
-import type { IExecutor, IExecutorFactory } from '../models/tools';
-import type { HookEvent } from '../hooks/hook-manager';
-import type { HookManager } from '../hooks/hook-manager';
-
-/**
- * Plugin metadata.
- */
-export interface PluginMetadata {
-  id: string;
-  name: string;
-  version: string;
-  description?: string;
-  author?: string;
-  dependencies?: string[];
-}
-
-/**
- * Plugin context — API surface exposed to plugins.
- *
- * Follows ISP: plugins only see what they need.
- * Follows DIP: plugins depend on interfaces, not concrete classes.
- */
-export interface PluginContext {
-  registerTool(tool: import('../models/tools').ITool): void;
-  registerSkill(skill: import('../skills/skill-registry').Skill): void;
-  registerOrchestratorType(type: string, creator: import('../orchestrators').OrchestratorCreator): void;
-  onHook(event: HookEvent, handler: (...args: any[]) => any): () => void;
-  getConfig<T>(key: string): T | undefined;
-  log: {
-    debug(msg: string, ...args: any[]): void;
-    info(msg: string, ...args: any[]): void;
-    warn(msg: string, ...args: any[]): void;
-    error(msg: string, ...args: any[]): void;
-  };
-}
-
-/**
- * Kernel plugin interface.
- *
- * Equivalent to llm-kernel's IKernelPlugin but adapted
- * to our dependency-injected architecture.
- */
-export interface IKernelPlugin {
-  readonly metadata: PluginMetadata;
-  initialize(context: PluginContext): Promise<void>;
-  destroy?(): Promise<void>;
-}
-```
-
-```typescript
-// plugins/plugin-manager.ts
-
-import type { IKernelPlugin, PluginContext, PluginMetadata } from './plugin-interface';
-import type { HookManager } from '../hooks/hook-manager';
-import type { ToolRegistry } from '../tools/registry';
-import type { SkillRegistry } from '../skills/skill-registry';
-import type { OrchestratorRegistry } from '../orchestrators';
-
-/**
- * Plugin manager.
- *
- * Unlike llm-kernel's singleton-based PluginManager, this one
- * receives all dependencies via constructor injection (DIP).
- */
-export class PluginManager {
-  private plugins = new Map<string, IKernelPlugin>();
-  private config: Record<string, unknown> = {};
-
-  constructor(
-    private readonly hookManager: HookManager,
-    private readonly toolRegistry: ToolRegistry,
-    private readonly skillRegistry: SkillRegistry,
-    private readonly orchestratorRegistry: OrchestratorRegistry,
-  ) {}
-
-  setConfig(config: Record<string, unknown>): void {
-    this.config = { ...this.config, ...config };
-  }
-
-  async register(plugin: IKernelPlugin): Promise<void> {
-    const { id } = plugin.metadata;
-
-    if (this.plugins.has(id)) {
-      throw new Error(`Plugin '${id}' is already registered`);
-    }
-
-    // Check dependencies
-    if (plugin.metadata.dependencies) {
-      for (const dep of plugin.metadata.dependencies) {
-        if (!this.plugins.has(dep)) {
-          throw new Error(`Plugin '${id}' requires '${dep}' which is not loaded`);
-        }
-      }
-    }
-
-    const context = this.createContext(plugin.metadata);
-    await plugin.initialize(context);
-    this.plugins.set(id, plugin);
-  }
-
-  async unregister(pluginId: string): Promise<void> {
-    const plugin = this.plugins.get(pluginId);
-    if (!plugin) return;
-
-    if (plugin.destroy) {
-      await plugin.destroy();
-    }
-    this.plugins.delete(pluginId);
-  }
-
-  getPlugins(): PluginMetadata[] {
-    return Array.from(this.plugins.values()).map(p => p.metadata);
-  }
-
-  private createContext(metadata: PluginMetadata): PluginContext {
-    const prefix = `[Plugin:${metadata.id}]`;
-
-    return {
-      registerTool: (tool) => {
-        // Add tool to the core skill so it's always available
-        const coreSkill = this.skillRegistry.getSkill('core');
-        if (coreSkill) {
-          coreSkill.tools.push(tool);
-        }
-      },
-
-      registerSkill: (skill) => {
-        this.skillRegistry.register(skill);
-      },
-
-      registerOrchestratorType: (type, creator) => {
-        this.orchestratorRegistry.register(type, creator);
-      },
-
-      onHook: (event, handler) => {
-        this.hookManager.on(event, handler);
-        return () => this.hookManager.off(event, handler);
-      },
-
-      getConfig: <T>(key: string) => {
-        return this.config[key] as T | undefined;
-      },
-
-      log: {
-        debug: (msg, ...args) => console.debug(prefix, msg, ...args),
-        info: (msg, ...args) => console.info(prefix, msg, ...args),
-        warn: (msg, ...args) => console.warn(prefix, msg, ...args),
-        error: (msg, ...args) => console.error(prefix, msg, ...args),
-      },
-    };
-  }
-}
-```
-
-```typescript
-// factory.ts
-
-import type { ExecutorConfig, ModelRegistry, BudgetLimits, LoopConfig } from './models/config';
-import { DEFAULT_BUDGET, DEFAULT_LOOP_CONFIG } from './models/config';
-import { ExecutionLoop } from './core/execution-loop';
-import { BudgetController } from './core/budget-controller';
-import { SessionManager } from './core/session-manager';
-import { ContextManager } from './context/context-manager';
-import { ContextCompressor } from './context/compressor';
-import { PromptBuilder } from './context/prompt-builder';
-import { MemoryStore } from './context/memory-store';
-import {
-  CoreIdentitySection,
-  EnvironmentSection,
-  SkillInstructionsSection,
-  MemorySection,
-  AvailableSkillsSection,
-} from './context/prompt-sections';
-import { createLLMGateway } from './llm/adapter-factory';
-import { ToolRegistry } from './tools/registry';
-import { ToolExecutor } from './tools/tool-executor';
-import { FileReadTool } from './tools/file-read';
-import { FileWriteTool } from './tools/file-write';
-import { ShellExecTool } from './tools/shell-exec';
-import { GlobSearchTool } from './tools/glob-search';
-import { GrepSearchTool } from './tools/grep-search';
-import { LoadSkillTool } from './tools/load-skill';
-import { SkillRegistry } from './skills/skill-registry';
-import type { Skill } from './skills/skill-registry';
-import { SubAgentRouter, SubAgentTool } from './sub-agent/sub-agent-router';
-import { PermissionManager, Permission } from './permissions/permission-manager';
-import type { PermissionRule } from './permissions/permission-manager';
-import { HookManager } from './hooks/hook-manager';
-import { OrchestratorRegistry } from './orchestrators';
-import { PluginManager } from './plugins/plugin-manager';
-import type { IKernelPlugin } from './plugins/plugin-interface';
-
-/**
- * Top-level configuration for the Executor Scheduler.
- */
-export interface ExecutorSchedulerConfig {
-  models: ModelRegistry;
-  budget?: Partial<BudgetLimits>;
-  loop?: Partial<LoopConfig>;
-  systemPromptBudgetTokens?: number;
-  workingDirectory?: string;
-  /** Extra skills to register at startup */
-  skills?: Skill[];
-  /** Extra permission rules */
-  permissionRules?: PermissionRule[];
-  /** Plugins to load */
-  plugins?: IKernelPlugin[];
-  /** Arbitrary config passed to plugins */
-  pluginConfig?: Record<string, unknown>;
-}
-
-/**
- * Factory output — everything the caller needs.
- */
-export interface ExecutorScheduler {
-  loop: ExecutionLoop;
-  hooks: HookManager;
-  sessionManager: SessionManager;
-  skillRegistry: SkillRegistry;
-  pluginManager: PluginManager;
-  orchestratorRegistry: OrchestratorRegistry;
-}
-
-/**
- * Composition Root.
- *
- * This is the ONLY place that knows about all concrete implementations.
- * Every other module depends on interfaces/protocols only.
- *
- * Usage:
- *   const scheduler = await createExecutorScheduler(config);
- *   scheduler.hooks.on(HookEvent.ToolStart, (call) => console.log(call));
- *   const result = await scheduler.loop.run({ prompt: '...' });
- */
-export async function createExecutorScheduler(
-  config: ExecutorSchedulerConfig,
-): Promise<ExecutorScheduler> {
-  const budget: BudgetLimits = { ...DEFAULT_BUDGET, ...config.budget };
-  const loopConfig: LoopConfig = { ...DEFAULT_LOOP_CONFIG, ...config.loop };
-
-  // 1. LLM Gateway
-  const llmGateway = createLLMGateway(config.models);
-
-  // 2. Hook Manager
-  const hookManager = new HookManager();
-
-  // 3. Core tools
-  const coreTools = [
-    new FileReadTool(),
-    new FileWriteTool(),
-    new ShellExecTool(),
-    new GlobSearchTool(),
-    new GrepSearchTool(),
-  ];
-
-  // 4. Skill Registry
-  const skillRegistry = new SkillRegistry([
-    {
-      name: 'core',
-      description: 'Core file and shell tools',
-      instructions: '',
-      tools: coreTools,
-      triggerPatterns: [],
-      autoLoad: true,
-      priority: 0,
-    },
-    ...(config.skills ?? []),
-  ]);
-
-  // 5. Meta-tool: load_skill
-  const loadSkillTool = new LoadSkillTool(skillRegistry);
-
-  // 6. Sub-Agent Router + meta-tool
-  const subAgentRouter = new SubAgentRouter(llmGateway, config.models, coreTools);
-  const subAgentTool = new SubAgentTool(subAgentRouter);
-
-  // All always-available tools
-  const allCoreTools = [...coreTools, loadSkillTool, subAgentTool];
-
-  // 7. Tool Registry
-  const toolRegistry = new ToolRegistry(allCoreTools, skillRegistry);
-
-  // 8. Permission Manager
-  const defaultRules: PermissionRule[] = [
-    { toolPattern: 'file_read', action: Permission.Allowed, reason: 'Reading files is safe' },
-    { toolPattern: 'glob_search', action: Permission.Allowed, reason: 'Searching files is safe' },
-    { toolPattern: 'grep_search', action: Permission.Allowed, reason: 'Searching contents is safe' },
-    { toolPattern: 'load_skill', action: Permission.Allowed, reason: 'Loading skills is safe' },
-    { toolPattern: 'delegate_task', action: Permission.Allowed, reason: 'Sub-agent delegation is safe (read-only)' },
-    { toolPattern: 'shell_exec', action: Permission.AskUser, reason: 'Shell commands may have side effects' },
-    { toolPattern: 'file_write', action: Permission.AskUser, reason: 'Writing files modifies local state' },
-    ...(config.permissionRules ?? []),
-  ];
-  const permissionManager = new PermissionManager(defaultRules, Permission.AskUser);
-
-  // 9. Tool Executor
-  const toolExecutor = new ToolExecutor(toolRegistry, permissionManager, hookManager);
-
-  // 10. Context Management
-  const memoryStore = new MemoryStore();
-  const contextCompressor = new ContextCompressor(llmGateway, config.models);
-
-  const promptSections = [
-    new CoreIdentitySection(),
-    new EnvironmentSection(),
-    new SkillInstructionsSection(skillRegistry),
-    new MemorySection(memoryStore),
-    new AvailableSkillsSection(skillRegistry),
-  ];
-
-  const promptBuilder = new PromptBuilder(
-    promptSections,
-    config.systemPromptBudgetTokens ?? 4000,
-  );
-
-  const contextManager = new ContextManager(
-    promptBuilder,
-    contextCompressor,
-    skillRegistry,
-    memoryStore,
-    {
-      maxContextTokens: config.models.primary.maxContextTokens,
-      compressionThreshold: loopConfig.compressionThreshold,
-    },
-  );
-
-  // 11. Budget Controller
-  const budgetController = new BudgetController(budget);
-
-  // 12. Session Manager
-  const sessionManager = new SessionManager();
-
-  // 13. Orchestrator Registry
-  const orchestratorRegistry = new OrchestratorRegistry();
-
-  // 14. Plugin Manager
-  const pluginManager = new PluginManager(
-    hookManager,
-    toolRegistry,
-    skillRegistry,
-    orchestratorRegistry,
-  );
-
-  if (config.pluginConfig) {
-    pluginManager.setConfig(config.pluginConfig);
-  }
-
-  // Load plugins
-  if (config.plugins) {
-    for (const plugin of config.plugins) {
-      await pluginManager.register(plugin);
-    }
-  }
-
-  // 15. Assemble Execution Loop
-  const loop = new ExecutionLoop(
-    llmGateway,
-    contextManager,
-    toolExecutor,
-    toolRegistry,
-    budgetController,
-    hookManager,
-    config.models,
-    loopConfig,
-  );
-
-  return {
-    loop,
-    hooks: hookManager,
-    sessionManager,
-    skillRegistry,
-    pluginManager,
-    orchestratorRegistry,
-  };
-}
-```
-
-```typescript
-// index.ts
-
-/**
- * LLM Executor Scheduler — Public API
- *
- * Usage:
- *
- *   import { createExecutorScheduler, HookEvent } from '@itookit/executor';
- *
- *   const scheduler = await createExecutorScheduler({
- *     models: {
- *       primary: {
- *         provider: 'anthropic',
- *         modelId: 'claude-sonnet-4-20250514',
- *         maxOutputTokens: 16384,
- *         maxContextTokens: 200_000,
- *         temperature: 0,
- *         costPerInputToken: 3e-6,
- *         costPerOutputToken: 15e-6,
- *       },
- *     },
- *     budget: { maxTurns: 50, maxCostUsd: 2.0 },
- *   });
- *
- *   scheduler.hooks.on(HookEvent.ToolStart, (call) => console.log(`🔧 ${call.name}`));
- *   scheduler.hooks.on(HookEvent.PermissionRequest, () => true);
- *
- *   const result = await scheduler.loop.run({
- *     prompt: 'Refactor error handling in src/auth.ts',
- *   });
- *   console.log(result.response);
- */
-
-// --- Core ---
-export { ExecutionLoop } from './core/execution-loop';
-export { Session } from './core/session';
-export type { TaskRequest, TaskResult, Step, Environment } from './core/session';
-export { SessionManager } from './core/session-manager';
-export { BudgetController } from './core/budget-controller';
-export type { UsageSnapshot } from './core/budget-controller';
-export { StreamingToolExecutor } from './core/streaming-tool-executor';
-
-// --- Context ---
-export { ContextManager } from './context/context-manager';
-export { ContextCompressor } from './context/compressor';
-export { PromptBuilder } from './context/prompt-builder';
-export { MemoryStore } from './context/memory-store';
-export type { Memory } from './context/memory-store';
-
-// --- LLM ---
-export type { ILLMGateway, StreamEvent } from './llm/gateway';
-export { AnthropicAdapter } from './llm/anthropic-adapter';
-export { OpenAIAdapter } from './llm/openai-adapter';
-export { createLLMGateway } from './llm/adapter-factory';
-
-// --- Tools ---
-export { ToolExecutor } from './tools/tool-executor';
-export { ToolRegistry } from './tools/registry';
-export type { ITool, ToolDefinition } from './models/tools';
-export { SideEffect } from './models/tools';
-
-// --- Skills ---
-export { SkillRegistry } from './skills/skill-registry';
-export type { Skill } from './skills/skill-registry';
-
-// --- Sub-Agent ---
-export { SubAgentRouter, SubAgentTool } from './sub-agent/sub-agent-router';
-
-// --- Permissions ---
-export { PermissionManager, Permission } from './permissions/permission-manager';
-export type { PermissionRule } from './permissions/permission-manager';
-
-// --- Hooks ---
-export { HookManager, HookEvent } from './hooks/hook-manager';
-
-// --- Orchestrators ---
-export {
-  OrchestratorRegistry,
-  BaseOrchestrator,
-  SerialOrchestrator,
-  ParallelOrchestrator,
-  RouterOrchestrator,
-  LoopOrchestrator,
-  DAGOrchestrator,
-} from './orchestrators';
-
-// --- Plugins ---
-export { PluginManager } from './plugins/plugin-manager';
-export type { IKernelPlugin, PluginMetadata, PluginContext } from './plugins/plugin-interface';
-
-// --- Config & Models ---
-export type {
-  ExecutorConfig,
-  ModelConfig,
-  ModelRegistry,
-  BudgetLimits,
-  LoopConfig,
-} from './models/config';
-export { DEFAULT_BUDGET, DEFAULT_LOOP_CONFIG } from './models/config';
-export type { Message, ToolCall, ToolResult, LLMResponse, TokenUsage } from './models/messages';
-export { StopReason } from './models/messages';
-
-// --- Errors ---
-export {
-  ExecutorError,
-  LLMError,
-  RateLimitError,
-  ContextTooLargeError,
-  ServiceOverloadError,
-  MaxRetriesExhaustedError,
-  BudgetExhaustedError,
-  ToolNotFoundError,
-  ToolExecutionError,
-} from './models/errors';
-
-// --- Utils ---
-export { estimateTokens, truncateToTokens } from './utils/tokens';
-export { ExpressionEvaluator } from './utils/expressions';
-
-// --- Factory (primary entry point) ---
-export { createExecutorScheduler } from './factory';
-export type { ExecutorSchedulerConfig, ExecutorScheduler } from './factory';
-```
-
----
-
-## 审查分析对比
-
-下面是综合设计方案与 llm-kernel 现有代码之间的系统性对比。
-
-### 1. 架构定位差异
-
-| 维度 | 综合设计方案 | llm-kernel |
-|------|-------------|-----------|
-| **核心隐喻** | "Agent Harness"——围绕 LLM 的安全带/防腐层 | "Execution Engine"——通用的执行器+编排器运行时 |
-| **设计焦点** | LLM Agent 循环的深度优化（上下文管理、反压、流式工具执行、子 Agent 防火墙） | 通用的执行编排框架（串行/并行/路由/循环/DAG），LLM 只是其中一种执行器 |
-| **抽象层级** | 为 coding agent 场景深度定制 | 更高层的通用抽象，支持 HTTP/Script/Tool/Agent 等多种执行器 |
-
-**分析**：llm-kernel 是一个更通用的框架——它可以编排任何类型的执行器（HTTP 请求、脚本执行、工具调用、LLM 调用），而综合方案是一个专门针对 LLM Agent 场景的深度解决方案。二者不是竞争关系，而是互补关系：llm-kernel 的编排层可以**编排**多个综合方案的 Agent 实例。
-
-### 2. 逐模块对比
-
-#### 2.1 Agent 执行循环
-
-**综合方案的 ExecutionLoop 优势**：
-- **四层上下文压缩**：HistorySnip → CachePrune → LLMSummarize → SlidingWindow，按 urgency 渐进触发。llm-kernel 的 AgentExecutor 完全没有上下文管理——它只做单轮 LLM 调用，不管理多轮对话的 token 膨胀。
-- **错误分级重试**：区分 429/413/529/截断四种错误，每种有独立的恢复策略（退避/压缩/降级/静默重试）。llm-kernel 的 AgentExecutor 只做简单的 `isRecoverable` 判断。
-- **反压验证**：`BackPressureCheck` Hook 让 LLM "说完了"之后还能被拉回继续修。llm-kernel 没有此概念。
-- **多维预算控制**：6 个维度同时约束。llm-kernel 没有预算控制。
-- **工具异常回馈**：工具执行失败包装成 `is_error=true` 的 ToolResult 喂回 LLM。llm-kernel 的 AgentExecutor 中工具失败只是发送事件，不回馈给 LLM。
-
-**llm-kernel 的 AgentExecutor 优势**：
-- **设备抽象**：通过 `IDeviceHandle` + `IDeviceManager` 抽象了 LLM 的连接管理。`connectionId` 设计让 API key 等敏感信息由设备驱动层管理，AgentExecutor 完全不感知。综合方案把 API key 放在 ModelConfig 中。
-- **附件系统**：支持 `Attachment`（图片/文件等多模态输入），有 `systemAttachments`、`defaultAttachments`、输入附件的三级合并机制。综合方案尚未实现多模态。
-- **MCP + Computer Use**：已经预留了 MCP 工具调用和 Computer Use 的处理入口（虽然实现标记为"not implemented"）。综合方案将 MCP 列为扩展点但未实现。
-- **Thinking 支持**：原生支持思考过程（`enableThinking`、`thinkingBudget`），流式输出思考内容。综合方案的 Session 没有追踪思考过程。
-
-**关键差异**：llm-kernel 的 AgentExecutor 是**单轮**执行——调一次 LLM，处理一次工具调用，返回结果。它没有 `while(true)` 的 Agent 循环。多轮对话需要外部（如 LoopOrchestrator 或 CLI 的 interactive 模式）来驱动。综合方案的 ExecutionLoop 是一个自驱动的**完整 Agent 循环**——它自己管理多轮对话、上下文压缩、工具调用链，直到 LLM 给出最终回复或预算耗尽。
-
-这是最根本的架构差异。llm-kernel 选择了"小积木"方式——每个执行器只做一件事，复杂行为通过编排器组合。综合方案选择了"大循环"方式——一个 ExecutionLoop 包含了完整的 Agent 行为。
-
-#### 2.2 编排层
-
-**llm-kernel 优势**（综合方案原本缺失，现已融合）：
-- **5 种编排器**：Serial、Parallel、Router、Loop、DAG，涵盖了绝大部分编排场景
-- **DAG 编排器**：完整的拓扑排序、环检测、并发执行、失败节点跳过下游——这是一个非常成熟的实现
-- **并发控制**：`maxConcurrency` 限制并行执行器数量
-- **条件路由**：支持规则路由和 LLM 路由两种模式
-- **循环编排器**：支持退出条件表达式、迭代变量注入、结果收集
-
-**综合方案**：原本没有编排层（YAGNI），但 llm-kernel 的编排器确实解决了真实需求——当你需要"先搜索、再分析、再生成报告"这种多步骤流程时，编排器比手写胶水代码优雅得多。综合后已将这一层纳入。
-
-#### 2.3 事件系统
-
-**llm-kernel 优势**：
-- **作用域事件总线**：`createScope(executionId)` 创建隔离的事件作用域，不同执行不会互相干扰
-- **事件优先级**：`priority` 参数控制处理器执行顺序
-- **事件过滤**：`filter` 函数实现细粒度的事件筛选
-- **通配符订阅**：`'*'` 订阅所有事件类型
-
-**综合方案**：
-- **反压 Hook**：`BackPressureCheck` 事件允许 Hook 处理器**阻塞流程并注入修正**——不只是通知
-- **权限交互 Hook**：`PermissionRequest` 事件等待用户响应后才继续
-
-**分析**：llm-kernel 的事件系统在基础设施层面更完善（作用域隔离、优先级），综合方案在语义层面更丰富（反压、权限交互）。综合后应取 llm-kernel 的事件总线基础设施 + 综合方案的 Hook 语义。
-
-#### 2.4 工具系统
-
-**综合方案优势**：
-- **SideEffect 分类**：None / Local / External 三级，决定并行策略和权限策略
-- **三层权限管理**：全局 → 项目 → 会话，带会话级授权记忆
-- **危险命令检测**：硬编码的 fork bomb / rm -rf / 等检测
-- **渐进式暴露闭环**：`load_skill` 元工具 + `AvailableSkillsSection` 提示词段落
-- **读写分离并行**：读操作并行、写操作串行的批量执行策略
-
-**llm-kernel 优势**：
-- **通用执行框架**：BaseExecutor 模板方法模式，统一了验证→事件→执行→错误处理的流程
-- **参数验证**：ToolExecutor 对 JSON Schema 参数做运行时类型检查
-- **ScriptExecutor**：内置沙箱化的 JavaScript/表达式执行能力——综合方案没有
-- **HttpExecutor**：内置 HTTP 请求执行器，支持模板替换、重试、JSONPath 提取——综合方案通过 shell_exec + curl 间接实现
-
-#### 2.5 上下文与记忆
-
-**综合方案优势**：
-- **四层渐进压缩**：完整实现了 HistorySnip → CachePrune → LLMSummarize → SlidingWindow，带 urgency 参数控制激进度
-- **摘要 fallback**：LLM 摘要调用失败时，回退到正则提取关键信息（文件路径、错误信息）
-- **动态系统提示词**：PromptBuilder 按优先级组装 Section，带 token 预算分配和截断策略
-- **Memory Store（三级作用域）**：Global / Project / Convention files 自动发现和加载
-- **Session 序列化/反序列化**：支持崩溃恢复，原子写入
-
-**llm-kernel 优势**：
-- **ScopedMemoryStore**：支持层级隔离，子作用域可以访问父作用域的数据——适合编排器的嵌套执行场景
-- **TTL 过期机制**：MemoryEntry 支持 `expiresAt`，自动清理过期条目
-- **标签索引**：按 tag 快速检索，支持交集查询
-- **ContextVariables 继承链**：子上下文自动继承父上下文的变量，但写入只影响本层
-
-**分析**：综合方案的上下文管理是为 Agent 循环深度定制的——解决的是"128K token 窗口内如何高效利用信息"的问题。llm-kernel 的内存系统是通用的 KV 存储，解决的是"执行器之间如何传递数据"的问题。两者解决不同层面的问题，不冲突。
-
-#### 2.6 Worker 与运行时
-
-**llm-kernel 独有**：
-- **WorkerAdapter / WorkerClient**：完整的 Web Worker / Node Worker 线程通信方案，支持跨线程执行、事件转发、取消控制
-- **ExecutionRuntime**：统一的执行入口，管理 AbortController、超时控制、事件作用域
-- **CLI Runner**：命令行交互模式、批量执行模式、流式输出着色
-
-**综合方案**：没有 Worker 层和 CLI 层——它假设调用方（IDE / Desktop App）自己管理线程和 UI。
-
-**分析**：Worker 层是 llm-kernel 面向浏览器环境的设计——把 CPU 密集的执行逻辑放到 Worker 线程，避免阻塞主线程。对于 Node.js 后端或 Electron 应用，这一层同样有价值。综合方案如果要支持浏览器内运行，需要补充这一层。
-
-#### 2.7 插件系统
-
-**llm-kernel 优势**：
-- 完整的插件生命周期：metadata → dependency check → initialize → destroy
-- PluginContext 提供注册执行器、编排器、订阅事件的统一 API
-
-**综合方案**：原本没有插件系统，依赖 Hook + Skill 注册实现扩展。综合后已纳入 PluginManager，但改为依赖注入而非 llm-kernel 的全局单例模式。
-
-#### 2.8 状态机
-
-**llm-kernel 独有**：
-- 通用状态机实现，支持 guard 条件、转换 action、状态生命周期钩子
-- 预定义的执行状态机配置（idle → running → completed/failed/cancelled）
-
-**综合方案**：ExecutionLoop 的状态管理内嵌在循环逻辑中，没有独立的状态机抽象。
-
-**分析**：llm-kernel 的状态机对于可视化执行状态（UI 中显示节点状态变化）非常有用。综合方案如果需要对接 UI 层展示 Agent 执行进度，可以引入这一抽象。
-
-### 3. 设计原则遵循对比
-
-| 原则 | 综合方案 | llm-kernel |
-|------|---------|-----------|
-| **SRP** | ✅ 每个模块职责清晰分离 | ⚠️ AgentExecutor 既管 LLM 调用又管工具执行又管消息构建，偏重 |
-| **OCP** | ✅ 新增 LLM 提供商/工具/Skill 不修改现有代码 | ✅ 通过 ExecutorRegistry 和 PluginManager 支持扩展 |
-| **LSP** | ✅ 所有 ITool 实现可互换 | ✅ 所有 IExecutor 实现可互换 |
-| **ISP** | ✅ ITool 接口精简（5 个成员） | ⚠️ IExecutor 接口含可选方法（validate? estimate?），不够精简 |
-| **DIP** | ✅ ExecutionLoop 依赖 ILLMGateway 接口，Factory 是唯一的 Composition Root | ⚠️ 大量全局单例（getRuntime(), getEventBus(), getExecutorRegistry()），违背 DIP |
-| **DRY** | ✅ 消息转换、token 估算、路径解析提取为独立函数 | ⚠️ executeWithTimeout 在 ToolExecutor 和 ScriptExecutor 中重复实现 |
-| **KISS** | ✅ 核心循环逻辑清晰：构造→调用→解析→执行→反馈 | ✅ 每个执行器和编排器的职责单一 |
-
-### 4. llm-kernel 的具体代码问题
-
-在审查 llm-kernel 现有代码时发现以下值得注意的问题：
-
-**4.1 AgentExecutor 的单轮设计**
-
-AgentExecutor 执行一次 LLM 调用后就返回结果。工具调用的结果存储在 `context.variables` 中但**没有回馈给 LLM**——也就是说 LLM 调用了工具后，无法看到工具的返回值并做出进一步决策。这是一个根本性的设计问题：
-
-```typescript
-// agent-executor.ts 中的 executeSingleToolCall
-context.variables.set(`tool_result_${toolCallId}`, result);
-// ← 结果存储在变量中，但 execute() 方法已经返回了
-// LLM 永远看不到这个结果
-```
-
-要实现真正的 Agent 循环（LLM 调用工具 → 看到结果 → 决定下一步），需要外部用 LoopOrchestrator 包裹 AgentExecutor 并手动拼接 history。这比综合方案的 ExecutionLoop 内置循环复杂得多，而且容易出错。
-
-**4.2 全局单例过多**
-
-```typescript
-// 至少 5 个全局单例
-getRuntime()
-getEventBus()
-getExecutorRegistry()
-getPluginManager()
-getGlobalMemoryStore()
-```
-
-这使得：
-- 单元测试需要 `resetGlobalMemoryStore()` 之类的 hack
-- 无法在同一进程中运行多个独立的 Kernel 实例
-- 隐式依赖关系，代码导航困难
-
-**4.3 ParallelOrchestrator 的并发控制有 bug**
-
-```typescript
-// parallel.ts
-if (executing.length >= limit) {
-    await Promise.race(executing);
-    const completed = executing.findIndex(p => 
-        p.then(() => true).catch(() => true)  // ← 这不会同步返回
-    );
-    if (completed !== -1) {
-        executing.splice(completed, 1);
-    }
-}
-```
-
-`findIndex` 中的 `.then()` 返回的是 Promise，不是 boolean，所以 `completed` 永远是 0（truthy value），导致始终移除第一个 promise 而不是实际完成的那个。正确的做法是用 `Promise.race` 返回的结果来确定哪个 promise 完成了。
-
-**4.4 ScriptExecutor 的沙箱安全性不足**
-
-```typescript
-// script-executor.ts
-const fn = new Function(...Object.keys(sandbox), asyncWrapper);
-```
-
-`new Function` 可以访问全局作用域（`globalThis`、`process`、`require` 等）。沙箱中虽然提供了安全的 API 子集，但没有阻止脚本直接访问 `globalThis.process.exit()` 或 `require('child_process')`。生产环境需要使用 `vm2` 或 `isolated-vm`。
-
-**4.5 RouterOrchestrator 的 LLM 路由存在信息泄露**
-
-```typescript
-// router.ts - selectByLLM
-const routingPrompt = `
-Based on the user input, select the most appropriate handler.
-Available handlers: ${childrenDesc}
-User input: ${typeof input === 'string' ? input : JSON.stringify(input)}
-Respond with only the handler ID.
-`;
-```
-
-这把所有子节点的 ID 和名称暴露给了 LLM。如果节点名称包含敏感信息（如内部系统名），会造成信息泄露。应该用匿名标签（"Handler A", "Handler B"）替代。
-
-**4.6 HttpExecutor 的 URL 注入风险**
-
-```typescript
-// http-executor.ts
-result = result.replace(/\{\{input\}\}/g, encodeURIComponent(input));
-```
-
-虽然对 input 做了 `encodeURIComponent`，但 `{{var.xxx}}` 替换同样做了编码，而 `bodyTemplate` 的插值没有做任何转义——直接拼入请求体。如果用户控制的输入出现在 JSON body 模板中，可能导致 JSON 注入。
-
-### 5. 综合建议
-
-基于以上分析，综合建议如下：
-
-**对现有 llm-kernel 代码的改进**：
-1. **AgentExecutor 需要内置 Agent 循环**（或提供一个 `AgentLoopExecutor` 变体），让工具调用结果能回馈给 LLM
-2. **消除全局单例**，改为通过构造函数注入或 factory 模式
-3. **修复 ParallelOrchestrator 的并发控制 bug**
-4. **加强 ScriptExecutor 的沙箱**
-5. **补充上下文压缩机制**——目前 history 无限增长
-
-**对综合方案的改进（已完成）**：
-1. ✅ 纳入 llm-kernel 的编排器层（Serial/Parallel/Router/Loop/DAG）
-2. ✅ 纳入 llm-kernel 的插件系统（但改为依赖注入）
-3. 后续可以纳入：设备抽象层（IDeviceHandle）、Worker 层、状态机、多模态附件支持
-
-**最终架构关系**：综合方案的 ExecutionLoop 应该作为 llm-kernel 的一种新执行器类型（`AgentLoopExecutor`），这样它既能独立使用，也能被 llm-kernel 的编排器编排——实现"用 DAG 编排三个 Agent，每个 Agent 有自己的独立上下文窗口和工具集"这样的高级场景。
-
----
-
-## 8. 工具与技能层：device-tools 与 device-skills
-
-### 8.1 架构定位
-
-工具系统是 Agent 执行能力的具体落地。在 itookit 架构中，工具与技能分为两个独立包：
-
-```
-llm-kernel (AgentLoopExecutor)
-    ├── 通过 IToolService 调用工具
-    └── 通过 ISkillService 管理技能
-
-@itookit/device-tools          @itookit/device-skills
-  ToolDeviceDriver               SkillDeviceDriver
-  ToolService ←─ IToolService    SkillService ←─ ISkillService
-  PermissionManager                  │
-  builtin/ (5 个内置工具)            │ 依赖 IToolService（DIP 边界）
-                                     └──────► ToolService（运行时注入）
-                    两者均仅依赖 @itookit/common
-```
-
-两者均实现 `IDeviceDriver`（来自 `@itookit/common/interfaces/fs/device`），通过 VFS 设备层接入，也支持直接实例化集成。
-
-**关键设计决策**：`device-skills` 不依赖 `device-tools` 包，只依赖 `IToolService` 接口。这个 DIP（依赖倒置）边界使技能系统可以独立单测，也允许将来替换工具执行后端（如基于 Worker 的沙箱执行器）。
-
----
-
-### 8.2 device-tools：工具执行层
-
-#### 8.2.1 三层架构
-
-```
-ToolDeviceDriver     ← IDeviceDriver，VFS 设备接入点
-    │ 委托
-    ▼
-ToolService          ← IToolService，工具注册 & 执行核心
-    │ 委托权限检查
-    ▼
-PermissionManager    ← 三层权限评估
-```
-
-`ToolDeviceDriver` 是轻薄的适配层，只负责将 ioctl 命令路由到 `ToolService`。业务逻辑集中在 `ToolService` 中，这样在不通过 VFS 的场景（如 llm-kernel 直接集成）也能干净地使用。
-
-#### 8.2.2 工具注册模型
-
-每个工具注册时需要提供三样东西：
-
-| 组成 | 类型 | 用途 |
-|------|------|------|
-| `ToolMeta` | 运行时属性 | 副作用分类、超时、是否启用、图标 |
-| `ToolDefinition` | LLM JSON Schema | 发给模型的函数定义，包含参数 Schema |
-| `ToolHandler` | `(args, ctx) => Promise<string>` | 实际执行逻辑，返回字符串作为 tool_result |
-
-这与 `device-llm` 的 `ToolDefinition` 复用同一类型（均来自 `@itookit/common`），保证了 LLM 层和执行层的 Schema 一致性。
-
-#### 8.2.3 批量执行与并行策略
-
-`invokeBatch()` 实现了工具调用的并行优化，与综合设计方案（第 2.4 节）的策略完全对齐：
-
-```
-请求列表 → 按 sideEffect 分组
-    ├── reads (sideEffect='none')  → Promise.allSettled() 并行执行
-    └── writes (local/external)   → 串行执行（前一个完成再执行下一个）
-结果按原始顺序收集返回
-```
-
-这一策略在实际 Agent 循环中意义重大：LLM 经常同时调用多个文件读取（如读取多个相关文件来理解代码库），并行执行可将等待时间从 O(n×t) 降至 O(t)，而写操作串行执行避免了竞态条件。
-
-#### 8.2.4 三层权限管理
-
-`PermissionManager` 的三层评估顺序体现了"最小打扰"原则：
-
-```
-评估层次（短路逻辑，首个匹配即返回）：
-1. 全局规则    → 安全基线（如读文件默认 allowed）
-2. 项目规则    → .executor/permissions.json（项目定制）
-3. 会话记忆    → 用户本次会话已授权的工具+目录组合
-4. 副作用推断  → sideEffect='none' 自动 allowed
-5. 默认策略    → 兜底（默认 ask_user）
-```
-
-会话记忆（`sessionGrants`）按"工具+操作目录"粒度记忆。例如用户授权了对 `/workspace/src` 目录的 `file_write`，后续对同目录的所有写操作无需再次确认。会话结束时（`close()`）自动清除记忆。
-
-**与综合设计方案的对应关系**：综合设计方案（第 2.4 节）描述的三层权限（全局规则 → 项目规则 → 会话记忆）已在 `PermissionManager` 中完整实现，包括危险命令硬拒绝（在 `ShellExecTool` 中的 `CATASTROPHIC_PATTERNS`）。
-
-#### 8.2.5 五个内置工具
-
-| 工具 | sideEffect | 超时 | 核心特性 |
-|------|-----------|------|---------|
-| `file_read` | none | 10s | 支持行偏移/限制，带行号输出 |
-| `file_write` | local | 10s | 自动创建父目录 |
-| `shell_exec` | local | 120s | 灾难命令硬拒绝，输出截断，AbortSignal |
-| `glob_search` | none | 30s | 内置 glob-to-RegExp，自动忽略构建目录 |
-| `grep_search` | none | 30s | 跳过二进制文件，相对路径:行号格式输出 |
-
-`shell_exec` 的灾难命令拦截（`CATASTROPHIC_PATTERNS`）是独立于权限系统的硬性保护，即使全局规则设置为 `allowed`，匹配这些模式的命令也会被直接拒绝——这与综合设计方案（第 2.5 节）中"某些操作不可通过权限覆盖"的要求对应。
-
----
-
-### 8.3 device-skills：技能管理层
-
-#### 8.3.1 渐进式工具暴露
-
-Skill 系统解决的核心问题是**工具空间过大导致的 LLM 注意力稀释**。一个功能完整的 Agent 可能有数十个工具，一次性全部注入 system_prompt 会消耗过多 token，并让 LLM 在工具选择上产生困惑。
-
-渐进式暴露的解决思路：
-
-```
-会话初始状态：
-  tools = [core_builtin_tools]  ← 数量少，LLM 聚焦
-  system_prompt += AvailableSkillsSection:
-    "以下 Skill 可按需加载：
-     - docker: 管理 Docker 容器（调用 load_skill 加载）
-     - git-advanced: 高级 Git 操作"
-
-LLM 判断需要 Docker → tool_call: load_skill({ skill_id: 'docker' })
-  → SkillService.loadSkill('docker')
-  → 向 ToolService 注册 docker 相关工具
-  → 返回成功 + 新增工具列表
-
-下一轮 LLM 调用：
-  tools = [core_tools + docker_run + docker_ps + docker_logs]
-  system_prompt += LoadedSkillsSection: "已加载：docker\n<docker 操作指南>"
-```
-
-#### 8.3.2 SkillDefinition 数据模型
-
-`SkillDefinition` 是技能系统的核心数据结构，包含四类信息：
-
-| 字段组 | 字段 | 用途 |
-|------|------|------|
-| 身份 | `id`, `name`, `description`, `type`, `enabled` | 基础标识与分类 |
-| Prompt | `instructions` | 加载后注入 system_prompt 的 Markdown 指令 |
-| 工具 | `tools: SkillToolBinding[]` | 工具绑定列表（含执行类型和副作用） |
-| 自动化 | `triggerPatterns`, `autoLoad`, `priority` | 自动加载决策 |
-| HTTP | `endpoint`, `method`, `headers` | HTTP Skill 专用 |
-
-`SkillToolBinding.executionType` 决定了工具的执行方式：
-- `'builtin'`：引用 device-tools 内置工具，不创建额外 handler
-- `'http'`：通过 fetch 调用 Skill 的 endpoint，将工具参数序列化为请求体
-- `'handler'`：预留给未来插件系统
-
-#### 8.3.3 HTTP 工具 Handler 设计
-
-`type='http'` 的 Skill 通过 `buildHttpHandler()` 创建的闭包执行远程调用：
-
-```
-Agent → ToolService.invoke({ toolId, args })
-  → 已注册的 HTTP handler（由 SkillService 在 loadSkill 时注入）
-  → fetch(skill.endpoint, {
-      method: skill.method ?? 'POST',
-      headers: { 'Content-Type': 'application/json', ...skill.headers },
-      body: JSON.stringify(args),
-      signal: ctx.signal   ← 支持取消
-    })
-  → 响应解析：
-      application/json → JSON.stringify(json, null, 2)
-      其他            → response.text()
-  → 返回字符串（不抛异常）
-```
-
-这一设计允许用任意技术栈（Python FastAPI、Go HTTP server、Cloudflare Workers 等）实现工具后端，只需暴露一个接受 JSON body、返回 JSON 或纯文本的 HTTP 端点。
-
-#### 8.3.4 自动检测机制
-
-`autoDetectSkills(prompt)` 在 Agent 会话开始时调用，通过正则匹配决定预加载哪些 Skill。`autoLoad: true` 的 Skill 无条件加载，其余 Skill 按 `triggerPatterns` 决定。无效正则时自动回退为简单包含匹配。
-
----
-
-### 8.4 与 Agent 执行循环的集成
-
-两个包在 Agent 执行循环中的角色：
-
-```
-AgentLoopExecutor 初始化：
-  1. toolDriver = new ToolDeviceDriver()
-  2. skillDriver = new SkillDeviceDriver(toolDriver.getService())
-  3. 自动检测并加载匹配的 Skill
-  4. 构建初始 system_prompt（含 AvailableSkillsSection）
-
-Agent 循环（每轮）：
-  while(true):
-    tools = toolDriver.getService().getToolDefinitions()  ← 随 Skill 加载动态变化
-    response = LLM(messages, tools)
-    if no tool_calls → break
-
-    for each tool_call:
-      if tool_call.name == 'load_skill':
-        await skillService.loadSkill(tool_call.args.skill_id)
-      else:
-        result = await toolService.invoke(tool_call)
-        messages.push(tool_result(result.output))
-
-    compress_context_if_needed()
-```
-
-工具定义的动态性是 Skill 系统对 Agent 循环的核心贡献：每次 LLM 调用前，`getToolDefinitions()` 返回的列表都反映了当前已加载的 Skill，无需重启 Agent 会话。
-
----
-
-### 8.5 关键设计决策
-
-| 决策 | 原因 |
-|------|------|
-| 拆分为两个包 | `device-tools` 是 Node.js 专属（依赖 `fs`/`child_process`）；`device-skills` 平台无关（只用 `fetch`），可运行于浏览器和 Node.js |
-| 工具异常不向外抛出 | Agent 循环要求工具失败不中断循环；返回 `success=false` 且 `output` 包含错误字符串，让 LLM 自行决策下一步 |
-| 会话记忆按目录粒度 | 文件级太细（每次写不同文件都要确认），工具级太粗；目录级是合理中间点，用户允许对 `/workspace/src` 写操作后同目录后续操作自动放行 |
-| Skill 加载失败返回结果而非抛异常 | 与工具执行一致——LLM 收到错误字符串后可尝试其他 Skill 或告知用户，比异常中断更健壮 |
\ No newline at end of file
diff --git a/data b/data
index c1a8418..8e9470d 160000
--- a/data
+++ b/data
@@ -1 +1 @@
-Subproject commit c1a841836eb7bfb241091f646ea1e3c22053772d
+Subproject commit 8e9470d4669d92cc9ccafbc62963dd5181a1c14f
diff --git a/packages/common/src/interfaces/fs/index.ts b/packages/common/src/interfaces/fs/index.ts
index 9a41c40..4d3b484 100644
--- a/packages/common/src/interfaces/fs/index.ts
+++ b/packages/common/src/interfaces/fs/index.ts
@@ -98,16 +98,7 @@ export type {
 
 // ── 存储后端 ──
 export type {
-    InodeRecord,
-    IInodeStore,
-    InodeWalkOptions,
-    MetaRecord,
-    IMetaStore,
-    MetaWalkOptions,
-    IContentStore,
-    ContentStreamOptions,
-    ContentStreamResult,
-    ITransactionScope,
+    IStorageBackend,
     RecordValue,
     QueryOperator,
     RecordQuery,
@@ -115,15 +106,8 @@ export type {
     RecordQueryResult,
     RecordWalkOptions,
     IRecordStore,
-    IHighLevelStore,
-    ISyncableStore,
-    IStorageBackend,
-} from './storage';
-export {
-    hasRecordStore,
-    hasHighLevelStore,
-    hasSyncableStore,
 } from './storage';
+export { hasRecordStore } from './storage';
 
 // ── 能力子接口 ──
 export type { ISeqFileOperations } from './capabilities/seq-file';
diff --git a/packages/common/src/interfaces/fs/storage/backend.ts b/packages/common/src/interfaces/fs/storage/backend.ts
index 6074c72..cb13ed6 100644
--- a/packages/common/src/interfaces/fs/storage/backend.ts
+++ b/packages/common/src/interfaces/fs/storage/backend.ts
@@ -1,103 +1,82 @@
 /**
  * @file common/interfaces/fs/storage/backend.ts
- * @desc 存储后端主接口 + 事务
+ * @desc 统一 path-based 存储后端接口
  *
- * 设计决策：
- * 1. 基础后端只需实现三层 store — 门槛最低
- * 2. 可选 store 通过可选属性声明 — 渐进增强
- * 3. 事务使用闭包 API + ITransactionScope — 保证 commit/rollback 自动执行
- * 4. 类型守卫辅助上层判断后端能力
+ * v4.1: 废弃 IInodeStore / IMetaStore / IContentStore 三层分离。
+ * 后端使用 path 作为主键，统一暴露类 fs.promises API。
  *
- * 关键修正：
- * - runInTransaction 接收 ITransactionScope 而非 IStorageBackend
- *   避免嵌套事务语义混淆（scope 上没有 runInTransaction 方法）
+ * 可选能力（transaction / symlink / search / records）通过鸭子类型暴露。
+ * 不支持的实现将对应属性设为 undefined 或不定义。
  */
 
-import type { IInodeStore } from './inode-store';
-import type { IMetaStore } from './meta-store';
-import type { IContentStore } from './content-store';
+import type { FSNode, FSSearchQuery } from '../core/types';
 import type { IRecordStore } from './record-backend';
-import type { IHighLevelStore } from './high-level-backend';
-import type { ISyncableStore } from './syncable-backend';
 
-/**
- * 事务作用域
- *
- * 与 IStorageBackend 的区别：
- * - 没有 runInTransaction（防止嵌套事务）
- * - 没有 init/close（生命周期归后端管理）
- * - 只暴露三层 store + 可选增强 store
- */
-export interface ITransactionScope {
-    readonly inodes: IInodeStore;
-    readonly meta: IMetaStore;
-    readonly content: IContentStore;
-    readonly records?: IRecordStore;
-}
-
-/**
- * 存储后端 — 所有后端必须实现的最小接口
- */
 export interface IStorageBackend {
-    /** 后端名称（日志/调试用） */
     readonly name: string;
 
-    // ── 三层 Store ──
+    // ── 结构操作 ──
+
+    /** 获取节点信息 */
+    stat(path: string): Promise<FSNode | null>;
+
+    /** 列出子节点 */
+    list(path: string): Promise<FSNode[]>;
+
+    /** 创建目录 */
+    mkdir(path: string): Promise<FSNode>;
+
+    /** 删除节点 */
+    delete(path: string, options?: { recursive?: boolean }): Promise<void>;
+
+    /** 重命名/移动 */
+    rename(fromPath: string, toPath: string): Promise<void>;
+
+    // ── 内容操作 ──
+
+    /** 读取文件内容 */
+    read(path: string, options?: { offset?: number; length?: number }): Promise<Uint8Array>;
+
+    /** 写入文件内容 */
+    write(path: string, content: Uint8Array): Promise<FSNode>;
 
-    readonly inodes: IInodeStore;
-    readonly meta: IMetaStore;
-    readonly content: IContentStore;
+    // ── 元数据 ──
 
-    // ── 可选增强 Store ──
+    /** 更新元数据（合并语义） */
+    updateMetadata(path: string, metadata: Record<string, unknown>): Promise<void>;
 
-    readonly records?: IRecordStore;
-    readonly highLevel?: IHighLevelStore;
-    readonly syncable?: ISyncableStore;
+    /** 设置标签（全量替换） */
+    setTags(path: string, tags: string[]): Promise<void>;
+
+    /** 获取所有已使用的标签 */
+    getAllTags(): Promise<string[]>;
+
+    // ── 选配能力（不支持的后端返回 undefined） ──
+
+    /** SeqFile K-V 记录存储 */
+    records?: IRecordStore;
+
+    /** 全文/标签搜索 */
+    search?(query: FSSearchQuery): Promise<FSNode[]>;
+
+    /** 创建符号链接 */
+    symlink?(linkPath: string, target: string): Promise<void>;
+
+    /** 读取符号链接目标 */
+    readlink?(path: string): Promise<string>;
+
+    /** 事务（tx 复用 IStorageBackend 接口） */
+    transaction?<T>(fn: (tx: IStorageBackend) => Promise<T>): Promise<T>;
 
     // ── 生命周期 ──
 
     init(): Promise<void>;
     close(): Promise<void>;
-
-    // ── 事务 ──
-
-    /**
-     * 在事务中执行操作
-     *
-     * 后端保证事务内的所有操作要么全部成功，要么全部回滚。
-     * 不支持真正事务的后端（如纯 FS），可使用 WAL 或伪事务。
-     *
-     * 接收 ITransactionScope 而非 IStorageBackend：
-     * - 防止嵌套调用 runInTransaction
-     * - scope 上无生命周期方法
-     *
-     * @param mode 事务模式
-     * @param fn 事务体
-     */
-    runInTransaction<T>(
-        mode: 'readonly' | 'readwrite',
-        fn: (scope: ITransactionScope) => Promise<T>,
-    ): Promise<T>;
 }
 
-// ═══════════════════════════════════════════════════════════════
-// 类型守卫
-// ═══════════════════════════════════════════════════════════════
-
+/** 类型守卫：检查后端是否有记录存储 */
 export function hasRecordStore(
     backend: IStorageBackend,
-): backend is IStorageBackend & { readonly records: IRecordStore } {
+): backend is IStorageBackend & { records: IRecordStore } {
     return backend.records != null;
 }
-
-export function hasHighLevelStore(
-    backend: IStorageBackend,
-): backend is IStorageBackend & { readonly highLevel: IHighLevelStore } {
-    return backend.highLevel != null;
-}
-
-export function hasSyncableStore(
-    backend: IStorageBackend,
-): backend is IStorageBackend & { readonly syncable: ISyncableStore } {
-    return backend.syncable != null;
-}
diff --git a/packages/common/src/interfaces/fs/storage/content-store.ts b/packages/common/src/interfaces/fs/storage/content-store.ts
deleted file mode 100644
index 6c187e2..0000000
--- a/packages/common/src/interfaces/fs/storage/content-store.ts
+++ /dev/null
@@ -1,67 +0,0 @@
-/**
- * @file common/interfaces/fs/storage/content-store.ts
- * @desc Layer 3: 内容存储
- *
- * 纯二进制数据存储。不了解文件类型或元数据。
- * 使用 ref (string) 作为内容寻址 key，对应 MetaRecord.contentRef。
- *
- * - SQLite 后端: ref = ino 的字符串形式，内容存 BLOB 列
- * - FS 后端: ref = 相对文件路径
- * - S3 后端: ref = S3 object key
- * - 内容寻址: ref = SHA256 hash
- */
-
-/** streamData 选项 */
-export interface ContentStreamOptions {
-    /** 分块大小（字节）@default 65536 (64KB) */
-    chunkSize?: number;
-    /** 起始偏移量 @default 0 */
-    startOffset?: number;
-    /** 最大读取字节数，不指定则读取全部 */
-    maxLength?: number;
-}
-
-/** streamData 结果 */
-export interface ContentStreamResult {
-    /** 实际读取的字节数 */
-    bytesRead: number;
-    /** true = 读取到末尾，false = callback 提前终止 */
-    completed: boolean;
-}
-
-export interface IContentStore {
-    /** 写入内容 */
-    putData(ref: string, data: ArrayBuffer): Promise<void>;
-
-    /** 读取内容（完整读取，适合小文件） */
-    getData(ref: string): Promise<ArrayBuffer | null>;
-
-    /** 删除内容 */
-    deleteData(ref: string): Promise<void>;
-
-    /** 检查内容是否存在 */
-    existsData(ref: string): Promise<boolean>;
-
-    /** 获取内容大小（字节） */
-    sizeData(ref: string): Promise<number>;
-
-    /**
-     * 部分读取（大文件场景，可选）
-     * 后端不支持时上层退化为全量读取后截取。
-     */
-    readRange?(ref: string, offset: number, length: number): Promise<ArrayBuffer | null>;
-
-    /** 追加写入（可选） */
-    appendData?(ref: string, data: ArrayBuffer): Promise<void>;
-
-    /**
-     * 流式读取大文件（可选）。
-     * 按 chunkSize 分块回调，callback 返回 false 时停止。
-     * 后端不支持时退化为全量 getData 后分块。
-     */
-    streamData?(
-        ref: string,
-        callback: (chunk: ArrayBuffer, offset: number) => boolean | Promise<boolean>,
-        options?: ContentStreamOptions,
-    ): Promise<ContentStreamResult>;
-}
diff --git a/packages/common/src/interfaces/fs/storage/high-level-backend.ts b/packages/common/src/interfaces/fs/storage/high-level-backend.ts
deleted file mode 100644
index 3ec16f7..0000000
--- a/packages/common/src/interfaces/fs/storage/high-level-backend.ts
+++ /dev/null
@@ -1,35 +0,0 @@
-/**
- * @file common/interfaces/fs/storage/high-level-backend.ts
- * @desc 可选增强：远程后端聚合操作
- *
- * 远程后端（S3、REST API）逐个调用 getInode → getMeta → getData
- * 产生多次网络往返。此接口允许后端提供路径级别的聚合操作。
- *
- * VFS Engine 优先使用这些方法（如果存在），回退到基础方法。
- */
-
-import type { InodeRecord } from './inode-store';
-import type { MetaRecord } from './meta-store';
-
-export interface IHighLevelStore {
-    /** 通过路径一次性读取 inode + meta + data */
-    readByPath?(path: string): Promise<{
-        inode: InodeRecord;
-        meta: MetaRecord;
-        data: ArrayBuffer;
-    } | null>;
-
-    /** 通过路径一次性写入 */
-    writeByPath?(
-        path: string,
-        data: ArrayBuffer,
-        meta?: Partial<MetaRecord>,
-    ): Promise<{ inode: InodeRecord; meta: MetaRecord }>;
-
-    /** 通过路径列出子节点（含 inode + meta） */
-    listByPath?(path: string): Promise<Array<{
-        name: string;
-        inode: InodeRecord;
-        meta: MetaRecord;
-    }>>;
-}
diff --git a/packages/common/src/interfaces/fs/storage/index.ts b/packages/common/src/interfaces/fs/storage/index.ts
index 73fe8d1..9831741 100644
--- a/packages/common/src/interfaces/fs/storage/index.ts
+++ b/packages/common/src/interfaces/fs/storage/index.ts
@@ -1,19 +1,11 @@
 /**
  * @file common/interfaces/fs/storage/index.ts
- * @desc 存储层统一导出
+ * @desc 存储层统一导出（v4.1: 简化为 path-based 单一接口）
  */
 
-// Layer 1
-export type { InodeRecord, IInodeStore, InodeWalkOptions } from './inode-store';
-
-// Layer 2
-export type { MetaRecord, IMetaStore, MetaWalkOptions } from './meta-store';
-
-// Layer 3
-export type { IContentStore } from './content-store';
-
-// 事务作用域
-export type { ITransactionScope } from './backend';
+// 主接口
+export type { IStorageBackend } from './backend';
+export { hasRecordStore } from './backend';
 
 // 可选增强
 export type {
@@ -25,12 +17,3 @@ export type {
     RecordWalkOptions,
     IRecordStore,
 } from './record-backend';
-
-export type { ContentStreamOptions, ContentStreamResult } from './content-store';
-
-export type { IHighLevelStore } from './high-level-backend';
-export type { ISyncableStore } from './syncable-backend';
-
-// 主接口
-export type { IStorageBackend } from './backend';
-export { hasRecordStore, hasHighLevelStore, hasSyncableStore } from './backend';
diff --git a/packages/common/src/interfaces/fs/storage/inode-store.ts b/packages/common/src/interfaces/fs/storage/inode-store.ts
deleted file mode 100644
index 602a029..0000000
--- a/packages/common/src/interfaces/fs/storage/inode-store.ts
+++ /dev/null
@@ -1,83 +0,0 @@
-/**
- * @file common/interfaces/fs/storage/inode-store.ts
- * @desc Layer 1: Inode 存储
- *
- * 只负责节点的存在性、名称、类型、父子关系。
- * 不包含任何元数据或内容信息。
- */
-
-import type { FSNodeType } from '../core/types';
-
-/** IInodeStore.walkTree 遍历选项 */
-export interface InodeWalkOptions {
-    /** 遍历顺序 @default 'depth-first' */
-    order?: 'breadth-first' | 'depth-first';
-    /** 最大深度，-1 无限制 @default -1 */
-    maxDepth?: number;
-}
-
-/**
- * 存储层 Inode 记录
- *
- * 与上层 FSNode 的区别：
- * - 使用 ino (number) 而非 id (string)
- * - 没有元数据字段
- * - 没有路径字段（路径由目录树结构隐含）
- */
-export interface InodeRecord {
-    /** 节点编号（后端内唯一） */
-    ino: number;
-    /** 父节点编号，根节点为 0 */
-    parentIno: number;
-    /** 节点名称 */
-    name: string;
-    /** 文件类型 */
-    type: FSNodeType;
-    /** 创建时间戳 (ms) */
-    createdAt: number;
-    /** 硬链接计数 */
-    nlink: number;
-}
-
-export interface IInodeStore {
-    /** 分配新 inode 编号 */
-    allocateIno(): Promise<number>;
-
-    /** 写入 inode 记录 */
-    putInode(inode: InodeRecord): Promise<void>;
-
-    /** 按 ino 获取 */
-    getInode(ino: number): Promise<InodeRecord | null>;
-
-    /** 在父目录中按名称查找 */
-    lookup(parentIno: number, name: string): Promise<InodeRecord | null>;
-
-    /** 删除 inode */
-    deleteInode(ino: number): Promise<void>;
-
-    /** 更新 inode（重命名/移动/nlink 变更） */
-    updateInode(ino: number, updates: Partial<Pick<InodeRecord, 'parentIno' | 'name' | 'nlink'>>): Promise<void>;
-
-    /**
-     * 流式遍历 inos 列表，找到目标即可停止（替代 batchGetInodes）。
-     * callback 返回 false 时提前终止。
-     */
-    forEachInode(
-        inos: number[],
-        callback: (inode: InodeRecord, index: number) => boolean | Promise<boolean>,
-    ): Promise<void>;
-
-    /**
-     * 遍历以 parentIno 为根的子孙节点（不含 parentIno 本身）。
-     * callback 返回 false 时停止全部遍历，返回 'skip' 时跳过当前节点的子树。
-     * depth 从 0 开始（直接子节点为 0）。
-     */
-    walkTree(
-        parentIno: number,
-        callback: (inode: InodeRecord, depth: number) => boolean | 'skip' | Promise<boolean | 'skip'>,
-        options?: InodeWalkOptions,
-    ): Promise<void>;
-
-    /** 检查 parentIno 是否有直接子节点 */
-    hasChildren(parentIno: number): Promise<boolean>;
-}
diff --git a/packages/common/src/interfaces/fs/storage/meta-store.ts b/packages/common/src/interfaces/fs/storage/meta-store.ts
deleted file mode 100644
index 1277d49..0000000
--- a/packages/common/src/interfaces/fs/storage/meta-store.ts
+++ /dev/null
@@ -1,114 +0,0 @@
-/**
- * @file common/interfaces/fs/storage/meta-store.ts
- * @desc Layer 2: 元数据存储
- *
- * 存储描述性信息：修改时间、版本号、标签、AI 元数据等。
- * 独立于 inode 结构和文件内容。
- *
- * 关键字段：contentRef — 将 meta 与 content 解耦。
- * inode.ino 标识节点身份，contentRef 标识内容位置。
- * 默认 contentRef = String(ino)，但内容寻址后端可设为 SHA256 等。
- */
-
-import type { FSNodeMetadata } from '../core/types';
-
-export interface MetaRecord {
-    /** 对应的 inode 编号 */
-    ino: number;
-
-    /**
-     * 内容引用标识
-     *
-     * 用于查找 IContentStore 中的数据。
-     * 将 inode 与 content 解耦：
-     * - 简单后端: contentRef = String(ino)
-     * - 内容寻址: contentRef = SHA256(content)
-     * - S3: contentRef = s3ObjectKey
-     * - 硬链接: 多个 ino 共享同一个 contentRef
-     *
-     * 无内容的节点（目录、设备等）此字段为 undefined。
-     */
-    contentRef?: string;
-
-    /** 最后修改时间戳 (ms) */
-    modifiedAt: number;
-    /** 文件大小（字节） */
-    size: number;
-    /** 版本号（乐观锁，每次内容写入递增） */
-    version: number;
-    /** 内容哈希（可选，完整性校验） */
-    contentHash?: string;
-    /** MIME 类型 */
-    mimeType?: string;
-    /** 自定义图标 */
-    icon?: string;
-    /** 标签列表 */
-    tags?: string[];
-    /** 自由格式元数据 */
-    metadata?: FSNodeMetadata;
-    /** 符号链接目标 */
-    symlinkTarget?: string;
-    /** 设备处理器 ID */
-    deviceHandlerId?: string;
-    /** 关联的 assetdir ino */
-    assetDirIno?: number;
-    /** 当自身是 assetdir 时，指向宿主文件的 ino */
-    ownerFileIno?: number;
-    /** 是否为 assetdir */
-    isAssetDir?: boolean;
-    /** 插件可写入的扩展字段 */
-    extra?: Record<string, unknown>;
-}
-
-/** IMetaStore 流式查询选项 */
-export interface MetaWalkOptions {
-    limit?: number;
-    offset?: number;
-}
-
-export interface IMetaStore {
-    /** 写入元数据记录 */
-    putMeta(meta: MetaRecord): Promise<void>;
-
-    /** 按 ino 获取 */
-    getMeta(ino: number): Promise<MetaRecord | null>;
-
-    /** 删除 */
-    deleteMeta(ino: number): Promise<void>;
-
-    /** 部分更新（合并语义） */
-    patchMeta(ino: number, partial: Partial<Omit<MetaRecord, 'ino'>>): Promise<void>;
-
-    /**
-     * 流式遍历 inos 列表（替代 batchGetMeta）。
-     * callback 返回 false 时提前终止。
-     */
-    forEachMeta(
-        inos: number[],
-        callback: (meta: MetaRecord, index: number) => boolean | Promise<boolean>,
-    ): Promise<void>;
-
-    /** 返回当前模块内所有已使用的 tag 名称（去重）。直接读索引，O(T)。 */
-    getAllDistinctTags(): Promise<string[]>;
-
-    /**
-     * 按标签流式遍历（替代 queryByTag）。
-     * callback 返回 false 时提前终止。
-     */
-    walkByTag(
-        tag: string,
-        callback: (ino: number) => boolean | Promise<boolean>,
-        options?: MetaWalkOptions,
-    ): Promise<{ total: number; processed: number }>;
-
-    /**
-     * 按元数据字段流式遍历（替代 queryByMetadata）。
-     * callback 返回 false 时提前终止。
-     */
-    walkByMetadata(
-        field: string,
-        value: unknown,
-        callback: (ino: number) => boolean | Promise<boolean>,
-        options?: MetaWalkOptions,
-    ): Promise<{ total: number; processed: number }>;
-}
diff --git a/packages/common/src/interfaces/fs/storage/syncable-backend.ts b/packages/common/src/interfaces/fs/storage/syncable-backend.ts
deleted file mode 100644
index 5f9eab0..0000000
--- a/packages/common/src/interfaces/fs/storage/syncable-backend.ts
+++ /dev/null
@@ -1,20 +0,0 @@
-/**
- * @file common/interfaces/fs/storage/syncable-backend.ts
- * @desc 可选增强：同步支持
- *
- * 后端实现此接口表示它能高效地提供变更日志。
- * 未实现时，ISyncService 通过监听 VFS 事件构建变更日志。
- */
-
-import type { ChangeLogEntry } from '../sync/sync';
-
-export interface ISyncableStore {
-    /** 获取自某个序列号以来的变更 */
-    getChangesSince(seq: number, limit?: number): Promise<ChangeLogEntry[]>;
-
-    /** 获取当前最新序列号 */
-    getLatestSeq(): Promise<number>;
-
-    /** 应用来自远程的变更（批量原子写入） */
-    applyChanges(changes: ChangeLogEntry[]): Promise<void>;
-}
diff --git a/packages/vfslib/src/backend/memory-backend.ts b/packages/vfslib/src/backend/memory-backend.ts
index 9dc12f5..a97a537 100644
--- a/packages/vfslib/src/backend/memory-backend.ts
+++ b/packages/vfslib/src/backend/memory-backend.ts
@@ -1,301 +1,261 @@
 /**
  * @file packages/vfslib/src/backend/memory-backend.ts
- * @desc 内存存储后端 — 用于测试和临时存储
+ * @desc 内存存储后端 — path-based IStorageBackend（测试和临时存储用）
  *
- * 完整实现 IStorageBackend 三层接口。
- * 所有数据存储在 Map 中，进程结束后丢失。
+ * v4.1: 简化为 path-based 统一接口，放弃 IInodeStore/IMetaStore/IContentStore 三层分离。
  */
 
-import type {
-    IStorageBackend,
-    ITransactionScope,
-    IInodeStore,
-    IMetaStore,
-    IContentStore,
-    InodeRecord,
-    MetaRecord,
-    InodeWalkOptions,
-    ContentStreamOptions,
-    ContentStreamResult,
-    MetaWalkOptions,
-} from '@itookit/common';
-
-class MemoryInodeStore implements IInodeStore {
-    private readonly data = new Map<number, InodeRecord>();
-    private nextIno = 2; // 1 is reserved for root
-
-    async allocateIno(): Promise<number> {
-        return this.nextIno++;
-    }
+import type { IStorageBackend, FSNode, FSFileNode, FSDirectoryNode, FSSearchQuery } from '@itookit/common';
+
+interface Entry {
+    type: 'file' | 'directory';
+    content: Uint8Array;
+    createdAt: number;
+    modifiedAt: number;
+    tags: string[];
+    metadata: Record<string, unknown>;
+    icon?: string;
+    symlinkTarget?: string;
+    extra?: Record<string, unknown>;
+}
 
-    async putInode(inode: InodeRecord): Promise<void> {
-        this.data.set(inode.ino, { ...inode });
-    }
+const ROOT_ENTRY: Entry = Object.freeze({
+    type: 'directory' as const,
+    content: new Uint8Array(0),
+    createdAt: Date.now(),
+    modifiedAt: Date.now(),
+    tags: [],
+    metadata: {},
+});
 
-    async getInode(ino: number): Promise<InodeRecord | null> {
-        const rec = this.data.get(ino);
-        return rec ? { ...rec } : null;
-    }
+export class MemoryBackend implements IStorageBackend {
+    readonly name = 'memory';
+    private data = new Map<string, Entry>();
 
-    async lookup(parentIno: number, name: string): Promise<InodeRecord | null> {
-        for (const rec of this.data.values()) {
-            if (rec.parentIno === parentIno && rec.name === name) {
-                return { ...rec };
-            }
-        }
-        return null;
+    async init(): Promise<void> {
+        this.data.set('/', { ...ROOT_ENTRY, createdAt: Date.now(), modifiedAt: Date.now() });
     }
 
-    async deleteInode(ino: number): Promise<void> {
-        this.data.delete(ino);
+    async close(): Promise<void> {
+        this.data.clear();
     }
 
-    async updateInode(
-        ino: number,
-        updates: Partial<Pick<InodeRecord, 'parentIno' | 'name' | 'nlink'>>,
-    ): Promise<void> {
-        const rec = this.data.get(ino);
-        if (!rec) return;
-        if (updates.parentIno !== undefined) rec.parentIno = updates.parentIno;
-        if (updates.name !== undefined) rec.name = updates.name;
-        if (updates.nlink !== undefined) rec.nlink = updates.nlink;
+    // ── Structure ──
+
+    async stat(path: string): Promise<FSNode | null> {
+        const entry = this.data.get(normalize(path));
+        if (!entry) return null;
+        return toFSNode(path, entry);
     }
 
-    async forEachInode(
-        inos: number[],
-        callback: (inode: InodeRecord, index: number) => boolean | Promise<boolean>,
-    ): Promise<void> {
-        for (let i = 0; i < inos.length; i++) {
-            const rec = this.data.get(inos[i]);
-            if (rec) {
-                if (!(await callback({ ...rec }, i))) break;
+    async list(path: string): Promise<FSNode[]> {
+        const parent = normalize(path);
+        if (!this.data.has(parent)) return [];
+        const prefix = parent === '/' ? '/' : parent + '/';
+        const seen = new Set<string>();
+        const results: FSNode[] = [];
+
+        for (const [p, entry] of this.data) {
+            if (p === parent || !p.startsWith(prefix)) continue;
+            const rest = p.slice(prefix.length);
+            const segEnd = rest.indexOf('/');
+            const seg = segEnd === -1 ? rest : rest.slice(0, segEnd);
+            const fullPath = segEnd === -1 ? p : parent + '/' + seg;
+            if (seen.has(fullPath)) continue;
+            seen.add(fullPath);
+
+            const childEntry = this.data.get(fullPath);
+            if (childEntry) {
+                results.push(toFSNode(fullPath, childEntry));
             }
         }
+        return results;
     }
 
-    async walkTree(
-        parentIno: number,
-        callback: (inode: InodeRecord, depth: number) => boolean | 'skip' | Promise<boolean | 'skip'>,
-        options?: InodeWalkOptions,
-    ): Promise<void> {
-        if (options?.order === 'breadth-first') {
-            await this._walkBFS(parentIno, callback, options?.maxDepth ?? -1);
-        } else {
-            await this._walkDFS(parentIno, callback, 0, options?.maxDepth ?? -1);
+    async mkdir(path: string): Promise<FSNode> {
+        const p = normalize(path);
+        if (this.data.has(p)) {
+            const existing = this.data.get(p)!;
+            return toFSNode(p, existing);
         }
+        const entry: Entry = {
+            type: 'directory',
+            content: new Uint8Array(0),
+            createdAt: Date.now(),
+            modifiedAt: Date.now(),
+            tags: [],
+            metadata: {},
+        };
+        this.data.set(p, entry);
+        return toFSNode(p, entry);
     }
 
-    private async _walkDFS(
-        parentIno: number,
-        callback: (inode: InodeRecord, depth: number) => boolean | 'skip' | Promise<boolean | 'skip'>,
-        depth: number,
-        maxDepth: number,
-    ): Promise<boolean> {
-        for (const rec of this.data.values()) {
-            if (rec.parentIno !== parentIno || rec.ino === parentIno) continue;
-            const result = await callback({ ...rec }, depth);
-            if (result === false) return false;
-            if (result !== 'skip' && rec.type === 'directory' && (maxDepth < 0 || depth < maxDepth)) {
-                if (!(await this._walkDFS(rec.ino, callback, depth + 1, maxDepth))) return false;
-            }
-        }
-        return true;
-    }
+    async delete(path: string, options?: { recursive?: boolean }): Promise<void> {
+        const p = normalize(path);
+        if (!this.data.has(p)) return;
+        const prefix = p === '/' ? '/' : p + '/';
 
-    private async _walkBFS(
-        parentIno: number,
-        callback: (inode: InodeRecord, depth: number) => boolean | 'skip' | Promise<boolean | 'skip'>,
-        maxDepth: number,
-    ): Promise<void> {
-        const queue: Array<{ ino: number; depth: number }> = [{ ino: parentIno, depth: -1 }];
-        while (queue.length > 0) {
-            const { ino, depth } = queue.shift()!;
-            const nextDepth = depth + 1;
-            if (maxDepth >= 0 && nextDepth > maxDepth) continue;
-            for (const rec of this.data.values()) {
-                if (rec.parentIno !== ino || rec.ino === ino) continue;
-                const result = await callback({ ...rec }, nextDepth);
-                if (result === false) return;
-                if (result !== 'skip' && rec.type === 'directory' && (maxDepth < 0 || nextDepth < maxDepth)) {
-                    queue.push({ ino: rec.ino, depth: nextDepth });
-                }
+        if (options?.recursive) {
+            for (const key of this.data.keys()) {
+                if (key.startsWith(prefix)) this.data.delete(key);
             }
         }
+        this.data.delete(p);
     }
 
-    async hasChildren(parentIno: number): Promise<boolean> {
-        for (const rec of this.data.values()) {
-            if (rec.parentIno === parentIno && rec.ino !== parentIno) return true;
+    async rename(fromPath: string, toPath: string): Promise<void> {
+        const from = normalize(fromPath);
+        const to = normalize(toPath);
+        const entry = this.data.get(from);
+        if (!entry) return;
+        const fromPrefix = from === '/' ? '/' : from + '/';
+        const toPrefix = to === '/' ? '/' : to + '/';
+
+        this.data.delete(from);
+        this.data.set(to, { ...entry, modifiedAt: Date.now() });
+
+        // Move children
+        for (const [p, e] of this.data) {
+            if (p.startsWith(fromPrefix)) {
+                const childRest = p.slice(fromPrefix.length - 1);
+                const newChildPath = to === '/' ? childRest : to + childRest;
+                this.data.delete(p);
+                this.data.set(newChildPath, e);
+            }
         }
-        return false;
     }
-}
 
-class MemoryMetaStore implements IMetaStore {
-    private readonly data = new Map<number, MetaRecord>();
+    // ── Content ──
 
-    async putMeta(meta: MetaRecord): Promise<void> {
-        this.data.set(meta.ino, { ...meta });
+    async read(path: string, options?: { offset?: number; length?: number }): Promise<Uint8Array> {
+        const entry = this.data.get(normalize(path));
+        if (!entry) throw new Error('ENOENT');
+        let buf = entry.content;
+        if (options?.offset !== undefined) {
+            buf = buf.slice(options.offset, options.length ? options.offset + options.length : undefined);
+        }
+        return buf;
     }
 
-    async getMeta(ino: number): Promise<MetaRecord | null> {
-        const rec = this.data.get(ino);
-        return rec ? { ...rec } : null;
+    async write(path: string, content: Uint8Array): Promise<FSNode> {
+        const p = normalize(path);
+        const existing = this.data.get(p);
+        const entry: Entry = {
+            type: 'file',
+            content: new Uint8Array(content),
+            createdAt: existing?.createdAt ?? Date.now(),
+            modifiedAt: Date.now(),
+            tags: existing?.tags ?? [],
+            metadata: existing?.metadata ?? {},
+            icon: existing?.icon,
+            symlinkTarget: existing?.symlinkTarget,
+            extra: existing?.extra,
+        };
+        this.data.set(p, entry);
+        return toFSNode(p, entry);
     }
 
-    async deleteMeta(ino: number): Promise<void> {
-        this.data.delete(ino);
-    }
+    // ── Metadata ──
 
-    async patchMeta(ino: number, partial: Partial<Omit<MetaRecord, 'ino'>>): Promise<void> {
-        const rec = this.data.get(ino);
-        if (!rec) return;
-        Object.assign(rec, partial);
+    async updateMetadata(path: string, metadata: Record<string, unknown>): Promise<void> {
+        const entry = this.data.get(normalize(path));
+        if (!entry) return;
+        entry.metadata = { ...entry.metadata, ...metadata };
+        entry.modifiedAt = Date.now();
     }
 
-    async forEachMeta(
-        inos: number[],
-        callback: (meta: MetaRecord, index: number) => boolean | Promise<boolean>,
-    ): Promise<void> {
-        for (let i = 0; i < inos.length; i++) {
-            const rec = this.data.get(inos[i]);
-            if (rec) {
-                if (!(await callback({ ...rec }, i))) break;
-            }
-        }
+    async setTags(path: string, tags: string[]): Promise<void> {
+        const entry = this.data.get(normalize(path));
+        if (!entry) return;
+        entry.tags = tags;
+        entry.modifiedAt = Date.now();
     }
 
-    async getAllDistinctTags(): Promise<string[]> {
+    async getAllTags(): Promise<string[]> {
         const seen = new Set<string>();
-        for (const rec of this.data.values()) {
-            for (const tag of rec.tags ?? []) seen.add(tag);
+        for (const entry of this.data.values()) {
+            for (const t of entry.tags) seen.add(t);
         }
-        return Array.from(seen);
+        return [...seen];
     }
 
-    async walkByTag(
-        tag: string,
-        callback: (ino: number) => boolean | Promise<boolean>,
-        options?: MetaWalkOptions,
-    ): Promise<{ total: number; processed: number }> {
-        const matched: number[] = [];
-        for (const rec of this.data.values()) {
-            if (rec.tags?.includes(tag)) matched.push(rec.ino);
-        }
-        const total = matched.length;
-        let processed = 0;
-        const offset = options?.offset ?? 0;
-        const limit = options?.limit ?? Infinity;
-        for (let i = offset; i < matched.length && processed < limit; i++) {
-            if (!(await callback(matched[i]))) break;
-            processed++;
-        }
-        return { total, processed };
-    }
+    // ── Search ──
 
-    async walkByMetadata(
-        field: string,
-        value: unknown,
-        callback: (ino: number) => boolean | Promise<boolean>,
-        options?: MetaWalkOptions,
-    ): Promise<{ total: number; processed: number }> {
-        const matched: number[] = [];
-        for (const rec of this.data.values()) {
-            if (rec.metadata && rec.metadata[field] === value) matched.push(rec.ino);
+    async search(query: FSSearchQuery): Promise<FSNode[]> {
+        const results: FSNode[] = [];
+        for (const [path, entry] of this.data) {
+            const node = toFSNode(path, entry);
+            if (matchesSearch(node, query)) results.push(node);
         }
-        const total = matched.length;
-        let processed = 0;
-        const offset = options?.offset ?? 0;
-        const limit = options?.limit ?? Infinity;
-        for (let i = offset; i < matched.length && processed < limit; i++) {
-            if (!(await callback(matched[i]))) break;
-            processed++;
+        if (query.orderBy === 'modifiedAt') {
+            results.sort((a, b) => query.orderDirection === 'desc' ? b.modifiedAt - a.modifiedAt : a.modifiedAt - b.modifiedAt);
         }
-        return { total, processed };
+        const offset = query.offset ?? 0;
+        const limit = query.limit ?? 50;
+        return results.slice(offset, offset + limit);
     }
-}
 
-class MemoryContentStore implements IContentStore {
-    private readonly data = new Map<string, ArrayBuffer>();
+    // ── Transaction ──
 
-    async putData(ref: string, data: ArrayBuffer): Promise<void> {
-        this.data.set(ref, data.slice(0));
+    async transaction<T>(fn: (tx: IStorageBackend) => Promise<T>): Promise<T> {
+        return fn(this); // Memory backend: no isolation
     }
+}
 
-    async getData(ref: string): Promise<ArrayBuffer | null> {
-        const buf = this.data.get(ref);
-        return buf ? buf.slice(0) : null;
-    }
+// ── Helpers ──
 
-    async deleteData(ref: string): Promise<void> {
-        this.data.delete(ref);
-    }
+function normalize(path: string): string {
+    if (path === '' || path === '/') return '/';
+    return '/' + path.split('/').filter(Boolean).join('/');
+}
 
-    async existsData(ref: string): Promise<boolean> {
-        return this.data.has(ref);
+function toFSNode(path: string, entry: Entry): FSNode {
+    const name = path === '/' ? '' : path.split('/').pop()!;
+    const parentDir = path === '/' ? null : path.substring(0, path.lastIndexOf('/')) || '/';
+    const base = {
+        id: path,
+        parentId: parentDir,
+        name,
+        path,
+        createdAt: entry.createdAt,
+        modifiedAt: entry.modifiedAt,
+        version: Math.floor(entry.modifiedAt),
+        nlink: 1,
+        tags: entry.tags,
+        metadata: entry.metadata,
+        icon: entry.icon,
+    };
+
+    if (entry.type === 'directory') {
+        return { ...base, type: 'directory' } as FSDirectoryNode;
     }
 
-    async sizeData(ref: string): Promise<number> {
-        return this.data.get(ref)?.byteLength ?? 0;
-    }
+    const fileBase = {
+        ...base,
+        type: 'file' as const,
+        size: entry.content.byteLength,
+        contentHash: undefined,
+        assetDirId: undefined,
+    };
 
-    async appendData(ref: string, data: ArrayBuffer): Promise<void> {
-        const existing = this.data.get(ref);
-        if (existing) {
-            const merged = new Uint8Array(existing.byteLength + data.byteLength);
-            merged.set(new Uint8Array(existing), 0);
-            merged.set(new Uint8Array(data), existing.byteLength);
-            this.data.set(ref, merged.buffer as ArrayBuffer);
-        } else {
-            this.data.set(ref, data.slice(0));
-        }
+    if (entry.symlinkTarget) {
+        return { ...fileBase, type: 'symlink' as const, symlinkTarget: entry.symlinkTarget } as FSNode;
     }
 
-    async streamData(
-        ref: string,
-        callback: (chunk: ArrayBuffer, offset: number) => boolean | Promise<boolean>,
-        options?: ContentStreamOptions,
-    ): Promise<ContentStreamResult> {
-        const data = await this.getData(ref);
-        if (!data) return { bytesRead: 0, completed: false };
-        const chunkSize = options?.chunkSize ?? 65536;
-        const start = options?.startOffset ?? 0;
-        const end = options?.maxLength != null ? start + options.maxLength : data.byteLength;
-        let offset = start;
-        let bytesRead = 0;
-        while (offset < end) {
-            const chunk = data.slice(offset, Math.min(offset + chunkSize, end));
-            if (!(await callback(chunk, offset))) return { bytesRead, completed: false };
-            bytesRead += chunk.byteLength;
-            offset += chunk.byteLength;
-        }
-        return { bytesRead, completed: true };
-    }
+    return fileBase as FSFileNode;
 }
 
-export class MemoryBackend implements IStorageBackend {
-    readonly name = 'memory';
-    readonly inodes: IInodeStore = new MemoryInodeStore();
-    readonly meta: IMetaStore = new MemoryMetaStore();
-    readonly content: IContentStore = new MemoryContentStore();
-
-    async init(): Promise<void> {
-        // No-op
-    }
-
-    async close(): Promise<void> {
-        // No-op
-    }
-
-    async runInTransaction<T>(
-        _mode: 'readonly' | 'readwrite',
-        fn: (scope: ITransactionScope) => Promise<T>,
-    ): Promise<T> {
-        // Memory backend: no real transaction — passthrough
-        return fn({
-            inodes: this.inodes,
-            meta: this.meta,
-            content: this.content,
-        });
+function matchesSearch(node: FSNode, q: FSSearchQuery): boolean {
+    if (q.type) {
+        const types = Array.isArray(q.type) ? q.type : [q.type];
+        if (!types.includes(node.type)) return false;
     }
+    if (q.name?.contains && !node.name.toLowerCase().includes(q.name.contains.toLowerCase())) return false;
+    if (q.name?.exact && node.name !== q.name.exact) return false;
+    if (q.name?.startsWith && !node.name.startsWith(q.name.startsWith)) return false;
+    if (q.tags?.all && !q.tags.all.every(t => node.tags.includes(t))) return false;
+    if (q.tags?.any && !q.tags.any.some(t => node.tags.includes(t))) return false;
+    if (q.tags?.none && q.tags.none.some(t => node.tags.includes(t))) return false;
+    if (q.text && node.type === 'file') return false; // Memory backend can't full-text search content
+    return true;
 }
diff --git a/packages/vfslib/src/engine/index.ts b/packages/vfslib/src/engine/index.ts
index db4459c..704cfee 100644
--- a/packages/vfslib/src/engine/index.ts
+++ b/packages/vfslib/src/engine/index.ts
@@ -1,11 +1,9 @@
 /**
  * @file packages/vfslib/src/engine/index.ts
+ * v4.1: Path-based engine — no ino resolution.
  */
 
-export { VFSEngine, ROOT_INO } from './vfs-engine';
-export { PathResolver, type ResolvedInode } from './path-resolver';
-export { toFSNode } from './node-mapper';
+export { VFSEngine } from './vfs-engine';
 export { AccessController, type CallerIdentity, SYSTEM_CALLER } from './access-controller';
 export { PluginPipeline } from './plugin-pipeline';
 export { DeviceRegistry } from './device-registry';
-export { deleteRecursive, copyRecursive } from './tree-ops';
diff --git a/packages/vfslib/src/engine/node-mapper.ts b/packages/vfslib/src/engine/node-mapper.ts
deleted file mode 100644
index 8c62616..0000000
--- a/packages/vfslib/src/engine/node-mapper.ts
+++ /dev/null
@@ -1,79 +0,0 @@
-/**
- * @file packages/vfslib/src/engine/node-mapper.ts
- * @desc InodeRecord + MetaRecord → FSNode 映射
- */
-
-import type {
-    FSNode,
-    FSFileNode,
-    FSDirectoryNode,
-    FSSeqFileNode,
-    FSDeviceNode,
-    FSSymlinkNode,
-    InodeRecord,
-    MetaRecord,
-} from '@itookit/common';
-
-export function toFSNode(
-    inode: InodeRecord,
-    meta: MetaRecord | null,
-    id: string,
-    parentId: string | null,
-    path: string,
-): FSNode {
-    const base = {
-        id,
-        parentId,
-        name: inode.name,
-        createdAt: inode.createdAt,
-        modifiedAt: meta?.modifiedAt ?? inode.createdAt,
-        path,
-        version: meta?.version ?? 0,
-        nlink: inode.nlink,
-        tags: Object.freeze(meta?.tags ?? []) as readonly string[],
-        metadata: Object.freeze(meta?.metadata ?? {}),
-        icon: meta?.icon,
-        mimeType: meta?.mimeType,
-    };
-
-    switch (inode.type) {
-        case 'file':
-            return Object.freeze<FSFileNode>({
-                ...base,
-                type: 'file',
-                size: meta?.size ?? 0,
-                contentHash: meta?.contentHash,
-                assetDirId: meta?.assetDirIno?.toString(),
-            });
-
-        case 'directory':
-            return Object.freeze<FSDirectoryNode>({
-                ...base,
-                type: 'directory',
-            });
-
-        case 'seqfile':
-            return Object.freeze<FSSeqFileNode>({
-                ...base,
-                type: 'seqfile',
-                assetDirId: meta?.assetDirIno?.toString(),
-            });
-
-        case 'device':
-            return Object.freeze<FSDeviceNode>({
-                ...base,
-                type: 'device',
-                deviceHandlerId: meta?.deviceHandlerId ?? '',
-            });
-
-        case 'symlink':
-            return Object.freeze<FSSymlinkNode>({
-                ...base,
-                type: 'symlink',
-                symlinkTarget: meta?.symlinkTarget ?? '',
-            });
-
-        default:
-            throw new Error(`Unknown inode type: ${inode.type}`);
-    }
-}
diff --git a/packages/vfslib/src/engine/path-resolver.ts b/packages/vfslib/src/engine/path-resolver.ts
deleted file mode 100644
index 50a34f8..0000000
--- a/packages/vfslib/src/engine/path-resolver.ts
+++ /dev/null
@@ -1,154 +0,0 @@
-/**
- * @file packages/vfslib/src/engine/path-resolver.ts
- * @desc 路径解析引擎
- */
-
-import type {
-    IStorageBackend,
-    InodeRecord,
-    MetaRecord,
-} from '@itookit/common';
-
-import {
-    FSNotFoundError,
-    FSSymlinkLoopError,
-    FSError,
-    DEFAULT_MAX_SYMLINK_DEPTH,
-} from '@itookit/common';
-
-import * as pathUtils from '../utils/path';
-
-export interface ResolvedInode {
-    readonly inode: InodeRecord;
-    readonly meta: MetaRecord | null;
-    readonly ino: number;
-    readonly parentIno: number;
-    readonly name: string;
-    readonly fullPath: string;
-}
-
-type StoreAccessor = Pick<IStorageBackend, 'inodes' | 'meta'>;
-
-export class PathResolver {
-    constructor(
-        private readonly maxSymlinkDepth: number = DEFAULT_MAX_SYMLINK_DEPTH,
-    ) {}
-
-    async resolve(
-        store: StoreAccessor,
-        rootIno: number,
-        path: string,
-        followLastSymlink = true,
-    ): Promise<ResolvedInode> {
-        return this.resolveInternal(store, rootIno, path, followLastSymlink, 0);
-    }
-
-    async tryResolve(
-        store: StoreAccessor,
-        rootIno: number,
-        path: string,
-        followLastSymlink = true,
-    ): Promise<ResolvedInode | null> {
-        try {
-            return await this.resolve(store, rootIno, path, followLastSymlink);
-        } catch (e) {
-            if (e instanceof FSNotFoundError) return null;
-            throw e;
-        }
-    }
-
-    private async resolveInternal(
-        store: StoreAccessor,
-        rootIno: number,
-        path: string,
-        followLastSymlink: boolean,
-        symlinkCount: number,
-    ): Promise<ResolvedInode> {
-        if (symlinkCount > this.maxSymlinkDepth) {
-            throw new FSSymlinkLoopError(path);
-        }
-
-        const segs = pathUtils.segments(pathUtils.normalize(path));
-
-        const rootInode = await this.getInode(store, rootIno);
-        if (segs.length === 0) {
-            const rootMeta = await store.meta.getMeta(rootIno);
-            return {
-                inode: rootInode,
-                meta: rootMeta,
-                ino: rootIno,
-                parentIno: rootIno,
-                name: '',
-                fullPath: '/',
-            };
-        }
-
-        let currentIno = rootIno;
-        let currentInode = rootInode;
-        let parentIno = rootIno;
-        let builtPath = '/';
-
-        for (let i = 0; i < segs.length; i++) {
-            const seg = segs[i];
-            const isLast = i === segs.length - 1;
-
-            if (currentInode.type !== 'directory') {
-                throw new FSError('ENOTDIR', `not a directory: ${builtPath}`, 'resolve', builtPath);
-            }
-
-            const child = await store.inodes.lookup(currentIno, seg);
-            if (!child) {
-                throw new FSNotFoundError(pathUtils.join(builtPath, seg), 'resolve');
-            }
-
-            parentIno = currentIno;
-            currentIno = child.ino;
-            currentInode = child;
-            builtPath = pathUtils.join(builtPath, seg);
-
-            const shouldFollow = isLast ? followLastSymlink : true;
-            if (currentInode.type === 'symlink' && shouldFollow) {
-                const meta = await store.meta.getMeta(currentIno);
-                const target = meta?.symlinkTarget;
-                if (!target) {
-                    throw new FSError('EIO', 'symlink has no target', 'resolve', builtPath);
-                }
-
-                const resolvedTarget = target.startsWith('/')
-                    ? target
-                    : pathUtils.join(pathUtils.dirname(builtPath), target);
-
-                const remaining = segs.slice(i + 1);
-                const fullTarget = remaining.length > 0
-                    ? pathUtils.join(resolvedTarget, ...remaining)
-                    : resolvedTarget;
-
-                return this.resolveInternal(
-                    store,
-                    rootIno,
-                    fullTarget,
-                    followLastSymlink,
-                    symlinkCount + 1,
-                );
-            }
-        }
-
-        const meta = await store.meta.getMeta(currentIno);
-        return {
-            inode: currentInode,
-            meta,
-            ino: currentIno,
-            parentIno,
-            name: segs[segs.length - 1],
-            fullPath: builtPath,
-        };
-    }
-
-    private async getInode(store: StoreAccessor, ino: number): Promise<InodeRecord> {
-        const inode = await store.inodes.getInode(ino);
-        if (!inode) {
-            throw new FSError('EIO', `inode ${ino} not found in store`, 'resolve');
-        }
-        return inode;
-    }
-}
diff --git a/packages/vfslib/src/engine/tree-ops.ts b/packages/vfslib/src/engine/tree-ops.ts
deleted file mode 100644
index 235cbb3..0000000
--- a/packages/vfslib/src/engine/tree-ops.ts
+++ /dev/null
@@ -1,134 +0,0 @@
-/**
- * @file packages/vfslib/src/engine/tree-ops.ts
- * @desc 树操作工具 — 递归删除、递归复制
- */
-
-import type {
-    IStorageBackend,
-    IRecordStore,
-    InodeRecord,
-} from '@itookit/common';
-
-type StoreAccessor = Pick<IStorageBackend, 'inodes' | 'meta' | 'content'> & {
-    readonly records?: IRecordStore;
-};
-
-type DeleteItem = { ino: number; type: string; contentRef?: string };
-
-export async function deleteRecursive(
-    store: StoreAccessor,
-    ino: number,
-): Promise<number[]> {
-    const rootInode = await store.inodes.getInode(ino);
-    if (!rootInode) return [];
-
-    // Collect root + all descendants in DFS pre-order (parent before children).
-    const items: DeleteItem[] = [];
-    const rootMeta = await store.meta.getMeta(ino);
-    items.push({ ino, type: rootInode.type, contentRef: rootMeta?.contentRef });
-
-    await store.inodes.walkTree(ino, async (inode) => {
-        const meta = await store.meta.getMeta(inode.ino);
-        items.push({ ino: inode.ino, type: inode.type, contentRef: meta?.contentRef });
-        return true;
-    }, { maxDepth: -1 });
-
-    // Reverse so children are deleted before their parent.
-    items.reverse();
-
-    const deleted: number[] = [];
-    for (const item of items) {
-        if (item.contentRef) {
-            await store.content.deleteData(item.contentRef);
-        }
-        // Seqfile stores key-value data in the records table; clean it up to avoid orphans.
-        if (item.type === 'seqfile' && store.records) {
-            await store.records.clearRecordFields(item.ino);
-        }
-        await store.meta.deleteMeta(item.ino);
-        await store.inodes.deleteInode(item.ino);
-        deleted.push(item.ino);
-    }
-
-    return deleted;
-}
-
-export async function copyRecursive(
-    store: StoreAccessor,
-    sourceIno: number,
-    targetParentIno: number,
-    newName: string,
-): Promise<Map<number, number>> {
-    const mapping = new Map<number, number>();
-    await copyWalk(store, sourceIno, targetParentIno, newName, mapping);
-    return mapping;
-}
-
-async function copyWalk(
-    store: StoreAccessor,
-    sourceIno: number,
-    targetParentIno: number,
-    name: string,
-    mapping: Map<number, number>,
-): Promise<number> {
-    const sourceInode = await store.inodes.getInode(sourceIno);
-    if (!sourceInode) {
-        throw new Error(`Source inode ${sourceIno} not found`);
-    }
-
-    const sourceMeta = await store.meta.getMeta(sourceIno);
-    const newIno = await store.inodes.allocateIno();
-    mapping.set(sourceIno, newIno);
-
-    const now = Date.now();
-
-    const newInode: InodeRecord = {
-        ino: newIno,
-        parentIno: targetParentIno,
-        name,
-        type: sourceInode.type,
-        createdAt: now,
-        nlink: 1,
-    };
-    await store.inodes.putInode(newInode);
-
-    let newContentRef: string | undefined;
-    if (sourceMeta?.contentRef) {
-        const data = await store.content.getData(sourceMeta.contentRef);
-        if (data) {
-            newContentRef = `data_${newIno}`;
-            await store.content.putData(newContentRef, data);
-        }
-    }
-
-    if (sourceMeta) {
-        await store.meta.putMeta({
-            ...sourceMeta,
-            ino: newIno,
-            contentRef: newContentRef,
-            modifiedAt: now,
-            version: 0,
-        });
-    }
-
-    // Copy seqfile records to the new inode.
-    if (sourceInode.type === 'seqfile' && store.records) {
-        await store.records.walkRecordFields(sourceIno, async (field, value) => {
-            await store.records!.setRecordField(newIno, field, value);
-            return true;
-        });
-    }
-
-    if (sourceInode.type === 'directory') {
-        const children: InodeRecord[] = [];
-        await store.inodes.walkTree(sourceIno, async (inode, depth) => {
-            if (depth === 0) { children.push(inode); return 'skip'; }
-            return false;
-        }, { maxDepth: 0 });
-        for (const child of children) {
-            await copyWalk(store, child.ino, newIno, child.name, mapping);
-        }
-    }
-
-    return newIno;
-}
diff --git a/packages/vfslib/src/engine/vfs-engine.ts b/packages/vfslib/src/engine/vfs-engine.ts
index debb922..24bd7aa 100644
--- a/packages/vfslib/src/engine/vfs-engine.ts
+++ b/packages/vfslib/src/engine/vfs-engine.ts
@@ -1,48 +1,38 @@
 /**
  * @file packages/vfslib/src/engine/vfs-engine.ts
- * @desc VFS 引擎 — 系统级核心操作
+ * @desc VFS 引擎 — 系统级核心操作（v4.1: path-based 后端）
  *
  * 职责：
- * - 管理根后端
+ * - 管理根后端 + 挂载路由
  * - Bootstrap 基础目录结构 (/etc, /dev, /module)
- * - 系统级路径解析与文件操作
+ * - 系统级路径操作
  * - 持有 plugin pipeline、device registry、event bus、access controller
+ *
+ * v4.1 变更：
+ * - 废弃 IInodeStore/IMetaStore/IContentStore 三层分离
+ * - 所有存储操作通过 path-based IStorageBackend 接口
+ * - 删除 PathResolver、node-mapper、ROOT_INO、contentRef 中间层
  */
 
 import type {
     IStorageBackend,
-    InodeRecord,
-    MetaRecord,
-    FSNodeType,
     FileContent,
     WriteOptions,
     DeleteOptions,
-    RenameOptions,
-    MoveOptions,
     IMountRouter,
 } from '@itookit/common';
 
-import {
-    FSError,
-    FSAlreadyExistsError,
-    FSConflictError,
-    SYSTEM_DIRS,
-} from '@itookit/common';
+import { FSError, FSAlreadyExistsError, FSCapabilityError, SYSTEM_DIRS } from '@itookit/common';
 
-import { PathResolver, type ResolvedInode } from './path-resolver';
 import { AccessController } from './access-controller';
 import { EventBus } from '../event/event-bus';
 import { PluginPipeline } from './plugin-pipeline';
 import { DeviceRegistry } from './device-registry';
-import { deleteRecursive } from './tree-ops';
 import { toBuffer, toString } from '../utils/encoding';
 import * as P from '../utils/path';
 import { toAssetDirName, validateFilename } from '../utils/validation';
 
-export const ROOT_INO = 1;
-
 export class VFSEngine {
-    readonly resolver: PathResolver;
     readonly access: AccessController;
     readonly events: EventBus;
     readonly plugins: PluginPipeline;
@@ -54,62 +44,35 @@ export class VFSEngine {
 
     constructor(
         backend: IStorageBackend,
-        options?: { maxSymlinkDepth?: number },
     ) {
         this.backend = backend;
-        this.resolver = new PathResolver(options?.maxSymlinkDepth);
         this.access = new AccessController();
         this.events = new EventBus();
         this.plugins = new PluginPipeline();
         this.devices = new DeviceRegistry();
     }
 
-    get store(): IStorageBackend {
-        return this.backend;
-    }
-
-    getBackend(): IStorageBackend {
-        return this.backend;
-    }
+    get store(): IStorageBackend { return this.backend; }
+    getBackend(): IStorageBackend { return this.backend; }
 
-    /** Wire in the mount router so path operations route to the correct backend. */
-    setMountRouter(router: IMountRouter): void {
-        this._mountRouter = router;
-    }
+    setMountRouter(router: IMountRouter): void { this._mountRouter = router; }
 
-    /** Returns the backend responsible for `systemPath`. Falls back to root backend. */
     getBackendForPath(systemPath: string): IStorageBackend {
         if (!this._mountRouter) return this.backend;
         return this._mountRouter.resolve(systemPath).mount.backend;
     }
 
-    /** Returns the mount path (e.g. '/module/home') that owns `systemPath`. */
     getMountPathForPath(systemPath: string): string {
         if (!this._mountRouter) return '/';
         return this._mountRouter.resolve(systemPath).mount.mountPath;
     }
 
-    /**
-     * Returns the backend, local path, and mount path for a system path.
-     * For root-backend paths the original systemPath is preserved and mountPath is '/'.
-     * For mounted paths localPath is stripped of the mount prefix.
-     */
-    private getMountedStore(systemPath: string): { backend: IStorageBackend; localPath: string; mountPath: string } {
-        if (!this._mountRouter) return { backend: this.backend, localPath: systemPath, mountPath: '/' };
+    /** Resolve backend + local path for a system path. */
+    private resolveStore(systemPath: string): { backend: IStorageBackend; localPath: string } {
+        if (!this._mountRouter) return { backend: this.backend, localPath: systemPath };
         const { mount, relativePath } = this._mountRouter.resolve(systemPath);
-        if (mount.backend === this.backend) return { backend: this.backend, localPath: systemPath, mountPath: '/' };
-        const localPath = relativePath ? '/' + relativePath : '/';
-        return { backend: mount.backend, localPath, mountPath: mount.mountPath };
-    }
-
-    inoToId(ino: number): string {
-        return String(ino);
-    }
-
-    idToIno(id: string): number {
-        const n = parseInt(id, 10);
-        if (isNaN(n)) throw new FSError('EINVAL', `invalid node id: ${id}`);
-        return n;
+        if (mount.backend === this.backend) return { backend: this.backend, localPath: systemPath };
+        return { backend: mount.backend, localPath: relativePath ? '/' + relativePath : '/' };
     }
 
     // ── Lifecycle ──
@@ -132,729 +95,352 @@ export class VFSEngine {
         this.initialized = false;
     }
 
-    // ── Bootstrap ── (always uses root backend)
-
     private async bootstrap(): Promise<void> {
-        await this.backend.runInTransaction('readwrite', async (scope) => {
-            const rootInode = await scope.inodes.getInode(ROOT_INO);
-            if (!rootInode) {
-                await scope.inodes.putInode({
-                    ino: ROOT_INO,
-                    parentIno: ROOT_INO,
-                    name: '',
-                    type: 'directory',
-                    createdAt: Date.now(),
-                    nlink: 1,
-                });
-                await scope.meta.putMeta({
-                    ino: ROOT_INO,
-                    modifiedAt: Date.now(),
-                    size: 0,
-                    version: 0,
-                });
-            }
-
-            for (const dirName of SYSTEM_DIRS) {
-                const existing = await scope.inodes.lookup(ROOT_INO, dirName);
-                if (!existing) {
-                    const ino = await scope.inodes.allocateIno();
-                    await scope.inodes.putInode({
-                        ino,
-                        parentIno: ROOT_INO,
-                        name: dirName,
-                        type: 'directory',
-                        createdAt: Date.now(),
-                        nlink: 1,
-                    });
-                    await scope.meta.putMeta({
-                        ino,
-                        modifiedAt: Date.now(),
-                        size: 0,
-                        version: 0,
-                    });
-                }
+        // Ensure root and system directories exist
+        if (!(await this.backend.stat('/'))) {
+            await this.backend.mkdir('/');
+        }
+        for (const dirName of SYSTEM_DIRS) {
+            if (!(await this.backend.stat(`/${dirName}`))) {
+                await this.backend.mkdir(`/${dirName}`);
             }
-        });
+        }
     }
 
     // ── Path Resolution ──
 
-    async resolve(path: string, followSymlink = true): Promise<ResolvedInode> {
-        const { backend, localPath, mountPath } = this.getMountedStore(path);
-        const r = await this.resolver.resolve(
-            { inodes: backend.inodes, meta: backend.meta },
-            ROOT_INO,
-            localPath,
-            followSymlink,
-        );
-        // For non-root backends fullPath is local to the mount (e.g. '/log.txt').
-        // Restore the system path so callers can pass it back to engine methods.
-        if (mountPath !== '/') {
-            return { ...r, fullPath: r.fullPath === '/' ? mountPath : mountPath + r.fullPath };
-        }
-        return r;
+    /** Stat a path (throws if not found) */
+    async stat(path: string): Promise<import('@itookit/common').FSNode> {
+        const { backend, localPath } = this.resolveStore(path);
+        const node = await backend.stat(localPath === '/' ? '/' : localPath);
+        if (!node) throw new FSError('ENOENT', 'not found', 'stat', path);
+        return node;
     }
 
-    async tryResolve(path: string, followSymlink = true): Promise<ResolvedInode | null> {
-        const { backend, localPath, mountPath } = this.getMountedStore(path);
-        const r = await this.resolver.tryResolve(
-            { inodes: backend.inodes, meta: backend.meta },
-            ROOT_INO,
-            localPath,
-            followSymlink,
-        );
-        if (!r) return null;
-        if (mountPath !== '/') {
-            return { ...r, fullPath: r.fullPath === '/' ? mountPath : mountPath + r.fullPath };
-        }
-        return r;
+    /** Stat that returns null on not found */
+    async tryStat(path: string): Promise<import('@itookit/common').FSNode | null> {
+        const { backend, localPath } = this.resolveStore(path);
+        return backend.stat(localPath === '/' ? '/' : localPath);
     }
 
-    // ── Module Directory Management ── (always root backend — creates stubs)
-
-    async ensureModuleDir(moduleName: string): Promise<number> {
-        const moduleParent = await this.resolve('/module');
-        const existing = await this.backend.inodes.lookup(moduleParent.ino, moduleName);
-        if (existing) return existing.ino;
-
-        let resultIno = 0;
-        await this.backend.runInTransaction('readwrite', async (scope) => {
-            const check = await scope.inodes.lookup(moduleParent.ino, moduleName);
-            if (check) { resultIno = check.ino; return; }
-
-            const ino = await scope.inodes.allocateIno();
-            await scope.inodes.putInode({
-                ino,
-                parentIno: moduleParent.ino,
-                name: moduleName,
-                type: 'directory',
-                createdAt: Date.now(),
-                nlink: 1,
-            });
-            await scope.meta.putMeta({
-                ino,
-                modifiedAt: Date.now(),
-                size: 0,
-                version: 0,
-            });
-            resultIno = ino;
-        });
-
-        return resultIno;
+    // ── Module Directory Management ──
+
+    async ensureModuleDir(moduleName: string): Promise<void> {
+        const path = `/module/${moduleName}`;
+        const { backend, localPath } = this.resolveStore(path);
+        const existing = await backend.stat(localPath);
+        if (existing) return;
+        await backend.mkdir(localPath);
     }
 
     async removeModuleDir(moduleName: string): Promise<void> {
-        const resolved = await this.tryResolve(`/module/${moduleName}`);
-        if (!resolved) return;
-
-        await this.backend.runInTransaction('readwrite', async (scope) => {
-            await deleteRecursive(scope, resolved.ino);
-        });
+        const path = `/module/${moduleName}`;
+        const { backend, localPath } = this.resolveStore(path);
+        const existing = await backend.stat(localPath);
+        if (!existing) return;
+        await backend.delete(localPath, { recursive: true });
     }
 
-    // ── System-Level Read ──
+    // ── Read ──
 
     async readBySystemPath(systemPath: string): Promise<FileContent> {
-        const { backend, localPath } = this.getMountedStore(systemPath);
-        const resolved = await this.resolver.resolve(
-            { inodes: backend.inodes, meta: backend.meta },
-            ROOT_INO,
-            localPath,
-        );
-        if (!resolved.meta?.contentRef) return '';
-        const data = await backend.content.getData(resolved.meta.contentRef);
-        if (!data) return '';
-        return toString(data);
+        const { backend, localPath } = this.resolveStore(systemPath);
+        try {
+            const data = await backend.read(localPath);
+            return toString(data);
+        } catch {
+            return '';
+        }
     }
 
-    // ── System-Level Operations ──
-
     async readContent(path: string): Promise<ArrayBuffer> {
-        const { backend, localPath } = this.getMountedStore(path);
-        const resolved = await this.resolver.resolve(
-            { inodes: backend.inodes, meta: backend.meta },
-            ROOT_INO,
-            localPath,
-        );
-        if (resolved.inode.type === 'directory') {
-            throw new FSError('EISDIR', 'cannot read directory', 'read', path);
+        const { backend, localPath } = this.resolveStore(path);
+        const node = await backend.stat(localPath);
+        if (!node) throw new FSError('ENOENT', 'not found', 'read', path);
+        if (node.type === 'directory') throw new FSError('EISDIR', 'cannot read directory', 'read', path);
+        try {
+            const data = await backend.read(localPath);
+            return (data.buffer ?? data) as ArrayBuffer;
+        } catch {
+            return new ArrayBuffer(0);
         }
-        if (!resolved.meta?.contentRef) return new ArrayBuffer(0);
-        const data = await backend.content.getData(resolved.meta.contentRef);
-        return data ?? new ArrayBuffer(0);
     }
 
+    // ── Write ──
+
     async writeContent(
         path: string,
         content: FileContent,
-        opts?: WriteOptions,
+        options?: WriteOptions,
     ): Promise<void> {
-        const { backend, localPath } = this.getMountedStore(path);
-        const resolved = await this.resolver.resolve(
-            { inodes: backend.inodes, meta: backend.meta },
-            ROOT_INO,
-            localPath,
-        );
-        if (resolved.inode.type === 'directory') {
-            throw new FSError('EISDIR', 'cannot write to directory', 'write', path);
-        }
-
-        if (opts?.expectedVersion != null && resolved.meta) {
-            if (resolved.meta.version !== opts.expectedVersion) {
-                throw new FSConflictError(path, opts.expectedVersion, resolved.meta.version);
-            }
+        const { backend, localPath } = this.resolveStore(path);
+        const raw = toBuffer(content);
+        let buf = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
+
+        if (options?.mode === 'append') {
+            try {
+                const existing = await backend.read(localPath);
+                const merged = new Uint8Array(existing.byteLength + buf.byteLength);
+                merged.set(new Uint8Array(existing), 0);
+                merged.set(new Uint8Array(buf), existing.byteLength);
+                buf = merged.buffer;
+            } catch { /* file doesn't exist yet, just write */ }
         }
 
-        await backend.runInTransaction('readwrite', async (scope) => {
-            const contentRef = String(resolved.ino);
-            const buf = toBuffer(content);
-
-            if (opts?.mode === 'append') {
-                if (scope.content.appendData) {
-                    await scope.content.appendData(contentRef, buf);
-                } else {
-                    const existing = await scope.content.getData(contentRef);
-                    if (existing) {
-                        const merged = new Uint8Array(existing.byteLength + buf.byteLength);
-                        merged.set(new Uint8Array(existing), 0);
-                        merged.set(new Uint8Array(buf), existing.byteLength);
-                        await scope.content.putData(contentRef, merged.buffer as ArrayBuffer);
-                    } else {
-                        await scope.content.putData(contentRef, buf);
-                    }
-                }
-            } else {
-                await scope.content.putData(contentRef, buf);
-            }
-
-            const currentMeta = await scope.meta.getMeta(resolved.ino);
-            const totalSize = opts?.mode === 'append'
-                ? (currentMeta?.size ?? 0) + buf.byteLength
-                : buf.byteLength;
-
-            await scope.meta.patchMeta(resolved.ino, {
-                modifiedAt: Date.now(),
-                size: totalSize,
-                version: (currentMeta?.version ?? 0) + 1,
-                contentRef,
-                ...(opts?.metadata ? { metadata: { ...currentMeta?.metadata, ...opts.metadata } } : {}),
-            });
-        });
+        await backend.write(localPath, new Uint8Array(buf));
     }
 
+    // ── Create ──
+
     async createFile(
         parentPath: string,
         name: string,
-        type: FSNodeType = 'file',
+        type: import('@itookit/common').FSNodeType = 'file',
         content?: FileContent,
         metadata?: Record<string, unknown>,
-        opts?: { overwrite?: boolean; recursive?: boolean },
-    ): Promise<{ ino: number; inode: InodeRecord; meta: MetaRecord }> {
-        const err = validateFilename(name);
-        if (err) throw new FSError('EINVAL', err, 'createFile', name);
-
-        const { backend, localPath: parentLocalPath } = this.getMountedStore(parentPath);
-
-        let parentIno: number;
-        if (opts?.recursive) {
-            parentIno = await this.ensureDirectoryPath(backend, parentLocalPath);
-        } else {
-            const parent = await this.resolver.resolve(
-                { inodes: backend.inodes, meta: backend.meta },
-                ROOT_INO,
-                parentLocalPath,
-            );
-            parentIno = parent.ino;
+        opts?: { overwrite?: boolean; deviceHandlerId?: string },
+    ): Promise<import('@itookit/common').FSNode> {
+        validateFilename(name);
+        const { backend, localPath: parentLocal } = this.resolveStore(parentPath);
+        const fullPath = parentLocal === '/' ? `/${name}` : `${parentLocal}/${name}`;
+
+        if (!opts?.overwrite) {
+            const existing = await backend.stat(fullPath);
+            if (existing) throw new FSAlreadyExistsError(name, parentPath);
         }
 
-        const existing = await backend.inodes.lookup(parentIno, name);
-        if (existing && !opts?.overwrite) {
-            throw new FSAlreadyExistsError(P.join(parentPath, name), 'createFile');
+        if (type === 'directory') {
+            const node = await backend.mkdir(fullPath);
+            if (metadata) await backend.updateMetadata(fullPath, metadata);
+            return node;
         }
 
-        let resultIno = 0;
-
-        await backend.runInTransaction('readwrite', async (scope) => {
-            if (existing && opts?.overwrite) {
-                await deleteRecursive(scope, existing.ino);
-            }
-
-            const ino = await scope.inodes.allocateIno();
-            const now = Date.now();
-            const contentRef = String(ino);
-            let size = 0;
-
-            if (content !== undefined) {
-                const buf = toBuffer(content);
-                await scope.content.putData(contentRef, buf);
-                size = buf.byteLength;
-            }
-
-            await scope.inodes.putInode({
-                ino,
-                parentIno,
-                name,
-                type,
-                createdAt: now,
-                nlink: 1,
-            });
-
-            await scope.meta.putMeta({
-                ino,
-                modifiedAt: now,
-                size,
-                version: 0,
-                contentRef: content !== undefined ? contentRef : undefined,
-                metadata: metadata as any,
-            });
-
-            resultIno = ino;
-        });
-
-        const inode = (await backend.inodes.getInode(resultIno))!;
-        const meta = (await backend.meta.getMeta(resultIno))!;
-        return { ino: resultIno, inode, meta };
+        const raw = content ? toBuffer(content) : new Uint8Array(0);
+        const buf = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
+        const node = await backend.write(fullPath, buf);
+        if (metadata) await backend.updateMetadata(fullPath, metadata);
+        return node;
     }
 
     async createDirectory(
         parentPath: string,
         name: string,
         metadata?: Record<string, unknown>,
-        opts?: { recursive?: boolean },
-    ): Promise<{ ino: number; inode: InodeRecord; meta: MetaRecord }> {
-        const err = validateFilename(name);
-        if (err) throw new FSError('EINVAL', err, 'createDirectory', name);
-
-        const { backend, localPath: parentLocalPath } = this.getMountedStore(parentPath);
-
-        let parentIno: number;
-        if (opts?.recursive) {
-            parentIno = await this.ensureDirectoryPath(backend, parentLocalPath);
-        } else {
-            const parent = await this.resolver.resolve(
-                { inodes: backend.inodes, meta: backend.meta },
-                ROOT_INO,
-                parentLocalPath,
-            );
-            parentIno = parent.ino;
-        }
-
-        const existing = await backend.inodes.lookup(parentIno, name);
-        if (existing) {
-            if (existing.type === 'directory') {
-                const meta = await backend.meta.getMeta(existing.ino);
-                return { ino: existing.ino, inode: existing, meta: meta! };
-            }
-            throw new FSAlreadyExistsError(P.join(parentPath, name), 'createDirectory');
-        }
-
-        let resultIno = 0;
-
-        await backend.runInTransaction('readwrite', async (scope) => {
-            const ino = await scope.inodes.allocateIno();
-            const now = Date.now();
-
-            await scope.inodes.putInode({
-                ino,
-                parentIno,
-                name,
-                type: 'directory',
-                createdAt: now,
-                nlink: 1,
-            });
-
-            await scope.meta.putMeta({
-                ino,
-                modifiedAt: now,
-                size: 0,
-                version: 0,
-                metadata: metadata as any,
-            });
-
-            resultIno = ino;
-        });
-
-        const inode = (await backend.inodes.getInode(resultIno))!;
-        const meta = (await backend.meta.getMeta(resultIno))!;
-        return { ino: resultIno, inode, meta };
+    ): Promise<import('@itookit/common').FSNode> {
+        return this.createFile(parentPath, name, 'directory', undefined, metadata);
     }
 
-    async delete(path: string, opts?: DeleteOptions): Promise<number[]> {
-        if (P.isRoot(path)) {
-            throw new FSError('EINVAL', 'cannot delete root', 'delete', '/');
-        }
+    // ── Delete ──
 
-        const { backend, localPath } = this.getMountedStore(path);
-        const resolved = await this.resolver.resolve(
-            { inodes: backend.inodes, meta: backend.meta },
-            ROOT_INO,
-            localPath,
-        );
-        const { ino, parentIno, name, inode } = resolved;
-
-        if (inode.type === 'directory' && !opts?.recursive) {
-            if (await backend.inodes.hasChildren(ino)) {
-                throw new FSError('ENOTEMPTY', 'directory not empty', 'delete', path);
-            }
+    async delete(path: string, options?: DeleteOptions): Promise<void> {
+        const { backend, localPath } = this.resolveStore(path);
+        const node = await backend.stat(localPath);
+        if (!node) {
+            if (options?.force) return;
+            throw new FSError('ENOENT', 'not found', 'delete', path);
         }
+        await backend.delete(localPath, { recursive: options?.recursive });
+
+        // Cascade: delete companion asset dir
+        if (node.type !== 'directory' && options?.assetDirStrategy !== 'keep') {
+            const parentDir = P.dirname(localPath);
+            const assetDirName = toAssetDirName(nameFromPath(localPath));
+            try {
+                await backend.delete(`${parentDir}/${assetDirName}`, { recursive: true });
+            } catch { /* asset dir may not exist */ }
+        }
+    }
 
-        const allDeleted: number[] = [];
-
-        await backend.runInTransaction('readwrite', async (scope) => {
-            const assetStrategy = opts?.assetDirStrategy ?? 'remove';
-            if (assetStrategy === 'remove' && (inode.type === 'file' || inode.type === 'seqfile')) {
-                const assetDirName = toAssetDirName(name);
-                const assetEntry = await scope.inodes.lookup(parentIno, assetDirName);
-                if (assetEntry) {
-                    const assetDeleted = await deleteRecursive(scope, assetEntry.ino);
-                    allDeleted.push(...assetDeleted);
-                }
-            }
+    // ── Rename / Move ──
 
-            const deleted = await deleteRecursive(scope, ino);
-            allDeleted.push(...deleted);
-        });
+    async rename(path: string, newName: string): Promise<void> {
+        validateFilename(newName);
+        const { backend, localPath } = this.resolveStore(path);
+        const dir = P.dirname(localPath);
+        const newPath = dir === '/' ? `/${newName}` : `${dir}/${newName}`;
 
-        return allDeleted;
-    }
+        const existing = await backend.stat(newPath);
+        if (existing) throw new FSAlreadyExistsError(newName, dir);
 
-    async rename(path: string, newName: string, opts?: RenameOptions): Promise<void> {
-        const err = validateFilename(newName);
-        if (err) throw new FSError('EINVAL', err, 'rename', newName);
-
-        const { backend, localPath } = this.getMountedStore(path);
-        const resolved = await this.resolver.resolve(
-            { inodes: backend.inodes, meta: backend.meta },
-            ROOT_INO,
-            localPath,
-        );
-        const { ino, parentIno, name } = resolved;
-        if (name === newName) return;
-
-        await backend.runInTransaction('readwrite', async (scope) => {
-            const conflict = await scope.inodes.lookup(parentIno, newName);
-            if (conflict && conflict.ino !== ino) {
-                throw new FSAlreadyExistsError(P.join(P.dirname(path), newName), 'rename');
-            }
+        await backend.rename(localPath, newPath);
 
-            await scope.inodes.updateInode(ino, { name: newName });
-            await scope.meta.patchMeta(ino, { modifiedAt: Date.now() });
-
-            if (opts?.syncAssetDir !== false) {
-                const oldAssetName = toAssetDirName(name);
-                const newAssetName = toAssetDirName(newName);
-                const assetInode = await scope.inodes.lookup(parentIno, oldAssetName);
-                if (assetInode) {
-                    await scope.inodes.updateInode(assetInode.ino, { name: newAssetName });
-                }
-            }
-        });
+        // Rename companion asset dir
+        const oldAssetName = toAssetDirName(nameFromPath(localPath));
+        const newAssetName = toAssetDirName(newName);
+        try {
+            await backend.rename(`${dir}/${oldAssetName}`, `${dir}/${newAssetName}`);
+        } catch { /* no asset dir */ }
     }
 
-    async move(path: string, targetParentPath: string, opts?: MoveOptions): Promise<void> {
-        const src = this.getMountedStore(path);
-        const dst = this.getMountedStore(targetParentPath);
-
-        if (src.backend !== dst.backend) {
-            throw new FSError('EXMOUNT', 'cross-mount move not supported', 'move', path);
-        }
+    async move(sourcePath: string, targetParentPath: string): Promise<void> {
+        const { backend, localPath: srcLocal } = this.resolveStore(sourcePath);
+        const { localPath: dstLocal } = this.resolveStore(targetParentPath);
+        const name = nameFromPath(srcLocal);
+        const newPath = dstLocal === '/' ? `/${name}` : `${dstLocal}/${name}`;
 
-        const backend = src.backend;
-        const resolved = await this.resolver.resolve(
-            { inodes: backend.inodes, meta: backend.meta },
-            ROOT_INO,
-            src.localPath,
-        );
-        const targetParent = await this.resolver.resolve(
-            { inodes: backend.inodes, meta: backend.meta },
-            ROOT_INO,
-            dst.localPath,
-        );
-
-        if (targetParent.inode.type !== 'directory') {
-            throw new FSError('ENOTDIR', 'target is not a directory', 'move', targetParentPath);
-        }
+        await backend.rename(srcLocal, newPath);
 
-        await backend.runInTransaction('readwrite', async (scope) => {
-            const conflict = await scope.inodes.lookup(targetParent.ino, resolved.name);
-            if (conflict) {
-                throw new FSAlreadyExistsError(P.join(targetParentPath, resolved.name), 'move');
-            }
+        // Move companion asset dir
+        const srcDir = P.dirname(srcLocal);
+        const assetDirName = toAssetDirName(name);
+        try {
+            await backend.rename(`${srcDir}/${assetDirName}`, `${dstLocal}/${assetDirName}`);
+        } catch { /* no asset dir */ }
+    }
 
-            await scope.inodes.updateInode(resolved.ino, { parentIno: targetParent.ino });
-            await scope.meta.patchMeta(resolved.ino, { modifiedAt: Date.now() });
+    // ── List ──
 
-            if (opts?.syncAssetDir !== false && (resolved.inode.type === 'file' || resolved.inode.type === 'seqfile')) {
-                const assetDirName = toAssetDirName(resolved.name);
-                const assetInode = await scope.inodes.lookup(resolved.parentIno, assetDirName);
-                if (assetInode) {
-                    await scope.inodes.updateInode(assetInode.ino, { parentIno: targetParent.ino });
-                }
-            }
-        });
+    async listChildren(path: string): Promise<import('@itookit/common').FSNode[]> {
+        const { backend, localPath } = this.resolveStore(path);
+        return backend.list(localPath === '/' ? '/' : localPath);
     }
 
+    // ── Metadata ──
+
     async updateMetadata(path: string, metadata: Record<string, unknown>): Promise<void> {
-        const { backend, localPath } = this.getMountedStore(path);
-        const resolved = await this.resolver.resolve(
-            { inodes: backend.inodes, meta: backend.meta },
-            ROOT_INO,
-            localPath,
-        );
-        await backend.runInTransaction('readwrite', async (scope) => {
-            const current = await scope.meta.getMeta(resolved.ino);
-            await scope.meta.patchMeta(resolved.ino, {
-                metadata: { ...current?.metadata, ...metadata },
-                modifiedAt: Date.now(),
-            });
-        });
+        const { backend, localPath } = this.resolveStore(path);
+        await backend.updateMetadata(localPath, metadata);
     }
 
-    async createSymlink(
-        parentPath: string,
-        name: string,
-        target: string,
-    ): Promise<{ ino: number; inode: InodeRecord; meta: MetaRecord }> {
-        const err = validateFilename(name);
-        if (err) throw new FSError('EINVAL', err, 'createSymlink', name);
-
-        const { backend, localPath: parentLocalPath } = this.getMountedStore(parentPath);
-        const parent = await this.resolver.resolve(
-            { inodes: backend.inodes, meta: backend.meta },
-            ROOT_INO,
-            parentLocalPath,
-        );
-        let resultIno = 0;
-
-        await backend.runInTransaction('readwrite', async (scope) => {
-            const conflict = await scope.inodes.lookup(parent.ino, name);
-            if (conflict) {
-                throw new FSAlreadyExistsError(P.join(parentPath, name), 'symlink');
-            }
+    // ── Symlink ──
 
-            const ino = await scope.inodes.allocateIno();
-            const now = Date.now();
-
-            await scope.inodes.putInode({
-                ino,
-                parentIno: parent.ino,
-                name,
-                type: 'symlink',
-                createdAt: now,
-                nlink: 1,
-            });
-
-            await scope.meta.putMeta({
-                ino,
-                modifiedAt: now,
-                size: 0,
-                version: 0,
-                symlinkTarget: target,
-            });
-
-            resultIno = ino;
-        });
-
-        const inode = (await backend.inodes.getInode(resultIno))!;
-        const meta = (await backend.meta.getMeta(resultIno))!;
-        return { ino: resultIno, inode, meta };
+    async createSymlink(parentPath: string, name: string, target: string): Promise<import('@itookit/common').FSNode> {
+        const { backend, localPath: parentLocal } = this.resolveStore(parentPath);
+        const fullPath = parentLocal === '/' ? `/${name}` : `${parentLocal}/${name}`;
+        if (!backend.symlink) throw new FSCapabilityError('symlinks', 'engine');
+        await backend.symlink(fullPath, target);
+        const node = await backend.stat(fullPath);
+        if (!node) throw new FSError('EIO', 'symlink created but not found', 'symlink', fullPath);
+        return node;
     }
 
     async readSymlink(path: string): Promise<string> {
-        const { backend, localPath } = this.getMountedStore(path);
-        const resolved = await this.resolver.resolve(
-            { inodes: backend.inodes, meta: backend.meta },
-            ROOT_INO,
-            localPath,
-            false,
-        );
-        if (resolved.inode.type !== 'symlink') {
-            throw new FSError('EINVAL', 'not a symlink', 'readlink', path);
-        }
-        return resolved.meta?.symlinkTarget ?? '';
+        const { backend, localPath } = this.resolveStore(path);
+        if (!backend.readlink) throw new FSCapabilityError('symlinks', 'engine');
+        return backend.readlink(localPath);
     }
 
-    async createHardlink(
-        parentPath: string,
-        name: string,
-        targetPath: string,
-    ): Promise<{ ino: number; inode: InodeRecord; meta: MetaRecord }> {
-        const err = validateFilename(name);
-        if (err) throw new FSError('EINVAL', err, 'hardlink', name);
-
-        const srcMount = this.getMountedStore(targetPath);
-        const dstMount = this.getMountedStore(parentPath);
-        if (srcMount.backend !== dstMount.backend) {
-            throw new FSError('EXMOUNT', 'cross-mount hardlink not supported', 'hardlink', targetPath);
-        }
+    // ── Asset Dir ──
 
-        const backend = srcMount.backend;
-        const target = await this.resolver.resolve(
-            { inodes: backend.inodes, meta: backend.meta },
-            ROOT_INO,
-            srcMount.localPath,
-        );
-        if (target.inode.type === 'directory') {
-            throw new FSError('EINVAL', 'cannot hardlink a directory', 'hardlink', targetPath);
-        }
+    async getAssetDirPath(filePath: string): Promise<string | null> {
+        const { backend, localPath } = this.resolveStore(filePath);
+        const parentDir = P.dirname(localPath);
+        const name = nameFromPath(localPath);
+        const assetDirName = toAssetDirName(name);
+        const assetPath = parentDir === '/' ? `/${assetDirName}` : `${parentDir}/${assetDirName}`;
+        const exists = await backend.stat(assetPath);
+        return exists ? assetPath : null;
+    }
 
-        const parent = await this.resolver.resolve(
-            { inodes: backend.inodes, meta: backend.meta },
-            ROOT_INO,
-            dstMount.localPath,
-        );
+    async ensureAssetDir(filePath: string): Promise<string> {
+        const { backend, localPath } = this.resolveStore(filePath);
+        const parentDir = P.dirname(localPath);
+        const name = nameFromPath(localPath);
+        const assetDirName = toAssetDirName(name);
+        const assetPath = parentDir === '/' ? `/${assetDirName}` : `${parentDir}/${assetDirName}`;
 
-        await backend.runInTransaction('readwrite', async (scope) => {
-            const conflict = await scope.inodes.lookup(parent.ino, name);
-            if (conflict) {
-                throw new FSAlreadyExistsError(P.join(parentPath, name), 'hardlink');
-            }
+        const existing = await backend.stat(assetPath);
+        if (existing) return assetPath;
 
-            await scope.inodes.updateInode(target.ino, { nlink: target.inode.nlink + 1 });
-
-            const ino = await scope.inodes.allocateIno();
-            await scope.inodes.putInode({
-                ino,
-                parentIno: parent.ino,
-                name,
-                type: target.inode.type,
-                createdAt: Date.now(),
-                nlink: 1,
-            });
-
-            await scope.meta.putMeta({
-                ino,
-                modifiedAt: Date.now(),
-                size: target.meta?.size ?? 0,
-                version: 0,
-                contentRef: target.meta?.contentRef,
-                contentHash: target.meta?.contentHash,
-                mimeType: target.meta?.mimeType,
-                metadata: target.meta?.metadata ? { ...target.meta.metadata } : undefined,
-                tags: target.meta?.tags ? [...target.meta.tags] : undefined,
-                extra: { hardlinkSource: target.ino },
-            });
-        });
-
-        const inode = (await backend.inodes.getInode(target.ino))!;
-        const meta = (await backend.meta.getMeta(target.ino))!;
-        return { ino: target.ino, inode, meta };
+        await backend.mkdir(assetPath);
+        return assetPath;
     }
 
-    // ── AssetDir helpers ──
-
-    async ensureAssetDir(filePath: string): Promise<number> {
-        const { backend, localPath } = this.getMountedStore(filePath);
-        const resolved = await this.resolver.resolve(
-            { inodes: backend.inodes, meta: backend.meta },
-            ROOT_INO,
-            localPath,
-        );
-        if (resolved.inode.type !== 'file' && resolved.inode.type !== 'seqfile') {
-            throw new FSError('EINVAL', 'only file and seqfile can have assetdir', 'assetdir', filePath);
-        }
+    // ── Search ──
 
-        const assetDirName = toAssetDirName(resolved.name);
-        const existing = await backend.inodes.lookup(resolved.parentIno, assetDirName);
-        if (existing) return existing.ino;
-
-        let resultIno = 0;
-        await backend.runInTransaction('readwrite', async (scope) => {
-            const check = await scope.inodes.lookup(resolved.parentIno, assetDirName);
-            if (check) { resultIno = check.ino; return; }
-
-            const ino = await scope.inodes.allocateIno();
-            const now = Date.now();
-
-            await scope.inodes.putInode({
-                ino,
-                parentIno: resolved.parentIno,
-                name: assetDirName,
-                type: 'directory',
-                createdAt: now,
-                nlink: 1,
-            });
-
-            await scope.meta.putMeta({
-                ino,
-                modifiedAt: now,
-                size: 0,
-                version: 0,
-                isAssetDir: true,
-                ownerFileIno: resolved.ino,
-            });
-
-            await scope.meta.patchMeta(resolved.ino, { assetDirIno: ino });
-
-            resultIno = ino;
-        });
-
-        return resultIno;
+    async search(path: string, query: import('@itookit/common').FSSearchQuery): Promise<import('@itookit/common').FSNode[]> {
+        const { backend } = this.resolveStore(path);
+        if (backend.search) return backend.search(query);
+        // Fallback: naive linear scan
+        const all: import('@itookit/common').FSNode[] = [];
+        await this._walkAndCollect(backend, '/', query, all);
+        return all;
     }
 
-    async getAssetDirIno(filePath: string): Promise<number | null> {
-        const { backend, localPath } = this.getMountedStore(filePath);
-        const resolved = await this.resolver.resolve(
-            { inodes: backend.inodes, meta: backend.meta },
-            ROOT_INO,
-            localPath,
-        );
-        const assetDirName = toAssetDirName(resolved.name);
-        const entry = await backend.inodes.lookup(resolved.parentIno, assetDirName);
-        return entry?.ino ?? null;
+    private async _walkAndCollect(
+        backend: IStorageBackend,
+        dirPath: string,
+        query: import('@itookit/common').FSSearchQuery,
+        results: import('@itookit/common').FSNode[],
+    ): Promise<void> {
+        if (query.limit && results.length >= query.limit) return;
+        try {
+            const children = await backend.list(dirPath);
+            for (const child of children) {
+                if (query.limit && results.length >= query.limit) break;
+                if (matchSearch(child, query)) results.push(child);
+                if (child.type === 'directory') {
+                    await this._walkAndCollect(backend, child.path, query, results);
+                }
+            }
+        } catch { /* skip */ }
     }
 
-    // ── Internal helpers ──
-
-    async listChildren(path: string): Promise<InodeRecord[]> {
-        const { backend, localPath } = this.getMountedStore(path);
-        const resolved = await this.resolver.resolve(
-            { inodes: backend.inodes, meta: backend.meta },
-            ROOT_INO,
-            localPath,
-        );
-        if (resolved.inode.type !== 'directory') {
-            throw new FSError('ENOTDIR', 'not a directory', 'list', path);
+    // ── Ensure Directory Path (recursive mkdir) ──
+
+    async ensureDirectoryPath(systemPath: string): Promise<void> {
+        const { backend } = this.resolveStore(systemPath);
+        const parts = systemPath.split('/').filter(Boolean);
+        let current = '';
+        for (const seg of parts) {
+            current += '/' + seg;
+            const exists = await backend.stat(current);
+            if (!exists) {
+                await backend.mkdir(current);
+            }
         }
-        const children: InodeRecord[] = [];
-        await backend.inodes.walkTree(resolved.ino, (inode) => {
-            children.push(inode);
-            return 'skip';
-        }, { maxDepth: 0 });
-        return children;
     }
 
-    private async ensureDirectoryPath(backend: IStorageBackend, localPath: string): Promise<number> {
-        const segs = P.segments(P.normalize(localPath));
-        let currentIno = ROOT_INO;
+    // ── Walk Tree ──
 
-        for (const seg of segs) {
-            const existing = await backend.inodes.lookup(currentIno, seg);
-            if (existing) {
-                if (existing.type !== 'directory') {
-                    throw new FSError('ENOTDIR', `${seg} is not a directory`, 'ensurePath');
-                }
-                currentIno = existing.ino;
-            } else {
-                const ino = await backend.inodes.allocateIno();
-                await backend.inodes.putInode({
-                    ino,
-                    parentIno: currentIno,
-                    name: seg,
-                    type: 'directory',
-                    createdAt: Date.now(),
-                    nlink: 1,
-                });
-                await backend.meta.putMeta({
-                    ino,
-                    modifiedAt: Date.now(),
-                    size: 0,
-                    version: 0,
-                });
-                currentIno = ino;
+    async walkTree(
+        rootPath: string,
+        callback: (node: import('@itookit/common').FSNode, depth: number) => boolean | void | 'skip' | Promise<boolean | void | 'skip'>,
+        options?: { maxDepth?: number; includeHidden?: boolean; includeAssetDirs?: boolean },
+    ): Promise<number> {
+        const { backend, localPath } = this.resolveStore(rootPath);
+        return this._walkDFS(backend, localPath, callback, 0, options?.maxDepth ?? -1, options);
+    }
+
+    private async _walkDFS(
+        backend: IStorageBackend,
+        path: string,
+        callback: (node: import('@itookit/common').FSNode, depth: number) => boolean | void | 'skip' | Promise<boolean | void | 'skip'>,
+        depth: number,
+        maxDepth: number,
+        options?: { includeHidden?: boolean; includeAssetDirs?: boolean },
+    ): Promise<number> {
+        let count = 0;
+        const children = await backend.list(path === '/' ? '/' : path);
+        for (const child of children) {
+            if (!options?.includeHidden && child.name.startsWith('.')) continue;
+            if (!options?.includeAssetDirs && child.name.startsWith('_')) continue;
+            const result = await callback(child, depth);
+            count++;
+            if (result === false) return count;
+            if (result !== 'skip' && child.type === 'directory' && (maxDepth < 0 || depth < maxDepth)) {
+                count += await this._walkDFS(backend, child.path, callback, depth + 1, maxDepth, options);
             }
         }
+        return count;
+    }
+}
+
+// ── Helpers ──
+
+function nameFromPath(path: string): string {
+    if (path === '/' || path === '') return '';
+    const parts = path.split('/').filter(Boolean);
+    return parts[parts.length - 1] || '';
+}
 
-        return currentIno;
+function matchSearch(node: import('@itookit/common').FSNode, query: import('@itookit/common').FSSearchQuery): boolean {
+    if (query.type) {
+        const types = Array.isArray(query.type) ? query.type : [query.type];
+        if (!types.includes(node.type)) return false;
     }
+    if (query.name?.contains && !node.name.toLowerCase().includes(query.name.contains.toLowerCase())) return false;
+    if (query.tags?.all && !query.tags.all.every(t => node.tags.includes(t))) return false;
+    if (query.tags?.any && !query.tags.any.some(t => node.tags.includes(t))) return false;
+    return true;
 }
diff --git a/packages/vfslib/src/factory.ts b/packages/vfslib/src/factory.ts
index d1ccead..78771f3 100644
--- a/packages/vfslib/src/factory.ts
+++ b/packages/vfslib/src/factory.ts
@@ -15,9 +15,7 @@ import { ConfigService } from './services/config-service';
 import { nullDevice, zeroDevice, randomDevice } from './devices';
 
 export async function createVFS(options: VFSFactoryOptions): Promise<VFSInstance> {
-    const engine = new VFSEngine(options.rootBackend, {
-        maxSymlinkDepth: options.maxSymlinkDepth,
-    });
+    const engine = new VFSEngine(options.rootBackend);
 
     // Register user plugins (before init)
     if (options.plugins) {
diff --git a/packages/vfslib/src/index.ts b/packages/vfslib/src/index.ts
index cf1dc82..abf8ead 100644
--- a/packages/vfslib/src/index.ts
+++ b/packages/vfslib/src/index.ts
@@ -12,13 +12,10 @@ export { createVFS } from './factory';
 
 // ── 引擎核心 ──
 export { VFSEngine } from './engine/vfs-engine';
-export { PathResolver, type ResolvedInode } from './engine/path-resolver';
-export { toFSNode } from './engine/node-mapper';
 export { EventBus, TransactionEventBuffer } from './event/event-bus';
 export { PluginPipeline } from './engine/plugin-pipeline';
 export { DeviceRegistry } from './engine/device-registry';
 export { AccessController, SYSTEM_CALLER, type CallerIdentity } from './engine/access-controller';
-export { deleteRecursive, copyRecursive } from './engine/tree-ops';
 
 // ── 服务层 ──
 export { ModuleFS, type ModuleFSDeps } from './services/module-fs';
@@ -42,7 +39,7 @@ export {
 } from './adapter-session/BaseModuleService';
 
 // ── 常量 ──
-export { ROOT_INO } from './engine/vfs-engine';
+// ROOT_INO removed in v4.1 — path-based engine uses '/' instead
 
 // ── File handles ──
 export { FileHandle, createFile, MDXFileHandle, createMDXFile, ChatFileHandle, createChatFile } from './file-io';
diff --git a/packages/vfslib/src/services/fs-driver-adapter.ts b/packages/vfslib/src/services/fs-driver-adapter.ts
index b062712..66760fc 100644
--- a/packages/vfslib/src/services/fs-driver-adapter.ts
+++ b/packages/vfslib/src/services/fs-driver-adapter.ts
@@ -1,37 +1,23 @@
 /**
  * @file vfslib/src/services/fs-driver-adapter.ts
- * @desc FSMetaDriverAdapter — combines capability sub-interfaces into IFSMetaDriver.
+ * @desc FSMetaDriverAdapter — groups ModuleFS capability sub-interfaces into IFSMetaDriver.
  *
- * Note: FSDriverAdapter was removed in v4.0 — ModuleFS now directly implements IFSDriver
- * (self-reference: ModuleFS.driver = this). This file only contains FSMetaDriverAdapter.
+ * v4.1: ModuleFS no longer exposes assets/tags/seq/refs/watcher at the top level.
+ * FSMetaDriverAdapter now receives them directly in its constructor.
  */
 
 import type {
     IFSMetaDriver,
     IAssetOperations,
     ITagOperations,
-    ISeqFileOperations,
-    IRefOperations,
-    IWatchOperations,
 } from '@itookit/common';
-import type { ModuleFS } from './module-fs';
-
-// ═══════════════════════════════════════════════════════════════
-// FSMetaDriverAdapter
-// ═══════════════════════════════════════════════════════════════
 
 export class FSMetaDriverAdapter implements IFSMetaDriver {
     readonly assets: IAssetOperations;
     readonly tags: ITagOperations;
-    readonly seq?: ISeqFileOperations;
-    readonly refs?: IRefOperations;
-    readonly watcher?: IWatchOperations;
 
-    constructor(fs: ModuleFS) {
-        this.assets = fs.assets;
-        this.tags = fs.tags;
-        this.seq = fs.seq;
-        this.refs = fs.refs;
-        this.watcher = fs.watcher;
+    constructor(assets: IAssetOperations, tags: ITagOperations) {
+        this.assets = assets;
+        this.tags = tags;
     }
 }
diff --git a/packages/vfslib/src/services/module-fs.ts b/packages/vfslib/src/services/module-fs.ts
index efd4898..2ff6485 100644
--- a/packages/vfslib/src/services/module-fs.ts
+++ b/packages/vfslib/src/services/module-fs.ts
@@ -1,13 +1,11 @@
 /**
  * @file packages/vfslib/src/services/module-fs.ts
- * @desc IModuleFS 实现 — 模块的 chroot 隔离文件系统视图
+ * @desc IModuleFS + IFSDriver 实现 — 模块的 chroot 隔离文件系统视图（v4.1 path-based）
  *
- * 设计：
- * - ScopedView 负责路径翻译
- * - AccessController 负责权限检查
- * - PluginPipeline 负责中间件管道
- * - 能力子接口内联实现（避免类爆炸）
- * - 事件在操作完成后触发，事务内延迟到 commit
+ * v4.1 简化：
+ * - 删除 ino 体系（ROOT_INO、ResolvedInode、toFSNode、path-resolver、tree-ops）
+ * - 所有存储操作直接走 path-based VFSEngine + IStorageBackend
+ * - _resolve → 返回 { node, realPath } 而不是 ResolvedInode
  */
 
 import type {
@@ -17,8 +15,6 @@ import type {
     FSNode,
     DirEntry,
     FSCapabilities,
-    FSModuleStats,
-    FSNodeType,
     FileContent,
     FSSearchQuery,
     FSSearchResult,
@@ -33,26 +29,11 @@ import type {
     DeleteOptions,
     RenameOptions,
     MoveOptions,
-    CopyOptions,
     ListOptions,
     TreeWalkOptions,
     TreeWalkCallback,
     IAssetOperations,
     ITagOperations,
-    ISeqFileOperations,
-    IRefOperations,
-    IWatchOperations,
-    InodeRecord,
-    MetaRecord,
-    RefType,
-    Reference,
-    RefQueryOptions,
-    TagDefinition,
-    SeqFileEntry,
-    RecordQuery,
-    RecordQueryOptions,
-    RecordQueryResult,
-    FSNodeMovedPayload,
     IDeviceHandle,
     DeviceContext,
     IStorageBackend,
@@ -62,29 +43,18 @@ import {
     FSNotFoundError,
     FSError,
     FSReadOnlyError,
-    FSTypeMismatchError,
     FSCapabilityError,
 } from '@itookit/common';
 
-import { VFSEngine, ROOT_INO } from '../engine/vfs-engine';
-import { toFSNode } from '../engine/node-mapper';
+import { VFSEngine } from '../engine/vfs-engine';
 import { ScopedView } from './scoped-view';
 import { AccessController, type CallerIdentity } from '../engine/access-controller';
 import { EventBus, TransactionEventBuffer } from '../event/event-bus';
 import { PluginPipeline } from '../engine/plugin-pipeline';
 import { DeviceRegistry } from '../engine/device-registry';
-import { deleteRecursive, copyRecursive } from '../engine/tree-ops';
-import type { ResolvedInode } from '../engine/path-resolver';
 import { toBuffer, toString } from '../utils/encoding';
-import {
-    isPath,
-    isHiddenName,
-    isAssetDirName,
-    isInternalDirName,
-    toAssetDirName,
-} from '../utils/validation';
+import { isPath, isHiddenName, isAssetDirName, isInternalDirName } from '../utils/validation';
 import * as P from '../utils/path';
-import { encodeId, decodeId } from './id-mapper';
 import { moduleDEBUG } from '../utils/debug';
 import { FSMetaDriverAdapter } from './fs-driver-adapter';
 import { FileHandle } from '../file-io/File';
@@ -97,59 +67,41 @@ export interface ModuleFSDeps {
     access: AccessController;
     devices: DeviceRegistry;
     mountId?: string;
-    /** If true, the module bypasses all access control checks */
     isSystem?: boolean;
 }
 
 // ─── DeviceHandle ─────────────────────────────────────────────────────────────
-
-/**
- * 打开设备文件后返回的句柄，将 driver + ctx 封装为统一接口。
- * 通过 ModuleFS.openDevice() 创建，不直接实例化。
- */
 class DeviceHandle implements IDeviceHandle {
     constructor(
         private readonly _driver: import('@itookit/common').IDeviceDriver,
         public readonly ctx: DeviceContext,
     ) {}
-
-    read(): Promise<FileContent> {
-        return this._driver.read(this.ctx);
-    }
-
+    read(): Promise<FileContent> { return this._driver.read(this.ctx); }
     write(content: FileContent): Promise<void> {
         if (!this._driver.writable) throw new Error(`Device '${this._driver.handlerId}' is read-only`);
         return this._driver.write(this.ctx, content);
     }
-
     async *readStream(): AsyncIterable<string | ArrayBuffer> {
         if (!this._driver.readStream) throw new Error(`Device '${this._driver.handlerId}' is not streamable`);
         yield* this._driver.readStream(this.ctx);
     }
-
     ioctl(command: string | number, arg?: unknown): Promise<unknown> {
         if (!this._driver.ioctl) throw new Error(`Device '${this._driver.handlerId}' does not support ioctl`);
         return this._driver.ioctl(this.ctx, command, arg);
     }
-
-    async close(): Promise<void> {
-        await this._driver.close?.(this.ctx);
-    }
+    async close(): Promise<void> { await this._driver.close?.(this.ctx); }
 }
 
-// ─────────────────────────────────────────────────────────────────────────────
+// ═══════════════════════════════════════════════════════════════
+// ModuleFS
+// ═══════════════════════════════════════════════════════════════
 
 export class ModuleFS implements IModuleFS, IFSDriver {
     readonly moduleId: string;
     readonly capabilities: FSCapabilities;
-
     readonly assets: IAssetOperations;
     readonly tags: ITagOperations;
-    readonly refs: IRefOperations;
-    readonly seq?: ISeqFileOperations;
-    readonly watcher?: IWatchOperations;
-
-    readonly driver: import('@itookit/common').IFSDriver;
+    readonly driver: IFSDriver;
     readonly meta: import('@itookit/common').IFSMetaDriver;
 
     private readonly engine: VFSEngine;
@@ -160,9 +112,7 @@ export class ModuleFS implements IModuleFS, IFSDriver {
     private readonly scope: ScopedView;
     private readonly mountId: string;
     private readonly caller: CallerIdentity;
-    /** The backend that actually stores this module's data (may differ from root backend). */
     private readonly _moduleBackend: IStorageBackend;
-    /** System mount path for this module (e.g. '/module/home'). '/' means root backend. */
     private readonly _mountPath: string;
     private initialized = false;
 
@@ -176,47 +126,25 @@ export class ModuleFS implements IModuleFS, IFSDriver {
         this.scope = new ScopedView(deps.moduleId);
         this.mountId = deps.mountId ?? 'mount_0';
         this.caller = { moduleId: deps.moduleId, isSystem: deps.isSystem ?? false };
-
-        // Resolve the backend and mount path for this module.
-        // Falls back to the root backend when no mount router is configured (e.g. in tests).
-        const moduleSysPath = `/module/${deps.moduleId}`;
-        this._moduleBackend = deps.engine.getBackendForPath(moduleSysPath);
-        this._mountPath     = deps.engine.getMountPathForPath(moduleSysPath);
+        this._moduleBackend = deps.engine.getBackendForPath(`/module/${deps.moduleId}`);
+        this._mountPath = deps.engine.getMountPathForPath(`/module/${deps.moduleId}`);
 
         const backend = this._moduleBackend;
         this.capabilities = Object.freeze({
-            readonly: false,
-            search: true,
-            semanticSearch: false,
-            syncable: false,
-            assets: true,
-            tags: true,
-            deviceFiles: true,
-            seqFiles: !!backend.records,
-            references: true,
-            symlinks: true,
-            hardlinks: false,
-            partialRead: !!backend.content.readRange,
-            partialWrite: !!backend.content.appendData,
-            treeWalk: true,
-            streaming: false,
-            watch: false,
-            mount: false,
+            readonly: false, search: true, semanticSearch: false, syncable: false,
+            assets: true, tags: true, deviceFiles: true,
+            seqFiles: !!backend.records, references: true,
+            symlinks: !!backend.symlink, hardlinks: false,
+            partialRead: true, partialWrite: true, treeWalk: true,
+            streaming: false, watch: false, mount: false,
         });
 
         this.assets = new InlineAssetOps(this);
         this.tags = new InlineTagOps(this);
-        this.refs = new InlineRefOps(this);
-        if (this.capabilities.seqFiles) {
-            this.seq = new InlineSeqOps(this);
-        }
-
         this.driver = this;
-        this.meta = new FSMetaDriverAdapter(this);
+        this.meta = new FSMetaDriverAdapter(this.assets, this.tags);
     }
 
-    // ── IFile 工厂 ────────────────────────────────────────────
-
     openFile(nodeId: string): import('@itookit/common').IFile {
         return new FileHandle(this, nodeId);
     }
@@ -231,832 +159,260 @@ export class ModuleFS implements IModuleFS, IFSDriver {
         this.initialized = true;
     }
 
-    async dispose(): Promise<void> {
-        this.initialized = false;
-    }
+    async dispose(): Promise<void> { this.initialized = false; }
 
     // ══════════════════════════════════════════════════════════
     // Events
     // ══════════════════════════════════════════════════════════
 
     on<E extends FSEventType>(event: E, callback: (event: FSEvent<E>) => void): () => void {
-        return this.bus.on(event, (evt) => {
-            const pass = evt.moduleId === this.moduleId || !evt.moduleId;
-            moduleDEBUG.filter(this.moduleId, event, pass, evt.moduleId);
-            if (pass) callback(evt);
+        return this.bus.on(event, (e) => {
+            if (e.moduleId === this.moduleId) callback(e);
         });
     }
-
     onAny(callback: (event: FSEvent) => void): () => void {
-        return this.bus.onAny((evt) => {
-            if (evt.moduleId === this.moduleId || !evt.moduleId) callback(evt);
+        return this.bus.onAny((e) => {
+            if (e.moduleId === this.moduleId) callback(e);
         });
     }
 
+    get _backend(): IStorageBackend { return this._moduleBackend; }
+    get _engine(): VFSEngine { return this.engine; }
+
     // ══════════════════════════════════════════════════════════
-    // Internal: Resolution & Mapping
+    // Path resolution helpers (centralized)
     // ══════════════════════════════════════════════════════════
 
-    /** @internal — used by inline capability implementations */
-    async _resolve(idOrPath: string, _op?: string): Promise<ResolvedInode> {
-        const realPath = await this._toReal(idOrPath);
-        return this.engine.resolve(realPath);
-    }
-
-    /** @internal */
-    async _tryResolve(idOrPath: string): Promise<ResolvedInode | null> {
-        try {
-            return await this._resolve(idOrPath);
-        } catch (e) {
-            if (e instanceof FSNotFoundError) return null;
-            throw e;
-        }
-    }
-
-    /** @internal */
-    async _toReal(idOrPath: string): Promise<string> {
+    /** Convert a public ID or virtual path to a system-real path. */
+    private toRealPath(idOrPath: string): string {
         if (isPath(idOrPath)) {
             return this.scope.toRealPath(idOrPath);
         }
-        // ID → ino → walk parent chain to build path
-        const decoded = decodeId(idOrPath);
-        if (!decoded) throw new FSError('EINVAL', `invalid id: ${idOrPath}`, 'resolve');
-
-        const inode = await this._moduleBackend.inodes.getInode(decoded.ino);
-        if (!inode) throw new FSNotFoundError(idOrPath, 'resolve');
-
-        const localPath = await this._buildAbsPath(inode);
-        // Convert local path (within the mounted backend) to system path.
-        // Root-backend modules: _mountPath='/', localPath is already a full system path.
-        // Non-root-backend modules: prepend the mount path (e.g. '/module/home').
-        return this._mountPath === '/' ? localPath : this._mountPath + localPath;
-    }
-
-    /** @internal */
-    _toVirtual(realPath: string): string {
-        return this.scope.toVirtualPath(realPath);
+        throw new FSError('EINVAL', 'path-based engine requires paths, not IDs', 'resolve', idOrPath);
     }
 
-    /** @internal */
-    _id(ino: number): string {
-        return encodeId(this.mountId, ino);
+    /** Stat + return { node, realPath }. Throws if not found. @internal — exposed for InlineAssetOps */
+    async resolveNode(idOrPath: string): Promise<{ node: FSNode; realPath: string }> {
+        const realPath = this.toRealPath(idOrPath);
+        const node = await this.engine.stat(realPath);
+        if (!node) throw new FSNotFoundError(idOrPath);
+        return { node, realPath };
     }
 
-    /** @internal */
-    _node(inode: InodeRecord, meta: MetaRecord | null, realPath: string): FSNode {
-        return toFSNode(
-            inode,
-            meta,
-            this._id(inode.ino),
-            inode.parentIno ? this._id(inode.parentIno) : null,
-            this.scope.toVirtualPath(realPath),
-        );
-    }
-
-    /** @internal */
-    _resolvedNode(r: ResolvedInode): FSNode {
-        return this._node(r.inode, r.meta, r.fullPath);
+    /** Check writable + permissions. */
+    private assertWritable(realPath: string): void {
+        if (this.scope.isRealPathReadOnly(realPath)) throw new FSReadOnlyError(this.moduleId, realPath);
     }
 
-    /** @internal */
-    _emit<E extends FSEventType>(
-        type: E,
-        payload: any,
-    ): void {
+    /** Emit a namespaced event. @internal — exposed for inline ops classes */
+    _emit(type: FSEventType, payload: any): void {
         this.bus.emit(type, payload, { moduleId: this.moduleId, mountId: this.mountId });
     }
 
-    /** @internal */
-    get _backend() {
-        return this._moduleBackend;
-    }
-
-    /** @internal */
-    get _stores() {
-        return this.engine.store;
-    }
-
-    /** @internal */
-    get _engine(): VFSEngine {
-        return this.engine;
-    }
-
-    private async _buildAbsPath(inode: InodeRecord): Promise<string> {
-        const parts: string[] = [];
-        let current: InodeRecord | null = inode;
-        while (current && current.ino !== ROOT_INO && current.parentIno !== current.ino) {
-            parts.unshift(current.name);
-            current = await this._moduleBackend.inodes.getInode(current.parentIno);
-        }
-        return '/' + parts.join('/');
-    }
-
-    // Takes a real (internal) path to avoid virtual-path ambiguity: e.g. a
-    // module dir named 'dev' has virtual path '/dev' which would incorrectly
-    // match the system read-only '/dev' mount.
-    private assertWritable(realPath: string): void {
-        if (this.scope.isRealPathReadOnly(realPath)) {
-            throw new FSReadOnlyError(this._toVirtual(realPath));
-        }
-    }
-
-    private ctx(op: FSOperationType, path: string): OperationContext {
-        return {
-            operation: op,
-            moduleId: this.moduleId,
-            path: this._toVirtual(path),
-            args: {},
-        };
+    /** Create plugin context. */
+    private ctx(operation: FSOperationType, args: Record<string, unknown>, node?: FSNode, path?: string): OperationContext {
+        const ctx: OperationContext = { operation, moduleId: this.moduleId, node, path, args };
+        ctx.getAssetDir = async (_ownerId: string) => undefined;
+        return ctx;
     }
 
     // ══════════════════════════════════════════════════════════
-    // Read Operations
+    // IFSDriver Read
     // ══════════════════════════════════════════════════════════
 
     async getNode(idOrPath: string): Promise<FSNode | null> {
-        const r = await this._tryResolve(idOrPath);
-        return r ? this._resolvedNode(r) : null;
+        try {
+            const realPath = this.toRealPath(idOrPath);
+            return await this.engine.stat(realPath);
+        } catch { return null; }
     }
 
+    // IFSDriver overloaded getChildren signatures
     getChildren(idOrPath: string, options?: ListOptions & { fields?: 'full' }): Promise<FSNode[]>;
     getChildren(idOrPath: string, options: ListOptions & { fields: 'entry' }): Promise<DirEntry[]>;
     getChildren(idOrPath: string, options?: ListOptions): Promise<FSNode[] | DirEntry[]>;
-    async getChildren(idOrPath: string, options?: ListOptions): Promise<FSNode[] | DirEntry[]> {
-        const r = await this._resolve(idOrPath, 'getChildren');
-        const backend = this._moduleBackend;
-        const childrenRaw: import('@itookit/common').InodeRecord[] = [];
-        await backend.inodes.walkTree(r.ino, (inode) => {
-            childrenRaw.push(inode);
-            return true;
-        }, { maxDepth: 0 });
-        const children = childrenRaw;
-
+    async getChildren(idOrPath: string, options?: any): Promise<FSNode[] | DirEntry[]> {
+        const realPath = this.toRealPath(idOrPath);
+        const children = await this.engine.listChildren(realPath);
         const filtered = children.filter(c => {
             if (!options?.includeHidden && isHiddenName(c.name)) return false;
-            if (!options?.includeInternalDirs && isInternalDirName(c.name)) return false;
             if (!options?.includeAssetDirs && isAssetDirName(c.name)) return false;
+            if (!options?.includeInternalDirs && isInternalDirName(c.name)) return false;
             return true;
         });
-
         if (options?.fields === 'entry') {
-            const entries: DirEntry[] = [];
-            for (const c of filtered) {
-                const meta = await backend.meta.getMeta(c.ino);
-                entries.push({
-                    id: this._id(c.ino),
-                    name: c.name,
-                    type: c.type,
-                    size: meta?.size,
-                    modifiedAt: meta?.modifiedAt ?? c.createdAt,
-                });
-            }
-            return entries;
+            return filtered.map(c => ({ id: c.id, name: c.name, type: c.type, size: (c as any).size, modifiedAt: c.modifiedAt } as DirEntry));
         }
-
-        const nodes: FSNode[] = [];
-        for (const c of filtered) {
-            const meta = await backend.meta.getMeta(c.ino);
-            nodes.push(this._node(c, meta, P.join(r.fullPath, c.name)));
-        }
-        return nodes;
+        return filtered;
     }
 
+    // IFSDriver overloaded readContent signatures
     readContent(idOrPath: string, options: ReadOptions & { encoding: 'utf-8' }): Promise<string>;
     readContent(idOrPath: string, options: ReadOptions & { encoding: 'binary' }): Promise<ArrayBuffer>;
     readContent(idOrPath: string, options?: ReadOptions): Promise<FileContent>;
     async readContent(idOrPath: string, options?: ReadOptions): Promise<FileContent> {
-        const r = await this._resolve(idOrPath, 'readContent');
-        // Guard hidden-file content in system modules (and cross-module ID-based access).
-        // Reads of visible files are isolated by ScopedView path translation; hidden files
-        // and ID-based paths need an explicit check here since _toReal bypasses chroot.
-        this.access.checkAccess(this.caller, r.fullPath, 'read');
-
-        // Device file delegation
-        if (r.inode.type === 'device') {
-            const handlerId = r.meta?.deviceHandlerId;
-            if (!handlerId) throw new FSError('ENOTTY', 'no device handler', 'read', r.fullPath);
-            const driver = this.devices.get(handlerId);
-            return driver.read({
-                nodeId: this._id(r.ino),
-                name: r.name,
-                metadata: r.meta?.metadata,
-                sessionId: options?.deviceSessionId,
-            });
-        }
-
-        // SeqFile: serialize to string
-        if (r.inode.type === 'seqfile' && this.seq) {
-            const lines: string[] = [];
-            await this.seq.walkEntries(idOrPath, (e) => { lines.push(`${e.key}=${e.value}`); return true; });
-            const text = lines.join('\n');
-            return options?.encoding === 'binary' ? toBuffer(text) : text;
-        }
-
-        if (!r.meta?.contentRef) {
-            return options?.encoding === 'binary' ? new ArrayBuffer(0) : '';
-        }
-
-        const data = await this._moduleBackend.content.getData(r.meta.contentRef);
-        if (!data) {
-            return options?.encoding === 'binary' ? new ArrayBuffer(0) : '';
-        }
-
-        // Partial read
-        if (options?.offset !== undefined || options?.length !== undefined) {
-            const offset = options.offset ?? 0;
-            const length = options.length ?? (data.byteLength - offset);
-            const slice = data.slice(offset, offset + length);
-            return options?.encoding === 'binary' ? slice : toString(slice);
-        }
-
-        return options?.encoding === 'binary' ? data : toString(data);
+        const { node, realPath } = await this.resolveNode(idOrPath);
+        this.assertWritable(realPath); // access check: verify not readonly mount
+        const data = await this.engine.readContent(realPath);
+        if (options?.encoding === 'utf-8') return toString(data);
+        return data;
     }
 
     async resolvePath(path: string): Promise<string | null> {
-        const r = await this._tryResolve(path);
-        return r ? this._id(r.ino) : null;
+        try {
+            const realPath = this.toRealPath(path);
+            const node = await this.engine.stat(realPath);
+            return node ? realPath : null;
+        } catch { return null; }
     }
 
     async exists(idOrPath: string): Promise<boolean> {
-        return (await this._tryResolve(idOrPath)) !== null;
+        try {
+            const realPath = this.toRealPath(idOrPath);
+            const node = await this.engine.tryStat(realPath);
+            return node !== null;
+        } catch { return false; }
     }
 
     async walkTree(callback: TreeWalkCallback, options?: TreeWalkOptions): Promise<number> {
-        const rootRealPath = options?.rootIdOrPath
-            ? await this._toReal(options.rootIdOrPath)
-            : `/module/${this.moduleId}`;
-
-        const maxDepth = options?.maxDepth ?? -1;
-        const limit = options?.limit ?? Infinity;
-        let count = 0;
-
-        const walk = async (currentPath: string, depth: number): Promise<boolean> => {
-            if (maxDepth >= 0 && depth > maxDepth) return true;
-            if (count >= limit) return false;
-
-            const backend = this._moduleBackend;
-            const parentIno = (await this.engine.resolve(currentPath)).ino;
-            const childrenArr: import('@itookit/common').InodeRecord[] = [];
-            await backend.inodes.walkTree(parentIno, (inode) => {
-                childrenArr.push(inode);
-                return 'skip';
-            }, { maxDepth: 0 });
-            const children = childrenArr;
-
-            for (const child of children) {
-                if (count >= limit) return false;
-                if (!options?.includeHidden && isHiddenName(child.name)) continue;
-                if (!options?.includeInternalDirs && isInternalDirName(child.name)) continue;
-                if (!options?.includeAssetDirs && isAssetDirName(child.name)) continue;
-
-                if (options?.typeFilter) {
-                    const types = Array.isArray(options.typeFilter)
-                        ? options.typeFilter
-                        : [options.typeFilter];
-                    if (!types.includes(child.type)) continue;
-                }
-
-                const childRealPath = P.join(currentPath, child.name);
-                const meta = await backend.meta.getMeta(child.ino);
-                const node = this._node(child, meta, childRealPath);
-
-                count++;
-                const result = await callback(node, depth);
-                if (result === false) return false;
-                if (result === 'skip') continue;
-
-                if (child.type === 'directory') {
-                    if (!(await walk(childRealPath, depth + 1))) return false;
-                }
-            }
-            return true;
-        };
-
-        await walk(rootRealPath, 0);
-        return count;
+        const rootPath = options?.rootIdOrPath ? this.toRealPath(options.rootIdOrPath) : this.scope.toRealPath('/');
+        return this.engine.walkTree(rootPath, callback as any, options);
     }
 
     async search(query: FSSearchQuery): Promise<FSSearchResult> {
-        const limit = query.limit ?? 50;
-        const offset = query.offset ?? 0;
-        const results: FSNode[] = [];
-
-        await this.walkTree(async (node) => {
-            if (results.length >= offset + limit) return false;
-
-            // Type filter
-            if (query.type) {
-                const types = Array.isArray(query.type) ? query.type : [query.type];
-                if (!types.includes(node.type)) return;
-            }
-
-            // Name filter
-            if (query.name) {
-                const n = node.name;
-                if (query.name.exact && n !== query.name.exact) return;
-                if (query.name.contains && !n.includes(query.name.contains)) return;
-                if (query.name.startsWith && !n.startsWith(query.name.startsWith)) return;
-                if (query.name.endsWith && !n.endsWith(query.name.endsWith)) return;
-            }
-
-            // Tag filter
-            if (query.tags) {
-                const nodeTags = node.tags ?? [];
-                if (query.tags.all && !query.tags.all.every(t => nodeTags.includes(t))) return;
-                if (query.tags.any && !query.tags.any.some(t => nodeTags.includes(t))) return;
-                if (query.tags.none && query.tags.none.some(t => nodeTags.includes(t))) return;
-            }
-
-            // Time range
-            if (query.modifiedAfter && node.modifiedAt < query.modifiedAfter) return;
-            if (query.modifiedBefore && node.modifiedAt > query.modifiedBefore) return;
-
-            // Metadata filter
-            if (query.metadata) {
-                const meta = node.metadata ?? {};
-                for (const [k, v] of Object.entries(query.metadata)) {
-                    if (meta[k] !== v) return;
-                }
-            }
-
-            // Text search (name + content)
-            if (query.text) {
-                const lower = query.text.toLowerCase();
-                let matched = node.name.toLowerCase().includes(lower);
-                if (!matched && node.type === 'file') {
-                    try {
-                        const content = await this.readContent(node.id, { encoding: 'utf-8' });
-                        if (typeof content === 'string') {
-                            matched = content.toLowerCase().includes(lower);
-                        }
-                    } catch {
-                        // skip unreadable
-                    }
-                }
-                if (!matched) return;
-            }
-
-            results.push(node);
-        }, { maxDepth: -1, includeHidden: false });
-
-        const paged = results.slice(offset, offset + limit);
-        return {
-            nodes: paged,
-            total: results.length,
-            hasMore: results.length > offset + limit,
-        };
+        const moduleRoot = this.scope.toRealPath('/');
+        const nodes = await this.engine.search(moduleRoot, query);
+        return { nodes, total: nodes.length, hasMore: false };
     }
 
-    async getStats(): Promise<FSModuleStats> {
-        let fileCount = 0;
-        let directoryCount = 0;
-        let totalSize = 0;
-        let lastModifiedAt = 0;
-        const typeBreakdown: Partial<Record<FSNodeType, number>> = {};
-
+    async getStats(): Promise<import('@itookit/common').FSModuleStats> {
+        let fileCount = 0, directoryCount = 0, totalSize = 0;
         await this.walkTree((node) => {
             if (node.type === 'directory') directoryCount++;
-            else fileCount++;
-            if ('size' in node) totalSize += (node as any).size ?? 0;
-            if (node.modifiedAt > lastModifiedAt) lastModifiedAt = node.modifiedAt;
-            typeBreakdown[node.type] = (typeBreakdown[node.type] ?? 0) + 1;
-        }, { includeHidden: true });
-
-        return { fileCount, directoryCount, totalSize, lastModifiedAt, typeBreakdown };
+            else { fileCount++; totalSize += (node as any).size ?? 0; }
+        });
+        return { fileCount, directoryCount, totalSize, lastModifiedAt: Date.now() };
     }
 
     // ══════════════════════════════════════════════════════════
-    // Write Operations
+    // IFSDriver Write
     // ══════════════════════════════════════════════════════════
 
     async createFile(options: CreateFileOptions): Promise<FSNode> {
-        const parentRealPath = options.parentIdOrPath
-            ? await this._toReal(options.parentIdOrPath)
-            : `/module/${this.moduleId}`;
-
-        this.assertWritable(parentRealPath);
-        this.access.checkCreate(this.caller, options.name, parentRealPath);
-
-        const c = this.ctx('create', parentRealPath);
-        c.args = { ...options };
-        let resultNode!: FSNode;
-
-        await this.plugins.execute('create', c, async () => {
-            const resolved = await this.engine.createFile(
-                parentRealPath,
-                options.name,
-                options.type ?? 'file',
-                options.content,
-                options.metadata as Record<string, unknown>,
-                { overwrite: options.overwrite, recursive: options.recursive },
-            );
-            const nodeRealPath = P.join(parentRealPath, options.name);
-            resultNode = this._node(resolved.inode, resolved.meta, nodeRealPath);
-            c.result = resultNode;
-        });
+        const parentPath = options.parentIdOrPath ? this.toRealPath(options.parentIdOrPath) : this.scope.toRealPath('/');
+        this.assertWritable(parentPath);
 
-        resultNode = (c.result as FSNode) ?? resultNode;
-        this._emit('node:created', {
-            nodes: [{
-                nodeId: resultNode.id,
-                parentId: resultNode.parentId,
-                path: resultNode.path,
-                type: resultNode.type,
-            }],
-        });
-        return resultNode;
+        const node = await this.engine.createFile(parentPath, options.name,
+            options.type ?? 'file', options.content, options.metadata, { overwrite: options.overwrite });
+
+        this._emit('node:created', { nodes: [{ nodeId: node.id, parentId: node.parentId, path: node.path, type: node.type }] });
+        return node;
     }
 
     async createDirectory(options: CreateDirectoryOptions): Promise<FSNode> {
-        const parentRealPath = options.parentIdOrPath
-            ? await this._toReal(options.parentIdOrPath)
-            : `/module/${this.moduleId}`;
-
-        this.assertWritable(parentRealPath);
-        this.access.checkCreate(this.caller, options.name, parentRealPath);
-
-        const c = this.ctx('create', parentRealPath);
-        let resultNode!: FSNode;
-
-        await this.plugins.execute('create', c, async () => {
-            const resolved = await this.engine.createDirectory(
-                parentRealPath,
-                options.name,
-                options.metadata as Record<string, unknown>,
-                { recursive: options.recursive },
-            );
-            const nodeRealPath = P.join(parentRealPath, options.name);
-            resultNode = this._node(resolved.inode, resolved.meta, nodeRealPath);
-            c.result = resultNode;
-        });
-
-        resultNode = (c.result as FSNode) ?? resultNode;
-        this._emit('node:created', {
-            nodes: [{
-                nodeId: resultNode.id,
-                parentId: resultNode.parentId,
-                path: resultNode.path,
-                type: resultNode.type,
-            }],
-        });
-        return resultNode;
+        return this.createFile({ ...options, type: 'directory', content: undefined });
     }
 
-    async writeContent(
-        idOrPath: string,
-        content: FileContent,
-        options?: WriteOptions,
-    ): Promise<void> {
-        const r = await this._resolve(idOrPath, 'writeContent');
-        const virtualPath = this._toVirtual(r.fullPath);
-        this.assertWritable(r.fullPath);
-
-        // Device delegation
-        if (r.inode.type === 'device') {
-            const handlerId = r.meta?.deviceHandlerId;
-            if (!handlerId) throw new FSError('ENOTTY', 'no device handler', 'write', r.fullPath);
-            const driver = this.devices.get(handlerId);
-            if (!driver.writable) throw new FSReadOnlyError(virtualPath, 'write');
-            await driver.write({
-                nodeId: this._id(r.ino),
-                name: r.name,
-                metadata: r.meta?.metadata,
-                sessionId: options?.deviceSessionId,
-            }, content);
-            return;
-        }
-
-        const nodeId = this._id(r.ino);
-        const c = this.ctx('write', r.fullPath);
-        c.args = { content, options };
-
-        await this.plugins.execute('write', c, async () => {
-            await this.engine.writeContent(r.fullPath, content, options);
-        });
-
-        this._emit('node:updated', {
-            nodes: [{ nodeId, path: virtualPath, changedFields: ['content'] }],
-            reason: 'content',
-        });
+    async writeContent(idOrPath: string, content: FileContent, options?: WriteOptions): Promise<void> {
+        const { node, realPath } = await this.resolveNode(idOrPath);
+        this.assertWritable(realPath);
+        await this.engine.writeContent(realPath, content, options);
+        this._emit('node:updated', { nodes: [{ nodeId: node.id, path: node.path, changedFields: ['content'] }] });
     }
 
     async appendContent(idOrPath: string, content: FileContent): Promise<void> {
-        await this.writeContent(idOrPath, content, { mode: 'append' });
+        return this.writeContent(idOrPath, content, { mode: 'append' });
     }
 
-    async rename(
-        idOrPath: string,
-        newName: string,
-        options?: RenameOptions,
-    ): Promise<void> {
-        const r = await this._resolve(idOrPath, 'rename');
-        const virtualPath = this._toVirtual(r.fullPath);
-        this.assertWritable(r.fullPath);
-
-        const oldName = r.name;
-        const c = this.ctx('rename', r.fullPath);
-        c.args = { newName, options };
-
-        await this.plugins.execute('rename', c, async () => {
-            await this.engine.rename(r.fullPath, newName, options);
-        });
-
-        const oldVirtual = virtualPath;
-        const newVirtual = P.join(P.dirname(virtualPath), newName);
-        this._emit('node:renamed', {
-            nodes: [{
-                nodeId: this._id(r.ino),
-                oldName,
-                newName,
-                oldPath: oldVirtual,
-                newPath: newVirtual,
-            }],
-        });
+    async rename(idOrPath: string, newName: string): Promise<void> {
+        const { node, realPath } = await this.resolveNode(idOrPath);
+        this.assertWritable(realPath);
+        await this.engine.rename(realPath, newName);
+        const newRealPath = `${P.dirname(realPath)}/${newName}`;
+        this._emit('node:renamed', { nodes: [{ nodeId: node.id, oldName: node.name, newName, oldPath: node.path, newPath: this.scope.toVirtualPath(newRealPath) }] });
     }
 
-    async move(
-        idsOrPaths: string[],
-        targetParentIdOrPath: string | null,
-        options?: MoveOptions,
-    ): Promise<void> {
-        const targetRealPath = targetParentIdOrPath
-            ? await this._toReal(targetParentIdOrPath)
-            : `/module/${this.moduleId}`;
-        this.assertWritable(targetRealPath);
-
-        const movedNodes: FSNodeMovedPayload['nodes'] = [];
+    async move(idsOrPaths: string[], targetParentIdOrPath: string | null): Promise<void> {
+        const targetPath = targetParentIdOrPath
+            ? this.toRealPath(targetParentIdOrPath)
+            : this.scope.toRealPath('/');
+        this.assertWritable(targetPath);
 
-        for (const idOrPath of idsOrPaths) {
-            const r = await this._resolve(idOrPath, 'move');
-            const oldVirtual = this._toVirtual(r.fullPath);
-
-            const c = this.ctx('move', r.fullPath);
-            c.args = { targetParentIdOrPath, options };
-
-            await this.plugins.execute('move', c, async () => {
-                await this.engine.move(r.fullPath, targetRealPath, options);
-            });
-
-            const newRealPath = P.join(targetRealPath, r.name);
-            movedNodes.push({
-                nodeId: this._id(r.ino),
-                oldPath: oldVirtual,
-                newPath: this._toVirtual(newRealPath),
-                oldParentId: this._id(r.parentIno),
-                newParentId: targetParentIdOrPath
-                    ? this._id((await this.engine.resolve(targetRealPath)).ino)
-                    : null,
-            });
-        }
-
-        if (movedNodes.length > 0) {
-            this._emit('node:moved', { nodes: movedNodes });
+        for (const src of idsOrPaths) {
+            const { realPath } = await this.resolveNode(src);
+            await this.engine.move(realPath, targetPath);
         }
+        this._emit('node:moved', {});
     }
 
     async delete(idsOrPaths: string[], options?: DeleteOptions): Promise<void> {
-        const requestedIds: string[] = [];
-        const allDeletedIds: string[] = [];
-
         for (const idOrPath of idsOrPaths) {
-            let r: ResolvedInode;
-            try {
-                r = await this._resolve(idOrPath, 'delete');
-            } catch (e) {
-                if (options?.force && e instanceof FSNotFoundError) continue;
-                throw e;
-            }
-
-            this.assertWritable(r.fullPath);
-            const nodeId = this._id(r.ino);
-            requestedIds.push(nodeId);
-
-            const c = this.ctx('delete', r.fullPath);
-            c.args = { options };
-
-            await this.plugins.execute('delete', c, async () => {
-                const deletedInos = await this.engine.delete(r.fullPath, options);
-                for (const ino of deletedInos) {
-                    allDeletedIds.push(this._id(ino));
-                }
-            });
-        }
-
-        if (requestedIds.length > 0) {
-            this._emit('node:deleted', { requestedIds, allDeletedIds });
+            const realPath = this.toRealPath(idOrPath);
+            this.assertWritable(realPath);
+            await this.engine.delete(realPath, options);
         }
+        this._emit('node:deleted', { requestedIds: idsOrPaths, allDeletedIds: idsOrPaths });
     }
 
-    async updateMetadata(
-        idOrPath: string,
-        metadata: Record<string, unknown>,
-    ): Promise<void> {
-        const r = await this._resolve(idOrPath, 'updateMetadata');
-        this.assertWritable(r.fullPath);
-
-        const c = this.ctx('updateMetadata', r.fullPath);
-        c.args = { metadata };
-
-        await this.plugins.execute('updateMetadata', c, async () => {
-            await this.engine.updateMetadata(r.fullPath, metadata);
-        });
-
-        this._emit('node:updated', {
-            nodes: [{
-                nodeId: this._id(r.ino),
-                path: this._toVirtual(r.fullPath),
-                changedFields: ['metadata'],
-            }],
-            reason: 'metadata',
-        });
+    async updateMetadata(idOrPath: string, metadata: Record<string, unknown>): Promise<void> {
+        const { node, realPath } = await this.resolveNode(idOrPath);
+        await this.engine.updateMetadata(realPath, metadata);
+        this._emit('node:updated', { nodes: [{ nodeId: node.id, path: node.path, changedFields: ['metadata'] }] });
     }
 
-    // ══════════════════════════════════════════════════════════
-    // Copy
-    // ══════════════════════════════════════════════════════════
-
-    async copy(
-        sourceIdOrPath: string,
-        targetParentIdOrPath: string | null,
-        newName?: string,
-        _options?: CopyOptions,
-    ): Promise<FSNode> {
-        const sourceR = await this._resolve(sourceIdOrPath, 'copy');
-        const targetRealPath = targetParentIdOrPath
-            ? await this._toReal(targetParentIdOrPath)
-            : `/module/${this.moduleId}`;
-        this.assertWritable(targetRealPath);
-
-        const c = this.ctx('copy', sourceR.fullPath);
-        let resultNode!: FSNode;
-
-        await this.plugins.execute('copy', c, async () => {
-            const backend = this._backend;
-            const targetParentR = await this.engine.resolve(targetRealPath);
-            const mapping = await backend.runInTransaction('readwrite', async (scope) => {
-                return copyRecursive(scope, sourceR.ino, targetParentR.ino, newName ?? sourceR.name);
-            });
-            const newIno = mapping.get(sourceR.ino)!;
-            const inode = (await backend.inodes.getInode(newIno))!;
-            const meta = await backend.meta.getMeta(newIno);
-            const nodeRealPath = P.join(targetRealPath, newName ?? sourceR.name);
-            resultNode = this._node(inode, meta, nodeRealPath);
-            c.result = resultNode;
-        });
-
-        resultNode = (c.result as FSNode) ?? resultNode;
-
-        this._emit('node:copied', {
-            copies: [{
-                sourceId: this._id(sourceR.ino),
-                targetId: resultNode.id,
-                targetPath: resultNode.path,
-                targetParentId: resultNode.parentId,
-            }],
-        });       return resultNode;
+    // ── Copy ──
+    async copy(sourceIdOrPath: string, targetParentIdOrPath: string | null, newName?: string): Promise<FSNode> {
+        const { node, realPath } = await this.resolveNode(sourceIdOrPath);
+        const targetPath = targetParentIdOrPath ? this.toRealPath(targetParentIdOrPath) : P.dirname(realPath);
+        const name = newName ?? node.name;
+        return this.createFile({ name, parentIdOrPath: targetPath, type: node.type, content: await this.readContent(sourceIdOrPath), metadata: node.metadata as any, tags: [...node.tags] });
     }
 
-    // ══════════════════════════════════════════════════════════
-    // Links
-    // ══════════════════════════════════════════════════════════
-
+    // ── Symlink ──
     async symlink(linkPath: string, targetPath: string): Promise<FSNode> {
         const dir = P.dirname(linkPath);
         const name = P.basename(linkPath);
-        const realDir = this.scope.toRealPath(dir);
+        const realDir = this.toRealPath(dir);
         this.assertWritable(realDir);
-        this.access.checkCreate(this.caller, name, realDir);
-
-        // Translate absolute virtual paths to real paths so the engine can resolve them.
-        // Relative paths are left unchanged (resolved relative to the symlink's directory).
-        const realTarget = targetPath.startsWith('/')
-            ? this.scope.toRealPath(targetPath)
-            : targetPath;
-        const resolved = await this.engine.createSymlink(realDir, name, realTarget);
-        const nodeRealPath = P.join(realDir, name);
-        const node = this._node(resolved.inode, resolved.meta, nodeRealPath);
-
-        this._emit('node:created', {
-            nodes: [{
-                nodeId: node.id,
-                parentId: node.parentId,
-                path: node.path,
-                type: 'symlink',
-            }],
-        });
-
+        const node = await this.engine.createSymlink(realDir, name, targetPath);
+        this._emit('node:created', { nodes: [{ nodeId: node.id, parentId: node.parentId, path: node.path, type: 'symlink' }] });
         return node;
     }
 
     async readlink(idOrPath: string): Promise<string> {
-        // Resolve without following the final symlink so we can inspect its target
-        const realPath = await this._toReal(idOrPath);
-        const r = await this.engine.resolve(realPath, false);
-        if (r.inode.type !== 'symlink') {
-            throw new FSError('EINVAL', 'not a symlink', 'readlink', r.fullPath);
-        }
-        return r.meta?.symlinkTarget ?? '';
+        const { realPath } = await this.resolveNode(idOrPath);
+        return this.engine.readSymlink(realPath);
     }
 
-    async hardlink(_linkPath: string, _targetPath: string): Promise<FSNode> {
+    async hardlink(): Promise<FSNode> {
         throw new FSCapabilityError('hardlinks', this.moduleId);
     }
 
-    // ══════════════════════════════════════════════════════════
-    // Device
-    // ══════════════════════════════════════════════════════════
-
-    async ioctl(
-        idOrPath: string,
-        command: string | number,
-        arg?: unknown,
-    ): Promise<unknown> {
-        const r = await this._resolve(idOrPath, 'ioctl');
-        if (r.inode.type !== 'device') {
-            throw new FSError('ENOTTY', 'not a device file', 'ioctl', r.fullPath);
-        }
-        const handlerId = r.meta?.deviceHandlerId;
-        if (!handlerId) throw new FSError('ENOTTY', 'no device handler', 'ioctl', r.fullPath);
-        const driver = this.devices.get(handlerId);
-        if (!driver.ioctl) {
-            throw new FSError('ENOTTY', 'device does not support ioctl', 'ioctl', r.fullPath);
-        }
-        return driver.ioctl(
-            { nodeId: this._id(r.ino), name: r.name, metadata: r.meta?.metadata },
-            command,
-            arg,
-        );
+    // ── Device ──
+    async createDeviceFile(name: string, parentIdOrPath: string | null, handlerId: string): Promise<FSNode> {
+        const parentPath = parentIdOrPath ? this.toRealPath(parentIdOrPath) : this.scope.toRealPath('/dev');
+        return this.engine.createFile(parentPath, name, 'device', undefined, undefined, { deviceHandlerId: handlerId });
     }
 
-    /**
-     * 在 parentIdOrPath 下创建 type=device 的文件节点。
-     * handlerId 必须已注册到 DeviceRegistry。
-     */
-    async createDeviceFile(
-        name: string,
-        parentIdOrPath: string | null,
-        handlerId: string,
-    ): Promise<FSNode> {
-        if (!this.devices.has(handlerId)) {
-            throw new FSError('ENOTTY', `device handler '${handlerId}' not registered`, 'createDeviceFile', name);
-        }
-
-        const parentRealPath = parentIdOrPath
-            ? await this._toReal(parentIdOrPath)
-            : `/module/${this.moduleId}`;
-
-        this.assertWritable(parentRealPath);
-        this.access.checkCreate(this.caller, name, parentRealPath);
-
-        const c = this.ctx('create', parentRealPath);
-        c.args = { name, handlerId };
-        let resultNode!: FSNode;
-
-        await this.plugins.execute('create', c, async () => {
-            const resolved = await this.engine.createFile(
-                parentRealPath, name, 'device',
-                undefined,
-                { deviceHandlerId: handlerId },
-            );
-            const nodeRealPath = P.join(parentRealPath, name);
-            resultNode = this._node(resolved.inode, resolved.meta, nodeRealPath);
-            c.result = resultNode;
-        });
-
-        resultNode = (c.result as FSNode) ?? resultNode;
-        this._emit('node:created', {
-            nodes: [{ nodeId: resultNode.id, parentId: resultNode.parentId, path: resultNode.path, type: resultNode.type }],
-        });
-        return resultNode;
+    async ioctl(idOrPath: string, command: string | number, arg?: unknown): Promise<unknown> {
+        const { node } = await this.resolveNode(idOrPath);
+        if (node.type !== 'device') throw new FSError('ENOTTY', 'not a device file', 'ioctl', node.path);
+        const handlerId = (node as any).deviceHandlerId;
+        if (!handlerId) throw new FSError('ENOTTY', 'no device handler', 'ioctl', node.path);
+        const driver = this.devices.get(handlerId);
+        if (!driver.ioctl) throw new FSError('ENOTTY', 'device does not support ioctl', 'ioctl', node.path);
+        return driver.ioctl({ nodeId: node.id, name: node.name, metadata: node.metadata }, command, arg);
     }
 
-    /**
-     * 打开设备文件，返回绑定上下文的 DeviceHandle。
-     *
-     * 对 sessionable 设备自动调用 driver.open() 建立会话；
-     * 无状态设备直接绑定 nodeId 返回句柄。
-     */
     async openDevice(idOrPath: string, options?: Record<string, unknown>): Promise<IDeviceHandle> {
-        const r = await this._resolve(idOrPath, 'openDevice');
-        if (r.inode.type !== 'device') {
-            throw new FSError('ENOTTY', 'not a device file', 'openDevice', r.fullPath);
-        }
-
-        const handlerId = r.meta?.deviceHandlerId as string | undefined;
-        if (!handlerId) throw new FSError('ENOTTY', 'no device handler', 'openDevice', r.fullPath);
-
+        const { node } = await this.resolveNode(idOrPath);
+        if (node.type !== 'device') throw new FSError('ENOTTY', 'not a device file', 'openDevice', node.path);
+        const handlerId = (node as any).deviceHandlerId;
+        if (!handlerId) throw new FSError('ENOTTY', 'no device handler', 'openDevice', node.path);
         const driver = this.devices.get(handlerId);
-        const baseCtx: DeviceContext = {
-            nodeId: this._id(r.ino),
-            name: r.name,
-            metadata: r.meta?.metadata as Record<string, unknown> | undefined,
-        };
-
+        const baseCtx: DeviceContext = { nodeId: node.id, name: node.name, metadata: node.metadata };
         let sessionId: string | undefined;
-        if (driver.sessionable && driver.open) {
-            sessionId = await driver.open(baseCtx, options);
-        }
-
+        if (driver.sessionable && driver.open) sessionId = await driver.open(baseCtx, options);
         return new DeviceHandle(driver, { ...baseCtx, sessionId });
     }
 
@@ -1066,47 +422,32 @@ export class ModuleFS implements IModuleFS, IFSDriver {
 
     async transaction<T>(fn: (tx: IFSDriverTransaction) => Promise<T>): Promise<T> {
         const buffer = new TransactionEventBuffer(this.bus, this.moduleId);
-
-        // Swap event bus to buffer during transaction
         const originalEmit = this.bus.emit.bind(this.bus);
         const bufferedEmit: typeof originalEmit = (type, payload, opts) => {
-            if (opts?.moduleId === this.moduleId) {
-                buffer.add(type, payload as any, opts?.mountId);
-            } else {
-                originalEmit(type, payload, opts);
-            }
+            if (opts?.moduleId === this.moduleId) buffer.add(type, payload as any, opts?.mountId);
+            else originalEmit(type, payload, opts);
         };
-
-        // Temporarily replace emit
-        const realEmit = this.bus.emit;
         (this.bus as any).emit = bufferedEmit;
 
-        // NOTE: do NOT wrap fn(tx) in backend.runInTransaction() here.
-        // Each tx.createFile/createDirectory/etc. internally calls engine methods
-        // that invoke backend.runInTransaction(), which would deadlock the txQueue
-        // (outer waits for inner, inner waits for outer via Promise chain).
-        // Individual operations are already serialized by their own txQueue items.
         const tx: IFSDriverTransaction = {
             getNode: (id) => this.getNode(id),
             readContent: (id, opts) => this.readContent(id, opts),
             createFile: (opts) => this.createFile(opts),
             createDirectory: (opts) => this.createDirectory(opts),
             writeContent: (id, content, opts) => this.writeContent(id, content, opts),
-            rename: (id, newName, opts) => this.rename(id, newName, opts),
-            move: (ids, target, opts) => this.move(ids, target, opts),
+            rename: (id, newName, opts) => this.rename(id, newName),
+            move: (ids, target, opts) => this.move(ids, target),
             delete: (ids, opts) => this.delete(ids, opts),
             updateMetadata: (id, meta) => this.updateMetadata(id, meta),
         };
 
         try {
             const result = await fn(tx);
-
-            // Restore emit and flush buffered events
-            (this.bus as any).emit = realEmit;
+            (this.bus as any).emit = originalEmit;
             buffer.commit();
             return result;
         } catch (e) {
-            (this.bus as any).emit = realEmit;
+            (this.bus as any).emit = originalEmit;
             buffer.rollback();
             throw e;
         }
@@ -1114,497 +455,111 @@ export class ModuleFS implements IModuleFS, IFSDriver {
 }
 
 // ═══════════════════════════════════════════════════════════════
-// Inline Asset Operations
+// InlineAssetOps
 // ═══════════════════════════════════════════════════════════════
 
 class InlineAssetOps implements IAssetOperations {
     constructor(private readonly fs: ModuleFS) {}
 
-    async putAsset(
-        ownerIdOrPath: string,
-        assetName: string,
-        content: FileContent,
-    ): Promise<FSNode> {
-        const ownerR = await this.fs._resolve(ownerIdOrPath, 'putAsset');
-        if (ownerR.inode.type === 'directory') {
-            throw new FSError('EISDIR', 'cannot attach assets to directory', 'putAsset', ownerR.fullPath);
-        }
-
-        const assetDirIno = await this.fs._engine.ensureAssetDir(ownerR.fullPath);
-        const assetDirName = toAssetDirName(ownerR.name);
-        const assetDirPath = P.join(P.dirname(ownerR.fullPath), assetDirName);
-
-        const backend = this.fs._backend;
-        const existing = await backend.inodes.lookup(assetDirIno, assetName);
+    private _engine() { return this.fs._engine; }
 
-        let resultNode!: FSNode;
-
-        await backend.runInTransaction('readwrite', async (scope) => {
-            let ino: number;
-            if (existing) {
-                ino = existing.ino;
-            } else {
-                ino = await scope.inodes.allocateIno();
-            }
-
-            // contentRef must be String(ino) so LocalFSContentStore.resolveRef
-            // can parseInt() it to look up the real path. putData must run
-            // before putInode so the staging file exists when putInode migrates
-            // it to the real path (LocalFS staging→rename flow).
-            const contentRef = String(ino);
-            const buf = toBuffer(content);
-            await scope.content.putData(contentRef, buf);
-
-            if (!existing) {
-                await scope.inodes.putInode({
-                    ino,
-                    parentIno: assetDirIno,
-                    name: assetName,
-                    type: 'file',
-                    createdAt: Date.now(),
-                    nlink: 1,
-                });
-            }
-
-            const currentMeta = existing ? await scope.meta.getMeta(ino) : null;
-            await scope.meta.putMeta({
-                ino,
-                modifiedAt: Date.now(),
-                size: buf.byteLength,
-                version: (currentMeta?.version ?? 0) + (existing ? 1 : 0),
-                contentRef,
-            });
-
-            const inode = (await scope.inodes.getInode(ino))!;
-            const meta = await scope.meta.getMeta(ino);
-            resultNode = this.fs._node(inode, meta, P.join(assetDirPath, assetName));
-        });
-
-        return resultNode;
+    async putAsset(ownerIdOrPath: string, assetName: string, content: FileContent): Promise<FSNode> {
+        const { realPath } = await this.fs.resolveNode(ownerIdOrPath);
+        const assetPath = `${P.dirname(realPath)}/${assetName}`;
+        const buf = toBuffer(content);
+        return this._engine().createFile(P.dirname(assetPath), assetName, 'file', buf);
     }
 
     async getAsset(ownerIdOrPath: string, assetName: string): Promise<FileContent | null> {
-        const assetDirIno = await this.getAssetDirIno(ownerIdOrPath);
-        if (assetDirIno === null) return null;
-
-        const entry = await this.fs._backend.inodes.lookup(assetDirIno, assetName);
-        if (!entry) return null;
-
-        const meta = await this.fs._backend.meta.getMeta(entry.ino);
-        if (!meta?.contentRef) return null;
-
-        return this.fs._backend.content.getData(meta.contentRef);
+        try {
+            const { realPath } = await this.fs.resolveNode(ownerIdOrPath);
+            const assetPath = `${P.dirname(realPath)}/${assetName}`;
+            const data = await this._engine().readContent(assetPath);
+            return data;
+        } catch { return null; }
     }
 
     async getAssetDirId(ownerIdOrPath: string): Promise<string | null> {
-        const ino = await this.getAssetDirIno(ownerIdOrPath);
-        return ino !== null ? this.fs._id(ino) : null;
+        try {
+            const { realPath } = await this.fs.resolveNode(ownerIdOrPath);
+            const assetDir = await this._engine().getAssetDirPath(realPath);
+            return assetDir || null;
+        } catch { return null; }
     }
 
     async ensureAssetDir(ownerIdOrPath: string): Promise<string> {
-        const ownerR = await this.fs._resolve(ownerIdOrPath, 'ensureAssetDir');
-        const ino = await this.fs._engine.ensureAssetDir(ownerR.fullPath);
-        return this.fs._id(ino);
+        const { realPath } = await this.fs.resolveNode(ownerIdOrPath);
+        return this._engine().ensureAssetDir(realPath);
     }
 
-    async listAssets(ownerIdOrPath: string, includeHidden?: boolean): Promise<string[]> {
-        const assetDirIno = await this.getAssetDirIno(ownerIdOrPath);
-        if (assetDirIno === null) return [];
-
-        const names: string[] = [];
-        await this.fs._backend.inodes.walkTree(assetDirIno, (inode) => {
-            if (includeHidden || !isHiddenName(inode.name)) names.push(inode.name);
-            return 'skip';
-        }, { maxDepth: 0 });
-        return names;
+    async listAssets(ownerIdOrPath: string): Promise<string[]> {
+        try {
+            const { realPath } = await this.fs.resolveNode(ownerIdOrPath);
+            const assetPath = await this._engine().getAssetDirPath(realPath);
+            if (!assetPath) return [];
+            const children = await this._engine().listChildren(assetPath);
+            return children.map(c => c.name);
+        } catch { return []; }
     }
 
     async deleteAsset(ownerIdOrPath: string, assetName: string): Promise<void> {
-        const assetDirIno = await this.getAssetDirIno(ownerIdOrPath);
-        if (assetDirIno === null) return;
-
-        const entry = await this.fs._backend.inodes.lookup(assetDirIno, assetName);
-        if (!entry) return;
-
-        await this.fs._backend.runInTransaction('readwrite', async (scope) => {
-            await deleteRecursive(scope, entry.ino);
-        });
+        const { realPath } = await this.fs.resolveNode(ownerIdOrPath);
+        const assetPath = `${P.dirname(realPath)}/${assetName}`;
+        await this._engine().delete(assetPath);
     }
 
-    async removeAssetDir(ownerIdOrPath: string, removeContent?: boolean): Promise<void> {
-        const assetDirIno = await this.getAssetDirIno(ownerIdOrPath);
-        if (assetDirIno === null) return;
-
-        if (removeContent !== false) {
-            await this.fs._backend.runInTransaction('readwrite', async (scope) => {
-                await deleteRecursive(scope, assetDirIno);
-            });
-        }
-
-        // Clear owner reference
-        const ownerR = await this.fs._resolve(ownerIdOrPath, 'removeAssetDir');
-        await this.fs._backend.meta.patchMeta(ownerR.ino, { assetDirIno: undefined });
+    async removeAssetDir(ownerIdOrPath: string): Promise<void> {
+        const { realPath } = await this.fs.resolveNode(ownerIdOrPath);
+        const assetPath = await this._engine().getAssetDirPath(realPath);
+        if (assetPath) await this._engine().delete(assetPath, { recursive: true });
     }
 
     async hasAssetDir(ownerIdOrPath: string): Promise<boolean> {
-        return (await this.getAssetDirIno(ownerIdOrPath)) !== null;
+        const dirId = await this.getAssetDirId(ownerIdOrPath);
+        return dirId !== null;
     }
-
-    private async getAssetDirIno(ownerIdOrPath: string): Promise<number | null> {
-        const ownerR = await this.fs._resolve(ownerIdOrPath, 'getAssetDirIno');
-        const assetDirName = toAssetDirName(ownerR.name);
-        const entry = await this.fs._backend.inodes.lookup(ownerR.parentIno, assetDirName);
-        return entry?.ino ?? null;
-    }
-
 }
 
 // ═══════════════════════════════════════════════════════════════
-// Inline Tag Operations
+// InlineTagOps
 // ═══════════════════════════════════════════════════════════════
 
 class InlineTagOps implements ITagOperations {
     constructor(private readonly fs: ModuleFS) {}
 
-    async getAllTags(): Promise<TagDefinition[]> {
-        const tags = await this.fs._backend.meta.getAllDistinctTags();
-        return tags.map(name => ({ name }));
+    async getAllTags(): Promise<import('@itookit/common').TagDefinition[]> {
+        const tags = await this.fs._backend.getAllTags();
+        return tags.map(t => ({ name: t }));
     }
 
     async setTags(idOrPath: string, tags: string[]): Promise<void> {
-        const r = await this.fs._resolve(idOrPath, 'setTags');
-        await this.fs._backend.meta.patchMeta(r.ino, { tags, modifiedAt: Date.now() });
-        this.fs._emit('node:updated', {
-            nodes: [{ nodeId: this.fs._id(r.ino), path: this.fs._toVirtual(r.fullPath), changedFields: ['tags'] }],
-            reason: 'tags',
-        });
+        const { realPath } = await this.fs.resolveNode(idOrPath);
+        await this.fs._backend.setTags(realPath, tags);
+        this.fs._emit('node:updated', { nodes: [{ nodeId: idOrPath }] });
     }
 
     async addTag(idOrPath: string, tag: string): Promise<void> {
-        const r = await this.fs._resolve(idOrPath, 'addTag');
-        const meta = await this.fs._backend.meta.getMeta(r.ino);
-        const current = meta?.tags ?? [];
-        if (current.includes(tag)) return;
-        await this.setTags(idOrPath, [...current, tag]);
+        const { node, realPath } = await this.fs.resolveNode(idOrPath);
+        const newTags = [...new Set([...node.tags, tag])];
+        await this.fs._backend.setTags(realPath, newTags);
     }
 
     async removeTag(idOrPath: string, tag: string): Promise<void> {
-        const r = await this.fs._resolve(idOrPath, 'removeTag');
-        const meta = await this.fs._backend.meta.getMeta(r.ino);
-        const current = meta?.tags ?? [];
-        if (!current.includes(tag)) return;
-        await this.setTags(idOrPath, current.filter(t => t !== tag));
-    }
-
-    async walkByTag(
-        tag: string,
-        callback: (nodeId: string) => boolean | Promise<boolean>,
-        options?: { limit?: number; offset?: number },
-    ): Promise<{ total: number; processed: number }> {
-        return this.fs._backend.meta.walkByTag(tag, (ino) => callback(this.fs._id(ino)), options);
-    }
-}
-
-// ═══════════════════════════════════════════════════════════════
-// Inline Ref Operations (in-memory index stored in meta.extra)
-// ═══════════════════════════════════════════════════════════════
-
-class InlineRefOps implements IRefOperations {
-    constructor(private readonly fs: ModuleFS) {}
-
-    async addRef(
-        sourceIdOrPath: string,
-        targetIdOrPath: string,
-        refType: RefType,
-        extra?: Record<string, unknown>,
-    ): Promise<void> {
-        if (await this.hasRef(sourceIdOrPath, targetIdOrPath, refType)) return;
-
-        const sourceR = await this.fs._resolve(sourceIdOrPath, 'addRef');
-        const targetR = await this.fs._resolve(targetIdOrPath, 'addRef');
-        const now = Date.now();
-
-        await this.fs._backend.runInTransaction('readwrite', async (scope) => {
-            // Add outgoing ref on source
-            const sMeta = await scope.meta.getMeta(sourceR.ino);
-            const outRefs = this.getRefList(sMeta, '_outRefs');
-            outRefs.push({
-                targetId: this.fs._id(targetR.ino),
-                refType,
-                createdAt: now,
-                extra,
-            });
-            await scope.meta.patchMeta(sourceR.ino, {
-                extra: { ...sMeta?.extra, _outRefs: outRefs },
-            });
-
-            // Add incoming ref on target
-            const tMeta = await scope.meta.getMeta(targetR.ino);
-            const inRefs = this.getRefList(tMeta, '_inRefs');
-            inRefs.push({
-                sourceId: this.fs._id(sourceR.ino),
-                refType,
-                createdAt: now,
-                extra,
-            });
-            await scope.meta.patchMeta(targetR.ino, {
-                extra: { ...tMeta?.extra, _inRefs: inRefs },
-            });
-        });
-    }
-
-    async removeRef(
-        sourceIdOrPath: string,
-        targetIdOrPath: string,
-        refType: RefType,
-    ):Promise<void> {
-        const sourceR = await this.fs._resolve(sourceIdOrPath, 'removeRef');
-        const targetR = await this.fs._resolve(targetIdOrPath, 'removeRef');
-        const targetId = this.fs._id(targetR.ino);
-        const sourceId = this.fs._id(sourceR.ino);
-
-        await this.fs._backend.runInTransaction('readwrite', async (scope) => {
-            const sMeta = await scope.meta.getMeta(sourceR.ino);
-            const outRefs = this.getRefList(sMeta, '_outRefs')
-                .filter((r: any) => !(r.targetId === targetId && r.refType === refType));
-            await scope.meta.patchMeta(sourceR.ino, {
-                extra: { ...sMeta?.extra, _outRefs: outRefs },
-            });
-
-            const tMeta = await scope.meta.getMeta(targetR.ino);
-            const inRefs = this.getRefList(tMeta, '_inRefs')
-                .filter((r: any) => !(r.sourceId === sourceId && r.refType === refType));
-            await scope.meta.patchMeta(targetR.ino, {
-                extra: { ...tMeta?.extra, _inRefs: inRefs },
-            });
-        });
-    }
-
-    async walkOutgoing(
-        idOrPath: string,
-        callback: (ref: Reference) => boolean | Promise<boolean>,
-        opts?: RefQueryOptions,
-    ): Promise<number> {
-        const r = await this.fs._resolve(idOrPath, 'walkOutgoing');
-        const meta = await this.fs._backend.meta.getMeta(r.ino);
-        const sourceId = this.fs._id(r.ino);
-
-        let refs: Reference[] = this.getRefList(meta, '_outRefs').map((raw: any) => ({
-            sourceId,
-            targetId: raw.targetId,
-            refType: raw.refType,
-            createdAt: raw.createdAt,
-            extra: raw.extra,
-        }));
-
-        if (opts?.refTypes?.length) {
-            refs = refs.filter(ref => opts.refTypes!.includes(ref.refType));
-        }
-        if (opts?.offset) refs = refs.slice(opts.offset);
-        if (opts?.limit) refs = refs.slice(0, opts.limit);
-
-        let count = 0;
-        for (const ref of refs) {
-            if (!(await callback(ref))) break;
-            count++;
-        }
-        return count;
-    }
-
-    async walkIncoming(
-        idOrPath: string,
-        callback: (ref: Reference) => boolean | Promise<boolean>,
-        opts?: RefQueryOptions,
-    ): Promise<number> {
-        const r = await this.fs._resolve(idOrPath, 'walkIncoming');
-        const meta = await this.fs._backend.meta.getMeta(r.ino);
-        const targetId = this.fs._id(r.ino);
-
-        let refs: Reference[] = this.getRefList(meta, '_inRefs').map((raw: any) => ({
-            sourceId: raw.sourceId,
-            targetId,
-            refType: raw.refType,
-            createdAt: raw.createdAt,
-            extra: raw.extra,
-        }));
-
-        if (opts?.refTypes?.length) {
-            refs = refs.filter(ref => opts.refTypes!.includes(ref.refType));
-        }
-        if (opts?.offset) refs = refs.slice(opts.offset);
-        if (opts?.limit) refs = refs.slice(0, opts.limit);
-
-        let count = 0;
-        for (const ref of refs) {
-            if (!(await callback(ref))) break;
-            count++;
-        }
-        return count;
-    }
-
-    async hasRef(
-        sourceIdOrPath: string,
-        targetIdOrPath: string,
-        refType: RefType,
-    ): Promise<boolean> {
-        const targetR = await this.fs._resolve(targetIdOrPath, 'hasRef');
-        const targetId = this.fs._id(targetR.ino);
-        let found = false;
-        await this.walkOutgoing(sourceIdOrPath, (ref) => {
-            if (ref.refType === refType && ref.targetId === targetId) {
-                found = true;
-                return false;
+        const { node, realPath } = await this.fs.resolveNode(idOrPath);
+        const newTags = node.tags.filter(t => t !== tag);
+        await this.fs._backend.setTags(realPath, newTags);
+    }
+
+    async walkByTag(tag: string, callback: (id: string) => boolean | Promise<boolean>): Promise<{ total: number; processed: number }> {
+        // Simplified: walk tree and filter by tag
+        let processed = 0;
+        await this.fs.walkTree((node) => {
+            if (node.tags.includes(tag)) {
+                processed++;
+                return callback(node.id);
             }
             return true;
-        }, { refTypes: [refType] });
-        return found;
-    }
-
-    async syncOutgoing(
-        sourceIdOrPath: string,
-        refs: Array<{
-            targetIdOrPath: string;
-            refType: RefType;
-            extra?: Record<string, unknown>;
-        }>,
-    ): Promise<void> {
-        // Collect existing outgoing refs
-        const existing: Reference[] = [];
-        await this.walkOutgoing(sourceIdOrPath, (ref) => {
-            existing.push(ref);
-            return true;
-        });
-        // Remove all existing outgoing
-        for (const ref of existing) {
-            await this.removeRef(sourceIdOrPath, ref.targetId, ref.refType);
-        }
-        // Add new refs
-        for (const ref of refs) {
-            await this.addRef(sourceIdOrPath, ref.targetIdOrPath, ref.refType, ref.extra);
-        }
-    }
-
-    private getRefList(meta: MetaRecord | null, key: string): any[] {
-        if (!meta?.extra) return [];
-        const list = (meta.extra as any)[key];
-        return Array.isArray(list) ? list : [];
-    }
-}
-
-// ═══════════════════════════════════════════════════════════════
-// Inline SeqFile Operations
-// ═══════════════════════════════════════════════════════════════
-
-class InlineSeqOps implements ISeqFileOperations {
-    constructor(private readonly fs: ModuleFS) {}
-
-    private get records() {
-        const backend = this.fs._backend;
-        if (!backend.records) {
-            throw new FSCapabilityError('seqFiles', this.fs.moduleId);
-        }
-        return backend.records;
-    }
-
-    private async mustBeSeqFile(idOrPath: string, op: string): Promise<ResolvedInode> {
-        const r = await this.fs._resolve(idOrPath, op);
-        if (r.inode.type !== 'seqfile') {
-            throw new FSTypeMismatchError(r.fullPath, 'seqfile', r.inode.type);
-        }
-        return r;
-    }
-
-    async getEntry(fileIdOrPath: string, key: string): Promise<string | null> {
-        const r = await this.mustBeSeqFile(fileIdOrPath, 'seqGet');
-        const val = await this.records.getRecordField(r.ino, key);
-        return val !== undefined ? String(val) : null;
-    }
-
-    async getEntries(fileIdOrPath: string, keys: string[]): Promise<Record<string, string>> {
-        const result: Record<string, string> = {};
-        for (const key of keys) {
-            const val = await this.getEntry(fileIdOrPath, key);
-            if (val !== null) result[key] = val;
-        }
-        return result;
-    }
-
-    async walkEntries(
-        fileIdOrPath: string,
-        callback: (entry: SeqFileEntry) => boolean | Promise<boolean>,
-        options?: { keyPrefix?: string; limit?: number; offset?: number },
-    ): Promise<{ total: number; processed: number }> {
-        const r = await this.mustBeSeqFile(fileIdOrPath, 'seqWalkEntries');
-        return this.records.walkRecordFields(r.ino, (key, value) => {
-            return callback({ key, value: String(value) });
-        }, { prefix: options?.keyPrefix, limit: options?.limit, offset: options?.offset });
-    }
-
-    async setEntry(fileIdOrPath: string, key: string, value: string): Promise<void> {
-        const r = await this.mustBeSeqFile(fileIdOrPath, 'seqSet');
-        await this.records.setRecordField(r.ino, key, value);
-        await this.fs._backend.meta.patchMeta(r.ino, {
-            modifiedAt: Date.now(),
-            version: (r.meta?.version ?? 0) + 1,
-        });
-        this.fs._emit('node:updated', {
-            nodes: [{
-                nodeId: this.fs._id(r.ino),
-                path: this.fs._toVirtual(r.fullPath),
-                changedFields: ['content'],
-            }],
-            reason: 'content',
         });
-    }
-
-    async setEntries(fileIdOrPath: string, entries: Record<string, string>): Promise<void> {
-        const r = await this.mustBeSeqFile(fileIdOrPath, 'seqSetBatch');
-        for (const [key, value] of Object.entries(entries)) {
-            await this.records.setRecordField(r.ino, key, value);
-        }
-        await this.fs._backend.meta.patchMeta(r.ino, {
-            modifiedAt: Date.now(),
-            version: (r.meta?.version ?? 0) + 1,
-        });
-        this.fs._emit('node:updated', {
-            nodes: [{
-                nodeId: this.fs._id(r.ino),
-                path: this.fs._toVirtual(r.fullPath),
-                changedFields: ['content'],
-            }],
-            reason: 'content',
-        });
-    }
-
-    async deleteEntry(fileIdOrPath: string, key: string): Promise<void> {
-        const r = await this.mustBeSeqFile(fileIdOrPath, 'seqDelete');
-        await this.records.deleteRecordField(r.ino, key);
-        await this.fs._backend.meta.patchMeta(r.ino, {
-            modifiedAt: Date.now(),
-            version: (r.meta?.version ?? 0) + 1,
-        });
-    }
-
-    async hasEntry(fileIdOrPath: string, key: string): Promise<boolean> {
-        return (await this.getEntry(fileIdOrPath, key)) !== null;
-    }
-
-    async queryEntries(
-        fileIdOrPath: string,
-        query: RecordQuery,
-        options?: RecordQueryOptions,
-    ): Promise<RecordQueryResult[]> {
-        const r = await this.mustBeSeqFile(fileIdOrPath, 'seqQuery');
-        return this.records.queryRecordFields(r.ino, query, options);
-    }
-
-    async createIndex(fileIdOrPath: string, field: string): Promise<void> {
-        const r = await this.mustBeSeqFile(fileIdOrPath, 'createIndex');
-        await this.records.createRecordIndex(r.ino, field);
-    }
-
-    async deleteIndex(fileIdOrPath: string, field: string): Promise<void> {
-        const r = await this.mustBeSeqFile(fileIdOrPath, 'deleteIndex');
-        await this.records.deleteRecordIndex(r.ino, field);
+        return { total: processed, processed };
     }
 }
diff --git a/tookit b/tookit
--- a/tookit
+++ b/tookit
@@ -1 +1 @@
-Subproject commit 016d535ae097a042908c61ba4105889a85aee8cc
+Subproject commit 016d535ae097a042908c61ba4105889a85aee8cc-dirty
