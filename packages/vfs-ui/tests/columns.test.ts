// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createVFS, MemoryBackend } from '@itookit/vfs-core';
import { createVFSUI, type VFSNodeUI, type VFSUIShell } from '../src';

beforeEach(() => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value) });
});
afterEach(() => { document.body.replaceChildren(); vi.unstubAllGlobals(); });

const projects = (items: VFSNodeUI[]): VFSNodeUI[] => items.filter(item => item.type === 'directory')
    .map(item => ({ ...item, children: item.id.split('/').length === 3 ? undefined : item.children && projects(item.children) }));

async function fixture(columns = true) {
    const { manager } = await createVFS({ rootBackend: new MemoryBackend() });
    const fs = await manager.openFileSystem('/');
    await fs.driver.createDirectory({ parentPath: '/teams', name: 'one', recursive: true });
    await fs.driver.createDirectory({ parentPath: '/teams', name: 'two', recursive: true });
    for (const name of ['notes.md', 'plan.md']) await fs.driver.createFile({ parentPath: '/teams/one', name, content: name });
    await fs.driver.createFile({ parentPath: '/teams/two', name: 'other.md', content: 'other' });
    const container = document.createElement('div'); document.body.append(container);
    const ui = createVFSUI({ sessionListContainer: container, scopeId: 'column-test', autoSelectFirst: false,
        activateDirectories: true, showFileExtensions: true, toolbar: 'compact',
        columns: columns ? { navigationTitle: 'Projects', navigationItems: projects,
            navigationLeaf: item => item.id.split('/').length === 3 } : undefined }, fs) as VFSUIShell;
    await ui.start();
    return { container, ui, fs, async destroy() { ui.destroy(); await manager.dispose(); } };
}

it('keeps the default single column and existing path navigation', async () => {
    const f = await fixture(false);
    try {
        expect(f.container.querySelector('.vfs-columns')).toBeNull();
        expect(f.container.querySelectorAll('.vfs-node-list')).toHaveLength(1);
        await f.ui.selectPath('/teams/one/notes.md');
        expect(f.ui.getActiveSession()?.id).toBe('/teams/one/notes.md');
    } finally { await f.destroy(); }
});

it('uses independent searches and scopes creation to the displayed content root', async () => {
    const f = await fixture();
    try {
        await f.ui.setContentRoot('/teams/one', 'One');
        const nav = f.container.querySelector('.vfs-columns__navigation')!;
        const content = f.container.querySelector('.vfs-columns__content')!;
        expect(nav.textContent).not.toContain('notes.md');
        expect(content.textContent).toContain('notes.md');
        const search = nav.querySelector<HTMLInputElement>('input[type=search]')!;
        search.value = 'two'; search.dispatchEvent(new Event('input'));
        await vi.waitFor(() => expect(nav.querySelector('[data-item-id="/teams/one"]')).toBeNull());
        expect(content.textContent).toContain('notes.md');
        (content.querySelector('[data-action="create-directory"]') as HTMLButtonElement).click();
        await vi.waitFor(() => expect(content.querySelector('[data-action="create-input"]')).not.toBeNull());
        const input = content.querySelector<HTMLInputElement>('[data-action="create-input"]')!;
        input.value = 'research'; input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        await vi.waitFor(async () => expect(await f.fs.driver.getNode('/teams/one/research')).not.toBeNull());
        expect(await f.fs.driver.getNode('/research')).toBeNull();
        await f.ui.setContentRoot('/teams/two', 'Two');
        expect(content.textContent).toContain('other.md'); expect(content.textContent).not.toContain('notes.md');
        await f.ui.refresh(); expect(content.textContent).toContain('other.md');
        expect(search.value).toBe('two');
    } finally { await f.destroy(); }
});

it('isolates bulk selection and supports returning to the navigation column', async () => {
    const f = await fixture();
    try {
        await f.ui.setContentRoot('/teams/one');
        const nav = f.container.querySelector('.vfs-columns__navigation')!;
        const content = f.container.querySelector('.vfs-columns__content')!;
        const click = (element: Element | null) => element!.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
        click(content.querySelector('[data-item-id="/teams/one/notes.md"] .vfs-node-item__content'));
        click(content.querySelector('[data-item-id="/teams/one/plan.md"] .vfs-node-item__content'));
        click(nav.querySelector('[data-item-id="/teams/two"] .vfs-directory-item__header'));
        expect(content.querySelector('.vfs-node-list__footer')?.textContent).toContain('已选择 2 项');
        expect(nav.querySelector('.vfs-node-list__footer')?.textContent).not.toContain('已选择 2 项');
        expect(f.container.querySelector('.vfs-columns')?.getAttribute('data-column')).toBe('content');
        (content.querySelector('.vfs-columns__back') as HTMLButtonElement).click();
        expect(f.container.querySelector('.vfs-columns')?.getAttribute('data-column')).toBe('navigation');
    } finally { await f.destroy(); }
});

it('follows a renamed content root and removes deleted entries from both views', async () => {
    const f = await fixture();
    try {
        await f.ui.setContentRoot('/teams/one');
        await f.fs.driver.rename('/teams/one', 'renamed');
        await vi.waitFor(() => expect(f.ui.getContentRoot()).toBe('/teams/renamed'));
        const content = f.container.querySelector('.vfs-columns__content')!;
        expect(content.querySelector('[data-item-id="/teams/renamed/notes.md"]')).not.toBeNull();
        await f.fs.driver.delete(['/teams/renamed']);
        await vi.waitFor(() => expect(content.textContent).not.toContain('notes.md'));
        expect(f.container.querySelector('[data-item-id="/teams/renamed"]')).toBeNull();
    } finally { await f.destroy(); }
});
