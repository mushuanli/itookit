// @file: device-llm/constants/providers.ts
// Layer 1 — Provider 目录（云提供商定义 + 模型 catalog）。
// 职责：持有 apiKey + 模型目录，是认证与模型信息的唯一来源。

import type { LLMProvider } from '@itookit/common';

// ─── VFS 存储路径 ──────────────────────────────────────────────────────────────
/** VFS __config 模块中 Provider 数据的存储目录 */
export const PROVIDERS_DIR = '/llm/.providers';

// ─── 定价常量（每百万 token，USD）───────────────────────────────────────────────

const P = {
    // Claude 系列
    CLAUDE_OPUS_IN: 15, CLAUDE_OPUS_OUT: 75,
    CLAUDE_SONNET_IN: 3, CLAUDE_SONNET_OUT: 15,
    CLAUDE_HAIKU_IN: 0.8, CLAUDE_HAIKU_OUT: 4,

    // GPT 系列
    GPT_PRO_IN: 5, GPT_PRO_OUT: 15,
    GPT_STD_IN: 2.5, GPT_STD_OUT: 10,
    GPT_MINI_IN: 0.15, GPT_MINI_OUT: 0.6,
    GPT_NANO_IN: 0.03, GPT_NANO_OUT: 0.12,
    GPT4O_IN: 2.5, GPT4O_OUT: 10,
    GPT4O_MINI_IN: 0.15, GPT4O_MINI_OUT: 0.6,
    GPT41_IN: 2, GPT41_OUT: 8,
    GPT41_MINI_IN: 0.4, GPT41_MINI_OUT: 1.6,
    GPT41_NANO_IN: 0.1, GPT41_NANO_OUT: 0.4,
    GPT4_IN: 30, GPT4_OUT: 60,
    GPT4_32K_IN: 60, GPT4_32K_OUT: 120,
    GPT51_IN: 2, GPT51_OUT: 8,

    // Gemini 系列
    GEMINI_PRO_IN: 1.25, GEMINI_PRO_OUT: 10,
    GEMINI_FLASH_IN: 0.15, GEMINI_FLASH_OUT: 0.6,
    GEMINI_LEGACY_IN: 0.5, GEMINI_LEGACY_OUT: 1.5,

    // DeepSeek 系列
    DEEPSEEK_CHAT_IN: 0.27, DEEPSEEK_CHAT_OUT: 1.1,
    DEEPSEEK_REASONER_IN: 0.55, DEEPSEEK_REASONER_OUT: 2.19,

    // OpenRouter 系列（含代理溢价）
    LLAMA4_MAVERICK_IN: 0.4, LLAMA4_MAVERICK_OUT: 0.8,
    HERMES4_405B_IN: 1.5, HERMES4_405B_OUT: 3,
    MISTRAL_LARGE_IN: 2, MISTRAL_LARGE_OUT: 6,
    GLM46_IN: 0.5, GLM46_OUT: 0.5,
    GROK4_IN: 2, GROK4_OUT: 8,
} as const;

// ─── 模型显示名称常量 ──────────────────────────────────────────────────────────

// Claude
export const MODEL_NAME_CLAUDE_46_OPUS = 'Claude 4.6 Opus';
export const MODEL_NAME_CLAUDE_46_OPUS_THINKING = 'Claude 4.6 Opus thinking';
export const MODEL_NAME_CLAUDE_46_SONNET = 'Claude 4.6 Sonnet';
export const MODEL_NAME_CLAUDE_45_OPUS = 'Claude 4.5 Opus';
export const MODEL_NAME_CLAUDE_45_SONNET = 'Claude 4.5 Sonnet';
export const MODEL_NAME_CLAUDE_45_HAIKU = 'Claude 4.5 Haiku';
export const MODEL_NAME_CLAUDE_OPUS_4 = 'Claude Opus 4';
export const MODEL_NAME_CLAUDE_SONNET_4 = 'Claude Sonnet 4';
export const MODEL_NAME_CLAUDE_4_SONNET = 'Claude 4 Sonnet';
export const MODEL_NAME_CLAUDE_37_SONNET_LATEST = 'Claude Sonnet 3.7 (Latest)';
export const MODEL_NAME_CLAUDE_37_SONNET = 'Claude Sonnet 3.7';

