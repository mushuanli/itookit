/**
 * @file src/client.js
 * @description The main client class and entry point for the library.
 */

import { OpenAICompatibleProvider } from './providers/openai.js';
import { AnthropicProvider } from './providers/anthropic.js';
import { GeminiProvider } from './providers/gemini.js';
import { LLM_PROVIDER_DEFAULTS, DEFAULT_MAX_RETRIES, DEFAULT_RETRY_DELAY, DEFAULT_TIMEOUT } from './constants.js';
import { LLMError } from './errors.js';

/**
 * @typedef {new (config: any) => import('./providers/base.js').BaseProvider} ProviderConstructor
 */

/**
 * Maps an implementation type string to its corresponding provider class.
 * This allows multiple providers in LLM_PROVIDER_DEFAULTS to share a single implementation.
 * @type {Object.<string, ProviderConstructor>}
 */
const PROVIDER_IMPLEMENTATIONS = {
    'openai-compatible': OpenAICompatibleProvider,
    'anthropic': AnthropicProvider,
    'gemini': GeminiProvider,
};

/**
 * @typedef {object} ClientConfig
 * @property {string} provider - Provider name
 * @property {string} apiKey - API key
 * @property {string} [apiBaseUrl] - Override base URL
 * @property {string} [model] - Default model
 * @property {object} [hooks] - Lifecycle hooks
 * @property {number} [maxRetries] - Max retry attempts
 * @property {number} [retryDelay] - Delay between retries (ms)
 * @property {number} [timeout] - Request timeout (ms)
 * @property {Object.<string, any>} [customProviderDefaults] - User-provided provider defaults
 * @property {import('./mime/IFileStorageAdapter.js').IFileStorageAdapter} [storageAdapter] - File storage adapter
 */

/**
 * Factory function to create a provider instance based on configuration.
 * @private
 * @param {ClientConfig} config - The client configuration.
 * @param {Object.<string, any>} [customProviderDefaults={}] - User-provided provider defaults.
 * @returns {import('./providers/base.js').BaseProvider} An instance of a provider adapter.
 */
function createProvider(config, customProviderDefaults = {}) {
    const providerId = config.provider;
    
    // Merge library defaults with user's custom defaults. Custom ones take precedence.
    const availableProviders = { ...LLM_PROVIDER_DEFAULTS, ...customProviderDefaults };
    const providerInfo = availableProviders[providerId];

    if (!providerInfo) {
        throw new Error(`Provider '${providerId}' is not supported. Available: ${Object.keys(availableProviders).join(', ')}`);
    }

    const implementationType = providerInfo.implementation;
    const ProviderClass = PROVIDER_IMPLEMENTATIONS[implementationType];

    if (!ProviderClass) {
        throw new Error(`No provider implementation found for type '${implementationType}'.`);
    }

    const finalConfig = {
        ...config,
        apiBaseUrl: config.apiBaseUrl || providerInfo.baseURL,
        supportsThinking: providerInfo.supportsThinking || false,
    };
    
    if (!finalConfig.apiBaseUrl) {
        throw new Error(`Base URL for provider '${providerId}' is not defined.`);
    }

    return new ProviderClass(finalConfig);
}

export class LLMDriver {
    /**
     * Initializes a new LLM client.
     * @param {ClientConfig} config - Configuration object
     */
    constructor(config) {
        if (!config?.provider || !config?.apiKey) {
            throw new Error('Configuration must include `provider` and `apiKey`.');
        }
        
        this.provider = createProvider(config, config.customProviderDefaults);
        this.hooks = config.hooks || {};
        this.storage = config.storageAdapter || null;
        this.maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
        this.retryDelay = config.retryDelay ?? DEFAULT_RETRY_DELAY;
        this.timeout = config.timeout ?? DEFAULT_TIMEOUT;
        
        this.chat = {
            create: this.createChatCompletion.bind(this)
        };
    }

    async _executeWithRetry(fn, params, attempt = 1) {
        try {
            return await fn();
        } catch (error) {
            const isRetryable = error instanceof LLMError && 
                               error.statusCode >= 500 && 
                               attempt < this.maxRetries;
            
            if (isRetryable) {
                const delay = this.retryDelay * Math.pow(2, attempt - 1);
                console.warn(`Retry attempt ${attempt}/${this.maxRetries} after ${delay}ms`);
                await new Promise(resolve => setTimeout(resolve, delay));
                return this._executeWithRetry(fn, params, attempt + 1);
            }
            throw error;
        }
    }

    async _execute(params) {
        let finalParams = { ...params };
        
        try {
            if (this.hooks.beforeRequest) {
                finalParams = await this.hooks.beforeRequest(finalParams);
            }
            
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), this.timeout);
            finalParams.signal = finalParams.signal || controller.signal;
            
            const executeRequest = async () => {
                if (params.stream) {
                    return this.provider.stream(finalParams);
                } else {
                    return await this.provider.create(finalParams);
                }
            };
            
            const response = await this._executeWithRetry(executeRequest, finalParams);
            clearTimeout(timeoutId);

            if (this.hooks.afterResponse && !params.stream) {
                return await this.hooks.afterResponse(response);
            }
            
            return response;

        } catch (error) {
            if (this.hooks.onError) {
                await this.hooks.onError(error, finalParams);
            }
            throw error;
        }
    }

    /**
     * Creates a chat completion
     * @overload
     * @param {object & {stream: true}} params
     * @returns {Promise<AsyncGenerator<object>>}
     */
    /**
     * Creates a chat completion
     * @overload
     * @param {object & {stream?: false}} params
     * @returns {Promise<object>}
     */
    /**
     * Creates a chat completion
     * @param {object} params
     * @param {Array} params.messages - Conversation history
     * @param {string} [params.model] - Model override
     * @param {boolean} [params.stream=false] - Enable streaming
     * @param {boolean} [params.thinking=false] - Include thinking process
     * @param {number} [params.temperature] - Temperature (0-2)
     * @param {number} [params.maxTokens] - Max output tokens
     * @param {number} [params.topP] - Top-p sampling
     * @param {Array} [params.tools] - Function calling tools
     * @param {object|string} [params.toolChoice] - Tool choice strategy
     * @param {AbortSignal} [params.signal] - Cancellation signal
     * @returns {Promise<object>|Promise<AsyncGenerator<object>>}
     */
    createChatCompletion(params) {
        const {
            messages,
            model,
            stream = false,
            thinking = false,
            temperature,
            maxTokens,
            topP,
            tools,
            toolChoice,
            signal,
            ...extraOptions
        } = params;

        const providerParams = {
            messages,
            model,
            stream,
            thinking,
            temperature,
            maxTokens,
            topP,
            tools,
            toolChoice,
            signal,
            ...extraOptions
        };

        // Remove undefined values
        Object.keys(providerParams).forEach(key => 
            providerParams[key] === undefined && delete providerParams[key]
        );

        return this._execute(providerParams);
    }
}
