// @file: llmdriver/providers/registry.ts

import { BaseProvider } from './base';
import { OpenAICompatibleProvider } from './openai';
import { AnthropicProvider } from './anthropic';
import { GeminiProvider } from './gemini';
import { LLMProviderConfig } from '../types';
import { LLM_PROVIDER_DEFAULTS } from '../constants';

const IMPLEMENTATIONS: Record<string, new (config: LLMProviderConfig) => BaseProvider> = {
    'openai-compatible': OpenAICompatibleProvider,
    'anthropic': AnthropicProvider,
    'gemini': GeminiProvider,
};

export function createProvider(config: LLMProviderConfig, customDefaults: Record<string, any> = {}): BaseProvider {
    const defaults = { ...LLM_PROVIDER_DEFAULTS, ...customDefaults };
    const providerDef = defaults[config.provider];

    if (!providerDef) {
        throw new Error(`Provider '${config.provider}' is not supported.`);
    }

    const implType = providerDef.implementation;
    const ProviderClass = IMPLEMENTATIONS[implType];

    if (!ProviderClass) {
        throw new Error(`Implementation '${implType}' not found.`);
    }

    // Merge config
    const finalConfig: LLMProviderConfig = {
        ...config,
        apiBaseUrl: config.apiBaseUrl || providerDef.baseURL,
        supportsThinking: providerDef.supportsThinking || false,
    };
    
    // Add extra headers for specific providers
    if (providerDef.requiresReferer) {
        finalConfig.headers = {
            ...finalConfig.headers,
            'HTTP-Referer': typeof window !== 'undefined' ? window.location.origin : 'https://itookit.io',
            'X-Title': 'ITooKit LLM Driver'
        };
    }

    return new ProviderClass(finalConfig);
}
