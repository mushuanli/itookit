// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ICommandBus } from '@itookit/common';
import { FlowCommand } from '@itookit/llm-session';
import { DagWorkbench } from '../../llm-ui/src/components/DagWorkbench';
import { openSessionFlowOutputs } from '../../llm-ui/src/flows/session-output';

beforeEach(() => {
    HTMLDialogElement.prototype.showModal = function () { this.open = true; };
    HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new Event('close')); };
});
afterEach(() => { document.body.innerHTML = ''; vi.useRealTimers(); vi.restoreAllMocks(); });

function snapshot(status: string, output?: unknown) {
    const task = { id: 'root', sessionId: 's', status, program: { kind: 'flow.aggregate' }, attemptCount: 1, output };
    return { root: { task }, nodes: [], taskTree: [task, { ...task, id: 'child', labels: { dispatchKey: 'language' }, output: { outputs: { result: 0 } } }],
        iterations: {}, detachedNodes: [], usage: { tokens: 0, elapsedMs: 100 }, attachedFromStorage: true };
}

it('refreshes final and child outputs, restores persisted results, and stops after destruction', async () => {
    vi.useFakeTimers(); let current = snapshot('running');
    const execute = vi.fn(async () => current), root = document.createElement('div'); document.body.append(root);
    const commands = { execute } as unknown as ICommandBus;
    const view = new DagWorkbench(root, { commands }); await view.openRun('root', 's');
    expect(root.querySelector('.dag-output__value')?.textContent).toBe('0');
    current = snapshot('succeeded', { nodes: { report: { outputs: { result: { score: 9, safe: '<img src=x onerror=alert(1)>' } } } } });
    await vi.advanceTimersByTimeAsync(1000);
    expect(root.textContent).toContain('"score": 9'); expect(root.querySelector('img')).toBeNull();
    view.destroy(); const count = execute.mock.calls.length; await vi.advanceTimersByTimeAsync(2000);
    expect(execute).toHaveBeenCalledTimes(count);
    const reopened = new DagWorkbench(root, { commands }); await reopened.openRun('root', 's');
    expect(root.textContent).toContain('"score": 9'); reopened.destroy();
});

it('shows only the current Session runs and closes on Session switch', async () => {
    const execute = vi.fn(async (command: string, args?: { sessionId?: string }) => {
        if (command === FlowCommand.RunList) { expect(args?.sessionId).toBe('s'); return [
            { taskId: 'foreign', sessionId: 'other', name: 'foreign', status: 'succeeded' },
            { taskId: 'root', sessionId: 's', name: 'Review', status: 'succeeded' },
        ]; }
        return snapshot('succeeded', { nodes: { report: { outputs: { result: false } } } });
    });
    const abort = new AbortController(); openSessionFlowOutputs({ execute } as unknown as ICommandBus, 's', abort.signal);
    await vi.waitFor(() => expect(document.querySelector('.dag-output__value')?.textContent).toBe('false'));
    expect(document.querySelector('select')?.textContent).not.toContain('foreign');
    expect(execute.mock.calls.some(([command]) => command === FlowCommand.RunResume)).toBe(false);
    abort.abort(); expect(document.querySelector('dialog')).toBeNull();
});
