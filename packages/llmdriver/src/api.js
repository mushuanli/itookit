/**
 * @file src/api.js
 * @description Standalone utility functions.
 */

import { LLMDriver } from './client.js';
import { LLMError } from './errors.js';
import { LLM_PROVIDER_DEFAULTS } from './constants.js';

/**
 * Tests an LLM provider connection
 * @param {object} connectionConfig
 * @param {string} connectionConfig.provider
 * @param {string} connectionConfig.apiKey
 * @param {string} [connectionConfig.baseURL]
 * @param {string} [connectionConfig.model]
 * @returns {Promise<{success: boolean, message: string}>}
 */
export async function testLLMConnection(connectionConfig) {
    if (!connectionConfig?.provider || !connectionConfig?.apiKey) {
        return { success: false, message: "Provider and API Key are required." };
    }

    try {
        const client = new LLMDriver({
            provider: connectionConfig.provider,
            apiKey: connectionConfig.apiKey,
            apiBaseUrl: connectionConfig.baseURL,
            timeout: 15000
        });

        const modelToUse = connectionConfig.model || 
                          LLM_PROVIDER_DEFAULTS[connectionConfig.provider]?.models?.[0]?.id ||
                          'gpt-4o-mini';

        const response = await client.chat.create({
            messages: [{ role: 'user', content: 'Hi' }],
            model: modelToUse,
            maxTokens: 5
        });
        
        if (response.choices?.length > 0) {
            return { success: true, message: 'Connection successful!' };
        } else {
            return { success: false, message: 'Response was empty.' };
        }

    } catch (error) {
        console.error("Connection test failed:", error);
        
        if (error instanceof LLMError) {
            return { 
                success: false, 
                message: `API Error: ${error.message}${error.statusCode ? ` (${error.statusCode})` : ''}` 
            };
        }
        
        if (error.name === 'AbortError') {
            return { success: false, message: 'Request timed out.' };
        }
        
        return { success: false, message: `Error: ${error.message}` };
    }
}