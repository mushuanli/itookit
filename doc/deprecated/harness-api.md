# LLM 执行体调度器 - 接口设计文档

## 一、设计概述

### 1.1 架构定位

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            Application Layer                                 │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ │
│  │  CLI/REPL   │  │   IDE Ext   │  │  Desktop App│  │   REST/gRPC API     │ │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────────┬──────────┘ │
└─────────┼────────────────┼────────────────┼────────────────────┼────────────┘
          │                │                │                    │
          └────────────────┴────────┬───────┴────────────────────┘
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              VFS Layer                                       │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │  /dev/agent      → AgentDeviceDriver    (IAgentRuntime)              │   │
│  │  /dev/llm/*      → LLMDeviceDriver      (ILLMService)                │   │
│  │  /dev/tools/*    → ToolDeviceDriver     (IToolService)               │   │
│  │  /dev/skills/*   → SkillDeviceDriver    (ISkillService)              │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
└────────────────────────────────────┬────────────────────────────────────────┘
                                     │
┌────────────────────────────────────┴────────────────────────────────────────┐
│                           Device Drivers                                     │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                    AgentDeviceDriver                                 │    │
│  │  ┌─────────────────────────────────────────────────────────────┐    │    │
│  │  │                   AgentLoopExecutor                          │    │    │
│  │  │  ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌────────────┐   │    │    │
│  │  │  │ Context   │ │  Budget   │ │  Error    │ │ BackPress  │   │    │    │
│  │  │  │ Manager   │ │Controller │ │ Recovery  │ │ Validator  │   │    │    │
│  │  │  └───────────┘ └───────────┘ └───────────┘ └────────────┘   │    │    │
│  │  └─────────────────────────────────────────────────────────────┘    │    │
│  │  依赖: ILLMService, IToolService, ISkillService                     │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐           │
│  │ LLMDeviceDriver  │  │ToolDeviceDriver  │  │SkillDeviceDriver │           │
│  │ (多 Provider)    │  │ (工具执行)       │  │ (技能管理)       │           │
│  └──────────────────┘  └──────────────────┘  └──────────────────┘           │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 1.2 核心设计原则

| 原则 | 体现 |
|------|------|
| **Device Driver 封装复杂性** | LLM 连接管理、Provider 适配、多模型切换等复杂性封装在 Driver 内部 |
| **服务接口简洁** | IToolService/ISkillService/ILLMService 只暴露必要的业务方法 |
| **Agent 循环为核心** | AgentLoopExecutor 内置多轮循环、上下文管理、错误恢复 |
| **VFS 路径即访问入口** | 通过 `/dev/llm/connections/xxx` 等路径统一访问 |
| **依赖倒置** | Agent Driver 依赖 Service 接口，不直接依赖具体 Driver |

---

## 二、核心接口定义

### 2.1 Agent 服务接口

```typescript
// @file: common/interfaces/agent/agent-service.ts

import type {
    AgentTaskRequest,
    AgentTaskResult,
    AgentSessionInfo,
    AgentEventType,
    AgentEventPayloads,
    AgentLoopConfig,
    AgentModelRoles,
    AgentBudgetLimits,
} from './agent-types';

/**
 * Agent 运行时接口。
 *
 * 由 AgentDeviceDriver 内部的 AgentLoopExecutor 实现。
 * 外部通过 VFS 设备文件 (/dev/agent) 访问。
 *
 * 设计要点：
 * 1. 不暴露 Session 内部状态（LoD 原则）
 * 2. 通过事件通知进度（观察者模式）
 * 3. 支持可拦截事件（权限确认、反压验证）
 */
export interface IAgentRuntime {
    /**
     * 执行任务。
     *
     * 启动 Agent 核心循环，返回最终结果。
     * 过程中通过事件通知进度。
     */
    run(task: AgentTaskRequest): Promise<AgentTaskResult>;

    /**
     * 中止当前执行
     */
    abort(): void;

    /**
     * 订阅 Agent 事件（通知模式）
     */
    on<E extends AgentEventType>(
        event: E,
        handler: (payload: AgentEventPayloads[E]) => void,
    ): () => void;

    /**
     * 订阅可拦截事件。
     *
     * handler 返回值影响执行流程：
     * - 'agent:permission:request' → 返回 true 允许、false 拒绝
     * - 'agent:backpressure:failed' → 返回修正指令字符串或 undefined
     */
    onIntercept<E extends AgentEventType>(
        event: E,
        handler: (payload: AgentEventPayloads[E]) => Promise<boolean | string | undefined>,
    ): () => void;

    // ── 会话管理 ──

    /** 获取当前会话信息 */
    getCurrentSession(): AgentSessionInfo | null;

    /** 列出最近的会话 */
    listRecentSessions(limit?: number): AgentSessionInfo[];

    /** 恢复历史会话 */
    resumeSession(sessionId: string): Promise<AgentTaskResult>;

    /** 删除会话 */
    deleteSession(sessionId: string): void;
}

/**
 * Agent 配置服务接口。
 *
 * 管理 Agent 的配置信息（模型角色、预算、循环参数等）。
 * 独立于 IAgentRuntime，遵循 SRP。
 */
export interface IAgentConfigService {
    /** 获取模型角色配置 */
    getModelRoles(): AgentModelRoles;

    /** 设置模型角色配置 */
    setModelRoles(roles: Partial<AgentModelRoles>): Promise<void>;

    /** 获取预算配置 */
    getBudgetLimits(): AgentBudgetLimits;

    /** 设置预算配置 */
    setBudgetLimits(limits: Partial<AgentBudgetLimits>): Promise<void>;

    /** 获取循环配置 */
    getLoopConfig(): AgentLoopConfig;

    /** 设置循环配置 */
    setLoopConfig(config: Partial<AgentLoopConfig>): Promise<void>;

    /** 监听配置变化 */
    onChange(listener: () => void): () => void;
}
```

### 2.2 Agent 类型定义

```typescript
// @file: common/interfaces/agent/agent-types.ts

import type { TokenUsage, ToolCall } from '../llm';

// ═══════════════════════════════════════════════════════════════
// 会话与状态
// ═══════════════════════════════════════════════════════════════

/**
 * Agent 会话信息（外部可见的快照）。
 *
 * 由 ExecutionLoop 内部维护，通过事件暴露给外部。
 * 外部不直接操作 Session 内部状态。
 */
export interface AgentSessionInfo {
    sessionId: string;
    status: AgentStatus;
    rounds: number;
    usage: AgentUsageSnapshot;
    loadedSkills: string[];
    isCompressed: boolean;
    createdAt: number;
    taskPreview: string;
}

export type AgentStatus =
    | 'idle'
    | 'running'
    | 'completed'
    | 'partial'
    | 'failed'
    | 'cancelled';

/**
 * 资源使用快照
 */
export interface AgentUsageSnapshot {
    rounds: number;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    elapsedMs: number;
    toolCalls: number;
    startTime: number;
}

// ═══════════════════════════════════════════════════════════════
// 预算与配置
// ═══════════════════════════════════════════════════════════════

/**
 * 六维预算限制
 */
export interface AgentBudgetLimits {
    maxRounds: number;
    maxInputTokens: number;
    maxOutputTokens: number;
    maxCostUsd: number;
    maxDurationMs: number;
    maxToolCalls: number;
}

/**
 * Agent 模型角色配置
 *
 * 四种角色：
 * - primary:    主要推理模型（最聪明的）
 * - fallback:   降级模型（主力不可用时）
 * - summarizer: 摘要模型（用于上下文压缩，可用便宜模型）
 * - subAgent:   子 Agent 模型（用于隔离任务）
 */
export interface AgentModelRoles {
    /** 主要推理模型 - LLM 连接 ID */
    primary: string;
    /** 降级模型（主力不可用时） */
    fallback?: string;
    /** 摘要模型（用于上下文压缩） */
    summarizer?: string;
    /** 子 Agent 模型（用于隔离任务） */
    subAgent?: string;
}

/**
 * Agent 循环配置
 */
export interface AgentLoopConfig {
    /** API 最大重试次数 @default 5 */
    maxApiRetries: number;
    /** 输出截断最大重试次数 @default 3 */
    maxTruncationRetries: number;
    /** 重试基础延迟（毫秒） @default 1000 */
    baseRetryDelayMs: number;
    /** 上下文压缩阈值（0~1） @default 0.75 */
    compressionThreshold: number;
    /** 系统提示词 token 预算 @default 4000 */
    systemPromptBudgetTokens: number;
    /** 是否启用反压验证 @default true */
    enableBackPressure: boolean;
    /** 反压规则列表 */
    backPressureRules: BackPressureRule[];
}

// ═══════════════════════════════════════════════════════════════
// 任务请求与结果
// ═══════════════════════════════════════════════════════════════

/**
 * 任务请求
 */
export interface AgentTaskRequest {
    /** 用户 prompt */
    prompt: string;
    /** 附加上下文（如当前选中的代码） */
    context?: Record<string, unknown>;
    /** 工作目录 */
    workingDirectory?: string;
    /** 模型覆盖（使用其他 LLM 连接） */
    modelOverride?: string;
    /** 预算覆盖 */
    budgetOverride?: Partial<AgentBudgetLimits>;
    /** 会话 ID（用于恢复已有会话） */
    sessionId?: string;
    /** 附件列表 */
    attachments?: import('../llm').Attachment[];
}

/**
 * 任务结果
 */
export interface AgentTaskResult {
    sessionId: string;
    status: AgentStatus;
    response: string;
    usage: AgentUsageSnapshot;
    rounds: number;
    incompleteReason?: string;
}

// ═══════════════════════════════════════════════════════════════
// 执行步骤与反压
// ═══════════════════════════════════════════════════════════════

/**
 * 执行步骤（事件通知用）
 */
export interface AgentStep {
    type: 'tool_execution' | 'final_response' | 'compression' | 'back_pressure';
    content?: string;
    toolCalls?: ToolCall[];
    toolResults?: Array<{ callId: string; output: string; isError: boolean }>;
    timestamp: number;
}

/**
 * 上下文压缩事件信息
 */
export interface CompressionInfo {
    /** 使用的压缩层级 1-4 */
    layer: number;
    /** 层级名称 */
    layerName: 'history_snip' | 'cache_prune' | 'llm_summarize' | 'sliding_window';
    /** 压缩前 token 数 */
    beforeTokens: number;
    /** 压缩后 token 数 */
    afterTokens: number;
}

/**
 * 反压验证规则
 */
export interface BackPressureRule {
    /** 规则名称 */
    name: string;
    /** 在哪些工具执行后触发 */
    afterTools: string[];
    /** 验证命令 */
    command: string;
    /** 超时（毫秒） */
    timeoutMs: number;
    /** 是否只在最终响应前验证 */
    onlyOnFinal: boolean;
}

// ═══════════════════════════════════════════════════════════════
// 事件系统
// ═══════════════════════════════════════════════════════════════════
// 事件系统
// ═══════════════════════════════════════════════════════════════

/**
 * Agent 事件类型枚举
 */
export type AgentEventType =
    // 任务生命周期
    | 'agent:task:start'
    | 'agent:task:end'
    | 'agent:step:complete'
    // LLM 调用
    | 'agent:llm:start'
    | 'agent:llm:end'
    | 'agent:llm:retry'
    | 'agent:llm:fallback'
    | 'agent:llm:stream:delta'
    // 工具执行
    | 'agent:tool:start'
    | 'agent:tool:success'
    | 'agent:tool:error'
    | 'agent:tool:timeout'
    // 权限（可拦截）
    | 'agent:permission:request'
    // 上下文管理
    | 'agent:context:compressed'
    | 'agent:skill:loaded'
    // 预算
    | 'agent:budget:warning'
    | 'agent:budget:exhausted'
    // 反压验证（可拦截）
    | 'agent:backpressure:check'
    | 'agent:backpressure:failed'
    // 子 Agent
    | 'agent:subagent:spawn'
    | 'agent:subagent:complete';

/**
 * 事件载荷类型映射
 */
export interface AgentEventPayloads {
    'agent:task:start': { task: AgentTaskRequest };
    'agent:task:end': { result: AgentTaskResult };
    'agent:step:complete': { step: AgentStep };

    'agent:llm:start': { model: string; connectionId: string; messageCount: number };
    'agent:llm:end': { model: string; usage: TokenUsage; stopReason: string };
    'agent:llm:retry': { attempt: number; reason: string; delayMs: number };
    'agent:llm:fallback': { from: string; to: string; reason: string };
    'agent:llm:stream:delta': { text?: string; toolCallDelta?: { id: string; partialJson: string } };

    'agent:tool:start': { call: ToolCall };
    'agent:tool:success': { call: ToolCall; output: string; durationMs: number };
    'agent:tool:error': { call: ToolCall; error: string };
    'agent:tool:timeout': { call: ToolCall; timeoutMs: number };

    'agent:permission:request': { tool: string; args: Record<string, unknown>; description: string };

    'agent:context:compressed': CompressionInfo;
    'agent:skill:loaded': { skillId: string; newTools: string[] };

    'agent:budget:warning': { resource: string; usedRatio: number };
    'agent:budget:exhausted': { resource: string; used: number; limit: number };

    'agent:backpressure:check': { ruleName: string; command: string };
    'agent:backpressure:failed': { ruleName: string; errors: string };

    'agent:subagent:spawn': { instruction: string; model: string };
    'agent:subagent:complete': { instruction: string; resultSummary: string };
}
```

### 2.3 LLM 服务接口

```typescript
// @file: common/interfaces/llm/llm-service.ts

import type {
    LLMChatRequest,
    LLMChatResponse,
    LLMStreamEvent,
    LLMConnectionConfig,
    LLMConnectionInfo,
    LLMConnectionStatus,
    ToolDefinition,
} from './llm-types';

/**
 * LLM 服务接口。
 *
 * 由 LLMDeviceDriver 实现，封装多 Provider 的连接管理。
 * AgentLoopExecutor 通过此接口调用 LLM，不直接感知 Provider 差异。
 *
 * 设计要点：
 * 1. 连接管理：创建、查询、删除连接
 * 2. 对话调用：同步和流式
 * 3. Provider 无关：Agent 层只使用 connectionId
 */
export interface ILLMService {
    // ── 连接管理 ──

    /**
     * 创建 LLM 连接。
     *
     * 返回 connectionId，后续操作使用此 ID。
     * 配置中的 apiKey 等敏感信息由 Driver 安全存储。
     */
    createConnection(config: LLMConnectionConfig): Promise<string>;

    /**
     * 获取连接信息（不含敏感数据）
     */
    getConnection(connectionId: string): LLMConnectionInfo | undefined;

    /**
     * 列出所有连接
     */
    listConnections(): LLMConnectionInfo[];

    /**
     * 删除连接
     */
    deleteConnection(connectionId: string): Promise<void>;

    /**
     * 测试连接可用性
     */
    testConnection(connectionId: string): Promise<LLMConnectionStatus>;

    // ── 对话调用 ──

