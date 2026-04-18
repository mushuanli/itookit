// @file: device-llm/constants/connections.ts
// Layer 2 — Connection 默认配置。
// 职责：引用 Provider（通过 providerId）+ tier 映射（optimal/standard/fast）。
// Connection 不持有 apiKey（在 Provider 层），也不持有模型目录（在 Provider 层）。
// Tier 配置是 Connection 层的核心责任：同一 Provider 的不同 API Key 可以有不同的 tier 策略。

import type { ModelTier } from '@itookit/common';

/** 系统默认连接 ID（对应 providers 中排名第一的 provider） */
export const LLM_DEFAULT_ID   = 'default';
export const LLM_DEFAULT_NAME = '默认';

/** LLM 请求超时（ms） */
export const DEFAULT_TIMEOUT      = 60000;
/** 最大重试次数 */
export const DEFAULT_MAX_RETRIES  = 3;
/** 重试基础延迟（ms） */
export const DEFAULT_RETRY_DELAY  = 1000;

/**
 * 各 Provider 对应默认连接的推荐 tier 映射。
 * 在 syncDefaultConnections() 中写入新建连接；用户可在 ConnectionSettingsEditor 中覆盖。
 * key = provider id；value = { optimal?, standard?, fast? } → model ID
 */
export const DEFAULT_CONNECTION_TIERS: Record<string, Partial<Record<ModelTier, string>>> = {
    rdsec: {
        optimal:  'claude-4.6-opus',
        standard: 'claude-4.6-sonnet',
        fast:     'claude-4.5-haiku',
    },
    anthropic: {
        optimal:  'claude-opus-4-1-20250805',
        standard: 'claude-sonnet-4-5-20250929',
        fast:     'claude-haiku-4-5-20251001',
    },
    gemini: {
        optimal:  'gemini-2.5-pro',
        standard: 'gemini-2.5-flash',
        fast:     'gemini-2.5-flash',
    },
    deepseek: {
        optimal:  'deepseek-reasoner',
        standard: 'deepseek-chat',
        fast:     'deepseek-chat',
    },
    cloudapi: {
        optimal:  'claude-opus-4-6',
        standard: 'claude-sonnet-4-6-thinking',
        fast:     'claude-haiku-4-5-20251001-r',
    },
    openai: {
        optimal:  'gpt-5-pro',
        standard: 'gpt-5',
        fast:     'gpt-5-mini',
    },
    // openrouter, custom: no default tiers (too heterogeneous)
};
