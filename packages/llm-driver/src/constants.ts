// @file: llm-driver/constants.ts

import { LLMProviderDefinition } from './types';

/**
 * 默认连接 ID
 */
export const LLM_DEFAULT_ID = 'default';
export const LLM_DEFAULT_NAME = '默认';

/**
 * 默认超时时间 (ms)
 */
export const DEFAULT_TIMEOUT = 60000;

/**
 * 默认最大重试次数
 */
export const DEFAULT_MAX_RETRIES = 3;

/**
 * 默认重试延迟 (ms)
 */
export const DEFAULT_RETRY_DELAY = 1000;

/**
 * Provider 默认配置
 */
export const LLM_PROVIDER_DEFAULTS: Record<string, LLMProviderDefinition> = {
    rdsec: {
        name: "RDSec",
        implementation: 'openai-compatible',
        baseURL: 'https://api.rdsec.trendmicro.com/prod/aiendpoint/v1/chat/completions',
        icon: '🛡️',
        supportsThinking: true,
        models: [
            { id: 'claude-4.5-opus', name: 'Claude 4.5 Opus', icon: '👑' },
            { id: 'claude-4.5-sonnet', name: 'Claude 4.5 Sonnet', icon: '🎭' },
            { id: 'gpt-4o', name: 'GPT-4o (OpenAI)', icon: '🤖' },
            { id: 'claude-3-haiku', name: 'Claude 3 Haiku', icon: '📜' },
            { id: 'claude-3.5-sonnet', name: 'Claude 3.5 Sonnet', icon: '🎭' },
            { id: 'claude-3.5-sonnet-v2', name: 'Claude 3.5 Sonnet v2', icon: '🎭' },
            { id: 'claude-3.7-sonnet', name: 'Claude 3.7 Sonnet', icon: '⚡' },
            { id: 'claude-4-opus', name: 'Claude 4 Opus', icon: '💎' },
            { id: 'claude-4-sonnet', name: 'Claude 4 Sonnet', icon: '🏺' },
            { id: 'claude-4.1-opus', name: 'Claude 4.1 Opus', icon: '🏰' },
            { id: 'claude-4.5-haiku', name: 'Claude 4.5 Haiku', icon: '🍃' },
            { id: 'deepseek-r1', name: 'DeepSeek R1', icon: '🧠', supportsThinking: true },
            { id: 'deepseek-r1-0528', name: 'DeepSeek R1 0528', icon: '🧠', supportsThinking: true },
            { id: 'deepseek-r1-aws', name: 'DeepSeek R1 AWS', icon: '☁️', supportsThinking: true },
            { id: 'deepseek-v3.1', name: 'DeepSeek v3.1', icon: '🐋' },
            { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', icon: '✨' },
            { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', icon: '🌟' },
            { id: 'gpt-4', name: 'GPT-4', icon: '🧱' },
            { id: 'gpt-4-32k', name: 'GPT-4 32k', icon: '📦' },
            { id: 'gpt-4.1', name: 'GPT-4.1', icon: '🔧' },
            { id: 'gpt-4.1-mini', name: 'GPT-4.1 Mini', icon: '🍃' },
            { id: 'gpt-4.1-nano', name: 'GPT-4.1 Nano', icon: '🧬' },
            { id: 'gpt-4o-mini', name: 'GPT-4o Mini', icon: '⚡' },
            { id: 'gpt-5', name: 'GPT-5', icon: '🚀' },
            { id: 'gpt-5-chat', name: 'GPT-5 Chat', icon: '💬' },
            { id: 'gpt-5-codex', name: 'GPT-5 Codex', icon: '💻' },
            { id: 'gpt-5-mini', name: 'GPT-5 Mini', icon: '🍃' },
            { id: 'gpt-5-nano', name: 'GPT-5 Nano', icon: '🧬' },
        ]
    },
    anthropic: {
        name: 'Anthropic',
        implementation: 'anthropic',
        baseURL: 'https://api.anthropic.com/v1/messages',
        icon: '🏺',
        supportsThinking: true,
        models: [
            { id: 'claude-sonnet-4-5-20250929', name: 'Claude Sonnet 4.5', icon: '🎭' },
            { id: 'claude-opus-4-1-20250805', name: 'Claude Opus 4.1', icon: '👑' },
            { id: 'claude-opus-4-20250514', name: 'Claude Opus 4', icon: '💎' },
            { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', icon: '🎨' },
            { id: 'claude-3-7-sonnet-latest', name: 'Claude Sonnet 3.7 (Latest)', icon: '🔥' },
            { id: 'claude-3-7-sonnet-20250219', name: 'Claude Sonnet 3.7', icon: '⚡' },
        ]
    },
    
    gemini: {
        name: 'Google Gemini',
        implementation: 'gemini',
        baseURL: 'https://generativelanguage.googleapis.com/v1beta/models',
        icon: '💎',
        supportsThinking: true,
        models: [
            { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', icon: '🌟' },
            { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', icon: '⚡' },
            { id: 'gemini-pro', name: 'Gemini Pro', icon: '🌌' },
        ]
    },
    
    deepseek: {
        name: 'DeepSeek',
        implementation: 'openai-compatible',
        baseURL: 'https://api.deepseek.com/v1/chat/completions',
        icon: '🐋',
        supportsThinking: true,
        models: [
            { id: 'deepseek-chat', name: 'DeepSeek Chat', icon: '💬' },
            { id: 'deepseek-reasoner', name: 'DeepSeek Reasoner', icon: '🧠', supportsThinking: true }
        ]
    },
    'deepseek-Speciale': {
        name: "DeepSeek-Speciale",
        implementation: 'openai-compatible',
        baseURL: 'https://api.deepseek.com/v3.2_speciale_expires_on_20251215/v1/chat/completions',
        icon: '✨',
        supportsThinking: true,
        models: [
            { id: 'deepseek-reasoner', name: 'DeepSeek Reasoner', icon: '🧠', supportsThinking: true }
        ]
    },

    openrouter: {
        name: 'OpenRouter',
        implementation: 'openai-compatible',
        baseURL: 'https://openrouter.ai/api/v1/chat/completions',
        icon: '🌐',
        requiresReferer: true,
        supportsThinking: true,
        models: [
            { id: 'openrouter/auto', name: 'Auto (Best Model)', icon: '🪄' },
            
            // --- OpenAI Models via OpenRouter ---
            { id: 'openai/gpt-5-pro', name: 'OpenAI: GPT-5 Pro', icon: '👑' },
            { id: 'openai/gpt-5-codex', name: 'OpenAI: GPT-5 Codex', icon: '💻' },
            { id: 'openai/gpt-5-mini', name: 'OpenAI: GPT-5 Mini', icon: '🍃' },
            
            // --- Anthropic Models via OpenRouter ---
            { id: 'anthropic/claude-sonnet-4.5', name: 'Anthropic: Claude Sonnet 4.5', icon: '🎭' },
            { id: 'anthropic/claude-opus-4.1', name: 'Anthropic: Claude Opus 4.1', icon: '👑' },
            
            // --- Google Models via OpenRouter ---
            { id: 'google/gemini-2.5-pro', name: 'Google: Gemini 2.5 Pro', icon: '🌟' },
            { id: 'google/gemini-2.5-flash', name: 'Google: Gemini 2.5 Flash', icon: '⚡' },

            // --- Other Top Models from the List ---
            { id: 'meta-llama/llama-4-maverick', name: 'Meta: Llama 4 Maverick', icon: '🦙' },
            { id: 'nousresearch/hermes-4-405b', name: 'Nous: Hermes 4 405B', icon: '🧪' },
            { id: 'mistralai/mistral-large-2411', name: 'Mistral: Mistral Large 2411', icon: '⛵' },
            { id: 'z-ai/glm-4.6', name: 'Z.AI: GLM 4.6', icon: '🌏' },
            { id: 'x-ai/grok-4', name: 'xAI: Grok 4', icon: '🏴‍☠️' }
        ]
    },
    cloudapi: {
        name: "CloudAPI",
        implementation: 'openai-compatible',
        baseURL: 'https://chat.cloudapi.vip/v1/chat/completions',
        supportsThinking: true,
        icon: '☁️',
        models: [
            { id: 'claude-opus-4-5-20251101', name: 'Opus 4.5', icon: '👑' },
            { id: 'claude-sonnet-4-5-20250929-thinking', name: 'Sonnet 4.5 Think', icon: '🧠', supportsThinking: true },
        ]
    },
    	
    openai: {
        name: 'OpenAI',
        implementation: 'openai-compatible',
        baseURL: 'https://api.openai.com/v1/chat/completions',
        icon: '🤖',
        supportsThinking: true,
        models: [
            { id: 'gpt-4o', name: 'GPT-4o', icon: '⚡' },
            { id: 'gpt-5-pro', name: 'GPT-5 Pro', icon: '👑' },
            { id: 'gpt-5', name: 'GPT-5', icon: '🚀' },
            { id: 'gpt-5-mini', name: 'GPT-5 Mini', icon: '🍃' },
            { id: 'gpt-5-codex', name: 'GPT-5 CodeX', icon: '💻' },
        ]
    },
        
    custom: {
        name: 'Custom (OpenAI Compatible)',
        implementation: 'openai-compatible',
        baseURL: '',
        icon: '🛠️',
        models: []
    }
};

/**
 * 获取 Provider 定义
 */
export function getProviderDefinition(provider: string): LLMProviderDefinition | undefined {
    return LLM_PROVIDER_DEFAULTS[provider];
}

/**
 * 获取模型定义
 */
export function getModelDefinition(provider: string, modelId: string): import('./types').LLMModel | undefined {
    const providerDef = LLM_PROVIDER_DEFAULTS[provider];
    return providerDef?.models.find(m => m.id === modelId);
}
