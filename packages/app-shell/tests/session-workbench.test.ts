import { afterEach, describe, expect, it, vi } from 'vitest';
import { createVFSUI } from '@itookit/vfs-ui';
vi.mock('@itookit/vfs-ui', () => ({ createVFSUI: vi.fn(() => ({ on: () => () => {}, start: async () => {}, refresh: async () => {}, selectPath: async () => {}, destroy: () => {} })) }));
import { SessionWorkbench } from '../src/core/SessionWorkbench';
const element = () => ({ replaceChildren: vi.fn(), append: vi.fn(), setAttribute: vi.fn(), classList: { add: vi.fn() }, remove: vi.fn(), title: '', textContent: '', hidden: false });
function setup() {
    vi.stubGlobal('document', { createElement: () => element() });
    const release = vi.fn(async () => {}), dispose = vi.fn(async () => {});
    const manifest = { currentBranch: 'main' };
    const listeners: Array<() => void> = [];
    const repository = { getManifest: vi.fn(async (id: string) => ({ id, title: 'Session', ...manifest })), list: vi.fn(async () => []),
        openAttachments: vi.fn(async () => ({ dispose })), subscribe: (listener: () => void) => { listeners.push(listener); return () => {}; } };
    const files = { subscribe: () => () => {}, inspect: vi.fn(async () => ({ revision: 1 })), acquireFiles: vi.fn(async () => ({ context: { fs: { capabilities: {} }, sessionId: 's' }, release })) };
    const destroy = vi.fn(async () => {}), factory = vi.fn(async (...args: any[]) => { manifest.currentBranch = args[1].target.branch ?? 'main'; return { destroy }; });
    const onSelect = vi.fn();
    const sidebar = element();
    const kernel = { onChanged: () => () => {}, cancel: vi.fn(async () => {}), task: vi.fn(async () => ({ effects: {} })) };
    const workbench = new SessionWorkbench(sidebar as any, element() as any, repository as any, files as any, factory as any, onSelect, undefined, kernel as any, factory as any);
    return { kernel, sidebar, workbench, repository, files, factory, release, dispose, destroy, onSelect, manifest, changed: () => listeners.forEach(listener => listener()) };
}
afterEach(() => vi.unstubAllGlobals());
describe('Session workbench lifecycle', () => {
    it('uses vfs-ui for the Session sidebar with directory activation', async () => {
        const f = setup(); await f.workbench.start();
        expect(createVFSUI).toHaveBeenCalledWith(expect.objectContaining({ activateDirectories: true, readOnly: false, exportDirectories: true, fileCreation: expect.objectContaining({ label: '会话' }) }), expect.anything());
        const options = (createVFSUI as any).mock.calls[0][0];
        expect(options.primaryAction).toBeUndefined();
        expect(typeof options.exportItem).toBe('function');
        await f.workbench.destroy();
    });
    it('records branch changes and restores explicit branch routes without navigation loops', async () => {
        const f = setup(); await f.workbench.start();
        await f.workbench.openResource('s');
        expect(f.workbench.getActiveResourceId()).toBe('s?branch=main');
        f.onSelect.mockClear();
        f.manifest.currentBranch = 'review/中文 & notes'; f.changed();
        const route = 's?branch=' + encodeURIComponent(f.manifest.currentBranch);
        await vi.waitFor(() => expect(f.onSelect).toHaveBeenCalledWith(route, 'push'));
        expect(f.factory).toHaveBeenCalledOnce();
        await f.workbench.openResource('s?branch=main');
        expect(f.factory.mock.calls.at(-1)?.[1].target.branch).toBe('main');
        expect(f.workbench.getActiveResourceId()).toBe('s?branch=main');
        await f.workbench.openResource(route);
        expect(f.factory.mock.calls.at(-1)?.[1].target.branch).toBe('review/中文 & notes');
        expect(f.factory).toHaveBeenCalledTimes(3);
        await f.workbench.openResource('s');
        await f.workbench.openResource(route);
        expect(f.factory).toHaveBeenCalledTimes(3);
        expect(f.onSelect.mock.calls.filter(([, mode]) => mode === 'push')).toHaveLength(1);
        await f.workbench.destroy();
    });

    it('does not acquire files or create an editor for an unknown Session', async () => {
        const f = setup(); f.repository.getManifest.mockRejectedValueOnce(new Error('Session missing'));
        await expect(f.workbench.openResource('missing')).rejects.toThrow('missing');
        expect(f.files.acquireFiles).not.toHaveBeenCalled(); expect(f.factory).not.toHaveBeenCalled();
        await f.workbench.destroy();
    });
    it('releases its file context when editor creation fails', async () => {
        const f = setup(); f.factory.mockRejectedValueOnce(new Error('editor failed'));
        await expect(f.workbench.openResource('s')).rejects.toThrow('editor failed');
        expect(f.release).toHaveBeenCalledOnce(); await f.workbench.destroy();
    });
    it('destroys a late editor and releases both sources when closed during opening', async () => {
        const f = setup(); let complete!: (editor: any) => void;
        f.factory.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
        const opening = f.workbench.openResource('s');
        await vi.waitFor(() => expect(f.factory).toHaveBeenCalledOnce());
        const closing = f.workbench.destroy(); complete({ destroy: f.destroy });
        await expect(opening).rejects.toThrow('closed'); await closing;
        expect(f.destroy).toHaveBeenCalledOnce(); expect(f.release).toHaveBeenCalledOnce();
        expect(f.workbench.getActiveResourceId()).toBeNull();
    });
});