    /**
     * 同步调用 LLM。
     *
     * 等待完整响应返回。
     */
    chat(connectionId: string, request: LLMChatRequest): Promise<LLMChatResponse>;

    /**
     * 流式调用 LLM。
     *
     * 返回 AsyncIterable，边生成边返回。
     * 用于流式工具执行：当一个 tool_use block 完整时可立即执行。
     */
    chatStream(connectionId: string, request: LLMChatRequest): AsyncIterable<LLMStreamEvent>;

    /**
     * 中止指定连接的当前请求
     */
    abort(connectionId: string): void;

    // ── 模型信息 ──

    /**
     * 获取指定连接支持的模型列表
     */
    listModels(connectionId: string): Promise<string[]>;

    /**
     * 估算 token 数量
     */
    estimateTokens(connectionId: string, text: string): number;
}

/**
 * LLM Provider 适配器接口。
 *
 * 由各 Provider 实现（Anthropic、OpenAI、Ollama 等）。
 * LLMDeviceDriver 内部使用，不对外暴露。
 */
export interface ILLMProviderAdapter {
    readonly providerId: string;
    readonly displayName: string;

    /** 是否支持流式调用 */
    readonly supportsStreaming: boolean;
    /** 是否支持工具调用 */
    readonly supportsTools: boolean;
    /** 是否支持多模态 */
    readonly supportsVision: boolean;
    /** 是否支持 thinking 输出 */
    readonly supportsThinking: boolean;

    /** 初始化适配器（如验证 API key） */
    initialize(config: LLMConnectionConfig): Promise<void>;

    /** 同步调用 */
    chat(request: LLMChatRequest): Promise<LLMChatResponse>;

    /** 流式调用 */
    chatStream(request: LLMChatRequest): AsyncIterable<LLMStreamEvent>;

    /** 列出可用模型 */
    listModels(): Promise<string[]>;

    /** 估算 token（Provider 特定实现） */
    estimateTokens(text: string): number;

    /** 释放资源 */
    dispose(): Promise<void>;
}
```

### 2.4 LLM 类型定义

```typescript
// @file: common/interfaces/llm/llm-types.ts

// ═══════════════════════════════════════════════════════════════
// 连接配置
// ═══════════════════════════════════════════════════════════════

/**
 * LLM 连接配置
 */
export interface LLMConnectionConfig {
    /** 连接名称（用户可读） */
    name: string;
    /** Provider 类型 */
    provider: LLMProvider;
    /** API Key（敏感信息，Driver 加密存储） */
    apiKey?: string;
    /** 自定义 Base URL（用于代理或私有部署） */
    baseUrl?: string;
    /** 默认模型 ID */
    defaultModel: string;
    /** 默认参数 */
    defaultParams?: LLMDefaultParams;
    /** 是否为默认连接 */
    isDefault?: boolean;
}

export type LLMProvider =
    | 'anthropic'
    | 'openai'
    | 'azure'
    | 'ollama'
    | 'deepseek'
    | 'google'
    | 'custom';

/**
 * 连接信息（不含敏感数据）
 */
export interface LLMConnectionInfo {
    connectionId: string;
    name: string;
    provider: LLMProvider;
    defaultModel: string;
    status: LLMConnectionStatus;
    createdAt: number;
    lastUsedAt?: number;
    isDefault: boolean;
}

export interface LLMConnectionStatus {
    available: boolean;
    latencyMs?: number;
    error?: string;
    checkedAt: number;
}

/**
 * 默认参数
 */
export interface LLMDefaultParams {
    maxOutputTokens?: number;
    temperature?: number;
    topP?: number;
    topK?: number;
}

// ═══════════════════════════════════════════════════════════════
// 对话请求与响应
// ═══════════════════════════════════════════════════════════════

/**
 * LLM 对话请求
 */
export interface LLMChatRequest {
    /** 系统提示词 */
    system: string;
    /** 消息历史 */
    messages: Message[];
    /** 工具定义 */
    tools?: ToolDefinition[];
    /** 模型覆盖（不指定则用连接默认模型） */
    model?: string;
    /** 最大输出 token */
    maxTokens?: number;
    /** 温度 */
    temperature?: number;
    /** 是否启用思考输出 */
    enableThinking?: boolean;
    /** 思考 token 预算 */
    thinkingBudget?: number;
    /** 附件（图片等） */
    attachments?: Attachment[];
    /** 取消信号 */
    signal?: AbortSignal;
}

/**
 * LLM 对话响应
 */
export interface LLMChatResponse {
    /** 文本内容 */
    text: string;
    /** 工具调用列表 */
    toolCalls: ToolCall[];
    /** 思考内容（如果启用） */
    thinking?: string;
    /** Token 使用统计 */
    usage: TokenUsage;
    /** 是否被截断 */
    isTruncated: boolean;
    /** 停止原因 */
    stopReason: StopReason;
    /** 实际使用的模型 */
    model: string;
}

export type StopReason = 'end_round' | 'tool_use' | 'max_tokens' | 'stop_sequence';

// ═══════════════════════════════════════════════════════════════
// 消息结构
// ═══════════════════════════════════════════════════════════════

/**
 * 统一消息格式
 *
 * 抹平 Anthropic（content blocks）和 OpenAI（message + tool_calls）差异。
 */
export interface Message {
    role: 'user' | 'assistant' | 'tool';
    content: string;
    toolCalls?: ToolCall[];
    toolCallId?: string;
    isError?: boolean;
    /** 标记此消息已被压缩截断 */
    isTruncated?: boolean;
    metadata?: Record<string, unknown>;
}

/**
 * 工具调用
 */
export interface ToolCall {
    id: string;
    name: string;
    arguments: Record<string, unknown>;
}

/**
 * 工具结果
 */
export interface ToolResult {
    callId: string;
    output: string;
    isError: boolean;
}

/**
 * Token 使用统计
 */
export interface TokenUsage {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
}

// ═══════════════════════════════════════════════════════════════
// 工具定义
// ═══════════════════════════════════════════════════════════════

/**
 * 工具定义（发送给 LLM）
 */
export interface ToolDefinition {
    name: string;
    description: string;
    /** JSON Schema 格式的参数定义 */
    parameters: Record<string, unknown>;
}

// ═══════════════════════════════════════════════════════════════
// 附件
// ═══════════════════════════════════════════════════════════════

/**
 * 附件（多模态输入）
 */
export interface Attachment {
    type: 'image' | 'file' | 'url';
    /** MIME 类型 */
    mimeType: string;
    /** Base64 编码内容 */
    data?: string;
    /** URL（用于 url 类型） */
    url?: string;
    /** 文件路径（用于 file 类型） */
    path?: string;
    /** 显示名称 */
    name?: string;
}

// ═══════════════════════════════════════════════════════════════
// 流式事件
// ═══════════════════════════════════════════════════════════════

/**
 * 流式事件
 */
export type LLMStreamEvent =
    | { type: 'content_block_start'; index: number; blockType: 'text' | 'tool_use'; toolName?: string; toolId?: string }
    | { type: 'content_delta'; index: number; text?: string; partialJson?: string }
    | { type: 'content_block_stop'; index: number }
    | { type: 'thinking_delta'; text: string }
    | { type: 'message_stop'; usage: TokenUsage; stopReason: StopReason };
```

### 2.5 工具服务接口

```typescript
// @file: common/interfaces/tool/tool-service.ts

import type {
    ToolMeta,
    ToolDefinition,
    ToolInvokeResult,
    ToolInvokeContext,
    ToolSideEffect,
    ToolPermission,
    ToolPermissionRule,
} from './tool-types';

/**
 * 工具服务接口。
 *
 * 由 ToolDeviceDriver 实现，管理工具注册、执行、权限。
 * AgentLoopExecutor 通过此接口执行工具调用。
 *
 * 设计要点：
 * 1. 批量执行：读操作并行、写操作串行
 * 2. 权限管理：三层规则评估
 * 3. 异常回馈：错误包装为结果，不抛异常
 */
export interface IToolService {
    // ── 工具注册 ──

    /**
     * 注册工具
     */
    register(
        meta: ToolMeta,
        definition: ToolDefinition,
        handler: ToolHandler,
    ): void;

    /**
     * 批量注册工具
     */
    registerBatch(tools: Array<{
        meta: ToolMeta;
        definition: ToolDefinition;
        handler: ToolHandler;
    }>): void;

    /**
     * 注销工具
     */
    unregister(toolId: string): void;

    /**
     * 获取工具元信息
     */
    getToolMeta(toolId: string): ToolMeta | undefined;

    /**
     * 获取所有已注册工具的 ID
     */
    listToolIds(): string[];

    // ── 工具定义（发给 LLM）──

    /**
     * 获取指定工具的定义（用于 LLM 调用）
     */
    getToolDefinition(toolId: string): ToolDefinition | undefined;

    /**
     * 获取所有可用工具的定义列表。
     *
     * 可选过滤：只返回已启用的、或按标签过滤。
     * 配合 Skill 系统实现渐进式工具暴露。
     */
    getToolDefinitions(filter?: ToolFilter): ToolDefinition[];

    // ── 工具执行 ──

    /**
     * 执行单个工具调用
     */
    invoke(
        toolId: string,
        args: Record<string, unknown>,
        context: ToolInvokeContext,
    ): Promise<ToolInvokeResult>;

    /**
     * 批量执行工具调用。
     *
     * 并行策略：
     * - sideEffect='none' 的工具并行执行
     * - sideEffect='local'/'external' 的工具串行执行
     */
    invokeBatch(
        calls: Array<{ toolId: string; callId: string; args: Record<string, unknown> }>,
        context: ToolInvokeContext,
    ): Promise<ToolInvokeResult[]>;

    // ── 权限管理 ──

    /**
     * 检查工具调用权限
     */
    checkPermission(
        toolId: string,
        args: Record<string, unknown>,
        context: ToolInvokeContext,
    ): Promise<ToolPermission>;

    /**
     * 记录会话级授权（用户确认后调用）
     */
    grantSessionPermission(toolId: string, scope: string): void;

    /**
     * 清除会话级授权
     */
    clearSessionPermissions(): void;

    /**
     * 添加全局权限规则
     */
    addPermissionRule(rule: ToolPermissionRule): void;

    /**
     * 移除全局权限规则
     */
    removePermissionRule(ruleId: string): void;
}

/**
 * 工具处理函数类型
 */
export type ToolHandler = (
    args: Record<string, unknown>,
    context: ToolInvokeContext,
) => Promise<string>;

/**
 * 工具过滤条件
 */
export interface ToolFilter {
    /** 只返回已启用的工具 */
    enabledOnly?: boolean;
    /** 按标签过滤 */
    tags?: string[];
    /** 按副作用类型过滤 */
    sideEffects?: ToolSideEffect[];
}
```

### 2.6 工具类型定义

```typescript
// @file: common/interfaces/tool/tool-types.ts

// ═══════════════════════════════════════════════════════════════
// 工具元信息
// ═══════════════════════════════════════════════════════════════

/**
 * 工具元信息（运行时属性）
 */
export interface ToolMeta {
    /** 工具唯一 ID */
    id: string;
    /** 显示名称 */
    displayName: string;
    /** 副作用分类 */
    sideEffect: ToolSideEffect;
    /** 超时时间（毫秒） */
    timeoutMs: number;
    /** 是否启用 */
    enabled: boolean;
    /** 标签（用于分类和过滤） */
    tags: string[];
    /** 图标（用于 UI 展示） */
    icon?: string;
    /** 来源（builtin / skill:xxx / mcp:xxx） */
    source: string;
}

/**
 * 副作用分类
 *
 * 决定并行策略和权限策略：
 * - none: 纯读操作，可安全并行，默认允许
 * - local: 本地副作用（文件写入），需串行，需确认
 * - external: 外部副作用（网络请求），需串行，需确认
 */
export type ToolSideEffect = 'none' | 'local' | 'external';

/**
 * 工具定义（发送给 LLM，与 llm-types 中的 ToolDefinition 相同）
 */
export interface ToolDefinition {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
}

// ═══════════════════════════════════════════════════════════════
// 执行上下文与结果
// ═══════════════════════════════════════════════════════════════

/**
 * 工具执行上下文
 */
export interface ToolInvokeContext {
    /** 会话 ID */
    sessionId: string;
    /** 工作目录 */
    workingDirectory: string;
    /** 取消信号 */
    signal?: AbortSignal;
    /** 环境变量 */
    env?: Record<string, string>;
}

/**
 * 工具执行结果
 */
export interface ToolInvokeResult {
    /** 工具调用 ID（对应 LLM 的 tool_call.id） */
    callId: string;
    /** 是否成功 */
    success: boolean;
    /** 输出内容（无论成功失败都有） */
    output: string;
    /** 执行耗时（毫秒） */
    durationMs: number;
}

// ═══════════════════════════════════════════════════════════════
// 权限系统
// ═══════════════════════════════════════════════════════════════

/**
 * 权限评估结果
 */
export type ToolPermission = 'allowed' | 'denied' | 'ask_user';

/**
 * 权限规则
 */
export interface ToolPermissionRule {
    /** 规则 ID */
    id: string;
    /** 工具 ID 模式（支持 * 通配符） */
    toolPattern: string;
    /** 参数模式（可选，如路径匹配） */
    argPatterns?: Record<string, string>;
    /** 权限动作 */
    action: ToolPermission;
    /** 规则说明 */
    reason: string;
    /** 优先级（数字越大优先级越高） */
    priority: number;
}
```

### 2.7 技能服务接口

```typescript
// @file: common/interfaces/skill/skill-service.ts

import type {
    SkillDefinition,
    SkillInfo,
    SkillLoadResult,
    SkillToolBinding,
} from './skill-types';

/**
 * 技能服务接口。
 *
 * 由 SkillDeviceDriver 实现，管理技能的注册、加载、卸载。
 * 实现渐进式工具暴露：LLM 按需加载技能，而非一次性注入所有工具。
 *
 * 设计要点：
 * 1. Skill 是工具和指令的容器
 * 2. 加载 Skill 会向 IToolService 注册其工具
 * 3. 支持自动检测：根据任务内容推荐 Skill
 */
export interface ISkillService {
    // ── 技能注册 ──

    /**
     * 注册技能定义
     */
    register(definition: SkillDefinition): void;

    /**
     * 批量注册技能
     */
    registerBatch(definitions: SkillDefinition[]): void;

    /**
     * 注销技能
     */
    unregister(skillId: string): void;

    /**
     * 获取技能定义
     */
    getSkill(skillId: string): SkillDefinition | undefined;

    /**
     * 列出所有已注册的技能
     */
    listSkills(): SkillInfo[];

    // ── 技能加载 ──

    /**
     * 加载技能到当前会话。
     *
     * 1. 向 IToolService 注册技能的工具
     * 2. 返回加载结果（包含新增的工具列表和指令）
     */
    loadSkill(
        skillId: string,
        sessionId: string,
    ): Promise<SkillLoadResult>;

