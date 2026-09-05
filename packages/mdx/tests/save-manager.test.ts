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
