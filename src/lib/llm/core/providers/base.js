/**
 * @file #llm/core/providers/base.js
 * @description Defines the abstract base class for all provider adapters.
 */

export class BaseProvider {
    /**
     * @param {object} config - The provider configuration.
     * @param {string} config.apiKey - The API key for the provider.
     * @param {string} config.model - The default model to use.
     */
    constructor(config) {
        if (this.constructor === BaseProvider) {
            throw new Error("Abstract class 'BaseProvider' cannot be instantiated directly.");
        }
        this.apiKey = config.apiKey;
        this.model = config.model;
        this.config = config;
    }

    /**
     * Creates a standard (non-streaming) chat completion.
     * @abstract
     * @param {object} params - The standardized request parameters from LLMClient.
     * @param {boolean} params.include_thinking - Flag to include thinking process.
     * @returns {Promise<object>}
     */
    async create(params) {
        throw new Error("Method 'create()' must be implemented by subclasses.");
    }

    /**
     * Creates a streaming chat completion.
     * @abstract
     * @param {object} params - The standardized request parameters from LLMClient.
     * @param {boolean} params.include_thinking - Flag to include thinking process.
     * @returns {AsyncGenerator<object>}
     */
    async* stream(params) {
        throw new Error("Method 'stream()' must be implemented by subclasses.");
    }
}
