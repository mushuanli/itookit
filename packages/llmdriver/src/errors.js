/**
 * @file src/llm/core/errors.js
 * @description Defines custom error classes for the library.
 */

export class LLMError extends Error {
    /**
     * Custom error for all library-related issues.
     * @param {string} message - The error message.
     * @param {object} details - Additional error details.
     * @param {Error} [details.cause] - The original error object.
     * @param {string} details.provider - The name of the LLM provider.
     * @param {number} [details.statusCode] - The HTTP status code from the API response.
     */
    constructor(message, { cause, provider, statusCode }) {
        super(message);
        this.name = 'LLMError';
        this.cause = cause;
        this.provider = provider;
        this.statusCode = statusCode;
    }
}