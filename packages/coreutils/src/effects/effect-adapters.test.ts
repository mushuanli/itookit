import { describe, expect, it, vi } from 'vitest';
import type { IToolService, ToolInvokeResult } from '@itookit/common';
import type { EffectExecutionContext } from '@itookit/kernel';
import { ToolCallEffectAdapter } from './tool-call-effect';
import { TtyEffectAdapter } from './tty-effect';

describe('Coreutils Effect adapters', () => {
    it('turns unsuccessful Tool results into failed Effects', async () => {
        const adapter = new ToolCallEffectAdapter(toolService(async request => result(
            request.toolId, false, 'denied',
        )));

        await expect(adapter.execute({
            resourceHandleId: 'tool-handle', toolId: 'danger', args: {},
        }, context('tool')))
            .rejects.toThrow('denied');
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

function context(kind?: 'tool' | 'tty'): EffectExecutionContext {
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
