// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { describeCauseChain, describeErrorReason } from '../src';
import { CommandBus } from '../src/interaction/CommandBus';
import { ActionRunner } from '../src/interaction/ActionRunner';

it('reports the innermost message a wrapped view error hides', () => {
    const wrapper = new Error('Source operation failed: move', { cause: new Error('请在同一项目内移动会话目录') });
    expect(describeErrorReason(wrapper)).toBe('请在同一项目内移动会话目录');
    expect(describeErrorReason(new Error('plain failure'))).toBe('plain failure');
    expect(describeErrorReason('not an error')).toBe('not an error');
    // A cause cycle must not hang the reporter.
    const cyclic = new Error('outer');
    (cyclic as Error & { cause?: unknown }).cause = cyclic;
    expect(describeErrorReason(cyclic)).toBe('outer');
});

it('keeps the full chain available for logs', () => {
    const wrapper = new Error('Source operation failed: move', { cause: new Error('跨项目不可移动') });
    expect(describeCauseChain(wrapper)).toContain('Source operation failed: move');
    expect(describeCauseChain(wrapper)).toContain('跨项目不可移动');
});

it('names the reason when a command fails', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
        const bus = new CommandBus();
        bus.on('file:move', () => { throw new Error('Source operation failed: move', { cause: new Error('跨项目不可移动') }); });
        await expect(bus.execute('file:move', { itemIds: ['/a'], targetId: '/b' })).rejects.toThrow('Source operation failed: move');
        expect(logged).toHaveBeenCalledWith(expect.stringContaining('跨项目不可移动'), expect.anything());
    } finally { logged.mockRestore(); }
});

it('surfaces the reason through the default action reporter', async () => {
    const alerts = vi.spyOn(window, 'alert').mockImplementation(() => {});
    const runner = new ActionRunner();
    try {
        await runner.run('move', () => { throw new Error('Source operation failed: move', { cause: new Error('跨项目不可移动') }); }).catch(() => {});
        await vi.waitFor(() => expect(alerts).toHaveBeenCalledWith('跨项目不可移动'));
    } finally { alerts.mockRestore(); runner.destroy(); }
});
