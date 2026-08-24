// @file: common/interfaces/llm/connection.ts
// LLM 连接与 Provider 相关数据结构。
// 这是跨包共享的唯一权威来源；device-llm 仅提供实现，不重复定义类型。
//
// 三层结构：
//   Provider   — 云提供商（持有 apiKey + 模型目录，是认证的唯一来源）
//   Connection — 引用 Provider 的命名配置（可覆盖 tier 映射，不存 apiKey）
//   Agent      — 绑定 Connection 的个性化定制（tier 偏好 + system prompt）

// ─── Model ───────────────────────────────────────────────────────────────────

/**
 * 模型用途分类。决定模型出现在哪些选择器、用哪个主图标。
 * - `chat`      — 对话 / 文本生成（默认，未设置时视为 chat）
 * - `image`     — 文生图（如 Seedream、DALL·E）
 * - `video`     — 视频生成（如 Seedance、Sora）
 * - `audio`     — 语音合成 / 识别（如 TTS、Whisper）
 * - `embedding` — 向量嵌入（如 text-embedding）
 */
export type ModelCategory = 'chat' | 'image' | 'video' | 'audio' | 'embedding';

export interface LLMModel {
    id: string;
    name: string;
    icon?: string;
    /** 模型用途分类，缺省视为 'chat'。 */
    category?: ModelCategory;
    contextWindow?: number;
    maxOutput?: number;
    supportsVision?: boolean;
    supportsThinking?: boolean;
    /**
     * 控制该模型的 thinking 字段发送策略：
     * - 'auto'     不发送 thinking 字段，由模型/代理自适应（默认，适用于不明确支持 disabled 的代理模型）
     * - 'enabled'  发送 thinking.type=enabled（明确开启 extended thinking）
     * - 'disabled' 发送 thinking.type=disabled（适用于 DeepSeek 等默认开启 thinking 的模型）
     * 未设置时行为同 'auto'。
     */
    thinkingMode?: 'auto' | 'enabled' | 'disabled';
    supportsTools?: boolean;
    supportsAudio?: boolean;
    supportsVideo?: boolean;
    supportsStructuredOutput?: boolean;
    inputPricePerMillion?: number;
    outputPricePerMillion?: number;
    /** cache 写入价格，USD/M tokens（仅支持 prompt caching 的 provider） */
    cacheWritePricePerMillion?: number;
    /** cache 读取价格，USD/M tokens */
    cacheReadPricePerMillion?: number;
}

// ─── DailyCost ───────────────────────────────────────────────────────────────

/** 单日用量开销记录，按日期 key 索引，用于统计和图表 */
export interface DailyCost {
    /** ISO 日期字符串 YYYY-MM-DD */
    date: string;
    /** 输入 token 数 */
    inputTokens: number;
    /** 输出 token 数 */
    outputTokens: number;
    /** 费用（美元） */
    cost: number;
    /** 请求次数 */
    requests: number;
}

// ─── ModelTier ────────────────────────────────────────────────────────────────

/**
 * 模型质量层级。
 * - `optimal`  — 最高质量，用于规划/推理（默认）
 * - `standard` — 常规质量，用于大多数日常工作
 * - `fast`     — 低成本，用于简单/廉价任务
 */
export type ModelTier = 'optimal' | 'standard' | 'fast';

// ─── ApiProtocol ──────────────────────────────────────────────────────────────

/**
 * API 协议类型。同一厂商可提供多种协议端点
 * （如 DeepSeek 同时支持 OpenAI Chat Completions 和 Anthropic Messages 格式）。
 *
 * - `openai-chat`        — OpenAI Chat Completions API (/v1/chat/completions)
 * - `openai-responses`   — OpenAI Responses API (/responses，input items + output[])
 * - `anthropic-messages` — Anthropic Messages API (/v1/messages)
 * - `gemini-generate`    — Google Gemini generateContent API
 *
 * 未设置时由 `resolveProtocol()` 按 URL + provider 名自动推断，向后兼容。
 */
