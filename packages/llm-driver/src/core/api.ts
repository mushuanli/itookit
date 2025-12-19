// @file: llm-driver/core/api.ts

import { LLMDriver } from './driver';
import { LLM_PROVIDER_DEFAULTS } from '../constants';
import { LLMError } from '../errors';

/**
 * 连接测试结果
 */
export interface ConnectionTestResult {
    success: boolean;
    message: string;
    latency?: number;
    model?: string;
}

/**
 * 测试 LLM 连接
 */
export async function testLLMConnection(config: {
    provider: string;
    apiKey: string;
    baseURL?: string;
    model?: string;
    timeout?: number;
}): Promise<ConnectionTestResult> {
    const { provider, apiKey, baseURL, model, timeout = 15000 } = config;
    
    // 1. 参数校验
    if (!provider) {
        return { success: false, message: 'Provider is required' };
    }
    if (!apiKey) {
        return { success: false, message: 'API Key is required' };
    }
    
    // 2. 确定模型
    const testModel = model || 
        LLM_PROVIDER_DEFAULTS[provider]?.models?.[0]?.id ||
        'gpt-4o-mini';
    
    const startTime = Date.now();
    
    try {
        // 3. 创建 Driver
        const driver = new LLMDriver({
            provider,
            apiKey,
            apiBaseUrl: baseURL,
            model: testModel,
            timeout,
            maxRetries: 1 // 测试时不重试
        });
        
        // 4. 发送测试请求
        const response = await driver.chat.create({
            messages: [{ role: 'user', content: 'Hi' }],
            model: testModel,
            maxTokens: 5,
            stream: false
        });
        
        const latency = Date.now() - startTime;
        
        // 5. 验证响应
        if (response.choices?.length > 0) {
            return {
                success: true,
                message: 'Connection successful',
                latency,
                model: response.model || testModel
            };
        } else {
            return {
                success: false,
                message: 'Response was empty',
                latency
            };
        }
        
    } catch (error: any) {
        const latency = Date.now() - startTime;
        
        if (error instanceof LLMError) {
            return {
                success: false,
                message: `${error.code}: ${error.message}`,
                latency
            };
        }
        
        if (error.name === 'AbortError') {
            return {
                success: false,
                message: 'Request timed out',
                latency
            };
        }
        
        return {
            success: false,
            message: error.message || 'Unknown error',
            latency
        };
    }
}

/**
 * 批量测试多个连接
 */
export async function testMultipleConnections(
    configs: Array<{
        id: string;
        provider: string;
        apiKey: string;
        baseURL?: string;
        model?: string;
    }>
): Promise<Map<string, ConnectionTestResult>> {
    const results = new Map<string, ConnectionTestResult>();
    
    // 并行测试
    const promises = configs.map(async (config) => {
        const result = await testLLMConnection(config);
        results.set(config.id, result);
    });
    
    await Promise.all(promises);
    
    return results;
}