// GPT
export const MODEL_NAME_GPT4 = 'GPT-4';
export const MODEL_NAME_GPT4_32K = 'GPT-4 32k';
export const MODEL_NAME_GPT4O = 'GPT-4o';
export const MODEL_NAME_GPT4O_OPENAI = 'GPT-4o (OpenAI)';
export const MODEL_NAME_GPT4O_MINI = 'GPT-4o Mini';
export const MODEL_NAME_GPT41 = 'GPT-4.1';
export const MODEL_NAME_GPT41_MINI = 'GPT-4.1 Mini';
export const MODEL_NAME_GPT41_NANO = 'GPT-4.1 Nano';
export const MODEL_NAME_GPT5 = 'GPT-5';
export const MODEL_NAME_GPT5_CHAT = 'GPT-5 Chat';
export const MODEL_NAME_GPT5_CODEX = 'GPT-5 Codex';
export const MODEL_NAME_GPT5_MINI = 'GPT-5 Mini';
export const MODEL_NAME_GPT5_NANO = 'GPT-5 Nano';
export const MODEL_NAME_GPT51 = 'GPT-5.1';
export const MODEL_NAME_GPT51H = 'GPT-5.1H';
export const MODEL_NAME_GPT52 = 'GPT-5.2';

// Gemini
export const MODEL_NAME_GEMINI_25_PRO = 'Gemini 2.5 Pro';
export const MODEL_NAME_GEMINI_25_FLASH = 'Gemini 2.5 Flash';
export const MODEL_NAME_GEMINI_3_PRO = 'Gemini 3 Pro';
export const MODEL_NAME_GEMINI_3_FLASH = 'Gemini 3 Flash';
export const MODEL_NAME_GEMINI_31_PRO = 'Gemini 3.1 Pro';
export const MODEL_NAME_GEMINI_PRO = 'Gemini Pro';

// DeepSeek
export const MODEL_NAME_DEEPSEEK_CHAT = 'DeepSeek Chat';
export const MODEL_NAME_DEEPSEEK_REASONER = 'DeepSeek Reasoner';
export const MODEL_NAME_DEEPSEEK_R1 = 'DeepSeek R1';
export const MODEL_NAME_DEEPSEEK_R1_0528 = 'DeepSeek R1 0528';
export const MODEL_NAME_DEEPSEEK_R1_AWS = 'DeepSeek R1 AWS';
export const MODEL_NAME_DEEPSEEK_V31 = 'DeepSeek v3.1';
export const MODEL_NAME_DEEPSEEK_V4_PRO = 'DeepSeek V4 Pro';
export const MODEL_NAME_DEEPSEEK_V4_FLASH = 'DeepSeek V4 Flash';

// Others
export const MODEL_NAME_OPENROUTER_AUTO = 'Auto (Best Model)';
export const MODEL_NAME_META_LLAMA4_MAVERICK = 'Meta: Llama 4 Maverick';
export const MODEL_NAME_NOUS_HERMES4_405B = 'Nous: Hermes 4 405B';
export const MODEL_NAME_MISTRAL_LARGE_2411 = 'Mistral: Mistral Large 2411';
export const MODEL_NAME_ZAI_GLM46 = 'Z.AI: GLM 4.6';
export const MODEL_NAME_XAI_GROK4 = 'xAI: Grok 4';

// ─── 内置 Provider 目录 ────────────────────────────────────────────────────────

/**
 * 内置 Provider 目录（模型 catalog 唯一权威来源）。
 * key = provider.id；Connection 通过 providerId 引用。
 * 用户自定义覆盖持久化在 VFS PROVIDERS_DIR 中。
 */
