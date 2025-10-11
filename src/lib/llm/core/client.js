/**
 * @file #llm/core/client.js
 * @description The main client class and entry point for the library.
 */

import { OpenAICompatibleProvider } from './providers/openai.js';
import { GeminiProvider } from './providers/gemini.js';
import { ClaudeProvider } from './providers/claude.js'; // +++ 新增导入

const PROVIDER_MAP = {
    'openai': OpenAICompatibleProvider,
    'deepseek': OpenAICompatibleProvider,
    'openrouter': OpenAICompatibleProvider,
    'gemini': GeminiProvider,
    'anthropic': ClaudeProvider, // +++ 新增 Claude (Anthropic) 支持
};

/**
 * Factory function to create a provider instance based on configuration.
 * @param {object} config - The client configuration.
 * @returns {import('./providers/base.js').BaseProvider} An instance of a provider adapter.
 */
function createProvider(config) {
    const ProviderClass = PROVIDER_MAP[config.provider];
    if (!ProviderClass) {
        throw new Error(`Unsupported provider: '${config.provider}'. Supported providers are: ${Object.keys(PROVIDER_MAP).join(', ')}`);
    }
    return new ProviderClass(config);
}

export class LLMClient {
    /**
     * Initializes a new LLM client.
     * @param {object} config - The client configuration.
     * @param {string} config.provider - The name of the LLM provider.
     * @param {string} config.apiKey - The API key for the selected provider.
     * @param {string} [config.model] - The default model to use.
     * @param {object} [config.hooks] - Lifecycle hooks for requests.
     * @param {function(object): Promise<object>} [config.hooks.beforeRequest]
     * @param {function(object): Promise<object>} [config.hooks.afterResponse]
     * @param {function(Error, object): Promise<void>} [config.hooks.onError]
     */
    constructor(config) {
        if (!config || !config.provider || !config.apiKey) {
            throw new Error('Configuration object with `provider` and `apiKey` is required.');
        }
        this.provider = createProvider(config);
        this.hooks = config.hooks || {};
        
        this.chat = {
            create: this.createChatCompletion.bind(this)
        };
    }

    /**
     * Executes the provider call, wrapping it with hooks.
     * @private
     */
    async _execute(params) {
        let finalParams = params;
        try {
            if (this.hooks.beforeRequest) {
                finalParams = await this.hooks.beforeRequest(params);
            }
            
            // Pass the signal down to the provider call
            const response = params.stream 
                ? this.provider.stream(finalParams, params.options?.signal) 
                : await this.provider.create(finalParams, params.options?.signal);

            // Note: afterResponse hook does not apply to streams in this implementation
            // as it would require wrapping the async generator.
            if (this.hooks.afterResponse && !params.stream) {
                 return await this.hooks.afterResponse(response);
            }
            return response;

        } catch (error) {
            if (this.hooks.onError) {
                await this.hooks.onError(error, finalParams);
            }
            throw error; // Re-throw the error after the hook
        }
    }

    /**
     * Creates a chat completion. This is the primary method for interacting with LLMs.
     * @param {object} params
     * @param {Array<object>} params.messages - The conversation history.
     * @param {string} [params.model] - Overrides the client's default model.
     * @param {boolean} [params.stream=false] - If true, returns an async generator.
     * @param {boolean} [params.include_thinking=false] - If true, requests the model's thinking process.
     * @param {number} [params.temperature] - The sampling temperature.
     * @param {number} [params.max_tokens] - The maximum number of tokens to generate.
     * @param {number} [params.top_p] - The nucleus sampling probability.
     * @param {Array<object>} [params.tools] - A list of tools the model may call.
     * @param {object | string} [params.tool_choice] - Controls which tool is called.
     * @param {object} [params.options] - Provider-specific or less common options.
     * @returns {Promise<object> | AsyncGenerator<object>}
     */
    createChatCompletion({
        messages,
        model,
        stream = false,
        include_thinking = false, // NEW PARAMETER
        temperature,
        max_tokens,
        top_p,
        tools,
        tool_choice,
        options = {}
    }) {
        const providerParams = {
            messages,
            model,
            stream,
            include_thinking, // Pass it down to the provider
            tools,
            tool_choice,
            // Combine top-level params and options for the provider.
            // This allows users to use top-level args for convenience
            // while still allowing overrides via the options object.
            options: {
                temperature,
                max_tokens,
                top_p,
                ...options,
            }
        };

        // Remove undefined top-level keys so they don't override provider defaults
        Object.keys(providerParams.options).forEach(key => 
            providerParams.options[key] === undefined && delete providerParams.options[key]
        );

        return this._execute(providerParams);
    }
}
