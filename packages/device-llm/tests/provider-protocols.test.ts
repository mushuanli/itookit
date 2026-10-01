import { expect, it } from 'vitest';
import type { LLMProvider } from '@itookit/llm-common';
import { getProviderProtocols } from '@itookit/llm-common';
import { createProvider } from '../src/providers/registry';
import { ResponsesProvider } from '../src/providers/responses';
import { AnthropicProvider } from '../src/providers/anthropic';
import { OpenAIProvider } from '../src/providers/openai';
import { fromLLMProvider, toLLMProvider } from '../src/constants/llm-loader';

const provider: LLMProvider = { id: 'custom', name: 'Custom', implementation: 'openai-compatible',
    baseURL: 'https://example.com', defaultProtocol: 'openai-responses',
    supportedProtocols: ['openai-chat', 'openai-responses', 'anthropic-messages'],
    responsesPath: '/custom/responses', modelsPath: '/catalog',
    models: [{ id: 'claude', name: 'Claude', preferredProtocol: 'anthropic-messages' }] };

it('resolves explicit connection protocol before model preference before Provider default', () => {
    const config = { provider: 'custom', apiKey: 'secret' };
    expect(createProvider(config, { custom: provider })).toBeInstanceOf(ResponsesProvider);
    expect(createProvider({ ...config, model: 'claude' }, { custom: provider })).toBeInstanceOf(AnthropicProvider);
    expect(createProvider({ ...config, model: 'claude', protocol: 'openai-chat' }, { custom: provider })).toBeInstanceOf(OpenAIProvider);
});

it('infers legacy protocols and respects explicit support without re-enabling paths', () => {
    expect(getProviderProtocols({ ...provider, supportedProtocols: undefined })).toEqual(['openai-chat', 'openai-responses']);
    expect(getProviderProtocols({ ...provider, supportedProtocols: ['openai-chat'] })).toEqual(['openai-chat']);
});

it('round trips protocol and catalog configuration along with model preference', () => {
    expect(toLLMProvider(fromLLMProvider(provider))).toMatchObject(provider);
});

it('selects the protocol for the actual requested model when a driver switches tiers', async () => {
    const { vi } = await import('vitest');
    const { LLMDriver } = await import('../src/core/driver');
    const messages = vi.spyOn(AnthropicProvider.prototype, 'create').mockResolvedValue({
        id: 'test', model: 'claude', object: 'chat.completion', created: 0,
        choices: [{ index: 0, message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }],
    });
    const responses = vi.spyOn(ResponsesProvider.prototype, 'create').mockResolvedValue({
        id: 'test', model: 'other', object: 'chat.completion', created: 0,
        choices: [{ index: 0, message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }],
    });
    const driver = new LLMDriver({ provider: 'custom', apiKey: 'secret', model: 'other', customProviderDefaults: { custom: provider } });
    try {
        await driver.chat.create({ model: 'claude', messages: [{ role: 'user', content: 'Hi' }] });
        await driver.chat.create({ model: 'other', messages: [{ role: 'user', content: 'Hi' }] });
        expect(messages).toHaveBeenCalledOnce();
        expect(responses).toHaveBeenCalledOnce();
    } finally { messages.mockRestore(); responses.mockRestore(); await driver.dispose(); }
});
