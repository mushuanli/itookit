import { describe, expect, it, vi } from 'vitest';
import { SaveManager } from '../src/editor/save-manager';

const deferred = () => {
    let resolve!: () => void;
    const promise = new Promise<void>(done => { resolve = done; });
    return { promise, resolve };
};

describe('SaveManager', () => {
    it('keeps changes made during an in-flight save dirty', async () => {
        const pending = deferred();
        const onSave = vi.fn(() => pending.promise);
        const manager = new SaveManager(onSave);
        let content = 'first';

        manager.setDirty(true);
        const saving = manager.save(() => content, vi.fn(), vi.fn());
        content = 'second';
        manager.setDirty(true);
        pending.resolve();
        await saving;

        expect(onSave).toHaveBeenCalledWith('first');
        expect(manager.isDirty()).toBe(true);
    });

    it('finalSave persists the latest change after an in-flight save', async () => {
        const pending = deferred();
        const saved: string[] = [];
        const manager = new SaveManager(async content => {
            saved.push(content);
            if (saved.length === 1) await pending.promise;
        });
        let content = 'first';

        manager.setDirty(true);
        void manager.save(() => content, vi.fn(), vi.fn());
        content = 'latest';
        manager.setDirty(true);
        const finalSaving = manager.finalSave(() => content, vi.fn(), vi.fn());
        pending.resolve();
        await finalSaving;

        expect(saved).toEqual(['first', 'latest']);
        expect(manager.isDirty()).toBe(false);
    });
});

describe('SaveManager failure contract', () => {
    it('keeps the document dirty and reports the error when a save fails', async () => {
        const failure = new Error('EROFS: mount is read-only');
        const onSave = vi.fn(async () => { throw failure; });
        const manager = new SaveManager(onSave);
        const onSuccess = vi.fn(), onError = vi.fn();
        manager.setDirty(true);

        await manager.save(() => 'edited', onSuccess, onError);

        expect(onSave).toHaveBeenCalledWith('edited');
        expect(onSuccess).not.toHaveBeenCalled();
        expect(onError).toHaveBeenCalledWith(failure);
        // Losing this flag would drop the user's text without any further attempt.
        expect(manager.isDirty()).toBe(true);
    });

    it('retries and clears the dirty flag once a later save succeeds', async () => {
        const onSave = vi.fn(async () => { if (onSave.mock.calls.length === 1) throw new Error('IPC connection lost'); });
        const manager = new SaveManager(onSave);
        const onError = vi.fn();
        manager.setDirty(true);

        await manager.save(() => 'edited', vi.fn(), onError);
        expect(onError).toHaveBeenCalledOnce();
        await manager.save(() => 'edited', vi.fn(), onError);

        expect(onSave).toHaveBeenCalledTimes(2);
        expect(onError).toHaveBeenCalledOnce();
        expect(manager.isDirty()).toBe(false);
    });

    it('reports a failing finalSave once and leaves the document dirty instead of looping', async () => {
        const onSave = vi.fn(async () => { throw new Error('EROFS: mount is read-only'); });
        const manager = new SaveManager(onSave);
        const onError = vi.fn();
        manager.setDirty(true);

        await manager.finalSave(() => 'edited', vi.fn(), onError);

        expect(onSave).toHaveBeenCalledTimes(1);
        expect(onError).toHaveBeenCalledOnce();
        expect(manager.isDirty()).toBe(true);
    });
});

it('allows an explicit retry after the save callback throws synchronously', async () => {
    const onSave = vi.fn(() => { if (onSave.mock.calls.length === 1) throw new Error('synchronous failure'); return Promise.resolve(); });
    const manager = new SaveManager(onSave);
    const onError = vi.fn();
    manager.setDirty(true);
    await manager.save(() => 'edited', vi.fn(), onError);
    await manager.save(() => 'edited', vi.fn(), onError);
    expect(onSave).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(manager.isDirty()).toBe(false);
});

it('finishes without clearing dirty state when no save callback is installed', async () => {
    const manager = new SaveManager();
    manager.setDirty(true);
    await manager.finalSave(() => 'edited', vi.fn(), vi.fn());
    expect(manager.isDirty()).toBe(true);
});