    /**
     * 卸载技能
     */
    unloadSkill(skillId: string, sessionId: string): void;

    /**
     * 获取会话已加载的技能列表
     */
    getLoadedSkills(sessionId: string): string[];

    /**
     * 获取会话未加载但可用的技能列表
     */
    getAvailableSkills(sessionId: string): SkillInfo[];

    // ── 自动检测 ──

    /**
     * 根据任务内容自动检测应预加载的技能
     */
    autoDetect(taskPrompt: string): string[];

    /**
     * 获取需要自动加载的技能列表（autoLoad: true）
     */
    getAutoLoadSkills(): string[];

    // ── 指令生成 ──

    /**
     * 生成已加载技能的指令文本（用于注入 system prompt）
     */
    generateInstructions(sessionId: string): string;

    /**
     * 生成可用技能的列表文本（用于注入 system prompt）
     */
    generateAvailableSkillsList(sessionId: string): string;
}
```

### 2.8 技能类型定义

```typescript
// @file: common/interfaces/skill/skill-types.ts

import type { ToolSideEffect } from '../tool';

// ═══════════════════════════════════════════════════════════════
// 技能定义
// ═══════════════════════════════════════════════════════════════

/**
 * 技能定义
 */
export interface SkillDefinition {
    /** 技能 ID */
    id: string;
    /** 显示名称 */
    name: string;
    /** 描述（展示给 LLM 和用户） */
    description: string;
    /** 技能类型 */
    type: SkillType;
    /** 是否启用 */
    enabled: boolean;
    /** 加载后注入 system prompt 的 Markdown 指令 */
    instructions: string;
    /** 工具绑定列表 */
    tools: SkillToolBinding[];
    /** 触发模式（正则表达式，用于自动检测） */
    triggerPatterns: string[];
    /** 是否自动加载 */
    autoLoad: boolean;
    /** 优先级（数字越小越优先） */
    priority: number;
    /** 图标 */
    icon?: string;
    /** 版本 */
    version?: string;
    /** 作者 */
    author?: string;
}

/**
 * 技能类型
 */
export type SkillType =
    | 'builtin'   // 内置技能
    | 'local'     // 本地技能（用户定义）
    | 'http'      // HTTP 技能（远程服务）
    | 'mcp'       // MCP 协议技能
    | 'plugin';   // 插件提供的技能

/**
 * 技能工具绑定
 */
export interface SkillToolBinding {
    /** 工具 ID */
    toolId: string;
    /** 工具名称（用于 LLM） */
    name: string;
    /** 工具描述 */
    description: string;
    /** 参数 Schema */
    parameters: Record<string, unknown>;
    /** 执行类型 */
    executionType: SkillToolExecutionType;
    /** 副作用分类 */
    sideEffect: ToolSideEffect;
    /** 超时（毫秒） */
    timeoutMs: number;
}

/**
 * 工具执行类型
 */
export type SkillToolExecutionType =
    | 'builtin'   // 引用 IToolService 已有的工具
    | 'http'      // 通过 HTTP 调用 Skill 端点
    | 'handler';  // 自定义处理函数（预留给插件）

// ═══════════════════════════════════════════════════════════════
// 技能信息与加载结果
// ═══════════════════════════════════════════════════════════════

/**
 * 技能信息（外部可见）
 */
export interface SkillInfo {
    id: string;
    name: string;
    description: string;
    type: SkillType;
    enabled: boolean;
    toolCount: number;
    autoLoad: boolean;
    icon?: string;
}

/**
 * 技能加载结果
 */
export interface SkillLoadResult {
    /** 是否成功 */
    success: boolean;
    /** 技能 ID */
    skillId: string;
    /** 新增的工具列表 */
    newTools: string[];
    /** 技能指令（注入 system prompt） */
    instructions: string;
    /** 错误信息（如果失败） */
    error?: string;
}
```

---

## 三、设备驱动接口

### 3.1 设备驱动基础接口

```typescript
// @file: common/interfaces/fs/device.ts

/**
 * 设备驱动接口。
 *
 * 所有 Driver（Agent、LLM、Tool、Skill）实现此接口。
 * 通过 VFS 挂载到 /dev/ 目录下。
 */
export interface IDeviceDriver {
    /** 设备类型标识 */
    readonly deviceType: string;

    /** 设备挂载路径（如 /dev/agent） */
    readonly mountPath: string;

    /** 初始化设备 */
    initialize(): Promise<void>;

    /** 关闭设备 */
    close(): Promise<void>;

    /**
     * 读取设备状态/数据
     *
     * @param path 子路径（如 /connections/xxx）
     */
    read(path: string): Promise<unknown>;

    /**
     * 写入设备数据
     */
    write(path: string, data: unknown): Promise<void>;

    /**
     * 设备控制命令
     */
    ioctl(command: string, args?: unknown): Promise<unknown>;

    /**
     * 监听设备事件
     */
    watch(path: string, callback: (event: DeviceEvent) => void): () => void;
}

/**
 * 设备事件
 */
export interface DeviceEvent {
    type: 'change' | 'error' | 'close';
    path: string;
    data?: unknown;
    error?: Error;
}
```

### 3.2 Agent 设备驱动

```typescript
// @file: common/interfaces/agent/agent-driver.ts

import type { IDeviceDriver } from '../fs/device';
import type { IAgentRuntime, IAgentConfigService } from './agent-service';
import type { ILLMService } from '../llm';
import type { IToolService } from '../tool';
import type { ISkillService } from '../skill';

/**
 * Agent 设备驱动配置
 */
export interface AgentDriverConfig {
    /** 会话存储目录 */
    sessionStorageDir?: string;
    /** 内存存储目录 */
    memoryStorageDir?: string;
}

/**
 * Agent 设备驱动接口。
 *
 * 挂载到 /dev/agent。
 * 内部聚合 AgentLoopExecutor 及其依赖组件。
 *
 * 依赖：
 * - ILLMService: 用于调用 LLM
 * - IToolService: 用于执行工具
 * - ISkillService: 用于管理技能
 *
 * 路径结构：
 * - /dev/agent/status           → 当前状态
 * - /dev/agent/session          → 当前会话信息
 * - /dev/agent/sessions/        → 历史会话列表
 * - /dev/agent/config/          → 配置
 * - /dev/agent/config/models    → 模型角色配置
 * - /dev/agent/config/budget    → 预算配置
 * - /dev/agent/config/loop      → 循环配置
 *
 * ioctl 命令：
 * - 'run'     → 执行任务
 * - 'abort'   → 中止执行
 * - 'resume'  → 恢复会话
 */
export interface IAgentDeviceDriver extends IDeviceDriver {
    readonly deviceType: 'agent';
    readonly mountPath: '/dev/agent';

    /** 获取运行时接口 */
    getRuntime(): IAgentRuntime;

    /** 获取配置服务 */
    getConfigService(): IAgentConfigService;

    /** 注入依赖服务（初始化时调用） */
    setServices(services: {
        llm: ILLMService;
        tool: IToolService;
        skill: ISkillService;
    }): void;
}
```

### 3.3 LLM 设备驱动

```typescript
// @file: common/interfaces/llm/llm-driver.ts

import type { IDeviceDriver } from '../fs/device';
import type { ILLMService, ILLMProviderAdapter } from './llm-service';
import type { LLMProvider } from './llm-types';

/**
 * LLM 设备驱动配置
 */
export interface LLMDriverConfig {
    /** 连接配置存储路径 */
    configStoragePath?: string;
    /** 默认超时（毫秒） */
    defaultTimeoutMs?: number;
}

/**
 * LLM 设备驱动接口。
 *
 * 挂载到 /dev/llm。
 * 管理多个 LLM Provider 的连接。
 *
 * 路径结构：
 * - /dev/llm/connections/               → 连接列表
 * - /dev/llm/connections/{id}           → 连接详情
 * - /dev/llm/connections/{id}/status    → 连接状态
 * - /dev/llm/providers/                 → 可用 Provider 列表
 *
 * ioctl 命令：
 * - 'create'      → 创建连接
 * - 'delete'      → 删除连接
 * - 'test'        → 测试连接
 * - 'chat'        → 同步调用
 * - 'chatStream'  → 流式调用
 * - 'abort'       → 中止请求
 * - 'listModels'  → 列出模型
 */
export interface ILLMDeviceDriver extends IDeviceDriver {
    readonly deviceType: 'llm';
    readonly mountPath: '/dev/llm';

    /** 获取 LLM 服务接口 */
    getService(): ILLMService;

    /** 注册 Provider 适配器 */
    registerProvider(provider: LLMProvider, adapter: ILLMProviderAdapter): void;

    /** 获取已注册的 Provider 列表 */
    getRegisteredProviders(): LLMProvider[];
}
```

### 3.4 Tool 设备驱动

```typescript
// @file: common/interfaces/tool/tool-driver.ts

import type { IDeviceDriver } from '../fs/device';
import type { IToolService, ToolHandler } from './tool-service';
import type { ToolMeta, ToolDefinition } from './tool-types';

/**
 * Tool 设备驱动配置
 */
export interface ToolDriverConfig {
    /** 项目权限规则路径 */
    projectPermissionsPath?: string;
}

/**
 * Tool 设备驱动接口。
 *
 * 挂载到 /dev/tools。
 * 管理工具注册、执行、权限。
 *
 * 路径结构：
 * - /dev/tools/                   → 工具列表
 * - /dev/tools/{id}               → 工具详情
 * - /dev/tools/{id}/meta          → 工具元信息
 * - /dev/tools/{id}/definition    → 工具定义（JSON Schema）
 * - /dev/tools/permissions/       → 权限规则
 *
 * ioctl 命令：
 * - 'register'      → 注册工具
 * - 'unregister'    → 注销工具
 * - 'invoke'        → 执行工具
 * - 'invokeBatch'   → 批量执行
 * - 'checkPermission' → 检查权限
 */
export interface IToolDeviceDriver extends IDeviceDriver {
    readonly deviceType: 'tool';
    readonly mountPath: '/dev/tools';

    /** 获取工具服务接口 */
    getService(): IToolService;

    /** 注册内置工具（初始化时调用） */
    registerBuiltinTools(): void;
}
```

### 3.5 Skill 设备驱动

```typescript
// @file: common/interfaces/skill/skill-driver.ts

import type { IDeviceDriver } from '../fs/device';
import type { ISkillService } from './skill-service';
import type { IToolService } from '../tool';
import type { SkillDefinition } from './skill-types';

/**
 * Skill 设备驱动配置
 */
export interface SkillDriverConfig {
    /** 技能定义目录 */
    skillsDirectory?: string;
}

/**
 * Skill 设备驱动接口。
 *
 * 挂载到 /dev/skills。
 * 管理技能定义和加载。
 *
 * 依赖 IToolService（DIP 边界）：
 * - 加载技能时向 IToolService 注册工具
 * - 不直接依赖 ToolDeviceDriver
 *
 * 路径结构：
 * - /dev/skills/                  → 技能列表
 * - /dev/skills/{id}              → 技能详情
 * - /dev/skills/{id}/tools        → 技能工具列表
 * - /dev/skills/loaded/{session}  → 会话已加载的技能
 *
 * ioctl 命令：
 * - 'register'    → 注册技能
 * - 'unregister'  → 注销技能
 * - 'load'        → 加载技能
 * - 'unload'      → 卸载技能
 * - 'autoDetect'  → 自动检测
 */
export interface ISkillDeviceDriver extends IDeviceDriver {
    readonly deviceType: 'skill';
    readonly mountPath: '/dev/skills';

    /** 获取技能服务接口 */
    getService(): ISkillService;

    /** 注入工具服务（DIP） */
    setToolService(toolService: IToolService): void;

    /** 从目录加载技能定义 */
    loadSkillsFromDirectory(directory: string): Promise<void>;
}
```

---

## 四、Agent 执行循环内部组件接口

### 4.1 上下文管理器

```typescript
// @file: common/interfaces/agent/context-manager.ts

import type { Message } from '../llm';

/**
 * 上下文管理器接口。
 *
 * AgentLoopExecutor 内部组件，管理：
 * 1. 系统提示词动态构建
 * 2. 消息历史管理
 * 3. 四层上下文压缩
 */
export interface IContextManager {
    /**
     * 构建系统提示词。
     *
     * 动态组装各 Section：
     * - CoreIdentitySection (priority 0, 不可省略)
     * - EnvironmentSection (priority 1)
     * - LoadedSkillsSection (priority 2)
     * - MemorySection (priority 3)
     * - AvailableSkillsSection (priority 4)
     *
     * 按 token 预算分配，超预算时截断低优先级 Section。
     */
    buildSystemPrompt(sessionId: string): string;

    /**
     * 构建发送给 LLM 的消息列表。
     *
     * 如果上下文被压缩过，头部包含摘要消息。
     */
    buildMessages(sessionId: string): Message[];

    /**
     * 检查并执行上下文压缩（如需要）。
     *
     * 四层渐进策略：
     * 1. HistorySnip: 截断大型工具输出（保留 head+tail）
     * 2. CachePrune: 移除低价值中间消息
     * 3. LLMSummarize: 用 LLM 生成摘要
     * 4. SlidingWindow: 激进滑动窗口
     *
     * @param urgency 紧迫度 0~1，决定压缩激进程度
     * @returns 压缩信息（如果执行了压缩）
     */
    maybeCompress(sessionId: string, urgency: number): Promise<CompressionInfo | null>;

    /**
     * 强制压缩（413 错误后调用）
     */
    forceCompress(sessionId: string): Promise<CompressionInfo>;

    /**
     * 获取当前上下文 token 估算
     */
    estimateContextTokens(sessionId: string): number;

    /**
     * 获取上下文使用率
     */
    getContextUsageRatio(sessionId: string): number;
}

/**
 * 压缩信息
 */
export interface CompressionInfo {
    layer: 1 | 2 | 3 | 4;
    layerName: 'history_snip' | 'cache_prune' | 'llm_summarize' | 'sliding_window';
    beforeTokens: number;
    afterTokens: number;
}
```

### 4.2 预算控制器

```typescript
// @file: common/interfaces/agent/budget-controller.ts

import type { AgentBudgetLimits, AgentUsageSnapshot } from './agent-types';
import type { TokenUsage } from '../llm';

/**
 * 预算控制器接口。
 *
 * 六维预算控制：
 * - rounds: 最大轮次
 * - inputTokens: 输入 token 上限
 * - outputTokens: 输出 token 上限
 * - costUsd: 费用上限
 * - durationMs: 执行时间上限
 * - toolCalls: 工具调用次数上限
 */
export interface IBudgetController {
    /**
     * 创建新的使用快照
     */
    createSnapshot(): AgentUsageSnapshot;

    /**
     * 更新使用量
     */
    updateUsage(
        snapshot: AgentUsageSnapshot,
        tokenUsage: TokenUsage,
        toolCallCount: number,
    ): void;

    /**
     * 检查预算，超限则抛出 BudgetExhaustedError
     */
    checkOrThrow(snapshot: AgentUsageSnapshot): void;

