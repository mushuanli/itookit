import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Kernel } from '@itookit/durable-kernel';
import { createVFS, MemoryBackend } from '@itookit/vfs-core';
import { createBuiltinDagPluginRegistry, registerDurablePrograms, DagCommandService, FlowCommand, FlowDefinitionStore } from '@itookit/llm-flow';
import type { FlowRevision } from '@itookit/common';
import { FlowInvocationService } from '../src/session/flow-invocations';
import { CommandBus } from '../src/core/command-bus';
import { SessionManager } from '../src/session/session-manager';
import { SessionRepository } from '../src/persistence/session-repository';
import { SessionDirectoryStorageResolver } from '../src/persistence/session-directory-storage';
import { createSessionPlugin, SessionCommand } from '../src/plugins/session-plugin';

let manager: Awaited<ReturnType<typeof createVFS>>['manager'], kernel: Kernel, service: FlowInvocationService, commands: CommandBus;
const flow: FlowRevision = { id: 'wait' as never, name: 'Wait', revision: 1, digest: 'wait-v1', createdAt: 0,
    parameters: [{ name: 'text', type: 'string', required: true }], nodes: [
        { id: 'ask' as never, name: 'Ask', plugin: 'builtin.human', pluginVersion: '1.0.0', inputs: {}, config: { requestId: 'same', prompt: '${param.text}' } },
    ], edges: [] };
const definitions = { loadRevision: async () => flow } as unknown as FlowDefinitionStore;
const input = (requestId: string, text = requestId) => ({ sessionId: 's', requestId, flowId: 'wait', revision: 1, parameters: { text } });
beforeEach(async () => {
    ({ manager } = await createVFS({ rootBackend: new MemoryBackend() }));
    const fs = await manager.openFileSystem('/test');
    kernel = new Kernel({ catalog: { fs }, pollMs: 5 });
    kernel.registerStorageResolver({ kind: 'test', async resolve() { return { fs, rootPath: '/s' }; } });
    registerDurablePrograms(kernel); await kernel.initialize();
    await kernel.createSession({ id: 's', storage: { kind: 'test', locator: null } });
    commands = new CommandBus();
    new DagCommandService({ kernel, flowStore: definitions, plugins: createBuiltinDagPluginRegistry() }).register(commands);
    service = new FlowInvocationService(kernel, definitions, commands);
});
afterEach(async () => { await kernel.closeSession('s', true); kernel.dispose(); await kernel.waitIdle(); await manager.dispose(); });

it('runs three calls in one Session, deduplicates admission, and routes identical interaction ids to the chosen Run', async () => {
    const [a, b, c, duplicate] = await Promise.all([service.invoke(input('a')), service.invoke(input('b')), service.invoke(input('c')), service.invoke(input('a'))]);
    expect(duplicate.rootTaskId).toBe(a.rootTaskId);
    expect(new Set([a.rootTaskId, b.rootTaskId, c.rootTaskId]).size).toBe(3);
    expect(await service.list('s')).toHaveLength(3);
    const ask = async (id: string) => {
        let snapshot: any;
        await vi.waitFor(async () => { snapshot = await commands.execute(FlowCommand.RunGet, { sessionId: 's', taskId: id });
            expect(snapshot.taskTree.some((task: any) => task.interactions.same?.status === 'pending')).toBe(true); });
        return snapshot.taskTree.find((task: any) => task.interactions.same?.status === 'pending').id;
    };
    const [targetA, targetB] = await Promise.all([ask(a.rootTaskId!), ask(b.rootTaskId!)]);
    await expect(commands.execute(FlowCommand.RunRespond, { taskId: a.rootTaskId, targetTaskId: targetB, requestId: 'same', value: 'wrong' })).rejects.toThrow('outside');
    await commands.execute(FlowCommand.RunRespond, { taskId: a.rootTaskId, targetTaskId: targetA, requestId: 'same', value: 'A' });
    expect((await (await kernel.openTask(a.rootTaskId!)).wait({ timeoutMs: 3000 })).status).toBe('succeeded');
    await commands.execute(FlowCommand.RunCancel, { taskId: b.rootTaskId });
    expect((await (await kernel.openTask(b.rootTaskId!)).status()).task.status).toBe('cancelled');
    expect((await (await kernel.openTask(c.rootTaskId!)).status()).task.status).not.toBe('cancelled');
    await expect(service.invoke(input('a', 'changed'))).rejects.toThrow('different arguments');
});