export type ApiProtocol = 'openai-chat' | 'openai-responses' | 'anthropic-messages' | 'gemini-generate';

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
    /**
     * Provider 根域地址，不含路径（如 "https://api.deepseek.com"）。
     * Provider 实现类会在此基础上拼接 defaultPath 或内置默认路径。
     */
    baseURL: string;
    /**
     * 覆盖 Provider 实现类的内置默认 API 路径。
     * 仅当与默认值不同时填写，否则省略：
     * - openai-compatible 默认：/v1/chat/completions
     * - anthropic 默认：/v1/messages
     * - gemini 默认：/v1beta/models
     */
    defaultPath?: string;
    /**
     * 该 Provider 支持的 Anthropic Messages API 兼容路径（相对于 baseURL）。
     * 如 "/anthropic"，完整 URL = baseURL + anthropicPath。
     * 填写后 Connection 可以选择 anthropic-messages 协议使用此端点。
     */
    anthropicPath?: string;
    /**
     * 该 Provider 支持的 OpenAI Responses API 兼容路径（相对于 baseURL）。
     * 如 DeepSeek 的 "/responses"，完整 URL = baseURL + responsesPath
     * （DeepSeek Responses API 的 base_url 为 https://api.deepseek.com）。
     * 填写后 Connection 可以选择 openai-responses 协议使用此端点。
     */
    responsesPath?: string;
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
        /**
         * 是否支持「服务端内置联网搜索」（server-side web search）。
         * true = 可通过请求参数触发厂商内置检索（如 DeepSeek/OpenAI Responses 的
         * `web_search` 工具、Gemini 的 `googleSearch`），结果经 `citations[]` 回传。
         * false / undefined = 无内置检索，联网能力需靠客户端统一工具（WebSearchTool）
         * 或 MCP server 实现。
         */
        serverSideWebSearch?: boolean;
    };
    /**
     * Responses API 推理行为配置（仅 openai-responses 协议生效）。
     * defaultThinkingEnabled = 服务端默认开启思考（如 DeepSeek），此时用户显式
     * 关闭 thinking（params.thinking=false）需发送 reasoning.effort='none' 才能关闭。
     */
    responses?: {
        defaultThinkingEnabled?: boolean;
    };
    /**
     * true = 内置 Provider（由 constants.ts 定义）。
     * false / undefined = 用户新建的自定义 Provider，可以删除。
     */
    isBuiltin?: boolean;
    /**
     * Provider 是否启用。false = 禁用（所有绑定此 Provider 的 Connection 均不可用）。
     * 未设置视为 true。
     */
    enabled?: boolean;
    /**
     * Provider 默认温度（0-2），所有绑定此 Provider 的 Connection 继承此值。
     * Connection.temperature 可覆盖此默认值。
     */
    defaultTemperature?: number;
    /**
     * 整个 Provider 每日开销统计（所有 Connection 汇总）。
     * key 为 ISO 日期字符串 YYYY-MM-DD。
     */
    dailyCosts?: Record<string, DailyCost>;
}

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
    /**
     * API 协议类型。同一厂商可通过不同 URL 提供多种协议（如 DeepSeek 的
     * openai-chat 端点和 anthropic-messages 端点）。
     *
     * 未设置时由 `resolveProtocol()` 按 URL + provider 名自动推断，向后兼容。
     */
    protocol?: ApiProtocol;
    metadata?: {
        isSystemDefault?: boolean;
        thinkingBudget?: number;
        reasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh';
        mcpServers?: string[];
        caching?: boolean;
        headers?: Record<string, string>;
        [key: string]: unknown;
    };
    /**
     * Connection 是否启用。false = 禁用（不出现在选择器中，不可用于发起请求）。
     * 未设置视为 true。
     */
    enabled?: boolean;
    status?: 'active' | 'error' | 'untested';
    /**
     * 温度参数（0-2），覆盖 Provider.defaultTemperature。
     * 未设置则使用 Provider 的默认温度。
     */
    temperature?: number;
    /**
     * 本连接每日开销统计，key 为 ISO 日期字符串 YYYY-MM-DD。
     * 与 Provider.dailyCosts 独立——Provider 存储所有 Connection 的汇总。
     */
    dailyCosts?: Record<string, DailyCost>;
    lastTestedAt?: number;
    lastTestResult?: boolean;
    createdAt?: number;
    updatedAt?: number;

    // ── 向后兼容字段（迁移旧数据时读取，新数据不再写入） ────────────────

    /**
     * 覆盖 Provider.baseURL。用于同一厂商多协议端点场景
     * （如 DeepSeek openai-chat 用 /v1，anthropic-messages 用 /anthropic）。
     * 未设置则使用 Provider.baseURL。
     */
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
    /** 已解析的 optimal 层级模型 ID（tiers.optimal → provider.models[0]） */
    model: string;
    /** Tier 映射（继承自 Connection.tiers 或 Provider.defaultTiers） */
    tiers?: Partial<Record<ModelTier, string>>;
    /** 关联 Provider 是否已配置 apiKey */
    hasApiKey: boolean;
    /**
     * 此连接是否可用（Connection.enabled && Provider.enabled 均为 true）。
     * false = 连接或其 Provider 被禁用，不可发起请求。
     */
    enabled: boolean;
    metadata?: Record<string, unknown>;
    status?: 'active' | 'error' | 'untested';
    /** 已解析的温度值（connection.temperature ?? provider.defaultTemperature） */
    temperature?: number;
    /** 本连接每日开销统计 */
    dailyCosts?: Record<string, DailyCost>;
    /** API 协议类型；未设置时由 resolveProtocol() 自动推断 */
    protocol?: ApiProtocol;
}