    /**
     * 获取各维度剩余预算比例
     */
    getRemainingRatios(snapshot: AgentUsageSnapshot): Record<string, number>;

    /**
     * 获取最紧张的资源
     */
    getMostConstrainedResource(snapshot: AgentUsageSnapshot): {
        resource: string;
        remainingRatio: number;
    };

    /**
     * 检查是否接近预算上限（用于发出警告）
     */
    isApproachingLimit(snapshot: AgentUsageSnapshot, threshold?: number): string[];
}
```

### 4.3 错误恢复服务

```typescript
// @file: common/interfaces/agent/error-recovery.ts

import type { LLMChatRequest, LLMChatResponse } from '../llm';

/**
 * 错误恢复服务接口。
 *
 * 五类错误的分级恢复策略：
 * 1. RateLimit (429): 指数退避重试
 * 2. ContextTooLarge (413): 强制压缩后重试
 * 3. ServiceOverload (529): 切换 fallback 模型
 * 4. OutputTruncated: 静默重试
 * 5. ToolError: 包装为 ToolResult 喂回 LLM
 */
export interface IErrorRecoveryService {
    /**
     * 执行 LLM 调用，自动处理错误恢复
     */
    callWithRecovery(
        connectionId: string,
        request: LLMChatRequest,
        options: RecoveryOptions,
    ): Promise<LLMChatResponse>;

    /**
     * 获取当前使用的连接 ID（可能因 fallback 切换）
     */
    getCurrentConnectionId(): string;

    /**
     * 是否已切换到 fallback 模型
     */
    isFallbackActive(): boolean;

    /**
     * 重置 fallback 状态
     */
    resetFallback(): void;
}

/**
 * 恢复选项
 */
export interface RecoveryOptions {
    /** 最大重试次数 */
    maxRetries: number;
    /** 基础重试延迟（毫秒） */
    baseDelayMs: number;
    /** 最大截断重试次数 */
    maxTruncationRetries: number;
    /** 压缩回调（413 错误时调用） */
    onCompressionNeeded: () => Promise<void>;
    /** Fallback 连接 ID */
    fallbackConnectionId?: string;
    /** 重试事件回调 */
    onRetry?: (attempt: number, reason: string, delayMs: number) => void;
    /** Fallback 切换回调 */
    onFallback?: (from: string, to: string, reason: string) => void;
}
```

### 4.4 反压验证器

```typescript
// @file: common/interfaces/agent/back-pressure.ts

import type { BackPressureRule } from './agent-types';

/**
 * 反压验证器接口。
 *
 * 核心思想：
 * Agent 说"我改完了"之后，自动跑验证命令（如 typecheck/build/test）。
 * 失败则将错误注入消息历史，让 LLM 继续修正。
 * 成功则静默通过（避免上下文膨胀）。
 */
export interface IBackPressureValidator {
    /**
     * 工具执行后检查
     */
    checkAfterTool(
        toolName: string,
        workingDirectory: string,
    ): Promise<BackPressureResult | null>;

    /**
     * 最终响应前检查
     */
    checkBeforeFinal(
        workingDirectory: string,
    ): Promise<BackPressureResult | null>;

    /**
     * 添加规则
     */
    addRule(rule: BackPressureRule): void;

    /**
     * 移除规则
     */
    removeRule(ruleName: string): void;

    /**
     * 获取所有规则
     */
    getRules(): BackPressureRule[];
}

/**
 * 反压验证结果
 */
export interface BackPressureResult {
    passed: boolean;
    ruleName: string;
    errorMessage: string;
}
```

### 4.5 子代理路由器

```typescript
// @file: common/interfaces/agent/sub-agent.ts

/**
 * 子代理路由器接口。
 *
 * 核心理念：子代理是"上下文防火墙"。
 * - 拥有完全独立的 Context Window
 * - 只接收一个精确指令
 * - 执行完毕后只返回精炼摘要
 * - 可使用更便宜/更快的模型
 *
 * 效果：
 * 1. 主 Agent 上下文保持干净
 * 2. 子 Agent 的中间 IO 不污染主循环
 * 3. 成本降低
 */
export interface ISubAgentRouter {
    /**
     * 委托任务给子代理
     */
    delegate(task: SubAgentTask): Promise<SubAgentResult>;

    /**
     * 中止当前子代理执行
     */
    abort(): void;
}

/**
 * 子代理任务
 */
export interface SubAgentTask {
    /** 任务指令 */
    instruction: string;
    /** 允许使用的工具（默认只读工具） */
    allowedTools?: string[];
    /** 期望的响应格式 */
    responseFormat?: string;
    /** 最大轮次 */
    maxRounds?: number;
    /** 使用的 LLM 连接（默认用 subAgent 角色） */
    connectionId?: string;
}

/**
 * 子代理结果
 */
export interface SubAgentResult {
    success: boolean;
    /** 精炼后的结果摘要 */
    summary: string;
    /** 执行轮次 */
    rounds: number;
    /** Token 使用 */
    tokenUsage: { input: number; output: number };
}
```

---

## 五、编排器接口

### 5.1 编排器基础接口

```typescript
// @file: common/interfaces/orchestrator/orchestrator-base.ts

import type { AgentTaskResult } from '../agent';

/**
 * 执行上下文。
 *
 * 编排器在多个执行节点之间传递数据的载体。
 */
export interface IExecutionContext {
    /** 变量存储 */
    variables: Map<string, unknown>;
    /** 父节点结果 */
    parentResult?: unknown;
    /** 元数据 */
    metadata: Record<string, unknown>;
    /** 获取变量（支持路径，如 'node1.output'） */
    get(path: string): unknown;
    /** 设置变量 */
    set(path: string, value: unknown): void;
}

/**
 * 编排器接口。
 *
 * 支持多种执行模式：串行、并行、路由、循环、DAG。
 * 每种编排器可以嵌套其他编排器或执行节点。
 */
export interface IOrchestrator {
    /** 编排器类型 */
    readonly type: OrchestratorType;

    /**
     * 执行编排
     */
    execute(context: IExecutionContext): Promise<OrchestratorResult>;

    /**
     * 中止执行
     */
    abort(): void;
}

export type OrchestratorType =
    | 'serial'
    | 'parallel'
    | 'router'
    | 'loop'
    | 'dag';

/**
 * 编排结果
 */
export interface OrchestratorResult {
    success: boolean;
    /** 最终输出 */
    output: unknown;
    /** 节点结果集合 */
    nodeResults: Map<string, NodeResult>;
    /** 总执行时间 */
    durationMs: number;
}

/**
 * 节点结果
 */
export interface NodeResult {
    nodeId: string;
    status: 'completed' | 'failed' | 'skipped' | 'cancelled';
    output?: unknown;
    error?: string;
    durationMs: number;
}
```

### 5.2 执行节点接口

```typescript
// @file: common/interfaces/orchestrator/execution-node.ts

import type { IExecutionContext, NodeResult } from './orchestrator-base';

/**
 * 执行节点类型
 */
export type ExecutionNodeType =
    | 'agent'      // Agent 执行（使用 IAgentRuntime）
    | 'tool'       // 工具执行（使用 IToolService）
    | 'http'       // HTTP 请求
    | 'script'     // 脚本执行
    | 'transform'  // 数据转换
    | 'condition'  // 条件判断
    | 'orchestrator'; // 嵌套编排器

/**
 * 执行节点定义
 */
export interface ExecutionNodeDefinition {
    /** 节点 ID */
    id: string;
    /** 节点类型 */
    type: ExecutionNodeType;
    /** 节点配置 */
    config: Record<string, unknown>;
    /** 依赖的节点 ID（用于 DAG） */
    dependencies?: string[];
    /** 超时（毫秒） */
    timeoutMs?: number;
    /** 重试配置 */
    retry?: {
        maxAttempts: number;
        delayMs: number;
        backoffMultiplier?: number;
    };
}

/**
 * 执行节点接口
 */
export interface IExecutionNode {
    readonly nodeId: string;
    readonly nodeType: ExecutionNodeType;

    /**
     * 执行节点
     */
    execute(input: unknown, context: IExecutionContext): Promise<NodeResult>;

    /**
     * 中止执行
     */
    abort(): void;
}

/**
 * 执行节点工厂接口
 */
export interface IExecutionNodeFactory {
    /**
     * 根据定义创建执行节点
     */
    create(definition: ExecutionNodeDefinition): IExecutionNode;

    /**
     * 注册自定义节点类型
     */
    registerNodeType(
        type: string,
        creator: (definition: ExecutionNodeDefinition) => IExecutionNode,
    ): void;
}
```

### 5.3 各类编排器配置

```typescript
// @file: common/interfaces/orchestrator/orchestrator-configs.ts

import type { ExecutionNodeDefinition } from './execution-node';

/**
 * 串行编排器配置
 */
export interface SerialOrchestratorConfig {
    type: 'serial';
    nodes: ExecutionNodeDefinition[];
    /** 某节点失败时是否继续 */
    continueOnError: boolean;
}

/**
 * 并行编排器配置
 */
export interface ParallelOrchestratorConfig {
    type: 'parallel';
    nodes: ExecutionNodeDefinition[];
    /** 最大并发数 */
    maxConcurrency: number;
    /** 结果合并策略 */
    mergeStrategy: 'all' | 'first' | 'majority';
    /** 是否等待所有节点（即使部分失败） */
    waitAll: boolean;
}

/**
 * 路由编排器配置
 */
export interface RouterOrchestratorConfig {
    type: 'router';
    nodes: ExecutionNodeDefinition[];
    /** 路由规则 */
    rules: RouteRule[];
    /** 默认节点 ID */
    defaultNodeId?: string;
    /** 是否使用 LLM 路由（规则匹配失败时） */
    useLLMRouting?: boolean;
}

export interface RouteRule {
    /** 条件表达式 */
    condition: string;
    /** 目标节点 ID */
    target: string;
}

/**
 * 循环编排器配置
 */
export interface LoopOrchestratorConfig {
    type: 'loop';
    nodes: ExecutionNodeDefinition[];
    /** 最大迭代次数 */
    maxIterations: number;
    /** 退出条件表达式 */
    exitCondition?: string;
    /** 是否收集每次迭代结果 */
    collectResults: boolean;
    /** 迭代间延迟（毫秒） */
    iterationDelayMs: number;
}

/**
 * DAG 编排器配置
 */
export interface DAGOrchestratorConfig {
    type: 'dag';
    nodes: ExecutionNodeDefinition[];
    /** 边定义 */
    edges: DAGEdge[];
    /** 最大并发数 */
    maxConcurrency: number;
}

export interface DAGEdge {
    from: string;
    to: string;
    /** 条件（可选） */
    condition?: string;
}

export type OrchestratorConfig =
    | SerialOrchestratorConfig
    | ParallelOrchestratorConfig
    | RouterOrchestratorConfig
    | LoopOrchestratorConfig
    | DAGOrchestratorConfig;
```

### 5.4 编排器工厂与注册表

```typescript
// @file: common/interfaces/orchestrator/orchestrator-factory.ts

import type { IOrchestrator, OrchestratorType } from './orchestrator-base';
import type { OrchestratorConfig } from './orchestrator-configs';
import type { IExecutionNodeFactory } from './execution-node';

/**
 * 编排器工厂接口
 */
export interface IOrchestratorFactory {
    /**
     * 创建编排器
     */
    create(config: OrchestratorConfig): IOrchestrator;

    /**
     * 注册自定义编排器类型
     */
    registerOrchestratorType(
        type: string,
        creator: (config: OrchestratorConfig, nodeFactory: IExecutionNodeFactory) => IOrchestrator,
    ): void;

    /**
     * 获取支持的编排器类型
     */
    getSupportedTypes(): OrchestratorType[];
}

/**
 * 编排器注册表接口
 */
export interface IOrchestratorRegistry {
    /**
     * 注册编排器定义
     */
    register(id: string, config: OrchestratorConfig): void;

    /**
     * 获取编排器定义
     */
    get(id: string): OrchestratorConfig | undefined;

    /**
     * 列出所有已注册的编排器
     */
    list(): Array<{ id: string; type: OrchestratorType }>;

    /**
     * 删除编排器定义
     */
    remove(id: string): void;
}
```

---

## 六、插件系统接口

### 6.1 插件接口

```typescript
// @file: common/interfaces/plugin/plugin-interface.ts

import type { IToolService, ToolMeta, ToolDefinition, ToolHandler } from '../tool';
import type { ISkillService, SkillDefinition } from '../skill';
import type { IOrchestratorFactory } from '../orchestrator';
import type { AgentEventType, AgentEventPayloads } from '../agent';

/**
 * 插件元数据
 */
export interface PluginMetadata {
    /** 插件 ID */
    id: string;
    /** 显示名称 */
    name: string;
    /** 版本 */
    version: string;
    /** 描述 */
    description?: string;
    /** 作者 */
    author?: string;
    /** 依赖的其他插件 */
    dependencies?: string[];
    /** 最低兼容版本 */
    minKernelVersion?: string;
}

/**
 * 插件上下文。
 *
 * 插件通过此接口与内核交互。
 * 遵循 ISP：插件只看到它需要的 API。
 */
export interface IPluginContext {
    // ── 工具扩展 ──

    /**
     * 注册工具
     */
    registerTool(
        meta: ToolMeta,
        definition: ToolDefinition,
        handler: ToolHandler,
    ): void;

    /**
     * 注销工具
     */
    unregisterTool(toolId: string): void;

    // ── 技能扩展 ──

    /**
     * 注册技能
     */
    registerSkill(definition: SkillDefinition): void;

    /**
     * 注销技能
     */
    unregisterSkill(skillId: string): void;

    // ── 编排器扩展 ──

    /**
     * 注册自定义编排器类型
     */
    registerOrchestratorType(
        type: string,
        creator: (config: any, nodeFactory: any) => any,
    ): void;

    // ── 事件订阅 ──

    /**
     * 订阅 Agent 事件
     */
    onAgentEvent<E extends AgentEventType>(
        event: E,
        handler: (payload: AgentEventPayloads[E]) => void,
    ): () => void;

    // ── 配置访问 ──

    /**
     * 获取插件配置
     */
    getConfig<T>(key: string): T | undefined;

    /**
     * 设置插件配置
     */
    setConfig<T>(key: string, value: T): void;

    // ── 日志 ──

    readonly log: {
        debug(msg: string, ...args: unknown[]): void;
        info(msg: string, ...args: unknown[]): void;
        warn(msg: string, ...args: unknown[]): void;
        error(msg: string, ...args: unknown[]): void;
    };

    // ── 存储 ──

    /**
     * 获取插件专属存储
     */
    getStorage(): IPluginStorage;
}

/**
 * 插件存储接口
 */
export interface IPluginStorage {
    get<T>(key: string): Promise<T | undefined>;
    set<T>(key: string, value: T): Promise<void>;
    delete(key: string): Promise<void>;
    list(): Promise<string[]>;
    clear(): Promise<void>;
}

