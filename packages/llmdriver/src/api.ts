// @file: llmdriver/api.ts
import { LLMDriver } from './driver';
import { LLM_PROVIDER_DEFAULTS } from './constants';
import { LLMError } from './errors';

export async function testLLMConnection(config: {
    provider: string;
    apiKey: string;
    baseURL?: string;
    model?: string;
}): Promise<{ success: boolean; message: string }> {
    if (!config.provider || !config.apiKey) {
        return { success: false, message: "Provider and API Key are required." };
    }

    try {
        const client = new LLMDriver({
            provider: config.provider,
            apiKey: config.apiKey,
            apiBaseUrl: config.baseURL,
            timeout: 15000
        });

        const modelToUse = config.model || 
                          LLM_PROVIDER_DEFAULTS[config.provider]?.models?.[0]?.id ||
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
    } catch (error: any) {
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
