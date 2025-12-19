// @file: llm-driver/providers/registry.ts

import { BaseProvider } from './base';
import { OpenAIProvider } from './openai';
import { AnthropicProvider } from './anthropic';
import { GeminiProvider } from './gemini';
import { LLMProviderConfig, LLMProviderDefinition } from '../types';
import { LLM_PROVIDER_DEFAULTS } from '../constants';

/**
 * Provider 构造函数类型
 */
type ProviderConstructor = new (config: LLMProviderConfig) => BaseProvider;

/**
 * Provider 注册表
 */
const providerRegistry = new Map<string, ProviderConstructor>();

/**
 * 注册内置 Providers
 */
function registerBuiltinProviders(): void {
    // OpenAI Compatible
    providerRegistry.set('openai', OpenAIProvider);
    providerRegistry.set('deepseek', OpenAIProvider);
    providerRegistry.set('groq', OpenAIProvider);
    providerRegistry.set('openrouter', OpenAIProvider);
    providerRegistry.set('ollama', OpenAIProvider);
    providerRegistry.set('custom', OpenAIProvider);
    
    // Anthropic
    providerRegistry.set('anthropic', AnthropicProvider);
    
    // Google Gemini
    providerRegistry.set('gemini', GeminiProvider);
}

// 初始化
registerBuiltinProviders();

/**
 * 注册自定义 Provider
 */
export function registerProvider(name: string, constructor: ProviderConstructor): void {
    providerRegistry.set(name, constructor);
}

/**
 * 获取 Provider 构造函数
 */
export function getProvider(name: string): ProviderConstructor | undefined {
    return providerRegistry.get(name);
}

/**
 * 创建 Provider 实例
 */
export function createProvider(
    config: LLMProviderConfig,
    customDefaults?: Record<string, LLMProviderDefinition>
): BaseProvider {
    const { provider } = config;
    
    // 1. 查找 Provider 定义
    const definition = customDefaults?.[provider] || LLM_PROVIDER_DEFAULTS[provider];
    
    // 2. 根据实现类型选择 Provider
    let ProviderClass: ProviderConstructor | undefined;
    
    if (definition) {
        switch (definition.implementation) {
            case 'openai-compatible':
                ProviderClass = OpenAIProvider;
                break;
            case 'anthropic':
                ProviderClass = AnthropicProvider;
                break;
            case 'gemini':
                ProviderClass = GeminiProvider;
                break;
        }
        
        // 合并能力配置
        config = {
            ...config,
            supportsThinking: config.supportsThinking ?? definition.supportsThinking,
            requiresReferer: config.requiresReferer ?? definition.requiresReferer,
            apiBaseUrl: config.apiBaseUrl || definition.baseURL
        };
    }
    
    // 3. 回退到注册表
    if (!ProviderClass) {
        ProviderClass = providerRegistry.get(provider);
    }
    
    // 4. 最终回退到 OpenAI Compatible
    if (!ProviderClass) {
        console.warn(`[LLMDriver] Unknown provider "${provider}", using OpenAI compatible mode`);
        ProviderClass = OpenAIProvider;
    }
    
    return new ProviderClass(config);
}

/**
 * 获取所有已注册的 Provider 名称
 */
export function getRegisteredProviders(): string[] {
    return Array.from(providerRegistry.keys());
}

/**
 * 检查 Provider 是否已注册
 */
export function isProviderRegistered(name: string): boolean {
    return providerRegistry.has(name);
}