/**
 * 内核插件接口
 */
export interface IKernelPlugin {
    /** 插件元数据 */
    readonly metadata: PluginMetadata;

    /**
     * 初始化插件
     */
    initialize(context: IPluginContext): Promise<void>;

    /**
     * 销毁插件（清理资源）
     */
    destroy?(): Promise<void>;

    /**
     * 启用插件
     */
    enable?(): Promise<void>;

    /**
     * 禁用插件
     */
    disable?(): Promise<void>;
}
```

### 6.2 插件管理器接口

```typescript
// @file: common/interfaces/plugin/plugin-manager.ts

import type { IKernelPlugin, PluginMetadata } from './plugin-interface';

/**
 * 插件管理器接口
 */
export interface IPluginManager {
    /**
     * 注册插件
     */
    register(plugin: IKernelPlugin): Promise<void>;

    /**
     * 注销插件
     */
    unregister(pluginId: string): Promise<void>;

    /**
     * 获取已注册的插件列表
     */
    getPlugins(): PluginMetadata[];

    /**
     * 获取插件实例
     */
    getPlugin(pluginId: string): IKernelPlugin | undefined;

    /**
     * 检查插件是否已注册
     */
    isRegistered(pluginId: string): boolean;

    /**
     * 启用插件
     */
    enablePlugin(pluginId: string): Promise<void>;

    /**
     * 禁用插件
     */
    disablePlugin(pluginId: string): Promise<void>;

    /**
     * 检查插件依赖
     */
    checkDependencies(pluginId: string): {
        satisfied: boolean;
        missing: string[];
    };

    /**
     * 按依赖顺序获取插件列表
     */
    getLoadOrder(): string[];
}
```

---

## 七、记忆与持久化接口

### 7.1 会话持久化

```typescript
// @file: common/interfaces/agent/session-persistence.ts

import type { AgentSessionInfo, AgentUsageSnapshot } from './agent-types';
import type { Message } from '../llm';

/**
 * 会话快照（完整状态）
 */
export interface SessionSnapshot {
    sessionId: string;
    taskPrompt: string;
    messages: Message[];
    loadedSkills: string[];
    usage: AgentUsageSnapshot;
    isCompressed: boolean;
    compressionSummary: string | null;
    compressionCutoff: number;
    workingDirectory: string;
    createdAt: number;
    updatedAt: number;
}

/**
 * 会话持久化服务接口
 */
export interface ISessionPersistence {
    /**
     * 保存会话快照
     */
    save(snapshot: SessionSnapshot): Promise<void>;

    /**
     * 加载会话快照
     */
    load(sessionId: string): Promise<SessionSnapshot | null>;

    /**
     * 列出最近的会话
     */
    listRecent(limit: number): Promise<AgentSessionInfo[]>;

    /**
     * 删除会话
     */
    delete(sessionId: string): Promise<void>;

    /**
     * 清理过期会话
     */
    cleanupOld(maxAgeDays: number): Promise<number>;

    /**
     * 检查会话是否存在
     */
    exists(sessionId: string): Promise<boolean>;
}
```

### 7.2 记忆存储

```typescript
// @file: common/interfaces/agent/memory-store.ts

/**
 * 记忆条目
 */
export interface MemoryEntry {
    /** 来源路径 */
    source: string;
    /** 内容 */
    content: string;
    /** 作用域 */
    scope: 'global' | 'project' | 'session';
    /** 标签 */
    tags: string[];
    /** 创建时间 */
    createdAt: number;
    /** 更新时间 */
    updatedAt: number;
}

/**
 * 记忆存储接口。
 *
 * 三级作用域：
 * 1. Global: 跨项目共享（~/.executor/memory/）
 * 2. Project: 项目级（.executor/memory/）
 * 3. Convention: 约定文件（CLAUDE.md、AGENTS.md 等）
 */
export interface IMemoryStore {
    /**
     * 加载相关记忆
     */
    loadRelevant(
        taskPrompt: string,
        workingDirectory: string,
    ): MemoryEntry[];

    /**
     * 保存记忆
     */
    save(
        content: string,
        name: string,
        scope: 'global' | 'project',
        workingDirectory: string,
    ): Promise<void>;

    /**
     * 按标签搜索
     */
    searchByTags(tags: string[]): MemoryEntry[];

    /**
     * 删除记忆
     */
    delete(source: string): Promise<void>;

    /**
     * 列出指定作用域的记忆
     */
    list(scope: 'global' | 'project', workingDirectory?: string): MemoryEntry[];
}
```

---

## 八、事件流详细设计

### 8.1 事件流总览

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            事件流向                                         │
│                                                                             │
│  Application Layer                                                          │
│       │                                                                     │
│       │ ① task:start                                                        │
│       ▼                                                                     │
│  ┌─────────────────────────────────────────────────────────────────┐       │
│  │                     AgentLoopExecutor                            │       │
│  │                                                                  │       │
│  │  ┌─────────────────────────────────────────────────────────┐    │       │
│  │  │                    Main Loop                             │    │       │
│  │  │                                                          │    │       │
│  │  │  ② budget:check ──► BudgetController                     │    │       │
│  │  │       │                                                  │    │       │
│  │  │       ▼                                                  │    │       │
│  │  │  ③ context:compress ──► ContextManager                   │    │       │
│  │  │       │                                                  │    │       │
│  │  │       ▼                                                  │    │       │
│  │  │  ④ llm:start ──────────────────────────────────────┐    │    │       │
│  │  │       │                                             │    │    │       │
│  │  │       ▼                                             │    │    │       │
│  │  │  ILLMService.chat() ───────────────────────────────┤    │    │       │
│  │  │       │                                             │    │    │       │
│  │  │       ├──► ⑤ llm:stream:delta (流式输出)            │    │    │       │
│  │  │       │                                             │    │    │       │
│  │  │       ├──► ⑥ llm:retry (错误重试)                   │    │    │       │
│  │  │       │                                             │    │    │       │
│  │  │       ├──► ⑦ llm:fallback (模型降级)                │    │    │       │
│  │  │       │                                             │    │    │       │
│  │  │       ▼                                             │    │    │       │
│  │  │  ⑧ llm:end ────────────────────────────────────────┘    │    │       │
│  │  │       │                                                  │    │       │
│  │  │       ▼                                                  │    │       │
│  │  │  ┌─────────────────────────────────────────────────┐    │    │       │
│  │  │  │ Has Tool Calls?                                  │    │    │       │
│  │  │  │     │                                            │    │    │       │
│  │  │  │     ├── Yes ──► Tool Execution Flow              │    │    │       │
│  │  │  │     │              │                             │    │    │       │
│  │  │  │     │              ├── ⑨ permission:request      │    │    │       │
│  │  │  │     │              │        (可拦截)              │    │    │       │
│  │  │  │     │              │                             │    │    │       │
│  │  │  │     │              ├── ⑩ tool:start              │    │    │       │
│  │  │  │     │              │                             │    │    │       │
│  │  │  │     │              ├── ⑪ tool:success/error      │    │    │       │
│  │  │  │     │              │                             │    │    │       │
│  │  │  │     │              └── ⑫ backpressure:check      │    │    │       │
│  │  │  │     │                      (工具后验证)           │    │    │       │
│  │  │  │     │                                            │    │    │       │
│  │  │  │     │              ──► Loop Continue              │    │    │       │
│  │  │  │     │                                            │    │    │       │
│  │  │  │     └── No ───► Final Response Flow              │    │    │       │
│  │  │  │                     │                            │    │    │       │
│  │  │  │                     ├── ⑬ backpressure:check     │    │    │       │
│  │  │  │                     │        (最终验证)           │    │    │       │
│  │  │  │                     │                            │    │    │       │
│  │  │  │                     ├── Pass ──► ⑭ step:complete │    │    │       │
│  │  │  │                     │                            │    │    │       │
│  │  │  │                     └── Fail ──► ⑮ backpressure:failed│   │       │
│  │  │  │                                   (可拦截)        │    │    │       │
│  │  │  │                                   ──► 注入错误    │    │    │       │
│  │  │  │                                   ──► Loop Continue│   │    │       │
│  │  │  └─────────────────────────────────────────────────┘    │    │       │
│  │  │                                                          │    │       │
│  │  └──────────────────────────────────────────────────────────┘    │       │
│  │                                                                  │       │
│  └──────────────────────────────────────────────────────────────────┘       │
│       │                                                                     │
│       ▼                                                                     │
│  ⑯ task:end                                                                │
│       │                                                                     │
│       ▼                                                                     │
│  Application Layer (结果处理)                                               │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 8.2 事件详细说明

#### 8.2.1 任务生命周期事件

| 事件 | 触发时机 | 载荷 | 可拦截 |
|------|---------|------|--------|
| `agent:task:start` | `run()` 被调用时 | `{ task: AgentTaskRequest }` | 否 |
| `agent:task:end` | 任务完成或中止时 | `{ result: AgentTaskResult }` | 否 |
| `agent:step:complete` | 每轮循环完成时 | `{ step: AgentStep }` | 否 |

#### 8.2.2 LLM 调用事件

| 事件 | 触发时机 | 载荷 | 可拦截 |
|------|---------|------|--------|
| `agent:llm:start` | LLM 调用开始 | `{ model, connectionId, messageCount }` | 否 |
| `agent:llm:end` | LLM 调用完成 | `{ model, usage, stopReason }` | 否 |
| `agent:llm:retry` | 错误重试时 | `{ attempt, reason, delayMs }` | 否 |
| `agent:llm:fallback` | 模型降级时 | `{ from, to, reason }` | 否 |
| `agent:llm:stream:delta` | 流式输出时 | `{ text?, toolCallDelta? }` | 否 |

#### 8.2.3 工具执行事件

| 事件 | 触发时机 | 载荷 | 可拦截 |
|------|---------|------|--------|
| `agent:tool:start` | 工具执行开始 | `{ call: ToolCall }` | 否 |
| `agent:tool:success` | 工具执行成功 | `{ call, output, durationMs }` | 否 |
| `agent:tool:error` | 工具执行失败 | `{ call, error }` | 否 |
| `agent:tool:timeout` | 工具执行超时 | `{ call, timeoutMs }` | 否 |

#### 8.2.4 权限事件

| 事件 | 触发时机 | 载荷 | 可拦截 |
|------|---------|------|--------|
| `agent:permission:request` | 需要用户确认时 | `{ tool, args, description }` | **是** |

**拦截处理**：
- 返回 `true`：允许执行
- 返回 `false`：拒绝执行，工具返回"Permission denied"
- 无 handler：使用默认策略（根据 ToolMeta.sideEffect 决定）

#### 8.2.5 上下文管理事件

| 事件 | 触发时机 | 载荷 | 可拦截 |
|------|---------|------|--------|
| `agent:context:compressed` | 上下文压缩后 | `{ layer, layerName, beforeTokens, afterTokens }` | 否 |
| `agent:skill:loaded` | 技能加载后 | `{ skillId, newTools }` | 否 |

#### 8.2.6 预算事件

| 事件 | 触发时机 | 载荷 | 可拦截 |
|------|---------|------|--------|
| `agent:budget:warning` | 使用率超过 80% | `{ resource, usedRatio }` | 否 |
| `agent:budget:exhausted` | 预算耗尽 | `{ resource, used, limit }` | 否 |

#### 8.2.7 反压验证事件

| 事件 | 触发时机 | 载荷 | 可拦截 |
|------|---------|------|--------|
| `agent:backpressure:check` | 开始验证时 | `{ ruleName, command }` | 否 |
| `agent:backpressure:failed` | 验证失败时 | `{ ruleName, errors }` | **是** |

**拦截处理**：
- 返回 `string`：作为修正指令注入消息历史
- 返回 `undefined`：使用默认错误信息注入
- 无 handler：使用默认错误信息注入

#### 8.2.8 子代理事件

| 事件 | 触发时机 | 载荷 | 可拦截 |
|------|---------|------|--------|
| `agent:subagent:spawn` | 子代理启动 | `{ instruction, model }` | 否 |
| `agent:subagent:complete` | 子代理完成 | `{ instruction, resultSummary }` | 否 |

### 8.3 典型事件序列

#### 8.3.1 简单任务（无工具调用）

```
agent:task:start
  │
  ├── agent:llm:start
  │       │
  │       └── agent:llm:stream:delta (多次)
  │
  ├── agent:llm:end
  │
  └── agent:step:complete (type: final_response)
          │
agent:task:end
```

#### 8.3.2 带工具调用的任务

```
agent:task:start
  │
  ├── [Round 1]
  │   ├── agent:llm:start
  │   ├── agent:llm:end
  │   ├── agent:permission:request (拦截点)
  │   ├── agent:tool:start
  │   ├── agent:tool:success
  │   ├── agent:backpressure:check
  │   └── agent:step:complete (type: tool_execution)
  │
  ├── [Round 2]
  │   ├── agent:llm:start
  │   ├── agent:llm:end
  │   ├── agent:backpressure:check (final)
  │   └── agent:step:complete (type: final_response)
  │
agent:task:end
```

#### 8.3.3 带错误恢复的任务

```
agent:task:start
  │
  ├── agent:llm:start
  ├── agent:llm:retry (429 RateLimit, attempt 1)
  ├── agent:llm:retry (429 RateLimit, attempt 2)
  ├── agent:llm:end
  │
  ├── agent:tool:start
  ├── agent:tool:error
  │   (错误包装为 ToolResult，继续循环)
  │
  ├── agent:llm:start
  ├── agent:llm:fallback (529 Overload, 切换模型)
  ├── agent:llm:end
  │
  └── agent:step:complete
          │
agent:task:end
```

#### 8.3.4 带上下文压缩的长任务

```
agent:task:start
  │
  ├── [Round 1-10] (省略细节)
  │
  ├── [Round 11]
  │   ├── agent:context:compressed (layer 1: history_snip)
  │   ├── agent:llm:start
  │   └── ...
  │
  ├── [Round 20]
  │   ├── agent:context:compressed (layer 2: cache_prune)
  │   └── ...
  │
  ├── [Round 30]
  │   ├── agent:context:compressed (layer 3: llm_summarize)
  │   └── ...
  │
  ├── agent:budget:warning (rounds: 80%)
  │
  ├── [Round 40]
  │   └── agent:budget:exhausted (rounds: 100%)
  │
agent:task:end (status: partial)
```

#### 8.3.5 带反压验证的任务

```
agent:task:start
  │
  ├── agent:tool:start (file_write)
  ├── agent:tool:success
  │
  ├── agent:llm:start
  ├── agent:llm:end (无工具调用，准备返回最终响应)
  │
  ├── agent:backpressure:check (typecheck)
  ├── agent:backpressure:failed (拦截点)
  │   (错误注入消息历史)
  │
  ├── agent:llm:start (让 LLM 修正)
  ├── agent:llm:end
  │
  ├── agent:tool:start (file_write, 修正代码)
  ├── agent:tool:success
  │
  ├── agent:llm:start
  ├── agent:llm:end
  │
  ├── agent:backpressure:check (typecheck)
  │   (通过)
  │
  └── agent:step:complete (type: final_response)
          │
