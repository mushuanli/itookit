import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LLMDriver } from '../src/core/driver';

const globalFetch = vi.fn();
global.fetch = globalFetch;

describe('Responses Provider', () => {
    beforeEach(() => {
        vi.resetAllMocks();
    });

    it('maps messages to input items and extracts instructions', async () => {
        const driver = new LLMDriver({
            connection: { providerId: 'deepseek', protocol: 'openai-responses' },
            apiKey: 'sk-test',
            model: 'deepseek-v4-flash',
        });

        globalFetch.mockResolvedValue({
            ok: true,
            json: async () => ({
                id: 'resp_1',
                status: 'completed',
                model: 'deepseek-v4-flash',
                output: [
                    { type: 'message', content: [{ type: 'output_text', text: 'Hello!' }] },
                ],
                usage: { input_tokens: 5, output_tokens: 2 },
            }),
        });

        const response = await driver.chat.create({
            messages: [
                { role: 'system', content: 'You are helpful.' },
                { role: 'user', content: 'Hi' },
            ],
        });

        const body = JSON.parse(globalFetch.mock.calls[0][1].body);
        expect(body.model).toBe('deepseek-v4-flash');
        expect(body.instructions).toBe('You are helpful.');
        // 单条纯文本 user 消息 → 直接字符串 input
        expect(body.input).toBe('Hi');

        expect(response.choices[0].message.content).toBe('Hello!');
        expect(response.choices[0].finish_reason).toBe('stop');
        expect(response.usage).toMatchObject({ prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 });
    });

    it('flattens tool schema and normalizes function_call output', async () => {
        const driver = new LLMDriver({
            connection: { providerId: 'deepseek', protocol: 'openai-responses' },
            apiKey: 'sk-test',
            model: 'deepseek-v4-flash',
        });

        globalFetch.mockResolvedValue({
            ok: true,
            json: async () => ({
                id: 'resp_2',
                status: 'completed',
                model: 'deepseek-v4-flash',
                output: [
                    { type: 'function_call', call_id: 'call_1', name: 'get_weather', arguments: '{"city":"Beijing"}' },
                ],
            }),
        });

        const response = await driver.chat.create({
            messages: [{ role: 'user', content: 'Weather in Beijing?' }],
            tools: [{
                type: 'function',
                function: { name: 'get_weather', description: 'Get weather', parameters: { type: 'object' } },
            }],
        });

        const body = JSON.parse(globalFetch.mock.calls[0][1].body);
        expect(body.tools).toEqual([{
            type: 'function', name: 'get_weather', description: 'Get weather', parameters: { type: 'object' },
        }]);

        expect(response.choices[0].finish_reason).toBe('stop');
        expect(response.choices[0].message.tool_calls).toEqual([{
            id: 'call_1', type: 'function', function: { name: 'get_weather', arguments: '{"city":"Beijing"}' },
        }]);
    });

    it('aggregates semantic SSE deltas into a stream', async () => {
        const driver = new LLMDriver({
            connection: { providerId: 'deepseek', protocol: 'openai-responses' },
            apiKey: 'sk-test',
            model: 'deepseek-v4-flash',
        });

        const encoder = new TextEncoder();
        const sse = [
            'event: response.created\ndata: {"id":"resp_3"}\n\n',
            'event: response.output_text.delta\ndata: {"delta":"Hel"}\n\n',
            'event: response.output_text.delta\ndata: {"delta":"lo"}\n\n',
            'event: response.completed\ndata: {"usage":{"input_tokens":3,"output_tokens":2}}\n\n',
        ].join('');

        globalFetch.mockResolvedValue({
            ok: true,
            body: new ReadableStream({
                start(controller) {
                    controller.enqueue(encoder.encode(sse));
                    controller.close();
                },
            }),
        });

        const chunks: any[] = [];
        for await (const chunk of (await driver.chat.create({ messages: [], stream: true }))) {
            chunks.push(chunk);
        }

        const content = chunks.flatMap((c: any) => c.choices?.[0]?.delta?.content ?? []);
        expect(content.join('')).toBe('Hello');
        expect(chunks.at(-1).choices[0].finish_reason).toBe('stop');
        expect(chunks.at(-1).usage).toMatchObject({ prompt_tokens: 3, completion_tokens: 2 });
    });

    it('maps status to finish_reason', async () => {
        const driver = new LLMDriver({
            connection: { providerId: 'deepseek', protocol: 'openai-responses' },
            apiKey: 'sk-test',
            model: 'deepseek-v4-flash',
        });

        globalFetch.mockResolvedValue({
            ok: true,
            json: async () => ({ id: 'r', status: 'incomplete', model: 'm', output: [] }),
        });

        const response = await driver.chat.create({ messages: [{ role: 'user', content: 'x' }] });
        expect(response.choices[0].finish_reason).toBe('length');
    });
});
