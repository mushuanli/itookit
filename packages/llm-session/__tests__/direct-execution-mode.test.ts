import { expect, it, vi } from 'vitest';
import { Kernel } from '@itookit/durable-kernel';
import { createVFS, MemoryBackend } from '@itookit/vfs-core';
import { DEFAULT_AGENT_MAX_EXCHANGES, type ChatExecutionMode } from '@itookit/llm-common';
import { ConversationRunCoordinator } from '../src/session/conversation-run-coordinator';
import { SessionRunCoordinator } from '../src/session/session-run-coordinator';
import type { ExecutionTask, TaskInput } from '../src/core/types';

it.each([
    ['chat', ['write_file'], 'disabled', 'llm.chat', []],
    ['chat', ['write_file', 'WebSearch'], 'client-tool', 'llm.agent', ['WebSearch']],
    ['chat', ['write_file', 'WebSearch'], 'builtin', 'llm.chat', []],
    ['agent', ['write_file'], 'disabled', 'llm.agent', ['write_file']],
    ['agent', undefined, 'disabled', 'llm.agent', ['write_file']],
    ['agent', [], 'disabled', 'rejected', []],
    ['chat', undefined, 'disabled', 'llm.chat', []],
    [undefined, ['write_file'], 'disabled', 'llm.agent', ['write_file']],
] as const)('freezes %s mode with tools %j and search %s', async (mode, ids, search, program, allowed) => {
    const { manager } = await createVFS({ rootBackend: new MemoryBackend() });
    const fs = await manager.openFileSystem('/');
    const kernel = new Kernel({ catalog: { fs, rootPath: '/catalog' }, pollMs: 0 });
    kernel.registerStorageResolver({ kind: 'test', resolve: async () => ({ fs, rootPath: '/session' }) });
    await kernel.initialize(); await kernel.createSession({ id: 's', storage: { kind: 'test', locator: null } });
    try {
        // Return an overbroad catalog to verify admission also filters at the Task boundary.
        const resolveTools = vi.fn(async () => ({ definitions: [{ name: 'write_file' }, { name: 'WebSearch' }], externalIds: ['write_file'] }));
        const resolveHarnessToolIds = vi.fn(async () => ['write_file']);
        const coordinator = new ConversationRunCoordinator({ kernel, resolveTools, resolveHarnessToolIds, engine: {}, eventBus: {}, dagPlugins: {} } as never);
        const internal = coordinator as any;
        vi.spyOn(internal, 'startRound').mockResolvedValue(undefined);
        vi.spyOn(internal, 'projectRun').mockReturnValue(undefined);
        vi.spyOn(internal, 'consume').mockResolvedValue({ message: { role: 'assistant', content: 'done' } });
        vi.spyOn(internal, 'completeRound').mockResolvedValue(undefined);
        const execution = { task: { id: 'request', sessionId: 's', input: { text: 'goal',
            sendIntent: { execution: { kind: 'agent', agentId: 'a', mode } } }, abortController: new AbortController() },
            config: { id: 'a', systemPrompt: 'policy', webSearchMode: search, capabilityPolicy: ids ? { toolIds: [...ids] } : undefined },
            log: { loadManifest: async () => ({ currentBranch: 'main', branches: { main: null }, branchMeta: {} }) },
            roundId: 'r', contextFiles: [], finalize: async () => {} };
        if (program === 'rejected') {
            await expect(coordinator.executeDirect(execution as never)).rejects.toThrow('没有可用工具');
            expect(resolveHarnessToolIds).not.toHaveBeenCalled();
            expect(await kernel.listSessionTasks('s')).toEqual([]);
            return;
        }
        await coordinator.executeDirect(execution as never);
        const [task] = await kernel.listSessionTasks('s');
        expect(task.program.kind).toBe(program);
        expect(task.input).toMatchObject({ tools: allowed.map(name => ({ name })), allowedToolIds: [...allowed], approval: 'external', webSearch: search === 'builtin' });
        expect(resolveTools).toHaveBeenCalledWith('s', [...allowed]);
        expect(task.labels?.executionMode).toBe(mode);
        expect(resolveHarnessToolIds).toHaveBeenCalledTimes(mode === 'agent' && ids === undefined ? 1 : 0);
        if (mode === 'agent') expect(task.input).toMatchObject({ maxExchanges: DEFAULT_AGENT_MAX_EXCHANGES });
        execution.task.input.sendIntent.execution.mode = 'agent';
        expect((await kernel.listSessionTasks('s'))[0].labels?.executionMode).toBe(mode);
    } finally { kernel.dispose(); await kernel.waitIdle(); await manager.dispose(); }
});

