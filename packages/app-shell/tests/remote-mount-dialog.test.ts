// @vitest-environment jsdom
import { it, expect, vi } from 'vitest';
import { t } from '@itookit/common';
import { createApplicationRuntime } from '@itookit/app-core';
import { MemoryBackend, createFileSystemSource, FSOperationCancelledError } from '@itookit/vfs-core';
import { showRemoteMountDialog } from '../src/files/remote-mount-dialog';
import { RemoteFilesSettingsEditor } from '../src/files/RemoteFilesSettingsEditor';
import { DirectoryItem } from '../../vfs-ui/src/ui/components/NodeList/items/DirectoryItem';
import { ENTITY_ICONS } from '@itookit/common';
import { StorageSettingsEditor } from '../../app-settings/src/editors/StorageSettingsEditor';
import { SETTINGS_PAGES } from '../../app-settings/src/engine/SettingsEngine';

it('adds a remote project grant and cancels an in-flight connection when closed', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'showModal');
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: () => {} });
    let slow = false, aborted = false;
    const runtime = await createApplicationRuntime({ backend: new MemoryBackend(), ownerKind: 'web', remoteSourceProvider: {
        setCredential() {}, async dispose() {}, async open(_connection, options) {
            if (slow) return new Promise((_resolve, reject) => options!.signal!.addEventListener('abort', () => {
                aborted = true; reject(new FSOperationCancelledError());
            }, { once: true }));
            return createFileSystemSource({ backend: new MemoryBackend(), viewId: 'remote', access: 'ro' });
        },
    } });
    const button = (text: string) => [...document.querySelectorAll<HTMLButtonElement>('dialog button')].find(item => item.textContent === text)!;
    const input = (key: Parameters<typeof t>[0]) => document.querySelector<HTMLInputElement>(`[aria-label="${t(key)}"]`)!;
    try {
        const project = (await runtime.projects.current())!;
        const closing = showRemoteMountDialog(runtime.projects, project.path, new AbortController().signal);
        await vi.waitFor(() => expect(button(t('remote.add'))).toBeTruthy());
        input('remote.token').value = 'secret'; button(t('remote.add')).click();
        await vi.waitFor(() => expect(runtime.projects.remoteMounts!.list(project.project.id)).toHaveLength(1));
        await vi.waitFor(() => expect(input('remote.token').value).toBe(''));
        slow = true; input('remote.at').value = '/second'; input('remote.token').value = 'another-secret';
        button(t('remote.add')).click();
        await vi.waitFor(() => expect(document.querySelector('[role="status"]')?.textContent).toBe(t('remote.connecting')));
        // Let the provider subscribe before closing the owning dialog.
        await new Promise(resolve => setTimeout(resolve, 10));
        button(t('project.cancel')).click(); await closing;
        await vi.waitFor(() => expect(aborted).toBe(true));
        expect(document.querySelector('dialog')).toBeNull();
        expect(runtime.projects.remoteMounts!.list(project.project.id)).toHaveLength(1);
    } finally {
        await runtime.dispose(); document.body.replaceChildren();
        if (descriptor) Object.defineProperty(HTMLDialogElement.prototype, 'showModal', descriptor);
        else Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal');
    }
});

it('keeps Settings configuration accessible while an offline project card disables its descendants', async () => {
    const runtime = await createApplicationRuntime({ backend: new MemoryBackend(), ownerKind: 'web', remoteSourceProvider: {
        setCredential() {}, async dispose() {}, async open() { return createFileSystemSource({ backend: new MemoryBackend(), viewId: 'settings-test' }); },
    } });
    const container = document.createElement('div'); document.body.append(container);
    const editor = new RemoteFilesSettingsEditor(container, runtime.projects, { target: { kind: 'file', path: 'remote-files' } } as never);
    try {
        await editor.init(container);
        expect(container.textContent).toContain(t('remote.settings'));
        expect([...container.querySelectorAll('button')].find(button => button.textContent === t('remote.connectionAdd'))?.disabled).toBe(false);
        const node = { id: '/remote-project', icon: ENTITY_ICONS.remoteProject, type: 'directory',
            metadata: { title: 'Remote project', tags: [], custom: { _disabled: true, navigationDescription: t('remote.projectOffline') } } } as any;
        const item = new DirectoryItem(node, false, { isCard: true, isExpanded: true, dirSelectionState: 'none', isSelected: false, isSelectionMode: false, searchQueries: [] });
        const child = document.createElement('button'); child.textContent = 'cached child'; item.childrenContainer.append(child);
        document.body.append(item.element);
        expect(item.element.inert).toBe(true); expect(item.element.getAttribute('aria-disabled')).toBe('true');
        expect(item.element.textContent).toContain(t('remote.projectOffline'));
        expect(item.element.querySelector('.vfs-directory-item__icon')?.textContent).toBe(ENTITY_ICONS.remoteProject);
        item.updateItem({ ...node, metadata: { ...node.metadata, custom: { _disabled: false } } });
        expect(item.element.inert).toBe(false); expect(item.childrenContainer.contains(child)).toBe(true);
        item.destroy();
    } finally { await editor.destroy(); await runtime.dispose(); document.body.replaceChildren(); }
});

