// @file: device-llm/providers/registry.ts

import { BaseProvider } from './base';
import { OpenAIProvider } from './openai';
import { ResponsesProvider } from './responses';
import { AnthropicProvider } from './anthropic';
import { GeminiProvider } from './gemini';
import { CodexProvider } from './codex';
import { LLMProviderConfig } from '../types';
import type { LLMProvider } from '@itookit/common';
import { LLM_PROVIDERS } from '../constants';
import type { ApiProtocol } from '@itookit/common';

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
    providerRegistry.set('volcengine', OpenAIProvider);

    // Local Codex CLI
    providerRegistry.set('codex', CodexProvider);

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
 * 按 URL 和 provider 名推断 API 协议类型。
 * Connection.protocol 显式设置时优先；未设置时按此函数推断，向后兼容。
 */
export function resolveProtocol(
    url: string,
    providerName: string,
    explicit?: ApiProtocol,
): ApiProtocol {
    if (explicit) return explicit;

    // URL 推断
    if (url.includes('/anthropic') || url.endsWith('/messages')) return 'anthropic-messages';
    if (url.includes('/chat/completions')) return 'openai-chat';
    if (url.includes('/responses')) return 'openai-responses';
    if (url.includes('generativelanguage') || url.includes('generateContent')) return 'gemini-generate';

    // provider 名回退
    if (providerName === 'anthropic') return 'anthropic-messages';
    if (providerName === 'gemini') return 'gemini-generate';
    return 'openai-chat';
}

/**
 * 创建 Provider 实例。
 *
 * 分发优先级：
 *   1. `config.protocol` 显式指定（ApiProtocol）
 *   2. providerRegistry 按名查找（内置/本地 provider 的权威实现类）
 *   3. Provider 定义中的 `implementation` 字段（未注册的 provider 才走这里）
 *   4. 兜底 OpenAIProvider
 */
export function createProvider(
    config: LLMProviderConfig,
    customDefaults?: Record<string, LLMProvider>
): BaseProvider {
    const { provider } = config;

    // 1. 查找 Provider 定义
    const definition = customDefaults?.[provider] || LLM_PROVIDERS[provider];

    // 2. 按 protocol 字段显式分发（优先级最高）
    let ProviderClass: ProviderConstructor | undefined;

    if (config.protocol) {
        switch (config.protocol) {
            case 'anthropic-messages': ProviderClass = AnthropicProvider; break;
            case 'gemini-generate':    ProviderClass = GeminiProvider;    break;
            case 'openai-chat':        ProviderClass = OpenAIProvider;    break;
            case 'openai-responses':   ProviderClass = ResponsesProvider; break;
        }
    }

    // 3. 注册表按名查找。内置/本地 provider 的实现类由注册表决定，用户保存的
    //    definition 只贡献配置、不改变实现类 —— 例如 codex 始终解析为
    //    CodexProvider，即使用户定义被误标为 openai-compatible。
    if (!ProviderClass) {
        ProviderClass = providerRegistry.get(provider);
    }

    // 4. 按 Provider 定义的 implementation 字段分发（未注册的 provider 才走这里）
    if (!ProviderClass && definition) {
        switch (definition.implementation) {
            case 'openai-compatible': ProviderClass = OpenAIProvider;    break;
            case 'anthropic':         ProviderClass = AnthropicProvider; break;
            case 'gemini':            ProviderClass = GeminiProvider;    break;
        }
    }

    // Merge definition capabilities and path config (only when definition exists)
    if (definition) {
        config = {
            ...config,
            supportsThinking: config.supportsThinking ?? definition.supportsThinking,
            requiresReferer:  config.requiresReferer  ?? definition.requiresReferer,
            apiBaseUrl:       config.apiBaseUrl || definition.baseURL,
            // openai-responses 协议优先使用 provider 声明的 Responses API 路径
            // （如 DeepSeek 的 "/responses"，完整 URL = baseURL + responsesPath）
            defaultPath: config.defaultPath ?? (config.protocol === 'openai-responses'
                ? definition.responsesPath
                : definition.defaultPath),
            anthropicPath:    config.anthropicPath ?? definition.anthropicPath,
            responsesPath:    config.responsesPath ?? definition.responsesPath,
            responses:        config.responses ?? definition.responses,
        };
    }

    // 5. 最终回退到 OpenAI Compatible
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
