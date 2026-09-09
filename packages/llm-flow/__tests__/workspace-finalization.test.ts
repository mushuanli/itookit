import { expect, it, vi } from 'vitest';
import { beginWorkspaceFinalization } from '../src/flow/workspace-finalization';

it('persists successful cleanup without conflating it with the root exit status', async () => {
    const saved: unknown[] = [];
    const setShared = vi.fn(async (_key, value) => { saved.push(value); });
    const finish = vi.fn(async () => {});
    const result = await beginWorkspaceFinalization({ setShared } as never,
        { id: 'root', wait: async () => ({ status: 'cancelled' }) } as never, { directory: '/isolated', finish });
    await result.completion;
    expect(finish).toHaveBeenCalledTimes(1);
    expect(finish).toHaveBeenCalledWith('cancelled');
    expect(saved).toEqual([{ status: 'pending' }, { status: 'succeeded' }]);
});

it.each([false, true])('preserves the cleanup outcome when final status persistence fails (cleanup fails: %s)', async fails => {
    const storage = new Error('storage offline'), cleanup = new Error('cleanup failed');
    const setShared = vi.fn().mockResolvedValueOnce({}).mockRejectedValue(storage);
    const finish = vi.fn(async () => { if (fails) throw cleanup; });
    const result = await beginWorkspaceFinalization({ setShared } as never,
        { id: 'root', wait: async () => ({ status: 'succeeded' }) } as never, { directory: '/isolated', finish });
    if (fails) await expect(result.completion).rejects.toMatchObject({ errors: [cleanup, storage] });
    else await expect(result.completion).rejects.toBe(storage);
    expect(result.state).toMatchObject({ status: fails ? 'failed' : 'succeeded', persistenceError: 'storage offline' });
    expect(finish).toHaveBeenCalledTimes(1);
    expect(setShared).toHaveBeenCalledTimes(2);
});
