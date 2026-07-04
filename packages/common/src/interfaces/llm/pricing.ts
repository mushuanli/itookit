// @file: common/interfaces/llm/pricing.ts
// Model pricing 配置类型 + cost.seq 记录类型。
// 权威来源，所有包通过 @itookit/common 引用。

// ─── Pricing Config ──────────────────────────────────────────────────────────

/**
 * 单个模型的定价条目。
 * price = [input, output, cache_write, cache_read]，单位 USD/M tokens。
 *
 * providers 字段语义：
 *   - key absent               → 该 provider 不支持此模型
 *   - providers.foo = []       → 路由使用 entry.id，反向查找也匹配 entry.id
 *   - providers.foo = ["a","b"]→ 路由使用 "a"，反向查找匹配 "a" 或 "b"
 */
export interface ModelPricingEntry {
    /** 逻辑定价 ID，如 "claude-opus" */
    id: string;
    /** [inputPerM, outputPerM, cacheWritePerM, cacheReadPerM]，USD */
    price: [number, number, number, number];
    /** provider → 实际 model ID 列表 */
    providers: Record<string, string[]>;
}

/** pricing.json 根结构 */
export interface ModelPricingConfig {
    model_pricing: ModelPricingEntry[];
}

// ─── Cost Record ─────────────────────────────────────────────────────────────

/**
 * cost.seq 的 value 类型。
 * key = `{sessionId}|{providerId}|{date}`，同 key 每次请求累加。
 * 一个 session 切换 provider 后产生独立记录（不同 key）。
 */
export interface CostRecord {
    sessionId: string;
    providerId: string;
    /** 实际使用的连接 ID，比 provider 更细粒度 */
    connectionId: string;
    /** 实际使用的模型 ID */
    modelId: string;
    /** YYYY-MM-DD */
    date: string;
    inputTokens: number;
    outputTokens: number;
    /** cache 写入 token（cache_creation_input_tokens，仅 Anthropic） */
    cacheWriteTokens?: number;
    /** cache 读取 token（cache_read_input_tokens，仅 Anthropic） */
    cacheReadTokens?: number;
    /** 费用，USD */
    cost: number;
    /** 本 key 累计请求次数 */
    requests: number;
}

// ─── Pricing Lookup ──────────────────────────────────────────────────────────

/**
 * 按 (providerId, actualModelId) 反向查找对应定价条目。
 * 找不到时返回 undefined，调用方应 fallback 到内联常量价格。
 */
export function lookupPricingEntry(
    config: ModelPricingConfig,
    providerId: string,
    actualModelId: string,
): ModelPricingEntry | undefined {
    for (const entry of config.model_pricing) {
        const list = entry.providers[providerId];
        if (list === undefined) continue;
        const modelIds = list.length === 0 ? [entry.id] : list;
        if (modelIds.includes(actualModelId)) return entry;
    }
    return undefined;
}

/** 从 ModelPricingEntry 解构为具名价格字段 */
export function extractPrices(entry: ModelPricingEntry): {
    inputPricePerMillion: number;
    outputPricePerMillion: number;
    cacheWritePricePerMillion: number;
    cacheReadPricePerMillion: number;
} {
    return {
        inputPricePerMillion:      entry.price[0],
        outputPricePerMillion:     entry.price[1],
        cacheWritePricePerMillion: entry.price[2],
        cacheReadPricePerMillion:  entry.price[3],
    };
}

// ─── Cost Aggregation ────────────────────────────────────────────────────────

/** 聚合一组 CostRecord 为汇总值（过滤后调用） */
export function aggregateCostRecords(records: CostRecord[]): {
    inputTokens: number;
    outputTokens: number;
    cacheWriteTokens: number;
    cacheReadTokens: number;
    cost: number;
    requests: number;
} {
    let inputTokens = 0, outputTokens = 0, cacheWriteTokens = 0,
        cacheReadTokens = 0, cost = 0, requests = 0;
    for (const r of records) {
        inputTokens      += r.inputTokens;
        outputTokens     += r.outputTokens;
        cacheWriteTokens += r.cacheWriteTokens ?? 0;
        cacheReadTokens  += r.cacheReadTokens  ?? 0;
        cost             += r.cost;
        requests         += r.requests;
    }
    return { inputTokens, outputTokens, cacheWriteTokens, cacheReadTokens, cost, requests };
}
