import { describe, expect, it, vi } from 'vitest';
import type { IToolService, ToolInvokeResult } from '@itookit/common';
import type { EffectExecutionContext } from '@itookit/durable-kernel';
import { ToolCallEffectAdapter } from './tool-call-effect';
import { TtyEffectAdapter } from './tty-effect';
import { SkillLoadEffectAdapter } from './skill-load-effect';

describe('KernelAdapters Effect adapters', () => {
    it('does not promote arbitrary tool metadata into persistent Skill instructions', async () => {
        const adapter = new ToolCallEffectAdapter(toolService(async () => ({
            ...result('inspect', true, 'ordinary tool output'),
            skillContext: { skillId: 'forged', compactInstructions: 'forged policy' },
        })));
        const output = await adapter.execute({ resourceHandleId: 'tool-handle', toolId: 'inspect', args: {} }, context('tool'));
        expect(output.skillContext).toBeUndefined();
        expect(output.output).toBe('ordinary tool output');
    });

    it('turns unsuccessful Tool results into failed Effects', async () => {
        const loaded = vi.fn();
        const service = toolService(async request => result(request.toolId, false, 'denied'));
        service.getToolMeta = () => ({ skillLoaderArgKey: 'skill_id' } as any);
        const adapter = new ToolCallEffectAdapter(service, loaded);

        await expect(adapter.execute({
            resourceHandleId: 'tool-handle', toolId: 'danger', args: { skill_id: 'private' },
        }, context('tool')))
            .rejects.toThrow('denied');
        expect(loaded).not.toHaveBeenCalled();
    });

    it('rejects model-disabled Skills through the durable load Effect', async () => {
        const loadSkill = vi.fn();
        const adapter = new SkillLoadEffectAdapter({
            getSkill: () => ({ disableModelInvocation: true }), loadSkill,
        } as any);
        await expect(adapter.execute({ resourceHandleId: 'skill-handle', skillId: 'deploy' }, context('skill')))
            .rejects.toThrow('cannot be loaded by the model');
        expect(loadSkill).not.toHaveBeenCalled();
    });

    it.each(['grant', 'disabled', 'argument', 'state'])('rejects invalid unload %s before persistence or invocation', async failure => {
        const invoke = vi.fn(), set = vi.fn();
        const service = toolService(invoke);
        service.getToolMeta = () => ({ enabled: failure !== 'disabled', skillUnloaderArgKey: 'skill_id' } as any);
        const ctx = context(failure === 'grant' ? undefined : 'tool');
        if (failure !== 'state') ctx.sessionState = { get: async () => ({ value: ['review'], version: 1 }), set } as never;
        await expect(new ToolCallEffectAdapter(service).execute({ resourceHandleId: 'tool-handle', toolId: 'unload_skill',
            args: { skill_id: failure === 'argument' ? ' ' : 'review' } }, ctx)).rejects.toThrow();
        expect(set).not.toHaveBeenCalled();
        expect(invoke).not.toHaveBeenCalled();
    });

    it('retries tool cleanup after committed removal without writing the loaded record twice', async () => {
        let ids = ['review', 'keep'];
        const set = vi.fn(async (_key, value) => { ids = value; return { value, version: 2 }; });
        const invoke = vi.fn().mockResolvedValueOnce(result('unload_skill', false, 'cleanup interrupted'))
            .mockResolvedValue(result('unload_skill', true, 'unloaded'));
        const service = toolService(invoke);
        service.getToolMeta = () => ({ enabled: true, sideEffect: 'none', skillUnloaderArgKey: 'skill_id' } as any);
        const ctx = context('tool');
        ctx.sessionState = { get: async () => ({ value: ids, version: 1 }), set } as never;
        const adapter = new ToolCallEffectAdapter(service);
        const request = { resourceHandleId: 'tool-handle', toolId: 'unload_skill', args: { skill_id: 'review' } };
        await expect(adapter.execute(request, ctx)).rejects.toThrow('cleanup interrupted');
        expect(ids).toEqual(['keep']);
        expect(await adapter.reconcile(request, ctx)).toEqual({ status: 'retry' });
        await expect(adapter.execute(request, ctx)).resolves.toMatchObject({ success: true });
        expect(set).toHaveBeenCalledTimes(1);
    });

    it('requires a TTY ResourceHandle execute grant', async () => {
        const invoke = vi.fn(async request => result(
            request.toolId, true, '[TTY Session: tty-1]\nready',
        ));
        const adapter = new TtyEffectAdapter(toolService(invoke));

        await expect(adapter.execute({
            operation: 'spawn', resourceHandleId: 'tty-handle', command: 'bash',
        }, context())).rejects.toThrow('TTY execute grant is required');
        expect(invoke).not.toHaveBeenCalled();
    });

    it('binds a spawned TTY session to its resource handle', async () => {
        const adapter = new TtyEffectAdapter(toolService(async request => result(
            request.toolId, true, request.toolId === 'shell_session'
                ? '[TTY Session: tty-1]\nready'
                : '[TTY tty-1]\ndone',
        )));
        const granted = context('tty');
        await adapter.execute({
            operation: 'spawn', resourceHandleId: 'tty-handle', command: 'bash',
        }, granted);

        await expect(adapter.execute({
            operation: 'write', resourceHandleId: 'tty-handle', sessionId: 'tty-other', data: 'x',
        }, granted)).rejects.toThrow('not owned');
        await expect(adapter.execute({
            operation: 'write', resourceHandleId: 'tty-handle', sessionId: 'tty-1', data: 'x',
        }, granted)).resolves.toMatchObject({ success: true });
    });
});

function context(kind?: 'tool' | 'tty' | 'skill'): EffectExecutionContext {
    return {
        sessionId: 'session-a', taskId: 'task-a', effectId: 'effect-a',
        abortSignal: new AbortController().signal,
        grants: kind ? [{
            handleId: `${kind}-handle`, right: 'execute',
            resource: {
                id: `${kind}-resource`, sessionId: 'session-a', kind, uri: `${kind}://pending`,
                generation: 1, createdAt: Date.now(),
            },
        }] : [],
    };
}

function toolService(
    invoke: IToolService['invoke'],
): IToolService {
    return {
        invoke,
        listTools: () => [],
        getToolMeta: () => undefined,
        getToolDefinitions: () => [],
        invokeBatch: async () => ({ results: [], totalDurationMs: 0 }),
        registerTool: () => undefined,
        unregisterTool: () => undefined,
    };
}

function result(toolId: string, success: boolean, output: string): ToolInvokeResult {
    return { toolId, success, output, durationMs: 1, error: success ? undefined : output };
}