agent:task:end
```

---

## 九、模块交互图

### 9.1 初始化流程

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            系统初始化流程                                    │
└─────────────────────────────────────────────────────────────────────────────┘

                                Application
                                     │
                                     │ 1. 创建 Kernel
                                     ▼
                            ┌────────────────┐
                            │  KernelFactory │
                            └───────┬────────┘
                                    │
        ┌───────────────────────────┼───────────────────────────┐
        │                           │                           │
        ▼                           ▼                           ▼
┌───────────────┐          ┌───────────────┐          ┌───────────────┐
│LLMDeviceDriver│          │ToolDeviceDriver│          │SkillDeviceDriver│
│               │          │               │          │               │
│ 2. initialize │          │ 3. initialize │          │ 4. initialize │
│    │          │          │    │          │          │    │          │
│    ├─ 加载配置 │          │    ├─ 注册内置 │          │    ├─ 加载技能 │
│    └─ 创建适配器│          │    │  工具     │          │    └─ 定义    │
│               │          │    └─ 加载权限 │          │               │
│               │          │       规则     │          │               │
└───────┬───────┘          └───────┬───────┘          └───────┬───────┘
        │                          │                          │
        │                          │ 5. setToolService        │
        │                          │◄─────────────────────────┤
        │                          │                          │
        └──────────────────────────┼──────────────────────────┘
                                   │
                                   ▼
                          ┌───────────────┐
                          │AgentDeviceDriver│
                          │               │
                          │ 6. initialize │
                          │    │          │
                          │    ├─ 注入    │
                          │    │  services│
                          │    │          │
                          │    ├─ 创建    │
                          │    │  组件    │
                          │    │          │
                          │    └─ 挂载    │
                          │       VFS     │
                          └───────────────┘
                                   │
                                   ▼
                              系统就绪
```

### 9.2 任务执行流程

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            任务执行流程                                      │
└─────────────────────────────────────────────────────────────────────────────┘

Application
    │
    │ run(task)
    ▼
┌───────────────────────────────────────────────────────────────────────────┐
│                         AgentDeviceDriver                                  │
│  ┌─────────────────────────────────────────────────────────────────────┐  │
│  │                      AgentLoopExecutor                               │  │
│  │                                                                      │  │
│  │  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐          │  │
│  │  │SessionManager│    │BudgetController│   │ContextManager│          │  │
│  │  │              │    │              │    │              │          │  │
│  │  │ 创建/恢复    │    │ 检查预算     │    │ 构建 prompt  │          │  │
│  │  │ Session      │    │              │    │ 压缩上下文   │          │  │
│  │  └──────┬───────┘    └──────┬───────┘    └──────┬───────┘          │  │
│  │         │                   │                   │                   │  │
│  │         └───────────────────┼───────────────────┘                   │  │
│  │                             │                                       │  │
│  │                             ▼                                       │  │
│  │  ┌──────────────────────────────────────────────────────────────┐  │  │
│  │  │                      Main Loop                                │  │  │
│  │  │                                                               │  │  │
│  │  │   ┌─────────────────────────────────────────────────────┐    │  │  │
│  │  │   │               ErrorRecoveryService                   │    │  │  │
│  │  │   │                                                      │    │  │  │
│  │  │   │  ┌──────────────────────────────────────────────┐   │    │  │  │
│  │  │   │  │              ILLMService.chat()               │   │    │  │  │
│  │  │   │  │                                               │   │    │  │  │
│  │  │   │  │  ┌─────────────────────────────────────────┐ │   │    │  │  │
│  │  │   │  │  │          LLMDeviceDriver                 │ │   │    │  │  │
│  │  │   │  │  │                                          │ │   │    │  │  │
│  │  │   │  │  │  ┌────────────────────────────────────┐ │ │   │    │  │  │
│  │  │   │  │  │  │     Provider Adapter               │ │ │   │    │  │  │
│  │  │   │  │  │  │     (Anthropic/OpenAI/...)         │ │ │   │    │  │  │
│  │  │   │  │  │  └────────────────────────────────────┘ │ │   │    │  │  │
│  │  │   │  │  └─────────────────────────────────────────┘ │   │    │  │  │
│  │  │   │  └──────────────────────────────────────────────┘   │    │  │  │
│  │  │   │                                                      │    │  │  │
│  │  │   │  处理: 429 重试 / 413 压缩 / 529 降级 / 截断重试     │    │  │  │
│  │  │   └──────────────────────────────────────────────────────┘    │  │  │
│  │  │                             │                                 │  │  │
│  │  │                             ▼                                 │  │  │
│  │  │   ┌─────────────────────────────────────────────────────┐    │  │  │
│  │  │   │                 Response Handling                    │    │  │  │
│  │  │   │                                                      │    │  │  │
│  │  │   │  ┌─────────────────┐    ┌─────────────────────────┐ │    │  │  │
│  │  │   │  │ Has Tool Calls? │    │ No Tool Calls           │ │    │  │  │
│  │  │   │  │                 │    │                         │ │    │  │  │
│  │  │   │  │  ┌───────────┐  │    │  BackPressureValidator  │ │    │  │  │
│  │  │   │  │  │ToolService│  │    │        │                │ │    │  │  │
│  │  │   │  │  │.invokeBatch│ │    │  ┌─────┴─────┐          │ │    │  │  │
│  │  │   │  │  │           │  │    │  │ Pass     │ Fail      │ │    │  │  │
│  │  │   │  │  │  权限检查  │  │    │  │          ▼           │ │    │  │  │
│  │  │   │  │  │  并行执行  │  │    │  │  注入错误到消息     │ │    │  │  │
│  │  │   │  │  │  结果回馈  │  │    │  │  继续循环           │ │    ││  │   │  │  └───────────┘  │    │  │          │           │ │    │  │  │
│  │  │   │  │               │    │  │          ▼           │ │    │  │  │
│  │  │   │  │  继续循环     │    │  │    返回最终结果     │ │    │  │  │
│  │  │   │  └─────────────────┘    └─────────────────────────┘ │    │  │  │
│  │  │   └─────────────────────────────────────────────────────┘    │  │  │
│  │  │                                                               │  │  │
│  │  └───────────────────────────────────────────────────────────────┘  │  │
│  │                                                                      │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
                            AgentTaskResult
```

### 9.3 工具执行流程

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            工具执行流程                                      │
└─────────────────────────────────────────────────────────────────────────────┘

AgentLoopExecutor
    │
    │ toolCalls = [call1, call2, call3]
    ▼
┌───────────────────────────────────────────────────────────────────────────┐
│                         IToolService.invokeBatch()                         │
│                                                                            │
│  ┌──────────────────────────────────────────────────────────────────────┐ │
│  │                        分组策略                                       │ │
│  │                                                                       │ │
│  │  toolCalls ──► 按 sideEffect 分组                                     │ │
│  │                    │                                                  │ │
│  │    ┌───────────────┼───────────────┐                                  │ │
│  │    │               │               │                                  │ │
│  │    ▼               ▼               ▼                                  │ │
│  │ ┌──────┐      ┌──────┐       ┌──────┐                                │ │
│  │ │ none │      │local │       │extern│                                │ │
│  │ │(读)  │      │(写)  │       │(外部)│                                │ │
│  │ └──┬───┘      └──┬───┘       └──┬───┘                                │ │
│  │    │             │              │                                     │ │
│  │    ▼             │              │                                     │ │
│  │ ┌────────────┐   │              │                                     │ │
│  │ │Promise.all │   │              │                                     │ │
│  │ │ (并行执行) │   │              │                                     │ │
│  │ └─────┬──────┘   │              │                                     │ │
│  │       │          │              │                                     │ │
│  │       ▼          ▼              ▼                                     │ │
│  │       │    ┌─────────────────────────┐                                │ │
│  │       │    │    串行执行队列         │                                │ │
│  │       │    │                         │                                │ │
│  │       │    │  for (call of writes)   │                                │ │
│  │       │    │    await execute(call)  │                                │ │
│  │       │    │                         │                                │ │
│  │       │    └────────────┬────────────┘                                │ │
│  │       │                 │                                              │ │
│  │       └────────┬────────┘                                              │ │
│  │                │                                                       │ │
│  │                ▼                                                       │ │
│  │         合并结果（按原始顺序）                                          │ │
│  │                                                                       │ │
│  └──────────────────────────────────────────────────────────────────────┘ │
│                                                                            │
└───────────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌───────────────────────────────────────────────────────────────────────────┐
│                         单个工具执行                                        │
│                                                                            │
│  ┌──────────────────────────────────────────────────────────────────────┐ │
│  │                      PermissionManager                                │ │
│  │                                                                       │ │
│  │  ┌─────────────────────────────────────────────────────────────┐     │ │
│  │  │                    三层权限评估                              │     │ │
│  │  │                                                              │     │ │
│  │  │  1. 全局规则 ────► 匹配 ──► 返回决策                         │     │ │
│  │  │       │                                                      │     │ │
│  │  │       ▼                                                      │     │ │
│  │  │  2. 项目规则 (.executor/permissions.json)                    │     │ │
│  │  │       │                                                      │     │ │
│  │  │       ▼                                                      │     │ │
│  │  │  3. 会话记忆 ────► 已授权 ──► allowed                        │     │ │
│  │  │       │                                                      │     │ │
│  │  │       ▼                                                      │     │ │
│  │  │  4. sideEffect='none' ──► allowed                            │     │ │
│  │  │       │                                                      │     │ │
│  │  │       ▼                                                      │     │ │
│  │  │  5. 默认策略 (ask_user)                                      │     │ │
│  │  │                                                              │     │ │
│  │  └─────────────────────────────────────────────────────────────┘     │ │
│  │                           │                                           │ │
│  │                           ▼                                           │ │
│  │  ┌────────────────────────────────────────────────────────────┐      │ │
│  │  │                    权限决策处理                             │      │ │
│  │  │                                                             │      │ │
│  │  │  allowed ──────────────────────────────────► 执行工具       │      │ │
│  │  │                                                             │      │ │
│  │  │  denied ───────────────────────────────────► 返回拒绝结果   │      │ │
│  │  │                                                             │      │ │
│  │  │  ask_user ──► 发送 permission:request 事件                  │      │ │
│  │  │                       │                                     │      │ │
│  │  │               ┌───────┴───────┐                             │      │ │
│  │  │               │               │                             │      │ │
│  │  │           用户允许        用户拒绝                          │      │ │
│  │  │               │               │                             │      │ │
│  │  │               ▼               ▼                             │      │ │
│  │  │          记录会话授权    返回拒绝结果                        │      │ │
│  │  │               │                                             │      │ │
│  │  │               ▼                                             │      │ │
│  │  │           执行工具                                          │      │ │
│  │  │                                                             │      │ │
│  │  └────────────────────────────────────────────────────────────┘      │ │
│  │                                                                       │ │
│  └──────────────────────────────────────────────────────────────────────┘ │
│                                                                            │
│  ┌──────────────────────────────────────────────────────────────────────┐ │
│  │                      工具 Handler 执行                                │ │
│  │                                                                       │ │
│  │  try {                                                                │ │
│  │    const output = await handler(args, context);                       │ │
│  │    return { success: true, output };                                  │ │
│  │  } catch (error) {                                                    │ │
│  │    return { success: false, output: formatError(error) };             │ │
│  │  }                                                                    │ │
│  │                                                                       │ │
│  │  // 关键：异常不向外抛出，包装为结果喂回 LLM                           │ │
│  │                                                                       │ │
│  └──────────────────────────────────────────────────────────────────────┘ │
│                                                                            │
└───────────────────────────────────────────────────────────────────────────┘
```

### 9.4 上下文压缩流程

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         上下文压缩流程                                       │
└─────────────────────────────────────────────────────────────────────────────┘

ContextManager.maybeCompress(sessionId, urgency)
                │
                ▼
┌───────────────────────────────────────────────────────────────────────────┐
│                        计算上下文使用率                                     │
│                                                                            │
│  currentTokens = estimateContextTokens(session.messages)                   │
│  maxTokens = session.modelConfig.maxContextTokens                          │
│  ratio = currentTokens / maxTokens                                         │
│                                                                            │
│  if (ratio < compressionThreshold) return null;  // 无需压缩               │
│                                                                            │
└───────────────────────────────────────────────────────────────────────────┘
                │
                ▼
┌───────────────────────────────────────────────────────────────────────────┐
│                        四层渐进压缩策略                                     │
│                                                                            │
│  ┌────────────────────────────────────────────────────────────────────┐   │
│  │ Layer 1: HistorySnip (urgency >= 0.70)                             │   │
│  │                                                                     │   │
│  │ 遍历所有 tool 消息，对超过阈值的输出进行截断：                       │   │
│  │ - 保留前 N 行（命令回显）                                           │   │
│  │ - 保留后 N 行（错误/总结）                                          │   │
│  │ - 中间替换为 [snipped X lines]                                      │   │
│  │                                                                     │   │
│  │ 成本：零                                                            │   │
│  │ 信息损失：极低                                                      │   │
│  └────────────────────────────────────────────────────────────────────┘   │
│                │                                                           │
│                ▼ (如果仍超阈值)                                            │
│  ┌────────────────────────────────────────────────────────────────────┐   │
│  │ Layer 2: CachePrune (urgency >= 0.80)                              │   │
│  │                                                                     │   │
│  │ 移除低价值中间消息：                                                 │   │
│  │ - 纯文本 assistant 回复（无工具调用）                                │   │
│  │ - 短于 100 token 的 assistant 回复                                  │   │
│  │                                                                     │   │
│  │ 保护区：最后 10 条消息不动                                           │   │
│  │                                                                     │   │
│  │ 成本：零                                                            │   │
│  │ 信息损失：低                                                        │   │
│  └────────────────────────────────────────────────────────────────────┘   │
│                │                                                           │
│                ▼ (如果仍超阈值)                                            │
│  ┌────────────────────────────────────────────────────────────────────┐   │
│  │ Layer 3: LLMSummarize (urgency >= 0.85)                            │   │
│  │                                                                     │   │
│  │ 用 LLM 生成旧对话摘要：                                              │   │
│  │                                                                     │   │
│  │ 1. 确定切分点（保留最近 40% 消息）                                   │   │
│  │ 2. 将旧消息发给 summarizer 模型                                     │   │
│  │ 3. Prompt 明确指定保留项：                                           │   │
│  │    - 原始任务目标                                                   │   │
│  │    - 已修改的文件路径                                               │   │
│  │    - 关键决策及理由                                                 │   │
│  │    - 遇到的错误及解决方案                                           │   │
│  │    - 当前进度和待办事项                                             │   │
│  │    - 用户明确的约束条件                                             │   │
│  │ 4. 用摘要替换旧消息                                                 │   │
│  │                                                                     │   │
│  │ 失败时 Fallback：正则提取关键信息（文件路径、错误信息）              │   │
│  │                                                                     │   │
│  │ 成本：一次 API 调用                                                 │   │
│  │ 信息损失：中等                                                      │   │
│  └────────────────────────────────────────────────────────────────────┘   │
│                │                                                           │
│                ▼ (如果仍超阈值)                                            │
│  ┌────────────────────────────────────────────────────────────────────┐   │
│  │ Layer 4: SlidingWindow (urgency >= 0.95)                           │   │
│  │                                                                     │   │
│  │ 激进的滑动窗口：                                                     │   │
│  │ - 只保留最后 6 条消息（约 3 轮对话）                                 │   │
│  │ - 如果之前没有摘要，生成最小摘要                                     │   │
│  │                                                                     │   │
│  │ 成本：零                                                            │   │
│  │ 信息损失：高                                                        │   │
│  └────────────────────────────────────────────────────────────────────┘   │
│                                                                            │
└───────────────────────────────────────────────────────────────────────────┘
                │
                ▼