it('reconciles a lost completion receipt from the durable root without starting a second Run', async () => {
    const call = await service.invoke(input('lost'));
    const session = await kernel.openSession('s');
    const stored = (await session.getShared('flow.invocation.lost'))!.value as any;
    delete stored.rootTaskId;
    await session.setShared('flow.invocation.lost', stored);
    const recovered = new FlowInvocationService(kernel, definitions, commands);
    expect((await recovered.invoke(input('lost'))).rootTaskId).toBe(call.rootTaskId);
    expect((await session.listTasks()).filter(task => task.labels?.kind === 'flow-root')).toHaveLength(1);
    await expect(new FlowInvocationService(kernel, definitions, commands, async () => false).invoke(input('denied'))).rejects.toThrow('another host');
});

it('restores multiple pending calls after rebuilding Kernel and also submits a durable intent without a root', async () => {
    const calls = await Promise.all([service.invoke(input('restore-a')), service.invoke(input('restore-b'))]);
    await vi.waitFor(async () => expect((await kernel.listSessionTasks('s')).filter(task => task.interactions.same?.status === 'pending')).toHaveLength(2));
    const session = await kernel.openSession('s');
    await session.setShared('flow.invocation.intent', { ...input('intent'), flow, createdAt: Date.now() } as never);
    kernel.dispose(); await kernel.waitIdle();
    await vi.waitFor(async () => {
        for (const call of calls) expect(Number(((await session.getShared(`flow.run.${call.rootTaskId}.scheduler-owner`))!.value as any).expiresAt)).toBeLessThanOrEqual(Date.now());
    }, { timeout: 3000 });
    const fs = await manager.openFileSystem('/test');
    kernel = new Kernel({ catalog: { fs }, pollMs: 5 });
    kernel.registerStorageResolver({ kind: 'test', async resolve() { return { fs, rootPath: '/s' }; } });
    registerDurablePrograms(kernel); await kernel.initialize(); await kernel.recoverSession('s');
    commands = new CommandBus(); new DagCommandService({ kernel, flowStore: definitions, plugins: createBuiltinDagPluginRegistry() }).register(commands);
    service = new FlowInvocationService(kernel, definitions, commands); await service.recover();
    const restored = await service.list('s'); expect(restored).toHaveLength(3);
    expect(restored.find(call => call.requestId === 'restore-a')?.rootTaskId).toBe(calls[0].rootTaskId);
    await vi.waitFor(async () => expect((await kernel.listSessionTasks('s')).filter(task => task.interactions.same?.status === 'pending')).toHaveLength(3));
    for (const call of restored) {
        const snapshot = await commands.execute<any>(FlowCommand.RunGet, { sessionId: 's', taskId: call.rootTaskId });
        const target = snapshot.taskTree.find((task: any) => task.interactions.same?.status === 'pending');
        await commands.execute(FlowCommand.RunRespond, { taskId: call.rootTaskId, targetTaskId: target.id, requestId: 'same', value: call.requestId });
        expect((await (await kernel.openTask(call.rootTaskId!)).wait({ timeoutMs: 3000 })).status).toBe('succeeded');
    }
});

it('starts the launcher call before any view binds the new Session and leaves its chat branch untouched', async () => {
    const fs = await manager.openFileSystem('/sessions');
    const repository = new SessionRepository(fs); await repository.init();
    kernel.registerStorageResolver(new SessionDirectoryStorageResolver(fs));
    const sessionManager = new SessionManager(repository, {} as never, { kernel,
        dagPlugins: createBuiltinDagPluginRegistry(), flowStore: {} as never, canWriteSession: async () => true });
    service.register();
    await createSessionPlugin(sessionManager).activate({ commands } as never);
    const created = await commands.execute<{ sessionId: string }>(SessionCommand.CreateFromFlow, {
        invocation: true, flowId: 'wait', revision: 1, parameters: { text: 'launch before navigation' },
    });
    try {
        const calls = await service.list(created.sessionId);
        expect(calls).toHaveLength(1); expect(calls[0].rootTaskId).toBeTruthy();
        expect((await repository.getManifest(created.sessionId))?.flow).toBeUndefined();
        expect(await repository.listHistory(created.sessionId)).toEqual([]);
        await vi.waitFor(async () => expect((await kernel.listSessionTasks(created.sessionId)).some(task => task.interactions.same?.status === 'pending')).toBe(true));
    } finally { await kernel.closeSession(created.sessionId, true); await repository.dispose(); }
});

it('does not scan chat tasks when the Session has no Flow invocations', async () => {
    const tasks = vi.spyOn(kernel, 'listSessionTasks');
    expect(await service.list('s')).toEqual([]);
    expect(tasks).not.toHaveBeenCalled();
    tasks.mockRestore();
});
