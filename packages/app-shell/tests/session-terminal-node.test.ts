import { expect, it, vi } from 'vitest';
import { MemoryBackend } from '@itookit/vfs-core';
import { createApplicationRuntime } from '@itookit/app-core';
import { SessionCommand, type SessionEventEnvelope } from '@itookit/llm-session';
import { createAgentSendIntent } from '@itookit/common';

it('addresses terminal status to the same assistant node that was mounted while running', async () => {
    const backend = new MemoryBackend(); await backend.init();
    for (const path of ['/etc', '/etc/llm', '/etc/llm/.providers', '/etc/llm/.connections']) await backend.mkdir(path);
    const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
    await backend.write('/etc/llm/.providers/mock.json', encode({ id: 'mock', name: 'Mock', implementation: 'openai-compatible', apiKey: 'test', baseURL: 'http://localhost:18449', models: [{ id: 'mock-model', name: 'Mock' }] }));
    await backend.write('/etc/llm/.connections/default.json', encode({ id: 'default', name: 'Default', providerId: 'mock', tiers: { standard: 'mock-model' } }));
    let failRequest!: (error: Error) => void;
    const fetch = vi.fn(() => new Promise((_resolve, reject) => { failRequest = reject; }));
    vi.stubGlobal('fetch', fetch);
    const runtime = await createApplicationRuntime({ backend, ownerKind: 'tauri' });
    const events: SessionEventEnvelope[] = [];
    try {
        const sessionId = await runtime.sessionRepository.createSession('Failure');
        await runtime.commandBus.execute(SessionCommand.Bind, { sessionId });
        const unsubscribe = runtime.sessionManager.onEvent(event => events.push(event));
        try {
            await runtime.commandBus.execute(SessionCommand.Send, {
                text: 'hello', files: [], agentId: 'default', sendIntent: createAgentSendIntent('default'),
            }).catch(() => {});
            await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
            failRequest(new Error('Model request timed out'));
            await vi.waitFor(() => expect(events.some(event => event.type === 'message:status' && event.payload.status === 'failed')).toBe(true));
        } finally { unsubscribe(); }
        const appended = events.find(event => event.type === 'message:appended' && event.payload.isExecutionRoot);
        expect(appended).toBeDefined();
        if (appended?.type !== 'message:appended') throw new Error('Missing assistant');
        const root = appended.payload.sessionGroup.executionRoot!;
        const terminal = events.filter(event => event.type === 'message:status' && event.payload.status === 'failed');
        expect(terminal.length).toBeGreaterThan(0);
        for (const event of terminal) {
            if (event.type === 'message:status') expect(event.payload.messageId).toBe(root.id);
        }
    } finally { await runtime.dispose(); vi.unstubAllGlobals(); }
});