┌───────────────────────────────────────────────────────────────────────────┐
│                        返回压缩信息                                         │
│                                                                            │
│  return {                                                                  │
│    layer: 1|2|3|4,                                                         │
│    layerName: 'history_snip'|'cache_prune'|'llm_summarize'|'sliding_window'│
│    beforeTokens: number,                                                   │
│    afterTokens: number,                                                    │
│  }                                                                         │
│                                                                            │
└───────────────────────────────────────────────────────────────────────────┘
```

### 9.5 技能加载流程

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         技能加载流程                                         │
└─────────────────────────────────────────────────────────────────────────────┘

LLM Response: tool_call { name: 'load_skill', args: { skill_id: 'docker' } }
                │
                ▼
┌───────────────────────────────────────────────────────────────────────────┐
│                      ISkillService.loadSkill()                             │
│                                                                            │
│  ┌──────────────────────────────────────────────────────────────────────┐ │
│  │ 1. 验证技能存在且未加载                                               │ │
│  │                                                                       │ │
│  │    skill = skillRegistry.get('docker')                                │ │
│  │    if (!skill) return { success: false, error: 'Not found' }          │ │
│  │    if (session.loadedSkills.has('docker'))                            │ │
│  │      return { success: true, newTools: [], instructions: '' }         │ │
│  │                                                                       │ │
│  └──────────────────────────────────────────────────────────────────────┘ │
│                │                                                           │
│                ▼                                                           │
│  ┌──────────────────────────────────────────────────────────────────────┐ │
│  │ 2. 向 IToolService 注册技能工具                                       │ │
│  │                                                                       │ │
│  │    for (binding of skill.tools) {                                     │ │
│  │      if (binding.executionType === 'builtin') {                       │ │
│  │        // 引用已有工具，无需注册                                       │ │
│  │      } else if (binding.executionType === 'http') {                   │ │
│  │        // 创建 HTTP handler 并注册                                    │ │
│  │        handler = buildHttpHandler(skill.endpoint, binding)            │ │
│  │        toolService.register(meta, definition, handler)                │ │
│  │      }                                                                │ │
│  │    }                                                                  │ │
│  │                                                                       │ │
│  └──────────────────────────────────────────────────────────────────────┘ │
│                │                                                           │
│                ▼                                                           │
│  ┌──────────────────────────────────────────────────────────────────────┐ │
│  │ 3. 更新会话状态                                                       │ │
│  │                                                                       │ │
│  │    session.loadedSkills.add('docker')                                 │ │
│  │                                                                       │ │
│  └──────────────────────────────────────────────────────────────────────┘ │
│                │                                                           │
│                ▼                                                           │
│  ┌──────────────────────────────────────────────────────────────────────┐ │
│  │ 4. 发送事件通知                                                       │ │
│  │                                                                       │ │
│  │    emit('agent:skill:loaded', {                                       │ │
│  │      skillId: 'docker',                                               │ │
│  │      newTools: ['docker_run', 'docker_ps', 'docker_logs']             │ │
│  │    })                                                                 │ │
│  │                                                                       │ │
│  └──────────────────────────────────────────────────────────────────────┘ │
│                │                                                           │
│                ▼                                                           │
│  ┌──────────────────────────────────────────────────────────────────────┐ │
│  │ 5. 返回加载结果                                                       │ │
│  │                                                                       │ │
│  │    return {                                                           │ │
│  │      success: true,                                                   │ │
│  │      skillId: 'docker',                                               │ │
│  │      newTools: ['docker_run', 'docker_ps', 'docker_logs'],            │ │
│  │      instructions: skill.instructions                                 │ │
│  │    }                                                                  │ │
│  │                                                                       │ │
│  │    // 此 instructions 会被返回给 LLM 作为 tool_result                  │ │
│  │    // 下一轮 system_prompt 也会包含这些指令                            │ │
│  │                                                                       │ │
│  └──────────────────────────────────────────────────────────────────────┘ │
│                                                                            │
└───────────────────────────────────────────────────────────────────────────┘
                │
                ▼
┌───────────────────────────────────────────────────────────────────────────┐
│                    下一轮 LLM 调用时                                        │
│                                                                            │
│  tools = toolService.getToolDefinitions()                                  │
│          // 现在包含: [core_tools..., docker_run, docker_ps, docker_logs]  │
│                                                                            │
│  systemPrompt = contextManager.buildSystemPrompt()                         │
│          // 现在包含:                                                      │
│          //   - CoreIdentitySection                                        │
│          //   - EnvironmentSection                                         │
│          //   - LoadedSkillsSection (包含 docker 指令)                     │
│          //   - MemorySection                                              │
│          //   - AvailableSkillsSection (docker 已移除)                     │
│                                                                            │
└───────────────────────────────────────────────────────────────────────────┘
```

---

## 十、错误处理策略

### 10.1 错误分类与恢复

```typescript
// @file: common/interfaces/agent/errors.ts

/**
 * 错误基类
 */
export abstract class AgentError extends Error {
    abstract readonly code: string;
    abstract readonly recoverable: boolean;
}

/**
 * LLM 相关错误
 */
export class LLMError extends AgentError {
    readonly code = 'LLM_ERROR';
    readonly recoverable = false;
    constructor(message: string, public readonly statusCode?: number) {
        super(message);
    }
}

/**
 * 速率限制错误
 * 
 * 恢复策略：指数退避重试
 */
export class RateLimitError extends LLMError {
    readonly code = 'RATE_LIMIT';
    readonly recoverable = true;
    constructor(message: string, public readonly retryAfterMs?: number) {
        super(message, 429);
    }
}

/**
 * 上下文过大错误
 * 
 * 恢复策略：强制压缩后重试
 */
export class ContextTooLargeError extends LLMError {
    readonly code = 'CONTEXT_TOO_LARGE';
    readonly recoverable = true;
    constructor(message: string) {
        super(message, 413);
    }
}

/**
 * 服务过载错误
 * 
 * 恢复策略：切换 fallback 模型
 */
export class ServiceOverloadError extends LLMError {
    readonly code = 'SERVICE_OVERLOAD';
    readonly recoverable = true;
    constructor(message: string) {
        super(message, 529);
    }
}

/**
 * 输出截断
 * 
 * 恢复策略：静默重试（最多 N 次）
 */
export class OutputTruncatedError extends LLMError {
    readonly code = 'OUTPUT_TRUNCATED';
    readonly recoverable = true;
    constructor() {
        super('Output was truncated due to max_tokens limit');
    }
}

/**
 * 预算耗尽错误
 * 
 * 恢复策略：无法恢复，返回 partial 结果
 */
export class BudgetExhaustedError extends AgentError {
    readonly code = 'BUDGET_EXHAUSTED';
    readonly recoverable = false;
    constructor(
        public readonly resource: string,
        public readonly used: number,
        public readonly limit: number,
    ) {
        super(`Budget exhausted: ${resource} (${used}/${limit})`);
    }
}

/**
 * 工具未找到错误
 * 
 * 恢复策略：包装为 tool_result 喂回 LLM
 */
export class ToolNotFoundError extends AgentError {
    readonly code = 'TOOL_NOT_FOUND';
    readonly recoverable = true;
    constructor(public readonly toolId: string) {
        super(`Tool not found: ${toolId}`);
    }
}

/**
 * 工具执行错误
 * 
 * 恢复策略：包装为 tool_result 喂回 LLM
 */
export class ToolExecutionError extends AgentError {
    readonly code = 'TOOL_EXECUTION';
    readonly recoverable = true;
    constructor(
        public readonly toolId: string,
        public readonly cause: Error,
    ) {
        super(`Tool execution failed: ${toolId} - ${cause.message}`);
    }
}

/**
 * 工具超时错误
 * 
 * 恢复策略：包装为 tool_result 喂回 LLM
 */
export class ToolTimeoutError extends AgentError {
    readonly code = 'TOOL_TIMEOUT';
    readonly recoverable = true;
    constructor(
        public readonly toolId: string,
        public readonly timeoutMs: number,
    ) {
        super(`Tool timed out after ${timeoutMs}ms: ${toolId}`);
    }
}

/**
 * 执行中止错误
 * 
 * 恢复策略：返回 cancelled 结果
 */
export class AbortError extends AgentError {
    readonly code = 'ABORTED';
    readonly recoverable = false;
    constructor() {
        super('Execution was aborted');
    }
}
```

### 10.2 错误恢复流程图

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            错误恢复决策树                                    │
└─────────────────────────────────────────────────────────────────────────────┘

LLM 调用 / 工具执行
        │
        ▼
    发生错误
        │
        ▼
┌───────────────────┐
│ 错误类型判断       │
└─────────┬─────────┘
          │
    ┌─────┴─────┬─────────────┬─────────────┬─────────────┬─────────────┐
    │           │             │             │             │             │
    ▼           ▼             ▼             ▼             ▼             ▼
┌───────┐  ┌───────┐     ┌───────┐     ┌───────┐     ┌───────┐     ┌───────┐
│  429  │  │  413  │     │  529  │     │ max   │     │ Tool  │     │Budget │
│RateLimit│  │Context│     │Overload│     │tokens │     │ Error │     │Exhaust│
└───┬───┘  └───┬───┘     └───┬───┘     └───┬───┘     └───┬───┘     └───┬───┘
    │          │             │             │             │             │
    ▼          ▼             ▼             ▼             ▼             ▼
┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────┐
│指数退避   │ │强制压缩   │ │切换模型   │ │静默重试   │ │包装为     │ │返回       │
│重试       │ │重试       │ │           │ │(max 3次)  │ │tool_result│ │partial    │
│           │ │           │ │           │ │           │ │喂回 LLM   │ │结果       │
│ delay =   │ │ layer 3/4 │ │ primary   │ │ 不通知    │ │           │ │           │
│ base *    │ │ 压缩后    │ │    ↓      │ │ 用户      │ │ LLM 决定  │ │ 任务      │
│ 2^attempt │ │ 重试      │ │ fallback  │ │           │ │ 下一步    │ │ 中止      │
│           │ │           │ │           │ │           │ │           │ │           │
│ max 5次   │ │           │ │ 继续执行  │ │ 超过则    │ │ 继续循环  │ │           │
│           │ │           │ │           │ │ 接受截断  │ │           │ │           │
└───────────┘ └───────────┘ └───────────┘ └───────────┘ └───────────┘ └───────────┘
    │             │             │             │             │             │
    └─────────────┴─────────────┴─────────────┴─────────────┘             │
                                │                                         │
                                ▼                                         │
                        继续 Agent 循环                                   │
                                                                          │
                                ◄─────────────────────────────────────────┘
                                        无法恢复，结束执行
```

---

## 十一、配置管理

### 11.1 配置层次

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            配置层次结构                                       │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│ 1. 系统默认配置 (代码内置)                                                   │
│                                                                             │
│    DEFAULT_BUDGET_LIMITS = {                                                │
│      maxRounds: 100,                                                         │
│      maxInputTokens: 5_000_000,                                             │
│      maxOutputTokens: 1_000_000,                                            │
│      maxCostUsd: 10.0,                                                      │
│      maxDurationMs: 3_600_000,                                              │
│      maxToolCalls: 500,                                                     │
│    }                                                                        │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                │
                                ▼ (覆盖)
┌─────────────────────────────────────────────────────────────────────────────┐
│ 2. 全局用户配置 (~/.executor/config.yaml)                                    │
│                                                                             │
│    models:                                                                  │
│      primary: claude-sonnet-connection                                      │
│      fallback: gpt4o-connection                                             │
│      summarizer: deepseek-connection                                        │
│                                                                             │
│    budget:                                                                  │
│      maxCostUsd: 5.0                                                        │
│                                                                             │
│    loop:                                                                    │
│      compressionThreshold: 0.75                                             │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                │
                                ▼ (覆盖)
┌─────────────────────────────────────────────────────────────────────────────┐
│ 3. 项目配置 (.executor/config.yaml)                                          │
│                                                                             │
│    budget:                                                                  │
│      maxRounds: 50                                                           │
│                                                                             │
│    backPressureRules:                                                       │
│      - name: typecheck                                                      │
│        command: npm run typecheck                                           │
│        afterTools: [file_write]                                             │
│        onlyOnFinal: true                                                    │
│                                                                             │
│    permissions:                                                             │
│      - toolPattern: shell_exec                                              │
│        action: ask_user                                                     │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                │
                                ▼ (覆盖)
┌─────────────────────────────────────────────────────────────────────────────┐
│ 4. 任务请求覆盖 (AgentTaskRequest.budgetOverride)                            │
│                                                                             │
│    {                                                                        │
│      prompt: "Fix the bug in auth.ts",                                      │
│      budgetOverride: {                                                      │
│        maxCostUsd: 1.0,                                                     │
│        maxRounds: 20                                                         │
│      }                                                                      │
│    }                                                                        │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 11.2 配置文件结构

```yaml
# ~/.executor/config.yaml 或 .executor/config.yaml

# ═══════════════════════════════════════════════════════════════
# 模型角色配置
# ═══════════════════════════════════════════════════════════════
models:
  # 主要推理模型（LLM 连接 ID）
  primary: claude-sonnet-main
  # 降级模型
  fallback: gpt4o-fallback
  # 摘要模型（可用便宜模型）
  summarizer: deepseek-summarizer
  # 子代理模型
  subAgent: claude-haiku

# ═══════════════════════════════════════════════════════════════
# 预算限制
# ═══════════════════════════════════════════════════════════════
budget:
  maxRounds: 100
  maxInputTokens: 5000000
  maxOutputTokens: 1000000
  maxCostUsd: 10.0
  maxDurationMs: 3600000
  maxToolCalls: 500

# ═══════════════════════════════════════════════════════════════
# 循环配置
# ═══════════════════════════════════════════════════════════════
loop:
  maxApiRetries: 5
  maxTruncationRetries: 3
  baseRetryDelayMs: 1000
  compressionThreshold: 0.75
  systemPromptBudgetTokens: 4000
  enableBackPressure: true

