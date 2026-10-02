import { expect, it, vi } from 'vitest';
import { VFSStore } from '../src/services/VFSStore';
import { makeVFSNodeUI } from './helpers/fixtures';

function setup() {
    const child = makeVFSNodeUI({ id: '/folder/one.md' });
    const sibling = makeVFSNodeUI({ id: '/untouched.md' });
    const folder = makeVFSNodeUI({ id: '/folder', type: 'directory', children: [child] });
    return new VFSStore({ items: [folder, sibling], activeId: child.id, selectedItemIds: new Set([child.id]) });
}

it('copies only the edited path and preserves previous snapshots', () => {
    const store = setup(), before = store.getState();
    store.dispatch({ type: 'ITEM_METADATA_UPDATE', payload: { itemId: '/folder/one.md', metadata: { title: 'Edited' } } });
    const after = store.getState();
    expect(before.items[0].children![0].metadata.title).not.toBe('Edited');
    expect(after.items[0].children![0].metadata.title).toBe('Edited');
    expect(after.items[0]).not.toBe(before.items[0]);
    expect(after.items[1]).toBe(before.items[1]);
    expect(after.selectedItemIds).toBe(before.selectedItemIds);
});

it('does not mutate a loaded parent when inserting a child', () => {
    const store = setup(), before = store.getState();
    const created = makeVFSNodeUI({ id: '/folder/two.md' });
    created.metadata.parentPath = '/folder';
    store.dispatch({ type: 'SESSION_CREATE_SUCCESS', payload: created });
    expect(before.items[0].children!.map(node => node.id)).toEqual(['/folder/one.md']);
    expect(store.getState().items[0].children!.map(node => node.id)).toEqual(['/folder/two.md', '/folder/one.md']);
    expect(before.selectedItemIds).toEqual(new Set(['/folder/one.md']));
});

it('keeps previous descendants and selections intact through rename and deletion', () => {
    const store = setup(), before = store.getState();
    const renamed = { ...before.items[0], id: '/renamed' };
    store.dispatch({ type: 'ITEM_RENAME_SUCCESS', payload: { oldId: '/folder', newItem: renamed } });
    const middle = store.getState();
    expect(middle.items[0].children![0].id).toBe('/renamed/one.md');
    expect(before.items[0].children![0].id).toBe('/folder/one.md');
    expect(before.selectedItemIds).toEqual(new Set(['/folder/one.md']));
    store.dispatch({ type: 'ITEM_DELETE_SUCCESS', payload: { itemIds: ['/renamed/one.md'] } });
    expect(middle.items[0].children).toHaveLength(1);
    expect(store.getState().items[0].children).toHaveLength(0);
    expect(store.getState().items[1]).toBe(before.items[1]);
});

it('does not notify for unknown actions or unchanged scalar, settings and selection updates', () => {
    const store = setup(), before = store.getState(), notify = vi.fn();
    store.subscribe(notify);
    for (const action of [{ type: 'UNKNOWN' }, { type: 'SEARCH_QUERY_UPDATE', payload: { query: '' } },
        { type: 'SETTINGS_UPDATE', payload: { settings: { sortBy: 'title' } } },
        { type: 'ITEM_SELECTION_REPLACE', payload: { ids: ['/folder/one.md'] } },
        { type: 'ITEM_METADATA_UPDATE', payload: { itemId: 'absent', metadata: { title: 'Ignored' } } }]) store.dispatch(action);
    expect(store.getState()).toBe(before);
    expect(notify).not.toHaveBeenCalled();
});

it('dispatches action hooks before subscribers and does not mutate settings or expansion snapshots', () => {
    const store = setup(), before = store.getState(), calls: string[] = [];
    store.onAction(() => calls.push('action'));
    store.subscribe(() => calls.push('state'));
    store.dispatch({ type: 'SETTINGS_UPDATE', payload: { settings: { density: 'compact' } } });
    store.dispatch({ type: 'FOLDER_TOGGLE', payload: { folderId: '/folder' } });
    expect(calls).toEqual(['action', 'state', 'action', 'state']);
    expect(before.uiSettings.density).toBe('comfortable');
    expect(before.expandedFolderIds.size).toBe(0);
    expect(store.getState().expandedFolderIds.has('/folder')).toBe(true);
});

it('preserves selection order changes because the first selected item determines the operation target', () => {
    const store = setup();
    store.dispatch({ type: 'ITEM_SELECTION_REPLACE', payload: { ids: ['/folder/one.md', '/untouched.md'] } });
    const before = store.getState(), notify = vi.fn(); store.subscribe(notify);
    store.dispatch({ type: 'ITEM_SELECTION_REPLACE', payload: { ids: ['/untouched.md', '/folder/one.md'] } });
    expect([...store.getState().selectedItemIds]).toEqual(['/untouched.md', '/folder/one.md']);
    expect([...before.selectedItemIds]).toEqual(['/folder/one.md', '/untouched.md']);
    expect(notify).toHaveBeenCalledTimes(1);
});
