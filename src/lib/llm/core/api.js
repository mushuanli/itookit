/**
 * @file #llm/core/api.js
 * @description Provides high-level, standalone functions for interacting with the core library.
 */

import { LLMClient } from './client.js';
import { LLMError } from './errors.js';

/**
 * Tests a given LLM provider connection configuration by making a lightweight API call.
 * This function is designed to be used independently, for example, in a settings UI.
 *
 * @param {object} connectionConfig - The connection configuration to test.
 * @param {string} connectionConfig.provider - The provider name (e.g., 'openai').
 * @param {string} connectionConfig.apiKey - The API key.
 * @param {string} [connectionConfig.baseURL] - The optional base URL for the API.
 * @returns {Promise<{success: boolean, message: string}>} A result object indicating success or failure.
 */
export async function testLLMConnection(connectionConfig) {
    if (!connectionConfig || !connectionConfig.provider || !connectionConfig.apiKey) {
        return { success: false, message: "Provider and API Key are required." };
    }

    try {
        // 1. Create a temporary client with the provided config.
        const client = new LLMClient({
            provider: connectionConfig.provider,
            apiKey: connectionConfig.apiKey,
            apiBaseUrl: connectionConfig.baseURL,
        });

        // 2. Make a lightweight, low-cost API call to verify the connection.
        // A simple chat completion with max_tokens: 1 is a reliable test.
        const response = await client.chat.create({
            messages: [{ role: 'user', content: 'hello' }],
            model: connectionConfig.model, // Use specified model if any
            options: {
                max_tokens: 1,
                // Use a short timeout to prevent long waits on unresponsive servers
                signal: AbortSignal.timeout(15000) // 15-second timeout
            }
        });
        
        // 3. If the call succeeds, the connection is valid.
        if (response.choices && response.choices.length > 0) {
            return { success: true, message: 'Connection successful!' };
        } else {
             return { success: false, message: 'Connection succeeded, but response was empty.' };
        }

    } catch (error) {
        // 4. If an error occurs, format it into a user-friendly message.
        console.error("Connection test failed:", error);
        if (error instanceof LLMError) {
            let message = `API Error: ${error.message}`;
            if (error.statusCode) {
                message += ` (HTTP Status: ${error.statusCode})`;
            }
            return { success: false, message };
        }
        if (error.name === 'TimeoutError') {
             return { success: false, message: 'Connection failed: The request timed out.' };
        }
        return { success: false, message: `An unexpected error occurred: ${error.message}` };
    }
}