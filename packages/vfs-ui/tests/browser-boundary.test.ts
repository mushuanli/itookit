// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createVFSBrowser, createVFSUI, fromVFS, type ActionContext, type BrowserAction, type BrowserNode, type BrowserSource } from '../src';
import { createVFS, MemoryBackend } from '@itookit/vfs-core';
import { ActionRunner } from '../src/interaction/ActionRunner';
import { CommandBus } from '../src/interaction/CommandBus';

const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function container(): HTMLElement { const node = document.createElement('div'); document.body.append(node); return node; }
const entries: BrowserNode[] = [
  { id: 'drawer', parentId: null, kind: 'group', label: 'Drawer', presentation: 'drawer' },
  { id: 'resource:one', parentId: 'drawer', kind: 'file', label: 'One', resource: { viewId: 'private', path: '/real/one' }, tags: ['example'], modifiedAt: 1000, expandable: false },
];
function source(nodes = entries): BrowserSource {
  return { get: async id => nodes.find(node => node.id === id), children: async parent => nodes.filter(node => node.parentId === parent), subscribe: () => () => {} };
}
it('navigates opaque display IDs and passes canonical resources to the host', async () => {
  const open = vi.fn(), root = container(), browser = createVFSBrowser({ container: root, source: source(), onActivate: open });
  cleanups.push(() => browser.destroy()); await browser.start(); await browser.reveal('resource:one');
  expect(open).toHaveBeenCalledWith(expect.objectContaining({ id: 'resource:one', resource: { viewId: 'private', path: '/real/one' }, tags: ['example'], modifiedAt: 1000, expandable: false }));
  expect(root.textContent).toContain('One');
  root.querySelector<HTMLButtonElement>('[data-item-id="drawer"] [data-action="item-menu"]')!.click();
  expect(document.querySelector('.vfs-context-menu')).toBeNull();
  expect(root.querySelector('[data-action="create-file"]')).toBeNull();
});
it('uses one async action in the toolbar and menu and honors its disabled state', async () => {
  const root = container(), run = vi.fn(async (_context: ActionContext) => {}), action: BrowserAction = {
    id: 'archive', label: 'Archive', placements: ['toolbar', 'menu'],
    state: context => ({ visible: true, enabled: context.selection.length > 0 }), run,
  };
  const browser = createVFSBrowser({ container: root, source: source(), actions: [action] });
  cleanups.push(() => browser.destroy()); await browser.start();
  expect(root.querySelector<HTMLButtonElement>('[data-action="archive"]')!.disabled).toBe(true);
  await browser.reveal('resource:one'); root.querySelector<HTMLButtonElement>('[data-action="archive"]')!.click();
  await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));
  await vi.waitFor(() => expect(root.querySelector<HTMLButtonElement>('[data-action="archive"]')!.disabled).toBe(false));
  root.querySelector<HTMLButtonElement>('[data-item-id="resource:one"] [data-action="item-menu"]')!.click();
  document.querySelector<HTMLButtonElement>('.vfs-context-menu [data-action="archive"]')!.click();
  await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(2));
  expect(run.mock.calls[0][0].selection[0].resource?.path).toBe('/real/one');
});
it('does not let the bulk footer bypass the host menu policy', async () => {
  const { manager } = await createVFS({ rootBackend: new MemoryBackend() }); cleanups.push(() => manager.dispose());
  const fs = await manager.openFileSystem('/'); await fs.driver.createFile({ name: 'safe.md', content: 'Keep' });
  await fs.driver.createFile({ name: 'another.md', content: 'Keep' });
  const root = container(), ui = createVFSUI({ sessionListContainer: root, persistence: false, contextMenu: { bulkItems: () => [] } }, fs);
  cleanups.push(() => ui.destroy()); await ui.start(); ui.setSelection(['/safe.md', '/another.md']);
  expect(root.querySelector<HTMLButtonElement>('[data-action="bulk-delete"]')?.hidden).toBe(true);
  root.querySelector<HTMLButtonElement>('[data-action="bulk-delete"]')?.click();
  expect(await fs.driver.exists('/safe.md')).toBe(true);
  const snapshot = ui.getSnapshot(); expect(Object.isFrozen(snapshot.selectedIds)).toBe(true);
});
it('keeps a VFS adapter inside its configured root', async () => {
  const { manager } = await createVFS({ rootBackend: new MemoryBackend() }); cleanups.push(() => manager.dispose());
  const fs = await manager.openFileSystem('/'); await fs.driver.createDirectory({ name: 'visible' });
  await fs.driver.createFile({ name: 'inside.md', parentPath: '/visible', content: '' });
  await fs.driver.createFile({ name: 'outside.md', content: '' });
  const data = fromVFS(fs, { root: '/visible' });
  expect((await data.children(null)).map(item => item.parentId)).toEqual([null]);
  expect(await data.get('/outside.md')).toBeUndefined(); expect(await data.children('/')).toEqual([]);
});
it('awaits command failures and prevents duplicate in-flight actions', async () => {
  const error = new Error('failed'), bus = new CommandBus(); vi.spyOn(console, 'error').mockImplementation(() => {});
  bus.on('file:delete', async () => { throw error; });
  await expect(bus.execute('file:delete', { itemIds: ['one'] })).rejects.toBe(error);
  let finish!: () => void; const run = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
  const runner = new ActionRunner(vi.fn()); cleanups.push(() => runner.destroy());
  const first = runner.run('delete', run), second = runner.run('delete', run);
  expect(first).toBe(second); await Promise.resolve(); expect(run).toHaveBeenCalledTimes(1); finish(); await first;
});
