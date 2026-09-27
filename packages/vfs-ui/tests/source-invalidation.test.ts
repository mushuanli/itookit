import { expect, it, vi } from 'vitest';
import { SourceAdapter } from '../src/browser/SourceAdapter';
import { VFSStore } from '../src/services/VFSStore';
import type { BrowserNode, SourceChange } from '../src/contracts/source';

it('refreshes only affected loaded parents and retains sibling subtrees', async () => {
  const directory = (id: string): BrowserNode => ({ id, parentId: null, kind: 'directory', label: id });
  let changed!: (event: SourceChange) => void;
  const children = vi.fn(async (id: string | null): Promise<BrowserNode[]> => id === null
    ? [directory('a'), directory('b'), directory('unopened')]
    : [{ id: id + '-child', parentId: id, kind: 'file', label: id + '-child' }]);
  const source = { children, get: async () => undefined, subscribe: (cb: typeof changed) => { changed = cb; return () => {}; } };
  const store = new VFSStore(), adapter = new SourceAdapter(source, store);
  adapter.connectEngineEvents(); await adapter.loadData();
  await adapter.expandDirectory('a'); await adapter.expandDirectory('b'); children.mockClear();
  changed({ parentIds: ['a', 'a', 'unopened'] });
  await vi.waitFor(() => expect(children).toHaveBeenCalledOnce());
  expect(children.mock.calls[0][0]).toBe('a');
  expect(store.getState().items.find(node => node.id === 'b')?.children?.[0].id).toBe('b-child');
  children.mockClear(); changed({ parentIds: [null] });
  await vi.waitFor(() => expect(children).toHaveBeenCalledOnce());
  expect(children.mock.calls[0][0]).toBeNull();
  expect(store.getState().items.find(node => node.id === 'b')?.children?.[0].id).toBe('b-child');
  adapter.destroy();
});

it('maps moves to both parents and ignores changes outside a scoped VFS root', async () => {
  const { fromVFS } = await import('../src/browser/from-vfs');
  const events = new Map<string, (event: any) => void>(), listener = vi.fn();
  const fs = { on: (name: string, callback: (event: any) => void) => { events.set(name, callback); return () => events.delete(name); } };
  const unsubscribe = fromVFS(fs as any, { root: '/scope' }).subscribe(listener);
  events.get('node:moved')!({ payload: { nodes: [{ oldPath: '/scope/a/file', newPath: '/scope/b/file' }] } });
  expect(listener).toHaveBeenLastCalledWith({ parentIds: ['/scope/a', '/scope/b'] });
  events.get('node:updated')!({ payload: { nodes: [{ path: '/elsewhere/file' }] } });
  expect(listener).toHaveBeenCalledOnce();
  events.get('node:created')!({ payload: { nodes: [{ path: '/scope/new' }] } });
  expect(listener).toHaveBeenLastCalledWith({ parentIds: [null] });
  unsubscribe(); expect(events.size).toBe(0);
});
