// @file: common/interfaces/llm/connection.ts
// LLM 连接与 Provider 相关数据结构。
// 这是跨包共享的唯一权威来源；device-llm 仅提供实现，不重复定义类型。

// ─── Model ───────────────────────────────────────────────────────────────────

export interface LLMModel {
    id: string;
    name: string;
    icon?: string;
    contextWindow?: number;
    maxOutput?: number;
    supportsVision?: boolean;
    supportsThinking?: boolean;
    supportsTools?: boolean;
    supportsAudio?: boolean;
    supportsVideo?: boolean;
    supportsStructuredOutput?: boolean;
    inputPricePerMillion?: number;
    outputPricePerMillion?: number;
}

// ─── Provider ────────────────────────────────────────────────────────────────

export type LLMProviderImplementation =
    | 'openai-compatible'
    | 'anthropic'
    | 'gemini'
    | 'custom';

export interface LLMProviderDefinition {
    name: string;
    implementation: LLMProviderImplementation;
    baseURL: string;
    models: LLMModel[];
    icon?: string;
    authMethod?: 'bearer' | 'api-key' | 'query-param';
    supportsThinking?: boolean;
    requiresReferer?: boolean;
    capabilities?: {
        vision?: boolean;
        audioInput?: boolean;
        audioOutput?: boolean;
        tools?: boolean;
        thinking?: boolean;
        streaming?: boolean;
    };
    [key: string]: unknown;
}

// ─── Connection ───────────────────────────────────────────────────────────────

/** 完整连接配置（含 apiKey），仅在 LLMDeviceDriver 内部流通 */
export interface LLMConnection {
    id: string;
    name: string;
    provider: string;
    apiKey: string;
    model: string;
    baseURL?: string;
    availableModels?: LLMModel[];
    metadata?: {
        isSystemDefault?: boolean;
        thinkingBudget?: number;
        reasoningEffort?: 'low' | 'medium' | 'high';
        mcpServers?: string[];
        caching?: boolean;
        headers?: Record<string, string>;
        [key: string]: unknown;
    };
    status?: 'active' | 'error' | 'untested';
    lastTestedAt?: number;
    lastTestResult?: boolean;
    createdAt?: number;
    updatedAt?: number;
}

// ─── ConnectionMeta (safe, no apiKey) ─────────────────────────────────────────

/**
 * 安全连接元数据 — 不含 apiKey，供 AgentExecutor、UI 列表等外部模块使用。
 * 完整数据（含 apiKey）仅 LLMDeviceDriver 内部持有。
 */
export interface ConnectionMeta {
    id: string;
    name: string;
    provider: string;
    model: string;
    baseURL?: string;
    /** apiKey 是否已配置（不暴露实际值） */
    hasApiKey: boolean;
    availableModels?: LLMModel[];
    metadata?: Record<string, unknown>;
    status?: 'active' | 'error' | 'untested';
}

// ─── ConnectionTestResult ─────────────────────────────────────────────────────

/** 连接测试结果 */
export interface ConnectionTestResult {
    success: boolean;
    message: string;
    latency?: number;
    model?: string;
}

/** 将完整连接转换为安全元数据 */
export function toConnectionMeta(conn: LLMConnection): ConnectionMeta {
    return {
        id: conn.id,
        name: conn.name,
        provider: conn.provider,
        model: conn.model,
        baseURL: conn.baseURL,
        hasApiKey: !!(conn.apiKey?.trim()),
        availableModels: conn.availableModels,
        metadata: conn.metadata as Record<string, unknown>,
        status: conn.status,
    };
}
