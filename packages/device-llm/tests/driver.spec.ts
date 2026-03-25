import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LLMDriver } from '../src/driver';
import { LLMError } from '../src/errors';

// Mock fetch globally
const globalFetch = vi.fn();
global.fetch = globalFetch;

describe('LLMDriver Core', () => {
    beforeEach(() => {
        vi.resetAllMocks();
    });

    it('should initialize correctly with connection object', () => {
        const driver = new LLMDriver({
            connection: {
                id: 'test',
                name: 'test',
                provider: 'openai',
                apiKey: 'sk-test',
                model: 'gpt-4',
                baseURL: 'https://api.openai.com/v1'
            }
        });
        expect(driver).toBeDefined();
    });

    it('should retry on 5xx errors', async () => {
        const driver = new LLMDriver({
            provider: 'openai',
            apiKey: 'sk-test',
            maxRetries: 2,
            retryDelay: 10 // fast retry for test
        });

        // First call fails (500), Second call succeeds (200)
        globalFetch
            .mockResolvedValueOnce({
                ok: false,
                status: 500,
                statusText: 'Internal Server Error',
                json: async () => ({ error: { message: 'Server Error' } })
            })
            .mockResolvedValueOnce({
                ok: true,
                status: 200,
                json: async () => ({
                    choices: [{ message: { content: 'Success' }, finish_reason: 'stop' }],
                    model: 'gpt-4'
                })
            });

        const response = await driver.chat.create({
            messages: [{ role: 'user', content: 'Hi' }]
        });

        expect(globalFetch).toHaveBeenCalledTimes(2);
        expect(response.choices[0].message.content).toBe('Success');
    });

    it('should throw error immediately on 4xx errors (non-retryable)', async () => {
        const driver = new LLMDriver({ provider: 'openai', apiKey: 'sk-test' });

        globalFetch.mockResolvedValueOnce({
            ok: false,
            status: 401,
            statusText: 'Unauthorized',
            json: async () => ({ error: { message: 'Invalid Key' } })
        });

        await expect(driver.chat.create({
            messages: [{ role: 'user', content: 'Hi' }]
        })).rejects.toThrow(LLMError);

        expect(globalFetch).toHaveBeenCalledTimes(1);
    });

// tests/driver.spec.ts

    it('should handle streaming responses correctly', async () => {
        const driver = new LLMDriver({ 
            provider: 'openai', 
            apiKey: 'test-key' 
        });

        // 1. 构造模拟的 SSE 数据流
        const streamData = [
            'data: {"choices": [{"delta": {"content": "Hello"}}], "model": "gpt-4"}\n\n',
            'data: {"choices": [{"delta": {"content": " World"}}], "model": "gpt-4"}\n\n',
            'data: [DONE]\n\n'
        ];

        const stream = new ReadableStream({
            start(controller) {
                const encoder = new TextEncoder();
                streamData.forEach(chunk => {
                    controller.enqueue(encoder.encode(chunk));
                });
                controller.close();
            }
        });

        // 2. Mock fetch 返回这个流
        globalFetch.mockResolvedValue({
            ok: true,
            status: 200,
            body: stream
        });

        // 3. 调用流式接口
        const responseGenerator = await driver.chat.create({
            messages: [{ role: 'user', content: 'Hi' }],
            stream: true
        });

        // 4. 验证结果
        let fullContent = '';
        let chunkCount = 0;

        for await (const chunk of responseGenerator) {
            if (chunk.choices[0].delta.content) {
                fullContent += chunk.choices[0].delta.content;
                chunkCount++;
            }
        }

        expect(chunkCount).toBe(2); // Hello + World
        expect(fullContent).toBe('Hello World');
        expect(globalFetch).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                body: expect.stringContaining('"stream":true') // 确保请求体里带了 stream: true
            })
        );
    });

});