it('offers reset only on tasks and cancels through Kernel without deleting history', async () => {
    const f = setup(); await f.workbench.start();
    const options = vi.mocked(createVFSUI).mock.calls.at(-1)![0];
    const defaults = [{ id: 'export', label: 'export' }];
    expect(options.contextMenu!.items!({ id: '/s/files/note.md' } as any, defaults)).toEqual(defaults);
    const menu = options.contextMenu!.items!({ id: '/s/tasks/t' } as any, defaults);
    expect(menu).toHaveLength(1);
    const reset = menu[0] as { onClick: (item: any) => void };
    reset.onClick({}); reset.onClick({});
    await vi.waitFor(() => expect(f.kernel.task).toHaveBeenCalledWith('s', 't'));
    expect(f.kernel.cancel).toHaveBeenCalledTimes(1);
    expect(f.kernel.cancel).toHaveBeenCalledWith('s', 't', expect.stringContaining('强制复位'));
    expect(f.factory).not.toHaveBeenCalled();
    await f.workbench.destroy();
});

it('keeps cleanup failures visible and permits retrying reset', async () => {
    const f = setup();
    f.kernel.task.mockResolvedValueOnce({ effects: { shell: { cleanupPending: true } } } as any);
    await expect((f.workbench as any).resetTask('/s/tasks/t')).rejects.toThrow('仍待清理');
    f.kernel.cancel.mockRejectedValueOnce(new Error('process could not be stopped'));
    await expect((f.workbench as any).resetTask('/s/tasks/t')).rejects.toThrow('process could not be stopped');
    await (f.workbench as any).resetTask('/s/tasks/t');
    expect(f.kernel.cancel).toHaveBeenCalledTimes(3);
    await f.workbench.destroy();
});

it('releases a deleted active Session and replaces its stale route', async () => {
    const f = setup(); await f.workbench.start(); await f.workbench.openResource('s');
    f.repository.getManifest.mockRejectedValueOnce(Object.assign(new Error('Session missing'), { code: 'ENOENT' }));
    f.changed();
    try {
        await vi.waitFor(() => expect(f.workbench.getActiveResourceId()).toBeNull());
        expect(f.destroy).toHaveBeenCalledOnce(); expect(f.release).toHaveBeenCalledOnce();
        expect(f.onSelect).toHaveBeenLastCalledWith('', 'replace');
    } finally { await f.workbench.destroy(); }
});

it('retains the active Session when reading its manifest fails without proving deletion', async () => {
    const f = setup(); await f.workbench.start(); await f.workbench.openResource('s');
    const calls = f.repository.getManifest.mock.calls.length;
    f.repository.getManifest.mockRejectedValueOnce(Object.assign(new Error('Storage unavailable'), { code: 'EIO' }));
    f.changed();
    try {
        await vi.waitFor(() => expect(f.repository.getManifest.mock.calls.length).toBeGreaterThan(calls));
        expect(f.workbench.getActiveResourceId()).toBe('s?branch=main');
        expect(f.destroy).not.toHaveBeenCalled(); expect(f.release).not.toHaveBeenCalled();
    } finally { await f.workbench.destroy(); }
});

it('finishes deletion reconciliation before opening a newly selected Session', async () => {
    const f = setup(); await f.workbench.start(); await f.workbench.openResource('s');
    let rejectRead!: (error: Error) => void;
    const read = new Promise<never>((_, reject) => { rejectRead = reject; });
    const calls = f.repository.getManifest.mock.calls.length;
    f.repository.getManifest.mockReturnValueOnce(read);
    f.changed();
    await vi.waitFor(() => expect(f.repository.getManifest.mock.calls.length).toBeGreaterThan(calls));
    const opening = f.workbench.openResource('next');
    rejectRead(Object.assign(new Error('Session missing'), { code: 'ENOENT' }));
    try {
        await opening;
        expect(f.workbench.getActiveResourceId()).toBe('next?branch=main');
        expect(f.destroy).toHaveBeenCalledOnce(); expect(f.release).toHaveBeenCalledOnce();
        expect(f.onSelect).toHaveBeenLastCalledWith('next?branch=main');
    } finally { await f.workbench.destroy(); }
});
