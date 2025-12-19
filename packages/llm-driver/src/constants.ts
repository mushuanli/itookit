// @file: llm-driver/constants.ts

import { LLMProviderDefinition } from './types';

/**
 * 默认连接 ID
 */
export const LLM_DEFAULT_ID = 'default';

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
    openai: {
        name: 'OpenAI',
        implementation: 'openai-compatible',
        baseURL: 'https://api.openai.com/v1',
        icon: '🤖',
        models: [
            {
                id: 'gpt-4o',
                name: 'GPT-4o',
                contextWindow: 128000,
                maxOutput: 16384,
                supportsVision: true,
                supportsTools: true,
                inputPrice: 2.5,
                outputPrice: 10
            },
            {
                id: 'gpt-4o-mini',
                name: 'GPT-4o Mini',
                contextWindow: 128000,
                maxOutput: 16384,
                supportsVision: true,
                supportsTools: true,
                inputPrice: 0.15,
                outputPrice: 0.6
            },
            {
                id: 'o1',
                name: 'o1',
                contextWindow: 200000,
                maxOutput: 100000,
                supportsThinking: true,
                inputPrice: 15,
                outputPrice: 60
            },
            {
                id: 'o1-mini',
                name: 'o1 Mini',
                contextWindow: 128000,
                maxOutput: 65536,
                supportsThinking: true,
                inputPrice: 3,
                outputPrice: 12
            },
            {
                id: 'o3-mini',
                name: 'o3 Mini',
                contextWindow: 200000,
                maxOutput: 100000,
                supportsThinking: true,
                inputPrice: 1.1,
                outputPrice: 4.4
            }
        ]
    },
    
    anthropic: {
        name: 'Anthropic',
        implementation: 'anthropic',
        baseURL: 'https://api.anthropic.com',
        icon: '🔮',
        supportsThinking: true,
        models: [
            {
                id: 'claude-sonnet-4-20250514',
                name: 'Claude Sonnet 4',
                contextWindow: 200000,
                maxOutput: 16000,
                supportsVision: true,
                supportsThinking: true,
                supportsTools: true,
                inputPrice: 3,
                outputPrice: 15
            },
            {
                id: 'claude-3-5-sonnet-20241022',
                name: 'Claude 3.5 Sonnet',
                contextWindow: 200000,
                maxOutput: 8192,
                supportsVision: true,
                supportsTools: true,
                inputPrice: 3,
                outputPrice: 15
            },
            {
                id: 'claude-3-5-haiku-20241022',
                name: 'Claude 3.5 Haiku',
                contextWindow: 200000,
                maxOutput: 8192,
                supportsVision: true,
                supportsTools: true,
                inputPrice: 0.8,
                outputPrice: 4
            }
        ]
    },
    
    gemini: {
        name: 'Google Gemini',
        implementation: 'gemini',
        baseURL: 'https://generativelanguage.googleapis.com/v1beta',
        icon: '💎',
        supportsThinking: true,
        models: [
            {
                id: 'gemini-2.5-pro-preview-06-05',
                name: 'Gemini 2.5 Pro',
                contextWindow: 1048576,
                maxOutput: 65536,
                supportsVision: true,
                supportsThinking: true,
                supportsTools: true
            },
            {
                id: 'gemini-2.5-flash-preview-05-20',
                name: 'Gemini 2.5 Flash',
                contextWindow: 1048576,
                maxOutput: 65536,
                supportsVision: true,
                supportsThinking: true,
                supportsTools: true
            },
            {
                id: 'gemini-2.0-flash',
                name: 'Gemini 2.0 Flash',
                contextWindow: 1048576,
                maxOutput: 8192,
                supportsVision: true,
                supportsTools: true
            }
        ]
    },
    
    deepseek: {
        name: 'DeepSeek',
        implementation: 'openai-compatible',
        baseURL: 'https://api.deepseek.com',
        icon: '🔍',
        supportsThinking: true,
        models: [
            {
                id: 'deepseek-chat',
                name: 'DeepSeek V3',
                contextWindow: 65536,
                maxOutput: 8192,
                supportsTools: true,
                inputPrice: 0.27,
                outputPrice: 1.1
            },
            {
                id: 'deepseek-reasoner',
                name: 'DeepSeek R1',
                contextWindow: 65536,
                maxOutput: 8192,
                supportsThinking: true,
                inputPrice: 0.55,
                outputPrice: 2.19
            }
        ]
    },
    
    openrouter: {
        name: 'OpenRouter',
        implementation: 'openai-compatible',
        baseURL: 'https://openrouter.ai/api/v1',
        icon: '🌐',
        requiresReferer: true,
        models: [
            {
                id: 'anthropic/claude-sonnet-4',
                name: 'Claude Sonnet 4 (via OpenRouter)',
                contextWindow: 200000,
                supportsVision: true,
                supportsThinking: true
            },
            {
                id: 'openai/gpt-4o',
                name: 'GPT-4o (via OpenRouter)',
                contextWindow: 128000,
                supportsVision: true
            },
            {
                id: 'google/gemini-2.5-pro-preview',
                name: 'Gemini 2.5 Pro (via OpenRouter)',
                contextWindow: 1048576,
                supportsVision: true,
                supportsThinking: true
            }
        ]
    },
    
    groq: {
        name: 'Groq',
        implementation: 'openai-compatible',
        baseURL: 'https://api.groq.com/openai/v1',
        icon: '⚡',
        models: [
            {
                id: 'llama-3.3-70b-versatile',
                name: 'Llama 3.3 70B',
                contextWindow: 128000,
                maxOutput: 32768
            },
            {
                id: 'llama-3.1-8b-instant',
                name: 'Llama 3.1 8B Instant',
                contextWindow: 128000,
                maxOutput: 8192
            },
            {
                id: 'mixtral-8x7b-32768',
                name: 'Mixtral 8x7B',
                contextWindow: 32768,
                maxOutput: 32768
            }
        ]
    },
    
    ollama: {
        name: 'Ollama (Local)',
        implementation: 'openai-compatible',
        baseURL: 'http://localhost:11434/v1',
        icon: '🦙',
        models: [
            {
                id: 'llama3.2',
                name: 'Llama 3.2',
                contextWindow: 128000
            },
            {
                id: 'qwen2.5',
                name: 'Qwen 2.5',
                contextWindow: 32768
            },
            {
                id: 'deepseek-r1',
                name: 'DeepSeek R1',
                contextWindow: 65536,
                supportsThinking: true
            }
        ]
    },
    
    custom: {
        name: 'Custom (OpenAI Compatible)',
        implementation: 'openai-compatible',
        baseURL: '',
        icon: '🔧',
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
