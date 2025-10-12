
/**
 * @file #llm/llmProvider.js
 * @description Single source of truth for LLM provider static metadata.
 * This includes default URLs, recommended models, etc., to be consumed
 * by both the core library and the settings UI.
 */

export const PROVIDER_DEFAULTS = {
    openai: {
        name: "OpenAI",
        baseURL: 'https://api.openai.com/v1/chat/completions',
        models: [
            { id: 'gpt-5-pro', name: 'GPT-5 Pro' },
            { id: 'gpt-5', name: 'GPT-5' },
            { id: 'gpt-5-mini', name: 'GPT-5 Mini' },
            { id: 'gpt-5-codex', name: 'GPT-5 CodeX' },
            { id: 'gpt-4.1', name: 'GPT-4.1' },
        ]
    },
    anthropic: {
        name: "Anthropic (Claude)",
        baseURL: 'https://api.anthropic.com/v1/messages',
        models: [
            { id: 'claude-opus-4-1-20250805', name: 'Claude Opus 4.1' },
            { id: 'claude-opus-4-20250514', name: 'Claude Opus 4' },
            { id: 'claude-sonnet-4-5-20250929', name: 'Claude Sonnet 4.5' },
            { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4' },
            { id: 'claude-3-7-sonnet-latest', name: 'Claude Sonnet 3.7 (Latest)' },
            { id: 'claude-3-7-sonnet-20250219', name: 'Claude Sonnet 3.7' },
        ]
    },
    gemini: {
        name: "Google Gemini",
        // Gemini's URL is model-specific, so we provide a template or base.
        // The provider logic will handle appending the model.
        baseURL: `https://generativelanguage.googleapis.com/v1beta/models`,
        models: [
            { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro' },
            { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
            { id: 'gemini-pro', name: 'Gemini Pro' },
        ]
    },
    deepseek: {
        name: "DeepSeek",
        baseURL: 'https://api.deepseek.com/v1/chat/completions',
        models: [
            { id: 'deepseek-v3.2-exp', name: 'DeepSeek V3.2 Exp' },
            { id: 'deepseek-v3.1-terminus', name: 'DeepSeek V3.1 Terminus' },
            { id: 'deepseek-chat', name: 'DeepSeek Chat' },
            { id: 'deepseek-coder', name: 'DeepSeek Coder' },
        ]
    },
    openrouter: {
        name: "OpenRouter",
        baseURL: 'https://openrouter.ai/api/v1/chat/completions',
        models: [
            // --- Auto Router ---
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
    custom_openai_compatible: {
        name: "Custom (OpenAI Compatible)",
        baseURL: '', // User must provide this
        models: [] // User must add their own models
    }
};
