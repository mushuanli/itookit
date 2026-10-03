import { afterEach, expect, it, vi } from 'vitest';
import { configureSessionHostPorts, traceBoot } from '../src/utils/host-ports';
import { log } from '../src/utils/logger';
import { assertExecutionMode } from '../src/session/execution-mode-policy';

afterEach(() => configureSessionHostPorts());

it('uses host translation and logging even when services were imported before configuration', () => {
    const info = vi.fn();
    configureSessionHostPorts({
        translate: key => `localized:${key}`,
        logger: { debug() {}, info, warn() {}, error() {} },
    });
    expect(() => assertExecutionMode({ executionMode: 'agent', executionModeLocked: true }, 'chat'))
        .toThrow('localized:chatInput.executionMode.locked');
    log.info('Created', { sessionId: 'session' });
    expect(info).toHaveBeenCalledWith('Created', { sessionId: 'session' });
    configureSessionHostPorts();
    expect(() => assertExecutionMode({ executionMode: 'agent', executionModeLocked: true }, 'chat'))
        .toThrow('The execution mode is locked for this conversation.');
    log.info('Standalone');
    expect(info).toHaveBeenCalledTimes(1);
});

it('delegates boot tracing and preserves operation results and errors', async () => {
    const labels: string[] = [];
    configureSessionHostPorts({ traceBoot: async (label, operation) => {
        labels.push(label);
        return operation();
    } });
    expect(await traceBoot('restore', async () => 42)).toBe(42);
    const error = new Error('Storage unavailable');
    await expect(traceBoot('load', async () => { throw error; })).rejects.toBe(error);
    expect(labels).toEqual(['restore', 'load']);
});
