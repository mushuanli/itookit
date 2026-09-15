// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createFileSystemSource, createFileSystemView, MemoryBackend, type FileSystemSourceOwner, type FileSystemView } from '@itookit/vfs-core';
import { createVFSUI, type VFSUIShell } from '../src';
import { VFSService } from '../src/services/VFSService';
import { resolveWritableParent } from '../src/utils/creation-guard';
import { VFSStore } from '../src/services/VFSStore';

let source: FileSystemSourceOwner;
let view: FileSystemView;
let shell: VFSUIShell;
let container: HTMLDivElement;
let readOnly = false;
const alert = vi.fn();

beforeEach(async () => {
    vi.stubGlobal('alert', alert.mockClear());
    vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => setTimeout(fn, 0));
    vi.stubGlobal('cancelAnimationFrame', clearTimeout);
    const storage = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) });
    source = await createFileSystemSource({ backend: new MemoryBackend(), viewId: 'creation-source' });
    await source.fs.driver.createDirectory({ name: 'ro' });
    await source.fs.driver.createDirectory({ name: 'rw' });
    view = createFileSystemView({ viewId: 'creation-view', mounts: [
        { mountId: 'ro', at: '/ro', root: '/ro', fs: source.fs, access: 'ro' },
        { mountId: 'rw', at: '/rw', root: '/rw', fs: source.fs, access: 'rw' },
    ] });
    const capabilitiesAt = view.capabilitiesAt.bind(view);
    readOnly = false;
    vi.spyOn(view, 'capabilitiesAt').mockImplementation(async path => ({ ...await capabilitiesAt(path), ...(readOnly ? { readonly: true } : {}) }));
    container = document.createElement('div'); document.body.append(container);
    shell = createVFSUI({ sessionListContainer: container, scopeId: 'creation-test', fileCreation: { title: 'New note' } }, view) as VFSUIShell;
    await shell.start();
});

afterEach(async () => {
    shell?.destroy(); await view?.dispose(); await source?.dispose();
    document.body.replaceChildren(); vi.unstubAllGlobals(); vi.restoreAllMocks();
});

it.each(['create-file', 'create-directory', 'import'])('blocks %s before opening input on a read-only mount', async action => {
    await shell.selectPath('/ro');
    const create = vi.spyOn(view.driver, 'createFile');
    container.querySelector<HTMLButtonElement>(`[data-action="${action}"]`)!.click();
    await vi.waitFor(() => expect(alert).toHaveBeenCalledOnce());
    expect(container.querySelector('.vfs-node-list__item-creator-input')).toBeNull();
    expect(document.querySelector('input[type="file"]')).toBeNull();
    expect(create).not.toHaveBeenCalled();
});

it('rechecks destination permission after the creation input opens', async () => {
    await shell.selectPath('/rw');
    container.querySelector<HTMLButtonElement>('[data-action="create-file"]')!.click();
    await vi.waitFor(() => expect(container.querySelector('.vfs-node-list__item-creator-input')).not.toBeNull());
    const input = container.querySelector<HTMLInputElement>('.vfs-node-list__item-creator-input')!;
    expect(input.value).toBe('New note');
    readOnly = true;
    input.value = 'blocked.md'; input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await vi.waitFor(() => expect(alert).toHaveBeenCalledOnce());
    expect(await source.fs.driver.exists('/rw/blocked.md')).toBe(false);
});

it('rechecks destination permission when import selection completes', async () => {
    await shell.selectPath('/rw');
    vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});
    container.querySelector<HTMLButtonElement>('[data-action="import"]')!.click();
    await vi.waitFor(() => expect(document.querySelector('input[type="file"]')).not.toBeNull());
    const picker = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(picker, 'files', { value: [new File(['body'], 'blocked.md')] });
    readOnly = true;
    picker.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(alert).toHaveBeenCalledOnce());
    expect(await source.fs.driver.exists('/rw/blocked.md')).toBe(false);
    expect(document.querySelector('input[type="file"]')).toBeNull();
});

it('guards direct service writes, including recursive paths and bulk import', async () => {
    const service = new VFSService({ engine: view });
    await expect(service.createFile({ parentPath: '/ro', title: 'a.md' })).rejects.toMatchObject({ code: 'EROFS' });
    await expect(service.createDirectory({ parentPath: '/ro', title: 'dir/sub' })).rejects.toMatchObject({ code: 'EROFS' });
    await expect(service.createFiles({ parentPath: '/ro', files: [{ title: 'a.md', content: 'body' }] })).rejects.toMatchObject({ code: 'EROFS' });
    await expect(service.createFile({ parentPath: '/rw', title: 'dir/a.md' })).resolves.toMatchObject({ path: '/rw/dir/a.md' });
});

it('does not redirect a read-only container into a writable creation destination', async () => {
    const service = new VFSService({ engine: view });
    await source.fs.driver.updateMetadata('/rw', { _readOnly: true });
    const redirect = vi.fn(() => '/elsewhere');
    await expect(resolveWritableParent(new VFSStore(), service, '/rw', redirect)).rejects.toMatchObject({ code: 'EROFS' });
    expect(redirect).not.toHaveBeenCalled();
    const check = vi.spyOn(service, 'assertCanCreate');
    await expect(resolveWritableParent(new VFSStore({ readOnly: true }), service, '/ro')).rejects.toThrow();
    expect(check).not.toHaveBeenCalled();
});

it('imports into the selected writable directory', async () => {
    await shell.selectPath('/rw');
    vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});
    container.querySelector<HTMLButtonElement>('[data-action="import"]')!.click();
    await vi.waitFor(() => expect(document.querySelector('input[type="file"]')).not.toBeNull());
    const picker = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(picker, 'files', { value: [new File(['body'], 'imported.md')] });
    picker.dispatchEvent(new Event('change'));
    await vi.waitFor(async () => expect(await source.fs.driver.exists('/rw/imported.md')).toBe(true));
    expect(await source.fs.driver.readContent('/rw/imported.md', { encoding: 'utf-8' })).toBe('body');
    expect(alert).not.toHaveBeenCalled();
});
