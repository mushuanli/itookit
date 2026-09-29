// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { ContextMenuHandler } from '../src/ui/components/NodeList/handlers/ContextMenuHandler';
import { ActionRunner } from '../src/interaction/ActionRunner';
import { VFSStore } from '../src/services/VFSStore';
import { makeVFSNodeUI } from './helpers/fixtures';

it('does not let host menus restore forbidden mutations or bulk writes', async () => {
    const store = new VFSStore();
    const node = makeVFSNodeUI(); node.metadata.custom._readOnly = true;
    store.dispatch({ type: 'ITEM_SELECTION_UPDATE', payload: { ids: [node.id], mode: 'replace' } });
    const called = vi.fn();
    const menu = new ContextMenuHandler(store, { execute: called }, {
        items: () => [{ id: 'delete', label: 'Delete', onClick: called }],
        bulkItems: () => [{ id: 'bulk-delete', label: 'Delete', onClick: called }],
    }, { findItemById: () => node, showTagEditor: vi.fn() });
    expect(menu.allows('delete', node)).toBe(false);
    expect(menu.allows('bulk-delete')).toBe(false);
    await menu.run('delete', node); await menu.run('bulk-delete');
    expect(called).not.toHaveBeenCalled();
});

it('rechecks the latest node before a queued menu action runs', async () => {
    const store = new VFSStore();
    const original = makeVFSNodeUI(); let current = original;
    const called = vi.fn();
    const runner = new ActionRunner(vi.fn());
    const menu = new ContextMenuHandler(store, { execute: called }, {
        items: () => [{ id: 'delete', label: 'Delete', onClick: called }],
    }, { findItemById: () => current, showTagEditor: vi.fn() }, 'File', true, runner);
    const pending = menu.run('delete', original);
    current = { ...original, metadata: { ...original.metadata, custom: { _readOnly: true } } };
    await pending;
    expect(called).not.toHaveBeenCalled(); runner.destroy();
});
