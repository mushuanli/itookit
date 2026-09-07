import { afterEach, describe, expect, it, vi } from 'vitest';
import { createVFSUI } from '@itookit/vfs-ui';
vi.mock('@itookit/vfs-ui', () => ({ createVFSUI: vi.fn(() => ({ on: () => () => {}, start: async () => {}, refresh: async () => {}, selectPath: async () => {}, destroy: () => {} })) }));
import { SessionWorkbench } from '../src/core/SessionWorkbench';
const element = () => ({ replaceChildren: vi.fn(), append: vi.fn(), setAttribute: vi.fn(), classList: { add: vi.fn() }, remove: vi.fn(), title: '', textContent: '', hidden: false });
function setup() {
    vi.stubGlobal('document', { createElement: () => element() });
    const release = vi.fn(async () => {}), dispose = vi.fn(async () => {});
    const repository = { getManifest: vi.fn(async (id: string) => ({ id, title: 'Session' })), list: vi.fn(async () => []),
        openAttachments: vi.fn(async () => ({ dispose })), subscribe: () => () => {} };
    const files = { subscribe: () => () => {}, inspect: vi.fn(async () => ({ revision: 1 })), acquireFiles: vi.fn(async () => ({ context: { fs: { capabilities: {} }, sessionId: 's' }, release })) };
    const destroy = vi.fn(async () => {}), factory = vi.fn(async () => ({ destroy }));
    const sidebar = element();
    const workbench = new SessionWorkbench(sidebar as any, element() as any, repository as any, files as any, factory as any, () => {}, undefined, { onChanged: () => () => {} } as any, factory as any);
    return { sidebar, workbench, repository, files, factory, release, dispose, destroy };
}
afterEach(() => vi.unstubAllGlobals());
describe('Session workbench lifecycle', () => {
    it('uses vfs-ui for the Session sidebar with directory activation', async () => {
        const f = setup(); await f.workbench.start();
        expect(createVFSUI).toHaveBeenCalledWith(expect.objectContaining({ activateDirectories: true, readOnly: true, primaryAction: expect.objectContaining({ label: '＋ 新建会话' }) }), expect.anything());
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