export const LLM_PROVIDERS: Record<string, LLMProvider> = {
    rdsec: {
        id: 'rdsec', isBuiltin: true,
        name: 'RDSec',
        implementation: 'openai-compatible',
        baseURL: 'https://api.rdsec.trendmicro.com/prod/aiendpoint/v1/chat/completions',
        icon: '🛡️',
        supportsThinking: true,
        models: [
            { id: 'claude-4.6-opus', name: MODEL_NAME_CLAUDE_46_OPUS, icon: '👑', inputPricePerMillion: P.CLAUDE_OPUS_IN, outputPricePerMillion: P.CLAUDE_OPUS_OUT },
            { id: 'gemini-3.1-pro', name: MODEL_NAME_GEMINI_31_PRO, icon: '💫', inputPricePerMillion: P.GEMINI_PRO_IN, outputPricePerMillion: P.GEMINI_PRO_OUT },
            { id: 'claude-4.6-sonnet', name: MODEL_NAME_CLAUDE_46_SONNET, icon: '🎭', inputPricePerMillion: P.CLAUDE_SONNET_IN, outputPricePerMillion: P.CLAUDE_SONNET_OUT },
            { id: 'gemini-3-flash', name: MODEL_NAME_GEMINI_3_FLASH, icon: '⚡', inputPricePerMillion: P.GEMINI_FLASH_IN, outputPricePerMillion: P.GEMINI_FLASH_OUT },
            { id: 'gpt-5.2', name: MODEL_NAME_GPT52, icon: '✨', inputPricePerMillion: P.GPT_PRO_IN, outputPricePerMillion: P.GPT_PRO_OUT },
            { id: 'gemini-3-pro', name: MODEL_NAME_GEMINI_3_PRO, icon: '💫', inputPricePerMillion: P.GEMINI_PRO_IN, outputPricePerMillion: P.GEMINI_PRO_OUT },
            { id: 'claude-4.5-haiku', name: MODEL_NAME_CLAUDE_45_HAIKU, icon: '🍃', inputPricePerMillion: P.CLAUDE_HAIKU_IN, outputPricePerMillion: P.CLAUDE_HAIKU_OUT },
            { id: 'claude-4.5-opus', name: MODEL_NAME_CLAUDE_45_OPUS, icon: '👑', inputPricePerMillion: P.CLAUDE_OPUS_IN, outputPricePerMillion: P.CLAUDE_OPUS_OUT },
            { id: 'gpt-4o', name: MODEL_NAME_GPT4O_OPENAI, icon: '🤖', inputPricePerMillion: P.GPT4O_IN, outputPricePerMillion: P.GPT4O_OUT },
            { id: 'claude-4-sonnet', name: MODEL_NAME_CLAUDE_4_SONNET, icon: '🏺', inputPricePerMillion: P.CLAUDE_SONNET_IN, outputPricePerMillion: P.CLAUDE_SONNET_OUT },
            { id: 'deepseek-r1', name: MODEL_NAME_DEEPSEEK_R1, icon: '🧠', inputPricePerMillion: P.DEEPSEEK_REASONER_IN, outputPricePerMillion: P.DEEPSEEK_REASONER_OUT, supportsThinking: true },
            { id: 'deepseek-r1-0528', name: MODEL_NAME_DEEPSEEK_R1_0528, icon: '🧠', inputPricePerMillion: P.DEEPSEEK_REASONER_IN, outputPricePerMillion: P.DEEPSEEK_REASONER_OUT, supportsThinking: true },
            { id: 'deepseek-r1-aws', name: MODEL_NAME_DEEPSEEK_R1_AWS, icon: '☁️', inputPricePerMillion: P.DEEPSEEK_REASONER_IN, outputPricePerMillion: P.DEEPSEEK_REASONER_OUT, supportsThinking: true },
            { id: 'deepseek-v3.1', name: MODEL_NAME_DEEPSEEK_V31, icon: '🐋', inputPricePerMillion: P.DEEPSEEK_CHAT_IN, outputPricePerMillion: P.DEEPSEEK_CHAT_OUT },
            { id: 'gemini-2.5-flash', name: MODEL_NAME_GEMINI_25_FLASH, icon: '✨', inputPricePerMillion: P.GEMINI_FLASH_IN, outputPricePerMillion: P.GEMINI_FLASH_OUT },
            { id: 'gemini-2.5-pro', name: MODEL_NAME_GEMINI_25_PRO, icon: '🌟', inputPricePerMillion: P.GEMINI_PRO_IN, outputPricePerMillion: P.GEMINI_PRO_OUT },
            { id: 'gpt-4', name: MODEL_NAME_GPT4, icon: '🧱', inputPricePerMillion: P.GPT4_IN, outputPricePerMillion: P.GPT4_OUT },
            { id: 'gpt-4-32k', name: MODEL_NAME_GPT4_32K, icon: '📦', inputPricePerMillion: P.GPT4_32K_IN, outputPricePerMillion: P.GPT4_32K_OUT },
            { id: 'gpt-4.1', name: MODEL_NAME_GPT41, icon: '🔧', inputPricePerMillion: P.GPT41_IN, outputPricePerMillion: P.GPT41_OUT },
            { id: 'gpt-4.1-mini', name: MODEL_NAME_GPT41_MINI, icon: '🍃', inputPricePerMillion: P.GPT41_MINI_IN, outputPricePerMillion: P.GPT41_MINI_OUT },
            { id: 'gpt-4.1-nano', name: MODEL_NAME_GPT41_NANO, icon: '🧬', inputPricePerMillion: P.GPT41_NANO_IN, outputPricePerMillion: P.GPT41_NANO_OUT },
            { id: 'gpt-4o-mini', name: MODEL_NAME_GPT4O_MINI, icon: '⚡', inputPricePerMillion: P.GPT4O_MINI_IN, outputPricePerMillion: P.GPT4O_MINI_OUT },
            { id: 'gpt-5', name: MODEL_NAME_GPT5, icon: '🚀', inputPricePerMillion: P.GPT_STD_IN, outputPricePerMillion: P.GPT_STD_OUT },
            { id: 'gpt-5-chat', name: MODEL_NAME_GPT5_CHAT, icon: '💬', inputPricePerMillion: P.GPT_STD_IN, outputPricePerMillion: P.GPT_STD_OUT },
            { id: 'gpt-5-codex', name: MODEL_NAME_GPT5_CODEX, icon: '💻', inputPricePerMillion: P.GPT_PRO_IN, outputPricePerMillion: P.GPT_PRO_OUT },
            { id: 'gpt-5-mini', name: MODEL_NAME_GPT5_MINI, icon: '🍃', inputPricePerMillion: P.GPT_MINI_IN, outputPricePerMillion: P.GPT_MINI_OUT },
            { id: 'gpt-5-nano', name: MODEL_NAME_GPT5_NANO, icon: '🧬', inputPricePerMillion: P.GPT_NANO_IN, outputPricePerMillion: P.GPT_NANO_OUT },
            { id: 'gpt-5.1', name: MODEL_NAME_GPT51, icon: '🎯', inputPricePerMillion: P.GPT51_IN, outputPricePerMillion: P.GPT51_OUT },
        ],
    },

    anthropic: {
        id: 'anthropic', isBuiltin: true,
        name: 'Anthropic',
        implementation: 'anthropic',
        baseURL: 'https://api.anthropic.com/v1/messages',
        icon: '🏺',
        supportsThinking: true,
        models: [
            { id: 'claude-opus-4-1-20250805', name: MODEL_NAME_CLAUDE_45_OPUS, icon: '👑', inputPricePerMillion: P.CLAUDE_OPUS_IN, outputPricePerMillion: P.CLAUDE_OPUS_OUT },
            { id: 'claude-sonnet-4-5-20250929', name: MODEL_NAME_CLAUDE_45_SONNET, icon: '🎭', inputPricePerMillion: P.CLAUDE_SONNET_IN, outputPricePerMillion: P.CLAUDE_SONNET_OUT },
            { id: 'claude-haiku-4-5-20251001', name: MODEL_NAME_CLAUDE_45_HAIKU, icon: '🍃', inputPricePerMillion: P.CLAUDE_HAIKU_IN, outputPricePerMillion: P.CLAUDE_HAIKU_OUT },
            { id: 'claude-opus-4-20250514', name: MODEL_NAME_CLAUDE_OPUS_4, icon: '💎', inputPricePerMillion: P.CLAUDE_OPUS_IN, outputPricePerMillion: P.CLAUDE_OPUS_OUT },
            { id: 'claude-sonnet-4-20250514', name: MODEL_NAME_CLAUDE_SONNET_4, icon: '🎨', inputPricePerMillion: P.CLAUDE_SONNET_IN, outputPricePerMillion: P.CLAUDE_SONNET_OUT },
            { id: 'claude-3-7-sonnet-latest', name: MODEL_NAME_CLAUDE_37_SONNET_LATEST, icon: '🔥', inputPricePerMillion: P.CLAUDE_SONNET_IN, outputPricePerMillion: P.CLAUDE_SONNET_OUT },
            { id: 'claude-3-7-sonnet-20250219', name: MODEL_NAME_CLAUDE_37_SONNET, icon: '⚡', inputPricePerMillion: P.CLAUDE_SONNET_IN, outputPricePerMillion: P.CLAUDE_SONNET_OUT },
        ],
    },

    gemini: {
        id: 'gemini', isBuiltin: true,
        name: 'Google Gemini',
        implementation: 'gemini',
        baseURL: 'https://generativelanguage.googleapis.com/v1beta/models',
        icon: '💎',
        supportsThinking: true,
        models: [
            { id: 'gemini-2.5-pro', name: MODEL_NAME_GEMINI_25_PRO, icon: '🌟', inputPricePerMillion: P.GEMINI_PRO_IN, outputPricePerMillion: P.GEMINI_PRO_OUT },
            { id: 'gemini-2.5-flash', name: MODEL_NAME_GEMINI_25_FLASH, icon: '⚡', inputPricePerMillion: P.GEMINI_FLASH_IN, outputPricePerMillion: P.GEMINI_FLASH_OUT },
            { id: 'gemini-pro', name: MODEL_NAME_GEMINI_PRO, icon: '🌌', inputPricePerMillion: P.GEMINI_LEGACY_IN, outputPricePerMillion: P.GEMINI_LEGACY_OUT },
        ],
    },

    deepseek: {
        id: 'deepseek', isBuiltin: true,
        name: 'DeepSeek',
        implementation: 'openai-compatible',
        baseURL: 'https://api.deepseek.com/v1/chat/completions',
        icon: '🐋',
        supportsThinking: true,
        models: [
            { id: 'deepseek-v4-pro', name: MODEL_NAME_DEEPSEEK_V4_PRO, icon: '👑', inputPricePerMillion: P.DEEPSEEK_REASONER_IN, outputPricePerMillion: P.DEEPSEEK_REASONER_OUT, supportsThinking: true },
            { id: 'deepseek-v4-flash', name: MODEL_NAME_DEEPSEEK_V4_FLASH, icon: '⚡', inputPricePerMillion: P.DEEPSEEK_CHAT_IN, outputPricePerMillion: P.DEEPSEEK_CHAT_OUT },
            { id: 'deepseek-reasoner', name: MODEL_NAME_DEEPSEEK_REASONER, icon: '🧠', inputPricePerMillion: P.DEEPSEEK_REASONER_IN, outputPricePerMillion: P.DEEPSEEK_REASONER_OUT, supportsThinking: true },
            { id: 'deepseek-chat', name: MODEL_NAME_DEEPSEEK_CHAT, icon: '💬', inputPricePerMillion: P.DEEPSEEK_CHAT_IN, outputPricePerMillion: P.DEEPSEEK_CHAT_OUT },
        ],
    },

    openrouter: {
        id: 'openrouter', isBuiltin: true,
        name: 'OpenRouter',
        implementation: 'openai-compatible',
        baseURL: 'https://openrouter.ai/api/v1/chat/completions',
        icon: '🌐',
        requiresReferer: true,
        supportsThinking: true,
        models: [
            { id: 'openrouter/auto', name: MODEL_NAME_OPENROUTER_AUTO, icon: '🪄' },
            { id: 'openai/gpt-5-pro', name: MODEL_NAME_GPT52, icon: '👑', inputPricePerMillion: P.GPT_PRO_IN, outputPricePerMillion: P.GPT_PRO_OUT },
            { id: 'openai/gpt-5-codex', name: MODEL_NAME_GPT5_CODEX, icon: '💻', inputPricePerMillion: P.GPT_PRO_IN, outputPricePerMillion: P.GPT_PRO_OUT },
            { id: 'openai/gpt-5-mini', name: MODEL_NAME_GPT5_MINI, icon: '🍃', inputPricePerMillion: P.GPT_MINI_IN, outputPricePerMillion: P.GPT_MINI_OUT },
            { id: 'anthropic/claude-sonnet-4.5', name: MODEL_NAME_CLAUDE_45_SONNET, icon: '🎭', inputPricePerMillion: P.CLAUDE_SONNET_IN, outputPricePerMillion: P.CLAUDE_SONNET_OUT },
            { id: 'anthropic/claude-opus-4.1', name: MODEL_NAME_CLAUDE_45_OPUS, icon: '👑', inputPricePerMillion: P.CLAUDE_OPUS_IN, outputPricePerMillion: P.CLAUDE_OPUS_OUT },
            { id: 'google/gemini-2.5-pro', name: MODEL_NAME_GEMINI_3_PRO, icon: '🌟', inputPricePerMillion: P.GEMINI_PRO_IN, outputPricePerMillion: P.GEMINI_PRO_OUT },
            { id: 'google/gemini-2.5-flash', name: MODEL_NAME_GEMINI_3_FLASH, icon: '⚡', inputPricePerMillion: P.GEMINI_FLASH_IN, outputPricePerMillion: P.GEMINI_FLASH_OUT },
            { id: 'meta-llama/llama-4-maverick', name: MODEL_NAME_META_LLAMA4_MAVERICK, icon: '🦙', inputPricePerMillion: P.LLAMA4_MAVERICK_IN, outputPricePerMillion: P.LLAMA4_MAVERICK_OUT },
            { id: 'nousresearch/hermes-4-405b', name: MODEL_NAME_NOUS_HERMES4_405B, icon: '🧪', inputPricePerMillion: P.HERMES4_405B_IN, outputPricePerMillion: P.HERMES4_405B_OUT },
            { id: 'mistralai/mistral-large-2411', name: MODEL_NAME_MISTRAL_LARGE_2411, icon: '⛵', inputPricePerMillion: P.MISTRAL_LARGE_IN, outputPricePerMillion: P.MISTRAL_LARGE_OUT },
            { id: 'z-ai/glm-4.6', name: MODEL_NAME_ZAI_GLM46, icon: '🌏', inputPricePerMillion: P.GLM46_IN, outputPricePerMillion: P.GLM46_OUT },
            { id: 'x-ai/grok-4', name: MODEL_NAME_XAI_GROK4, icon: '🏴‍☠️', inputPricePerMillion: P.GROK4_IN, outputPricePerMillion: P.GROK4_OUT },
        ],
    },

    cloudapi: {
        id: 'cloudapi', isBuiltin: true,
        name: 'CloudAPI',
        implementation: 'openai-compatible',
        baseURL: 'https://chat.cloudapi.vip/v1/chat/completions',
        icon: '☁️',
        supportsThinking: true,
        models: [
            { id: 'claude-opus-4-6-thinking', name: MODEL_NAME_CLAUDE_46_OPUS_THINKING, icon: '👑', inputPricePerMillion: P.CLAUDE_OPUS_IN, outputPricePerMillion: P.CLAUDE_OPUS_OUT },
            { id: 'gemini-3.1-pro-preview', name: MODEL_NAME_GEMINI_31_PRO, icon: '💫', inputPricePerMillion: P.GEMINI_PRO_IN, outputPricePerMillion: P.GEMINI_PRO_OUT },
            { id: 'gemini-3-pro-thinking', name: MODEL_NAME_GEMINI_3_PRO, icon: '💫', inputPricePerMillion: P.GEMINI_PRO_IN, outputPricePerMillion: P.GEMINI_PRO_OUT },
            { id: 'claude-sonnet-4-6-thinking', name: MODEL_NAME_CLAUDE_46_SONNET, icon: '🎭', inputPricePerMillion: P.CLAUDE_SONNET_IN, outputPricePerMillion: P.CLAUDE_SONNET_OUT },
            { id: 'gemini-3-flash-preview', name: MODEL_NAME_GEMINI_3_FLASH, icon: '⚡', inputPricePerMillion: P.GEMINI_FLASH_IN, outputPricePerMillion: P.GEMINI_FLASH_OUT },
            { id: 'claude-opus-4-6', name: MODEL_NAME_CLAUDE_46_OPUS, icon: '👑', inputPricePerMillion: P.CLAUDE_OPUS_IN, outputPricePerMillion: P.CLAUDE_OPUS_OUT },
            { id: 'claude-opus-4-5-20251101', name: MODEL_NAME_CLAUDE_45_OPUS, icon: '👑', inputPricePerMillion: P.CLAUDE_OPUS_IN, outputPricePerMillion: P.CLAUDE_OPUS_OUT },
            { id: 'claude-haiku-4-5-20251001-r', name: MODEL_NAME_CLAUDE_45_HAIKU, icon: '🍃', inputPricePerMillion: P.CLAUDE_HAIKU_IN, outputPricePerMillion: P.CLAUDE_HAIKU_OUT },
            { id: 'gpt-5.2', name: MODEL_NAME_GPT52, icon: '✨', inputPricePerMillion: P.GPT_PRO_IN, outputPricePerMillion: P.GPT_PRO_OUT },
            { id: 'gpt-5.1-high', name: MODEL_NAME_GPT51H, icon: '🤖', inputPricePerMillion: P.GPT51_IN, outputPricePerMillion: P.GPT51_OUT },
            { id: 'deepseek-v3.2', name: MODEL_NAME_DEEPSEEK_R1, icon: '🧠', inputPricePerMillion: P.DEEPSEEK_REASONER_IN, outputPricePerMillion: P.DEEPSEEK_REASONER_OUT, supportsThinking: true },
        ],
    },

    openai: {
        id: 'openai', isBuiltin: true,
        name: 'OpenAI',
        implementation: 'openai-compatible',
        baseURL: 'https://api.openai.com/v1/chat/completions',
        icon: '🤖',
        supportsThinking: true,
        models: [
            { id: 'gpt-5-pro', name: MODEL_NAME_GPT52, icon: '👑', inputPricePerMillion: P.GPT_PRO_IN, outputPricePerMillion: P.GPT_PRO_OUT },
            { id: 'gpt-5', name: MODEL_NAME_GPT5, icon: '🚀', inputPricePerMillion: P.GPT_STD_IN, outputPricePerMillion: P.GPT_STD_OUT },
            { id: 'gpt-5-mini', name: MODEL_NAME_GPT5_MINI, icon: '🍃', inputPricePerMillion: P.GPT_MINI_IN, outputPricePerMillion: P.GPT_MINI_OUT },
            { id: 'gpt-5-codex', name: MODEL_NAME_GPT5_CODEX, icon: '💻', inputPricePerMillion: P.GPT_PRO_IN, outputPricePerMillion: P.GPT_PRO_OUT },
            { id: 'gpt-4o', name: MODEL_NAME_GPT4O, icon: '⚡', inputPricePerMillion: P.GPT4O_IN, outputPricePerMillion: P.GPT4O_OUT },
        ],
    },

    custom: {
        id: 'custom', isBuiltin: true,
        name: 'Custom (OpenAI Compatible)',
        implementation: 'openai-compatible',
        baseURL: '',
        icon: '🛠️',
        models: [],
    },
};

/** @deprecated 请使用 LLM_PROVIDERS */
export const LLM_PROVIDER_DEFAULTS = LLM_PROVIDERS;

export function getProviderDefinition(provider: string): LLMProvider | undefined {
    return LLM_PROVIDERS[provider];
}

export function getModelDefinition(provider: string, modelId: string) {
    return LLM_PROVIDERS[provider]?.models.find(m => m.id === modelId);
}
