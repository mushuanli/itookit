// @file: device-llm/constants/connections.ts
// Layer 2 — Connection 默认定义。
// 职责：引用 Provider（通过 providerId）+ 命名 + tier 映射（optimal/standard/fast）。
// Connection 不持有 apiKey（在 Provider 层），也不持有模型目录（在 Provider 层）。
//
// 同一 Provider 可有多个 Connection，每个 Connection 选取不同的模型族作为 tier 策略。
// 例：rdsec 提供商下分设 rdsec（Claude）、rdsec-gemini、rdsec-deepseek 三条连接。

import type { DefaultConnectionDef } from '@itookit/common';

/** 系统默认连接 ID */
export const LLM_DEFAULT_ID = 'default';
export const LLM_DEFAULT_NAME = '默认';

/** LLM 请求超时（ms） */
export const DEFAULT_TIMEOUT = 60000;
/** 最大重试次数 */
export const DEFAULT_MAX_RETRIES = 3;
/** 重试基础延迟（ms） */
export const DEFAULT_RETRY_DELAY = 1000;

/** Re-export for convenience */
export type { DefaultConnectionDef };

/**
 * 内置默认连接列表。
 * 第一条 id='default' 为系统默认连接。
 * 同一 Provider 可出现多次，代表不同的模型族策略。
 */
export const DEFAULT_CONNECTIONS: DefaultConnectionDef[] = [
    // ── RDSec — Claude 系列（系统默认连接）──────────────────────────────────
    {
        id: 'default',
        name: 'RDSec',
        providerId: 'rdsec',
        tiers: {
            optimal: 'claude-4.6-opus',
            standard: 'claude-4.6-sonnet',
            fast: 'claude-4.5-haiku',
        },
    },
    // ── RDSec — Gemini 系列 ───────────────────────────────────────────────
    {
        id: 'conn-rdsec-gemini',
        name: 'RDSec Gemini',
        providerId: 'rdsec',
        tiers: {
            optimal: 'gemini-3.1-pro',
            standard: 'gemini-3-flash',
            fast: 'gemini-3-flash',
        },
    },
    // ── RDSec — DeepSeek 系列 ────────────────────────────────────────────
    {
        id: 'conn-rdsec-deepseek',
        name: 'RDSec DeepSeek',
        providerId: 'rdsec',
        tiers: {
            optimal: 'deepseek-r1',
            standard: 'deepseek-v3.1',
            fast: 'deepseek-v3.1',
        },
    },

    // ── Anthropic ─────────────────────────────────────────────────────────
    {
        id: 'conn-anthropic',
        name: 'Anthropic',
        providerId: 'anthropic',
        tiers: {
            optimal: 'claude-opus-4-1-20250805',
            standard: 'claude-sonnet-4-5-20250929',
            fast: 'claude-haiku-4-5-20251001',
        },
    },

    // ── Google Gemini ─────────────────────────────────────────────────────
    {
        id: 'conn-gemini',
        name: 'Google Gemini',
        providerId: 'gemini',
        tiers: {
            optimal: 'gemini-2.5-pro',
            standard: 'gemini-2.5-flash',
            fast: 'gemini-2.5-flash',
        },
    },

    // ── DeepSeek ──────────────────────────────────────────────────────────
    {
        id: 'conn-deepseek',
        name: 'DeepSeek',
        providerId: 'deepseek',
        tiers: {
            optimal: 'deepseek-v4-pro',
            standard: 'deepseek-v4-flash',
            fast: 'deepseek-v4-flash',
        },
    },

    // ── CloudAPI — Claude 系列 ────────────────────────────────────────────
    {
        id: 'conn-cloudapi',
        name: 'CloudAPI',
        providerId: 'cloudapi',
        tiers: {
            optimal: 'claude-opus-4-6',
            standard: 'claude-sonnet-4-6-thinking',
            fast: 'claude-haiku-4-5-20251001-r',
        },
    },

    // ── OpenRouter ────────────────────────────────────────────────────────
    {
        id: 'conn-openrouter',
        name: 'OpenRouter',
        providerId: 'openrouter',
        // No default tiers — model list too heterogeneous; user configures manually
    },

    // ── OpenAI ────────────────────────────────────────────────────────────
    {
        id: 'conn-openai',
        name: 'OpenAI',
        providerId: 'openai',
        tiers: {
            optimal: 'gpt-5-pro',
            standard: 'gpt-5',
            fast: 'gpt-5-mini',
        },
    },
];

/** @deprecated 使用 DEFAULT_CONNECTIONS 代替 */
export const DEFAULT_CONNECTION_TIERS = {} as Record<string, unknown>;