// ─── DefaultConnectionDef ────────────────────────────────────────────────────

/**
 * 内置默认连接定义模板。
 * `syncDefaultConnections()` 按此列表初始化 VFS；
 * 同一 Provider 可出现多次，代表不同的模型族策略。
 */
export interface DefaultConnectionDef {
    /** 连接唯一 ID，'default' 表示系统默认连接 */
    id: string;
    /** 连接显示名称 */
    name: string;
    /** 引用的 Provider ID */
    providerId: string;
    /** Tier → model ID 映射 */
    tiers?: Partial<Record<ModelTier, string>>;
    /** API 协议类型；未设置时由 resolveProtocol() 自动推断 */
    protocol?: ApiProtocol;
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
 * 在 provider 的模型目录中按 name（display name）查找模型。
 * 返回匹配的 model ID，未找到返回 undefined。
 */
function findModelByName(provider: LLMProvider, name: string): string | undefined {
    return provider.models.find(m => m.name === name)?.id;
}

/**
 * 跨 provider 解析 model ID。
 *
 * 当 connection 从 provider A 切换到 provider B 时，tiers 中存储的是 A 的 model ID，
 * 在 B 的模型目录中可能不存在。此函数尝试按以下策略解析：
 *   1. 直接 ID 匹配（modelId 在 provider.models 中存在）
 *   2. 在所有 provider 中查找 modelId 的 name，再在目标 provider 中按 name 匹配
 *   3. 在目标 provider 中按 name 直接匹配（当 modelId 恰好是 display name 时）
 *
 * @param modelId  待解析的模型 ID
 * @param provider  目标 provider
 * @param allProviders  所有 provider 的集合（用于跨 provider name 查找），可选
 * @returns 匹配到的 model ID，未匹配到返回 undefined
 */
export function resolveModelId(
    modelId: string,
    provider: LLMProvider,
    allProviders?: Iterable<LLMProvider>,
): string | undefined {
    // 1. Direct ID match
    if (provider.models.some(m => m.id === modelId)) return modelId;

    // 2. Cross-provider: find the model's name from any provider, then match by name
    if (allProviders) {
        for (const p of allProviders) {
            const srcModel = p.models.find(m => m.id === modelId);
            if (srcModel) {
                const match = findModelByName(provider, srcModel.name);
                if (match) return match;
                break; // found the source model but no name match in target
            }
        }
    }

    // 3. Fallback: try direct name match in target provider
    return findModelByName(provider, modelId);
}

/**
 * 将完整连接转换为安全元数据。
 * hasApiKey 从 provider.apiKey 解析。
 *
 * @param allProviders  所有 provider（用于跨 provider 的 model ID → name → ID 解析）
 */
export function toConnectionMeta(
    conn: LLMConnection,
    provider?: LLMProvider,
    allProviders?: Iterable<LLMProvider>,
): ConnectionMeta {
    // Tier config lives exclusively on Connection; Provider has no defaultTiers.
    const effectiveTiers = conn.tiers;
    const directModel =
        effectiveTiers?.optimal
        ?? provider?.models[0]?.id
        ?? '';
    const resolvedModel =
        provider && effectiveTiers?.optimal
            ? resolveModelId(effectiveTiers.optimal, provider, allProviders)
                ?? provider.models[0]?.id
                ?? ''
            : directModel;
    const pid = conn.providerId;

    return {
        id: conn.id,
        name: conn.name,
        providerId: pid,
        model: resolvedModel,
        tiers: effectiveTiers,
        hasApiKey: !!(provider?.apiKey?.trim()),
        // enabled = both connection and provider must be enabled (undefined treated as true)
        enabled: conn.enabled !== false && provider?.enabled !== false,
        metadata: conn.metadata as Record<string, unknown>,
        status: conn.status,
        temperature: conn.temperature ?? provider?.defaultTemperature,
        dailyCosts: conn.dailyCosts,
        protocol: conn.protocol,
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
/** 层级 fallback 顺序：fast → standard → optimal → model */
const TIER_FALLBACK: Record<ModelTier, ModelTier[]> = {
    fast:     ['fast', 'standard', 'optimal'],
    standard: ['standard', 'optimal'],
    optimal:  ['optimal'],
};

/**
 * 解析指定 tier 对应的模型 ID，未配置时自动向上 fallback。
 *
 * 例：选择「快速」但连接未配置 fast/standard → fallback 到 optimal → model
 */
export function resolveModelForTier(
    conn: Pick<ConnectionMeta, 'model' | 'tiers'>,
    tier: ModelTier,
): string {
    for (const t of TIER_FALLBACK[tier]) {
        const modelId = conn.tiers?.[t];
        if (modelId) return modelId;
    }
    return conn.model;
}

/** 解析最终温度：connection.temperature → provider.defaultTemperature → undefined */
export function resolveTemperature(
    conn: Pick<LLMConnection, 'temperature'>,
    provider?: Pick<LLMProvider, 'defaultTemperature'>,
): number | undefined {
    return conn.temperature ?? provider?.defaultTemperature;
}

/**
 * 聚合所有 Connection 的每日开销 → Provider 级别汇总。
 * 按日期合并，同名日期累加所有 Connection 的数据。
 */
export function aggregateProviderCosts(
    connections: Pick<LLMConnection, 'dailyCosts'>[],
): Record<string, DailyCost> {
    const result: Record<string, DailyCost> = {};
    for (const conn of connections) {
        if (!conn.dailyCosts) continue;
        for (const [date, c] of Object.entries(conn.dailyCosts)) {
            if (result[date]) {
                result[date].inputTokens += c.inputTokens;
                result[date].outputTokens += c.outputTokens;
                result[date].cost += c.cost;
                result[date].requests += c.requests;
            } else {
                result[date] = { ...c };
            }
        }
    }
    return result;
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

// ─── Web Search 策略（分层统一） ────────────────────────────────────────────────

/**
 * 联网搜索策略三态（判别联合，天然排除「内置+客户端」非法态）。
 *
 * - 'builtin'    ：走底层内置 server-side search，LLM 请求携带 `webSearch` 参数
 *                  （DeepSeek/OpenAI Responses 的 `web_search` 工具、Gemini 的
 *                  `googleSearch`），服务端执行并回传 `citations[]`。
 * - 'client-tool'：注入客户端统一 WebSearchTool 供模型调用。
 * - 'disabled'   ：禁用联网（内置与客户端均关闭）。
 */
export type WebSearchMode = 'builtin' | 'client-tool' | 'disabled';

/**
 * 根据 Provider 能力与用户总开关解析联网搜索策略。
 *
 * @param capabilities  当前 Provider 能力（LLMProvider.capabilities）
 * @param enabled       用户是否启用联网搜索（总开关）
 * @param protocol      连接 API 协议；某些 Provider 的内置 search 仅在特定协议下可用
 *   （如 DeepSeek/OpenAI 的 `web_search` 内置工具在 `openai-responses` 协议下才生效，
 *   Gemini 的 `googleSearch` 在 `gemini-generate` 协议下生效）。
 * @returns 三态策略；enabled=false 时返回 'disabled'。
 */
export function resolveWebSearchStrategy(
    capabilities?: { serverSideWebSearch?: boolean },
    enabled = true,
    protocol?: ApiProtocol,
): WebSearchMode {
    if (!enabled) return 'disabled';
    const builtin = !!capabilities?.serverSideWebSearch && supportsServerSideSearch(protocol);
    return builtin ? 'builtin' : 'client-tool';
}

/** 判断协议是否支持 server-side 内置检索。未指定协议时按 Provider 能力判定（向后兼容）。 */
function supportsServerSideSearch(protocol?: ApiProtocol): boolean {
    if (!protocol) return true;
    return protocol === 'openai-responses' || protocol === 'gemini-generate';
}
