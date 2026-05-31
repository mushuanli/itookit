// @file: device-llm/constants/providers.ts
// Layer 1 — Provider 目录（云提供商定义 + 模型 catalog）。
// 职责：持有 apiKey + 模型目录，是认证与模型信息的唯一来源。

import type { LLMProvider } from '@itookit/common';
import { externalProviders } from './llm-configs';

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

    // Doubao 系列 (人民币价格按 ~7.2 汇率折算 USD)
    // 豆包视觉模型极便宜，1.6-vision: ¥0.0008/千输入 ≈ $0.11/百万
    DOUBAO_VISION_IN: 0.11, DOUBAO_VISION_OUT: 0.28,
    DOUBAO_PRO_IN: 0.08, DOUBAO_PRO_OUT: 0.28,
    DOUBAO_LITE_IN: 0.04, DOUBAO_LITE_OUT: 0.14,
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

// Volcengine / Doubao
export const MODEL_NAME_DOUBAO_SEED_20_PRO = 'Doubao Seed 2.0 Pro';
export const MODEL_NAME_DOUBAO_SEED_20_LITE = 'Doubao Seed 2.0 Lite';
export const MODEL_NAME_DOUBAO_SEED_20_MINI = 'Doubao Seed 2.0 Mini';
export const MODEL_NAME_DOUBAO_SEED_20_CODE = 'Doubao Seed 2.0 Code';
// Volcengine / Doubao — 图片生成 (Seedream) / 视频生成 (Seedance)
export const MODEL_NAME_DOUBAO_SEEDREAM_50 = 'Doubao Seedream 5.0';
export const MODEL_NAME_DOUBAO_SEEDREAM_45 = 'Doubao Seedream 4.5';
export const MODEL_NAME_DOUBAO_SEEDANCE_20 = 'Doubao Seedance 2.0';
export const MODEL_NAME_DOUBAO_SEEDANCE_20_FAST = 'Doubao Seedance 2.0 Fast';

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
    // External providers loaded from .llm configs
    ...externalProviders,

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

    volcengine: {
        id: 'volcengine', isBuiltin: true,
        name: 'Volcengine (火山方舟)',
        implementation: 'openai-compatible',
        baseURL: 'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
        icon: '🌋',
        capabilities: {
            vision: true,
            audioInput: false,
            audioOutput: false,
            tools: true,
            thinking: true,
            streaming: true,
        },
        models: [
            // Seed-2.0 系列：对话 + 多模态视觉 + 工具调用 + 深度思考
            { id: 'doubao-seed-2-0-pro-260215', name: MODEL_NAME_DOUBAO_SEED_20_PRO, icon: '👑', category: 'chat', inputPricePerMillion: P.DOUBAO_VISION_IN, outputPricePerMillion: P.DOUBAO_VISION_OUT, supportsThinking: true, supportsVision: true, supportsTools: true },
            { id: 'doubao-seed-2-0-lite-260428', name: MODEL_NAME_DOUBAO_SEED_20_LITE, icon: '⚡', category: 'chat', inputPricePerMillion: P.DOUBAO_LITE_IN, outputPricePerMillion: P.DOUBAO_LITE_OUT, supportsThinking: true, supportsVision: true, supportsTools: true },
            { id: 'doubao-seed-2-0-mini-260428', name: MODEL_NAME_DOUBAO_SEED_20_MINI, icon: '🍃', category: 'chat', inputPricePerMillion: P.DOUBAO_LITE_IN, outputPricePerMillion: P.DOUBAO_LITE_OUT, supportsThinking: true, supportsVision: true, supportsTools: true },
            // Seed-2.0 Code：对话 + 工具调用（代码增强）
            { id: 'doubao-seed-2-0-code-preview-260215', name: MODEL_NAME_DOUBAO_SEED_20_CODE, icon: '💻', category: 'chat', inputPricePerMillion: P.DOUBAO_PRO_IN, outputPricePerMillion: P.DOUBAO_PRO_OUT, supportsTools: true },
            // DeepSeek-V4 系列：对话 + 深度思考 + 工具调用（纯文本推理）
            { id: 'deepseek-v4-pro-260425', name: MODEL_NAME_DEEPSEEK_V4_PRO, icon: '🧠', category: 'chat', inputPricePerMillion: P.DOUBAO_PRO_IN, outputPricePerMillion: P.DOUBAO_PRO_OUT, supportsThinking: true, supportsTools: true },
            { id: 'deepseek-v4-flash-260425', name: MODEL_NAME_DEEPSEEK_V4_FLASH, icon: '🚀', category: 'chat', inputPricePerMillion: P.DOUBAO_LITE_IN, outputPricePerMillion: P.DOUBAO_LITE_OUT, supportsThinking: true, supportsTools: true },
            // 文生图 (Seedream)：按张计费，走 images/generations 端点（非 chat/completions）
            { id: 'doubao-seedream-5-0-260128', name: MODEL_NAME_DOUBAO_SEEDREAM_50, icon: '🎨', category: 'image' },
            { id: 'doubao-seedream-4-5-251128', name: MODEL_NAME_DOUBAO_SEEDREAM_45, icon: '🖼️', category: 'image' },
            // 视频生成 (Seedance)：按时长计费，走异步任务端点（非 chat/completions）
            { id: 'doubao-seedance-2-0-260128', name: MODEL_NAME_DOUBAO_SEEDANCE_20, icon: '🎬', category: 'video' },
            { id: 'doubao-seedance-2-0-fast-260128', name: MODEL_NAME_DOUBAO_SEEDANCE_20_FAST, icon: '⚡', category: 'video' },
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
