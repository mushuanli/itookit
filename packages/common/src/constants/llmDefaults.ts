/**
 * @file packages/common/src/constants/llmDefaults.ts
 * @description LLM 提供商的默认配置注册表。
 */

import { LLMProviderDefinition } from '../interfaces/llm/ILLM';

export const LLM_PROVIDER_DEFAULTS: Record<string, LLMProviderDefinition> = {
    openai: {
        name: "OpenAI",
        implementation: 'openai-compatible',
        baseURL: 'https://api.openai.com/v1/chat/completions',
        supportsThinking: true,
        models: [
            { id: 'gpt-4o', name: 'GPT-4o' },
            { id: 'gpt-5-pro', name: 'GPT-5 Pro' },
            { id: 'gpt-5', name: 'GPT-5' },
            { id: 'gpt-5-mini', name: 'GPT-5 Mini' },
            { id: 'gpt-5-codex', name: 'GPT-5 CodeX' },
        ]
    },
    rdsec: {
        name: "RDSec",
        implementation: 'openai-compatible',
        baseURL: 'https://api.rdsec.trendmicro.com/prod/aiendpoint/v1/chat/completions',
        supportsThinking: true,
        models: [
            { id: 'claude-4.5-opus', name: 'Claude 4.5 Opus' },
            { id: 'claude-4.5-sonnet', name: 'Claude 4.5 Sonnet' },
            { id: 'gpt-4o', name: 'GPT-4o (OpenAI)' },
            { id: 'claude-3-haiku', name: 'Claude 3 Haiku' },
            { id: 'claude-3.5-sonnet', name: 'Claude 3.5 Sonnet' },
            { id: 'claude-3.5-sonnet-v2', name: 'Claude 3.5 Sonnet v2' },
            { id: 'claude-3.7-sonnet', name: 'Claude 3.7 Sonnet' },
            { id: 'claude-4-opus', name: 'Claude 4 Opus' },
            { id: 'claude-4-sonnet', name: 'Claude 4 Sonnet' },
            { id: 'claude-4.1-opus', name: 'Claude 4.1 Opus' },
            { id: 'claude-4.5-haiku', name: 'Claude 4.5 Haiku' },
            { id: 'deepseek-r1', name: 'DeepSeek R1' },
            { id: 'deepseek-r1-0528', name: 'DeepSeek R1 0528' },
            { id: 'deepseek-r1-aws', name: 'DeepSeek R1 AWS' },
            { id: 'deepseek-v3.1', name: 'DeepSeek v3.1' },
            { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
            { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro' },
            { id: 'gpt-4', name: 'GPT-4' },
            { id: 'gpt-4-32k', name: 'GPT-4 32k' },
            { id: 'gpt-4.1', name: 'GPT-4.1' },
            { id: 'gpt-4.1-mini', name: 'GPT-4.1 Mini' },
            { id: 'gpt-4.1-nano', name: 'GPT-4.1 Nano' },
            { id: 'gpt-4o-mini', name: 'GPT-4o Mini' },
            { id: 'gpt-5', name: 'GPT-5' },
            { id: 'gpt-5-chat', name: 'GPT-5 Chat' },
            { id: 'gpt-5-codex', name: 'GPT-5 Codex' },
            { id: 'gpt-5-mini', name: 'GPT-5 Mini' },
            { id: 'gpt-5-nano', name: 'GPT-5 Nano' },
        ]
    },
    anthropic: {
        name: "Anthropic (Claude)",
        implementation: 'anthropic', // 改为专用实现
        baseURL: 'https://api.anthropic.com/v1/messages',
        supportsThinking: true,
        models: [
            { id: 'claude-sonnet-4-5-20250929', name: 'Claude Sonnet 4.5' },
            { id: 'claude-opus-4-1-20250805', name: 'Claude Opus 4.1' },
            { id: 'claude-opus-4-20250514', name: 'Claude Opus 4' },
            { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4' },
            { id: 'claude-3-7-sonnet-latest', name: 'Claude Sonnet 3.7 (Latest)' },
            { id: 'claude-3-7-sonnet-20250219', name: 'Claude Sonnet 3.7' },
        ]
    },
    gemini: {
        name: "Google Gemini",
        implementation: 'gemini',
        baseURL: 'https://generativelanguage.googleapis.com/v1beta/models',
        supportsThinking: true,
        models: [
            { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro' },
            { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
            { id: 'gemini-pro', name: 'Gemini Pro' },
        ]
    },
    deepseek: {
        name: "DeepSeek",
        implementation: 'openai-compatible',
        baseURL: 'https://api.deepseek.com/v1/chat/completions',
        supportsThinking: true,
        models: [
            { id: 'deepseek-chat', name: 'DeepSeek Chat' },
            { id: 'deepseek-reasoner', name: 'DeepSeek Reasoner' }
        ]
    },
    openrouter: {
        name: "OpenRouter",
        implementation: 'openai-compatible',
        baseURL: 'https://openrouter.ai/api/v1/chat/completions',
        requiresReferer: true,
        models: [
            { id: 'openrouter/auto', name: 'Auto (Best Model)' },
            
            // --- OpenAI Models via OpenRouter ---
            { id: 'openai/gpt-5-pro', name: 'OpenAI: GPT-5 Pro' },
            { id: 'openai/gpt-5-codex', name: 'OpenAI: GPT-5 Codex' },
            { id: 'openai/gpt-5-mini', name: 'OpenAI: GPT-5 Mini' },
            
            // --- Anthropic Models via OpenRouter ---
            { id: 'anthropic/claude-sonnet-4.5', name: 'Anthropic: Claude Sonnet 4.5' },
            { id: 'anthropic/claude-opus-4.1', name: 'Anthropic: Claude Opus 4.1' },
            
            // --- Google Models via OpenRouter ---
            { id: 'google/gemini-2.5-pro', name: 'Google: Gemini 2.5 Pro' },
            { id: 'google/gemini-2.5-flash', name: 'Google: Gemini 2.5 Flash' },

            // --- Other Top Models from the List ---
            { id: 'meta-llama/llama-4-maverick', name: 'Meta: Llama 4 Maverick' },
            { id: 'nousresearch/hermes-4-405b', name: 'Nous: Hermes 4 405B' },
            { id: 'mistralai/mistral-large-2411', name: 'Mistral: Mistral Large 2411' },
            { id: 'z-ai/glm-4.6', name: 'Z.AI: GLM 4.6' },
            { id: 'x-ai/grok-4', name: 'xAI: Grok 4' }
        ]
    },
    cloudapi: {
        name: "CloudAPI",
        implementation: 'openai-compatible',
        baseURL: 'https://chat.cloudapi.vip/v1/chat/completions',
        models: [
            { id: 'claude-sonnet-4-5-20250929-thinking', name: 'Sonnet 4.5 Think' },
            { id: 'claude-opus-4-5-20251101', name: 'Opus 4.5' }
        ]
    },
    custom_openai_compatible: {
        name: "Custom (OpenAI Compatible)",
        implementation: 'openai-compatible',
        baseURL: '',
        models: []
    }
};

// 预设 connection/agent ID 常量,不可被删除
export const LLM_DEFAULT_ID = 'default';
