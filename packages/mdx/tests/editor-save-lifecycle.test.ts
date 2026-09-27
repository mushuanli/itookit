// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { MDxEditor } from '../src/editor/mdx-editor';

it('retains editable content after a failed final save and supports retry', async () => {
    const onSave = vi.fn(async (_text: string) => {});
    onSave.mockRejectedValueOnce(new Error('read only'));
    const editor = new MDxEditor({ onSave });
    const container = document.createElement('div'); document.body.append(container);
    await editor.init(container, 'draft');
    editor.setDirty(true);
    const failed = vi.fn(); editor.on('saveError', failed);
    await expect(editor.destroy()).rejects.toThrow('Unsaved changes');
    expect(editor.isDirty()).toBe(true);
    expect(editor.getText()).toBe('draft');
    expect(container.childElementCount).toBeGreaterThan(0);
    expect(failed).toHaveBeenCalledOnce();
    await editor.destroy();
    expect(onSave).toHaveBeenCalledTimes(2);
    expect(onSave).toHaveBeenLastCalledWith('draft');
    expect(container.childElementCount).toBe(0);
    container.remove();
});

it('does not write an unchanged document on hide or destroy', async () => {
    const onSave = vi.fn(async (_text: string) => {});
    const editor = new MDxEditor({ onSave });
    const container = document.createElement('div');
    await editor.init(container, 'original');
    await editor.flushPendingSave(); await editor.destroy();
    expect(onSave).not.toHaveBeenCalled();
});

it('shares destruction and saves changes made while the first write is pending', async () => {
    let finish!: () => void;
    const write = vi.fn(async (_text: string) => {});
    write.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    const editor = new MDxEditor({ onSave: write });
    const container = document.createElement('div');
    await editor.init(container, 'first'); editor.setDirty(true);
    const first = editor.destroy(), second = editor.destroy();
    expect(second).toBe(first);
    await vi.waitFor(() => expect(write).toHaveBeenCalledOnce());
    editor.setText('latest'); editor.setDirty(true);
    finish(); await Promise.all([first, second]);
    expect(write.mock.calls.map(([text]) => text)).toEqual(['first', 'latest']);
    expect(container.childElementCount).toBe(0);
    await editor.destroy(); expect(write).toHaveBeenCalledTimes(2);
});