it('captures mode before asynchronous admission', async () => {
    const coordinator = new SessionRunCoordinator(...Array(8).fill({}) as ConstructorParameters<typeof SessionRunCoordinator>);
    const internal = coordinator as any;
    let admit!: () => void;
    vi.spyOn(coordinator, 'assertCanSubmit').mockImplementation(() => new Promise(resolve => { admit = resolve; }));
    const captured: TaskInput[] = [];
    vi.spyOn(internal, 'createTask').mockImplementation(async (input: TaskInput) => {
        captured.push(input); return { id: 'r', sessionId: 's', input } as ExecutionTask;
    });
    vi.spyOn(internal, 'execute').mockResolvedValue(undefined);
    internal.callbacks = { onStatusChange: vi.fn() };
    const input = { sessionId: 's', text: 'goal', files: [], agentId: 'a',
        overrides: { executionMode: 'chat' as ChatExecutionMode },
        sendIntent: { branch: { mode: 'continue' }, retention: { mode: 'persistent' }, execution: { kind: 'agent', agentId: 'a', mode: 'chat' } },
    } as TaskInput;
    const pending = coordinator.submit(input, {} as never);
    input.overrides!.executionMode = 'agent';
    if (input.sendIntent!.execution.kind === 'agent') input.sendIntent!.execution.mode = 'agent';
    admit(); await pending;
    expect(captured[0].sendIntent?.execution).toMatchObject({ mode: 'chat' });
    expect(captured[0].overrides?.executionMode).toBe('chat');
});

it.each(['agent', 'chat'] as const)('resolves configured MCP profiles only for %s execution and freezes their tool grants', async mode => {
    const { manager } = await createVFS({ rootBackend: new MemoryBackend() });
    const fs = await manager.openFileSystem('/');
    const kernel = new Kernel({ catalog: { fs, rootPath: '/catalog' }, pollMs: 0 });
    kernel.registerStorageResolver({ kind: 'test', resolve: async () => ({ fs, rootPath: '/session' }) });
    await kernel.initialize(); await kernel.createSession({ id: 's', storage: { kind: 'test', locator: null } });
    try {
        const name = 'mcp__server__lookup';
        const resolveMCPToolIds = vi.fn(async () => [name]);
        const coordinator = new ConversationRunCoordinator({ kernel, resolveMCPToolIds,
            resolveTools: async () => ({ definitions: [{ name }], externalIds: [name] }), engine: {}, eventBus: {}, dagPlugins: {} } as never);
        const internal = coordinator as any;
        vi.spyOn(internal, 'startRound').mockResolvedValue(undefined);
        vi.spyOn(internal, 'projectRun').mockReturnValue(undefined);
        vi.spyOn(internal, 'consume').mockResolvedValue({ message: { role: 'assistant', content: 'done' } });
        vi.spyOn(internal, 'completeRound').mockResolvedValue(undefined);
        const policy = { toolIds: [], mcpProfileIds: ['server'] };
        await coordinator.executeDirect({ task: { id: 'request', sessionId: 's', input: { text: 'lookup',
            sendIntent: { execution: { kind: 'agent', mode } } }, abortController: new AbortController() },
            config: { id: 'a', capabilityPolicy: policy, webSearchMode: 'disabled' },
            log: { loadManifest: async () => ({ currentBranch: 'main', branches: { main: null }, branchMeta: {} }) },
            roundId: 'r', contextFiles: [], finalize: async () => {} } as never);
        const [task] = await kernel.listSessionTasks('s');
        expect(task.input).toMatchObject({ tools: mode === 'agent' ? [{ name }] : [], allowedToolIds: mode === 'agent' ? [name] : [], approval: 'external' });
        expect(resolveMCPToolIds).toHaveBeenCalledTimes(mode === 'agent' ? 1 : 0);
        expect(policy.toolIds).toEqual([]);
    } finally { kernel.dispose(); await kernel.waitIdle(); await manager.dispose(); }
});
