// @file: common/interfaces/llm/connection.ts
// LLM 连接与 Provider 相关数据结构。
// 这是跨包共享的唯一权威来源；device-llm 仅提供实现，不重复定义类型。
//
// 三层结构：
//   Provider   — 云提供商（持有 apiKey + 模型目录，是认证的唯一来源）
//   Connection — 引用 Provider 的命名配置（可覆盖 tier 映射，不存 apiKey）
//   Agent      — 绑定 Connection 的个性化定制（tier 偏好 + system prompt）

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

// ─── ModelTier ────────────────────────────────────────────────────────────────

/**
 * 模型质量层级。
 * - `optimal`  — 最高质量，用于规划/推理（默认）
 * - `standard` — 常规质量，用于大多数日常工作
 * - `fast`     — 低成本，用于简单/廉价任务
 */
export type ModelTier = 'optimal' | 'standard' | 'fast';

// ─── Provider ────────────────────────────────────────────────────────────────

export type LLMProviderImplementation =
    | 'openai-compatible'
    | 'anthropic'
    | 'gemini'
    | 'custom';

/**
 * 云提供商 — 认证 + 模型目录的唯一权威来源。
 *
 * 完整版（含 apiKey）仅在 LLMDeviceDriver 内部流通；
 * 对外通过 `getProviders()` 返回无 apiKey 版本。
 */
export interface LLMProvider {
    /** Provider 唯一标识（如 'anthropic'、'gemini'、'deepseek'） */
    id: string;
    name: string;
    implementation: LLMProviderImplementation;
    /** API 端点地址 */
    baseURL: string;
    /**
     * API Key — 认证凭据，存储于 Provider 层（而非 Connection 层）。
     * 仅在 LLMDeviceDriver 内部流通；对外 `getProviders()` 会剥离此字段。
     */
    apiKey?: string;
    /** 该 Provider 支持的全部模型（模型目录唯一来源，不在 Connection 中存储） */
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
    /**
     * 推荐的默认 tier → model ID 映射。
     * optimal 未显式设置时等价于 models[0].id。
     */
    defaultTiers?: Partial<Record<ModelTier, string>>;
    /**
     * true = 内置 Provider（由 constants.ts 定义）。
     * false / undefined = 用户新建的自定义 Provider，可以删除。
     */
    isBuiltin?: boolean;
    [key: string]: unknown;
}

/**
 * @deprecated 请使用 LLMProvider。
 */
export type LLMProviderDefinition = LLMProvider;

// ─── Connection ───────────────────────────────────────────────────────────────

/**
 * 连接配置 — 引用 Provider 的命名配置，不持有 apiKey。
 *
 * 职责：命名 + 引用 Provider + 可选 tier 覆盖。
 * 认证（apiKey）由 Provider 统一管理。
 */
export interface LLMConnection {
    id: string;
    name: string;
    /** 引用 LLMProvider.id */
    providerId: string;
    /**
     * Tier → model ID 覆盖，优先级高于 Provider.defaultTiers。
     * 不填则直接使用 Provider.defaultTiers。
     */
    tiers?: Partial<Record<ModelTier, string>>;
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

    // ── 向后兼容字段（迁移旧数据时读取，新数据不再写入） ────────────────

    /** @deprecated 已由 `providerId` 替代 */
    provider?: string;
    /** @deprecated apiKey 已移至 LLMProvider.apiKey */
    apiKey?: string;
    /** @deprecated 模型由 Provider.models[0] 决定 */
    model?: string;
    /** @deprecated 模型目录由 Provider 统一管理 */
    availableModels?: LLMModel[];
    /** @deprecated baseURL 由 Provider 统一管理 */
    baseURL?: string;
}

// ─── ConnectionMeta (safe, no apiKey) ─────────────────────────────────────────

/**
 * 安全连接元数据 — 供 AgentExecutor、UI 等外部模块使用。
 * hasApiKey 反映关联 Provider 是否配置了 apiKey。
 */
export interface ConnectionMeta {
    id: string;
    name: string;
    /** Provider ID */
    providerId: string;
    /** @deprecated 与 providerId 相同，保留兼容 */
    provider: string;
    /** 已解析的 optimal 层级模型 ID（tiers.optimal → provider.models[0]） */
    model: string;
    /** Tier 映射（继承自 Connection.tiers 或 Provider.defaultTiers） */
    tiers?: Partial<Record<ModelTier, string>>;
    /** 关联 Provider 是否已配置 apiKey */
    hasApiKey: boolean;
    metadata?: Record<string, unknown>;
    status?: 'active' | 'error' | 'untested';
}

// ─── ConnectionTestResult ─────────────────────────────────────────────────────

export interface ConnectionTestResult {
    success: boolean;
    message: string;
    latency?: number;
    model?: string;
}

// ─── Utilities ────────────────────────────────────────────────────────────────

/**
 * 将完整连接转换为安全元数据。
 * hasApiKey 从 provider.apiKey 解析（再 fallback 到 legacy conn.apiKey）。
 */
export function toConnectionMeta(conn: LLMConnection, provider?: LLMProvider): ConnectionMeta {
    const effectiveTiers = conn.tiers ?? provider?.defaultTiers;
    const resolvedModel =
        effectiveTiers?.optimal
        ?? conn.model
        ?? provider?.models[0]?.id
        ?? '';
    const pid = conn.providerId ?? conn.provider ?? '';

    return {
        id: conn.id,
        name: conn.name,
        providerId: pid,
        provider: pid,
        model: resolvedModel,
        tiers: effectiveTiers,
        // apiKey now lives on Provider; fall back to legacy conn.apiKey for old data
        hasApiKey: !!(provider?.apiKey?.trim() ?? conn.apiKey?.trim()),
        metadata: conn.metadata as Record<string, unknown>,
        status: conn.status,
    };
}

/**
 * 返回 Provider 的安全视图（剥离 apiKey）。
 * `getProviders()` 使用此函数对外暴露 provider 列表。
 */
export function toProviderMeta(provider: LLMProvider): Omit<LLMProvider, 'apiKey'> {
    const { apiKey: _apiKey, ...meta } = provider as LLMProvider & { apiKey?: string };
    return meta;
}

/** 解析指定 tier 对应的模型 ID */
export function resolveModelForTier(
    conn: Pick<ConnectionMeta, 'model' | 'tiers'>,
    tier: ModelTier,
): string {
    return conn.tiers?.[tier] ?? conn.model;
}

/** 返回下一个更低成本的层级，optimal → standard → fast → undefined */
export function getNextLowerTier(
    current: ModelTier,
    tiers: Partial<Record<ModelTier, string>>,
): ModelTier | undefined {
    if (current === 'optimal') return tiers.standard ? 'standard' : tiers.fast ? 'fast' : undefined;
    if (current === 'standard') return tiers.fast ? 'fast' : undefined;
    return undefined;
}