it('configures multiple named servers in Storage and selects one when creating remote projects', async () => {
    const { showProjectDialog } = await import('../src/files/project-dialog');
    const original = Object.getOwnPropertyDescriptors(HTMLDialogElement.prototype);
    for (const method of ['showModal', 'close']) Object.defineProperty(HTMLDialogElement.prototype, method, { configurable: true, value: () => {} });
    const setCredential = vi.fn();
    const runtime = await createApplicationRuntime({ backend: new MemoryBackend(), ownerKind: 'web', remoteSourceProvider: {
        setCredential, async dispose() {}, async open() {
            const backend = new MemoryBackend(); await backend.init(); await backend.mkdir('/project-a');
            return createFileSystemSource({ backend, viewId: 'remote-project-form', access: 'ro' });
        },
    } });
    const container = document.createElement('div'); document.body.append(container);
    const editor = new StorageSettingsEditor(container, {
        listLocalSnapshots: async () => [], getAvailableSettingsKeys: () => [], getAvailableWorkspaces: () => [],
    } as never, {} as never, async (target, options) => {
        const remote = new RemoteFilesSettingsEditor(target, runtime.projects, options); await remote.init(target); return remote;
    });
    const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent === label)!;
    const field = (key: Parameters<typeof t>[0]) => document.querySelector<HTMLInputElement>(`[aria-label="${t(key)}"]`)!;
    try {
        await editor.init(container);
        expect(SETTINGS_PAGES['remote-files']).toBeUndefined();
        expect(container.textContent).toContain(t('storage.title'));
        expect(container.querySelector('#section-sync')).toBeNull();
        expect(container.textContent).not.toContain('远程同步');
        for (const [name, endpoint] of [['Office', '127.0.0.1:8787'], ['Home', '127.0.0.1:8788']]) {
            button(t('remote.connectionAdd')).click();
            await vi.waitFor(() => expect(document.querySelector('dialog form')).not.toBeNull());
            document.querySelector<HTMLInputElement>('dialog form input')!.value = name;
            field('remote.endpoint').value = endpoint; field('remote.username').value = 'alice'; field('remote.password').value = 'private-password';
            button(t('remote.connectionSave')).click();
            await vi.waitFor(() => expect(document.querySelector('dialog')).toBeNull());
        }
        expect(runtime.projects.remoteMounts!.connections()).toHaveLength(2);
        expect(container.querySelectorAll('.remote-settings__project')).toHaveLength(2);
        expect(container.textContent).toContain('Office'); expect(container.textContent).not.toContain('private-password');
        expect(setCredential).toHaveBeenCalledWith(expect.any(String), 'private-password');
        const created = vi.fn(async (_path: string) => {}), controller = new AbortController();
        for (const name of ['Remote A', 'Same path']) {
            const dialog = showProjectDialog(runtime.projects, null, controller.signal, created);
            await vi.waitFor(() => expect(field('remote.projectType')).not.toBeNull());
            const type = field('remote.projectType'); type.value = 'remote'; type.dispatchEvent(new Event('change'));
            expect(field('remote.connection').textContent).toContain('Office');
            field('remote.projectPath').value = '/docs/project-a/';
            document.querySelector<HTMLInputElement>('dialog form input')!.value = name;
            button(t('project.createConfirm')).click(); await dialog;
        }
        expect(created.mock.calls.map(call => call[0])).toEqual(['/Remote A', '/Remote A']);
        expect((await runtime.projects.list()).filter(project => project.name === 'Same path')).toHaveLength(0);
    } finally {
        await editor.destroy(); await runtime.dispose(); document.body.replaceChildren();
        for (const method of ['showModal', 'close']) {
            if (original[method]) Object.defineProperty(HTMLDialogElement.prototype, method, original[method]);
            else Reflect.deleteProperty(HTMLDialogElement.prototype, method);
        }
    }
});