# ═══════════════════════════════════════════════════════════════
# 反压规则
# ═══════════════════════════════════════════════════════════════
backPressureRules:
  - name: typecheck
    command: npm run typecheck
    afterTools: [file_write]
    timeoutMs: 30000
    onlyOnFinal: true
    
  - name: build
    command: npm run build
    afterTools: []
    timeoutMs: 60000
    onlyOnFinal: true
    
  - name: test
    command: npm run test -- --bail
    afterTools: [file_write]
    timeoutMs: 120000
    onlyOnFinal: true

# ═══════════════════════════════════════════════════════════════
# 权限规则
# ═══════════════════════════════════════════════════════════════
permissions:
  # 读操作默认允许
  - id: allow-read
    toolPattern: file_read
    action: allowed
    priority: 100
    
  - id: allow-glob
    toolPattern: glob_search
    action: allowed
    priority: 100
    
  - id: allow-grep
    toolPattern: grep_search
    action: allowed
    priority: 100
    
  # 写操作需要确认
  - id: ask-write
    toolPattern: file_write
    action: ask_user
    priority: 50
    
  # 危险目录禁止
  - id: deny-system
    toolPattern: file_write
    argPatterns:
      path: "/etc/*"
    action: denied
    priority: 200
    
  - id: deny-system2
    toolPattern: file_write
    argPatterns:
      path: "/usr/*"
    action: denied
    priority: 200

# ═══════════════════════════════════════════════════════════════
# 技能配置
# ═══════════════════════════════════════════════════════════════
skills:
  # 技能定义目录
  directory: .executor/skills
  
  # 自动检测阈值
  autoDetectEnabled: true

# ═══════════════════════════════════════════════════════════════
# 插件配置
# ═══════════════════════════════════════════════════════════════
plugins:
  # 启用的插件列表
  enabled:
    - "@executor/plugin-git"
    - "@executor/plugin-docker"
    
  # 插件配置
  config:
    "@executor/plugin-git":
      autoCommit: false
    "@executor/plugin-docker":
      defaultRegistry: docker.io
```

---

## 十二、VFS 路径结构

### 12.1 完整路径树

```
/dev/
├── agent/                              # Agent 设备
│   ├── status                          # 当前状态 (idle|running|...)
│   ├── session                         # 当前会话信息 (AgentSessionInfo)
│   ├── sessions/                       # 历史会话
│   │   ├── {sessionId}/
│   │   │   ├── info                    # 会话信息
│   │   │   ├── messages                # 消息历史
│   │   │   └── usage                   # 使用统计
│   │   └── ...
│   ├── config/                         # 配置
│   │   ├── models                      # 模型角色配置
│   │   ├── budget                      # 预算配置
│   │   ├── loop                        # 循环配置
│   │   └── backpressure                # 反压规则
│   └── events                          # 事件流 (watch)
│
├── llm/                                # LLM 设备
│   ├── connections/                    # 连接管理
│   │   ├── {connectionId}/
│   │   │   ├── info                    # 连接信息 (不含敏感数据)
│   │   │   ├── status                  # 连接状态
│   │   │   └── models                  # 可用模型列表
│   │   └── ...
│   ├── providers/                      # Provider 信息
│   │   ├── anthropic
│   │   ├── openai
│   │   ├── ollama
│   │   └── ...
│   └── default                         # 默认连接 ID
│
├── tools/                              # 工具设备
│   ├── {toolId}/
│   │   ├── meta                        # 工具元信息
│   │   └── definition                  # 工具定义 (JSON Schema)
│   ├── permissions/                    # 权限规则
│   │   ├── global                      # 全局规则
│   │   └── project                     # 项目规则
│   └── session/                        # 会话授权记录
│       └── {sessionId}
│
└── skills/                             # 技能设备
    ├── {skillId}/
    │   ├── info                        # 技能信息
    │   ├── tools                       # 工具绑定列表
    │   └── instructions                # 指令文本
    ├── loaded/                         # 已加载技能
    │   └── {sessionId}                 # 会话已加载的技能列表
    └── available/                      # 可用技能
        └── {sessionId}                 # 会话可用的技能列表
```

### 12.2 ioctl 命令汇总

| 设备 | 命令 | 参数 | 返回 | 说明 |
|------|------|------|------|------|
| `/dev/agent` | `run` | `AgentTaskRequest` | `Promise<AgentTaskResult>` | 执行任务 |
| `/dev/agent` | `abort` | - | `void` | 中止执行 |
| `/dev/agent` | `resume` | `{ sessionId }` | `Promise<AgentTaskResult>` | 恢复会话 |
| `/dev/llm` | `create` | `LLMConnectionConfig` | `string` (connectionId) | 创建连接 |
| `/dev/llm` | `delete` | `{ connectionId }` | `void` | 删除连接 |
| `/dev/llm` | `test` | `{ connectionId }` | `LLMConnectionStatus` | 测试连接 |
| `/dev/llm` | `chat` | `{ connectionId, request }` | `LLMChatResponse` | 同步调用 |
| `/dev/llm` | `chatStream` | `{ connectionId, request }` | `AsyncIterable<LLMStreamEvent>` | 流式调用 |
| `/dev/llm` | `abort` | `{ connectionId }` | `void` | 中止请求 |
| `/dev/llm` | `listModels` | `{ connectionId }` | `string[]` | 列出模型 |
| `/dev/tools` | `register` | `{ meta, definition, handler }` | `void` | 注册工具 |
| `/dev/tools` | `unregister` | `{ toolId }` | `void` | 注销工具 |
| `/dev/tools` | `invoke` | `{ toolId, args, context }` | `ToolInvokeResult` | 执行工具 |
| `/dev/tools` | `invokeBatch` | `{ calls, context }` | `ToolInvokeResult[]` | 批量执行 |
| `/dev/tools` | `checkPermission` | `{ toolId, args, context }` | `ToolPermission` | 检查权限 |
| `/dev/skills` | `register` | `SkillDefinition` | `void` | 注册技能 |
| `/dev/skills` | `unregister` | `{ skillId }` | `void` | 注销技能 |
| `/dev/skills` | `load` | `{ skillId, sessionId }` | `SkillLoadResult` | 加载技能 |
| `/dev/skills` | `unload` | `{ skillId, sessionId }` | `void` | 卸载技能 |
| `/dev/skills` | `autoDetect` | `{ prompt }` | `string[]` | 自动检测 |

---

## 十三、设计原则总结

### 13.1 SOLID 原则映射

| 原则 | 体现 |
|------|------|
| **SRP** | 每个 Service 只负责一个领域：ILLMService 管连接和调用、IToolService 管工具执行、ISkillService 管技能加载 |
| **OCP** | 新增 LLM Provider 实现 ILLMProviderAdapter 即可，无需修改 LLMDeviceDriver；新增工具类型实现 ToolHandler 即可 |
| **LSP** | 所有 IDeviceDriver 实现可互换；所有 IOrchestrator 实现可互换 |
| **ISP** | IPluginContext 只暴露插件需要的 API；IAgentRuntime 不暴露 Session 内部状态 |
| **DIP** | AgentDeviceDriver 依赖 ILLMService/IToolService/ISkillService 接口，不直接依赖其他 Driver |

### 13.2 其他设计原则

| 原则 | 体现 |
|------|------|
| **LoD** | Session 内部状态不对外暴露，通过 AgentSessionInfo 快照访问 |
| **DRY** | Token 估算、路径解析、错误格式化提取为共享工具函数 |
| **KISS** | Agent 核心循环逻辑清晰：构造→调用→解析→执行→反馈 |
| **YAGNI** | 初始不实现编排器，仅保留接口；不实现完整 MCP，仅预留扩展点 |
| **CoC** | 约定文件（CLAUDE.md、AGENTS.md）自动发现和加载 |
| **Fail Fast** | 预算检查在循环开始时立即执行，不等到循环中间 |

### 13.3 关键设计决策

| 决策 | 原因 |
|------|------|
| **Device Driver 封装 API 细节** | LLM Provider 差异（Anthropic content blocks vs OpenAI messages）、API key 管理、连接池等复杂性封装在 Driver 内部，Service 接口保持简洁 |
| **Agent 循环内置而非编排** | Agent 场景的核心是"LLM 自主决策"，不是"预定义执行图"；内置循环比外部 LoopOrchestrator 包装更直观、更易调试 |
| **工具异常不向外抛出** | Agent 循环要求工具失败不中断，让 LLM 决定如何处理；异常包装为 ToolResult 是核心设计 |
| **四层渐进压缩** | 不同信息有不同"保质期"，按紧迫度分层处理比一刀切截断更智能 |
| **权限三层评估 + 会话记忆** | 用户不想每次写同一目录都确认；按目录粒度记忆授权是合理的中间点 |
| **Skill 渐进式暴露** | 工具空间过大会稀释 LLM 注意力；按需加载比一次性注入更高效 |
| **事件区分通知与拦截** | 大部分事件是观察性的（fire-and-forget），但权限确认和反压验证需要阻塞等待响应 |
| **编排器作为独立层** | 多 Agent 协作、复杂工作流需要编排能力；保持为可选层，单 Agent 场景可不使用 |

---

## 十四、扩展点

### 14.1 预留的扩展接口

| 扩展点 | 接口 | 用途 |
|--------|------|------|
| **新增 LLM Provider** | `ILLMProviderAdapter` | 支持新的 LLM 服务（如 Cohere、Mistral） |
| **新增工具类型** | `ToolHandler` + `ToolMeta` | 添加自定义工具 |
| **新增技能类型** | `SkillDefinition.type` | 支持 MCP 技能、远程技能 |
| **新增编排器类型** | `IOrchestrator` | 自定义编排逻辑 |
| **新增执行节点类型** | `IExecutionNode` | 自定义编排节点 |
| **插件扩展** | `IKernelPlugin` | 第三方功能扩展 |
| **自定义压缩策略** | `IContextManager` | 替换或扩展压缩逻辑 |
| **自定义权限评估** | `ToolPermissionRule` | 复杂权限规则 |

### 14.2 MCP 支持预留

```typescript
// @file: common/interfaces/mcp/mcp-types.ts (预留)

/**
 * MCP 服务器配置
 */
export interface MCPServerConfig {
    name: string;
    transport: 'stdio' | 'sse';
    command?: string;
    args?: string[];
    url?: string;
    env?: Record<string, string>;
}

/**
 * MCP 工具定义
 */
export interface MCPToolDefinition {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
}

/**
 * MCP 服务接口（预留）
 */
export interface IMCPService {
    /** 连接 MCP 服务器 */
    connect(config: MCPServerConfig): Promise<string>;
    /** 断开连接 */
    disconnect(serverId: string): Promise<void>;
    /** 列出工具 */
    listTools(serverId: string): Promise<MCPToolDefinition[]>;
    /** 调用工具 */
    callTool(serverId: string, toolName: string, args: Record<string, unknown>): Promise<unknown>;
}
```

### 14.3 A2A 协议支持预留

```typescript
// @file: common/interfaces/a2a/a2a-types.ts (预留)

/**
 * Agent 卡片（A2A 协议）
 */
export interface AgentCard {
    id: string;
    name: string;
    description: string;
    capabilities: string[];
    endpoint: string;
    authentication?: {
        type: 'bearer' | 'api_key';
        headerName?: string;
    };
}

/**
 * A2A 消息
 */
export interface A2AMessage {
    from: string;
    to: string;
    type: 'task' | 'result' | 'error' | 'status';
    content: unknown;
    correlationId: string;
    timestamp: number;
}

/**
 * A2A 服务接口（预留）
 */
export interface IA2AService {
    /** 发布 Agent 卡片 */
    publishCard(card: AgentCard): Promise<void>;
    /** 发现 Agent */
    discoverAgents(capability?: string): Promise<AgentCard[]>;
    /** 发送消息 */
    send(message: A2AMessage): Promise<void>;
    /** 接收消息 */
    receive(): AsyncIterable<A2AMessage>;
}
```

---

## 十五、实施建议

### 15.1 分阶段实施

**Phase 1: 核心 Agent 循环 (2-3 周)**
- 实现 `ILLMService` + `AnthropicAdapter` + `OpenAIAdapter`
- 实现 `IToolService` + 5 个内置工具
- 实现 `AgentLoopExecutor` 核心循环
- 实现 `BudgetController` 六维预算
- 实现基础事件系统

**Phase 2: 上下文管理 (1-2 周)**
- 实现 `IContextManager` 四层压缩
- 实现 `PromptBuilder` 动态系统提示词
- 实现 `IMemoryStore` 三级记忆
- 实现 `ISessionPersistence` 会话持久化

**Phase 3: 错误恢复与反压 (1 周)**
- 实现 `IErrorRecoveryService` 五类错误恢复
- 实现 `IBackPressureValidator` 反压验证
- 完善事件拦截机制

**Phase 4: 技能系统 (1-2 周)**
- 实现 `ISkillService` 技能管理
- 实现 `load_skill` 元工具
- 实现渐进式工具暴露

**Phase 5: 子代理与编排 (2 周)**
- 实现 `ISubAgentRouter` 子代理路由
- 实现五种编排器
- 实现执行节点工厂

**Phase 6: 插件与扩展 (1-2 周)**
- 实现 `IPluginManager` 插件管理
- 实现插件上下文
- 预留 MCP/A2A 扩展点

### 15.2 测试策略

| 层级 | 测试重点 | 工具 |
|------|---------|------|
| 单元测试 | 各 Service 的独立逻辑 | Vitest |
| 集成测试 | Driver 与 Service 协作 | Vitest + Mock LLM |
| 端到端测试 | 完整任务执行流程 | Playwright + 真实 LLM |
| 性能测试 | 上下文压缩效果、并行工具执行 | Benchmark |

### 15.3 监控指标

| 指标 | 说明 |
|------|------|
| `agent.rounds.total` | 总轮次 |
| `agent.tokens.input` | 输入 token 总量 |
| `agent.tokens.output` | 输出 token 总量 |
| `agent.cost.usd` | 总费用 |
| `agent.compression.count` | 压缩次数 |
| `agent.compression.ratio` | 平均压缩比 |
| `agent.tools.calls` | 工具调用次数 |
| `agent.tools.errors` | 工具错误次数 |
| `agent.llm.retries` | LLM 重试次数 |
| `agent.llm.fallbacks` | 模型降级次数 |
| `agent.backpressure.failures` | 反压验证失败次数 |

---

本文档定义了 LLM 执行体调度器的完整接口设计，涵盖：

1. **核心服务接口**：IAgentRuntime、ILLMService、IToolService、ISkillService
2. **设备驱动接口**：基于 VFS 的统一访问模式
3. **内部组件接口**：上下文管理、预算控制、错误恢复、反压验证、子代理
4. **编排器接口**：五种编排模式（串行、并行、路由、循环、DAG）
5. **插件接口**：第三方扩展机制
6. **事件系统**：通知模式与拦截模式
7. **错误处理**：五类错误的分级恢复策略
8. **配置管理**：四层配置覆盖机制