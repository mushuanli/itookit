/**
 * Tests for VFSStore state transitions.
 * Covers create/delete/update actions and their effect on items tree.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { VFSStore } from '../services/VFSStore';
import type { VFSNodeUI } from '../contracts/types';
import { makeVFSNodeUI } from './helpers/fixtures';

// ── Setup ────────────────────────────────────────────────────────────────────

let store: VFSStore;

const file = (id: string, parentId: string | null = null, overrides: Partial<VFSNodeUI> = {}): VFSNodeUI =>
    makeVFSNodeUI({ id, metadata: { ...makeVFSNodeUI().metadata, parentId, path: `/${id}`, title: id }, ...overrides });

const dir = (id: string, parentId: string | null = null, children: VFSNodeUI[] = []): VFSNodeUI =>
    makeVFSNodeUI({ id, type: 'directory', content: undefined, metadata: { ...makeVFSNodeUI().metadata, parentId, path: `/${id}`, title: id }, children });

beforeEach(() => {
    store = new VFSStore();
});

// ── STATE_LOAD_SUCCESS ───────────────────────────────────────────────────────

describe('STATE_LOAD_SUCCESS', () => {
    it('populates items and tags', () => {
        const item = file('f1');
        store.dispatch({ type: 'STATE_LOAD_SUCCESS', payload: { items: [item], tags: new Map() } });
        expect(store.getState().items).toHaveLength(1);
        expect(store.getState().items[0].id).toBe('f1');
        expect(store.getState().status).toBe('success');
    });

    it('replaces existing items', () => {
        store.dispatch({ type: 'STATE_LOAD_SUCCESS', payload: { items: [file('a')], tags: new Map() } });
        store.dispatch({ type: 'STATE_LOAD_SUCCESS', payload: { items: [file('b'), file('c')], tags: new Map() } });
        expect(store.getState().items.map(i => i.id)).toEqual(['b', 'c']);
    });
});

// ── SESSION_CREATE_SUCCESS ───────────────────────────────────────────────────

describe('SESSION_CREATE_SUCCESS', () => {
    it('prepends file to root when no parentId', () => {
        store.dispatch({ type: 'SESSION_CREATE_SUCCESS', payload: file('new-file') });
        const { items, activeId } = store.getState();
        expect(items[0].id).toBe('new-file');
        expect(activeId).toBe('new-file');
    });

    it('inserts file into parent directory children', () => {
        store.dispatch({ type: 'STATE_LOAD_SUCCESS', payload: { items: [dir('folder-1')], tags: new Map() } });
        store.dispatch({ type: 'SESSION_CREATE_SUCCESS', payload: file('child-1', 'folder-1') });

        const folder = store.getState().items.find(i => i.id === 'folder-1');
        expect(folder?.children?.[0].id).toBe('child-1');
        expect(store.getState().activeId).toBe('child-1');
    });

    it('sets activeId and selectedItemIds to newly created file', () => {
        store.dispatch({ type: 'SESSION_CREATE_SUCCESS', payload: file('f1') });
        const { activeId, selectedItemIds } = store.getState();
        expect(activeId).toBe('f1');
        expect(selectedItemIds.has('f1')).toBe(true);
    });
});

// ── FOLDER_CREATE_SUCCESS ────────────────────────────────────────────────────

describe('FOLDER_CREATE_SUCCESS', () => {
    it('prepends directory to root', () => {
        store.dispatch({ type: 'FOLDER_CREATE_SUCCESS', payload: dir('new-dir') });
        expect(store.getState().items[0].id).toBe('new-dir');
    });

    it('does NOT set activeId for a new directory', () => {
        store.dispatch({ type: 'FOLDER_CREATE_SUCCESS', payload: dir('new-dir') });
        expect(store.getState().activeId).toBeNull();
    });

    it('expands parent when nested', () => {
        store.dispatch({ type: 'STATE_LOAD_SUCCESS', payload: { items: [dir('parent')], tags: new Map() } });
        store.dispatch({ type: 'FOLDER_CREATE_SUCCESS', payload: dir('child-dir', 'parent') });
        expect(store.getState().expandedFolderIds.has('parent')).toBe(true);
    });
});

// ── ITEM_DELETE_SUCCESS ───────────────────────────────────────────────────────

describe('ITEM_DELETE_SUCCESS', () => {
    it('removes file from root', () => {
        store.dispatch({ type: 'STATE_LOAD_SUCCESS', payload: { items: [file('f1'), file('f2')], tags: new Map() } });
        store.dispatch({ type: 'ITEM_DELETE_SUCCESS', payload: { itemIds: ['f1'] } });
        expect(store.getState().items.map(i => i.id)).toEqual(['f2']);
    });

    it('clears activeId when active file is deleted', () => {
        store.dispatch({ type: 'STATE_LOAD_SUCCESS', payload: { items: [file('f1')], tags: new Map() } });
        store.dispatch({ type: 'SESSION_CREATE_SUCCESS', payload: file('f1') }); // set active
        store.dispatch({ type: 'ITEM_DELETE_SUCCESS', payload: { itemIds: ['f1'] } });
        expect(store.getState().activeId).toBeNull();
    });

    it('removes nested file from directory children', () => {
        const parentDir = dir('d1', null, [file('child', 'd1')]);
        store.dispatch({ type: 'STATE_LOAD_SUCCESS', payload: { items: [parentDir], tags: new Map() } });
        store.dispatch({ type: 'ITEM_DELETE_SUCCESS', payload: { itemIds: ['child'] } });

        const remaining = store.getState().items[0].children;
        expect(remaining).toHaveLength(0);
    });

    it('handles batch delete of multiple IDs', () => {
        store.dispatch({ type: 'STATE_LOAD_SUCCESS', payload: { items: [file('a'), file('b'), file('c')], tags: new Map() } });
        store.dispatch({ type: 'ITEM_DELETE_SUCCESS', payload: { itemIds: ['a', 'c'] } });
        expect(store.getState().items.map(i => i.id)).toEqual(['b']);
    });
});

// ── ITEMS_BATCH_UPDATE_SUCCESS ────────────────────────────────────────────────

describe('ITEMS_BATCH_UPDATE_SUCCESS', () => {
    it('updates existing item in-place', () => {
        const original = file('f1');
        store.dispatch({ type: 'STATE_LOAD_SUCCESS', payload: { items: [original], tags: new Map() } });

        const updated = file('f1', null, { icon: '🔥' });
        store.dispatch({
            type: 'ITEMS_BATCH_UPDATE_SUCCESS',
            payload: { updates: [{ itemId: 'f1', data: updated }] },
        });

        expect(store.getState().items[0].icon).toBe('🔥');
    });
});

// ── Subscriber notification ───────────────────────────────────────────────────

describe('subscriber notifications', () => {
    it('notifies subscribers on state change', () => {
        const snapshots: number[] = [];
        store.subscribe(state => snapshots.push(state.items.length));

        store.dispatch({ type: 'SESSION_CREATE_SUCCESS', payload: file('f1') });
        store.dispatch({ type: 'SESSION_CREATE_SUCCESS', payload: file('f2') });

        expect(snapshots).toEqual([1, 2]);
    });

    it('unsubscribe stops further notifications', () => {
        const calls: number[] = [];
        const unsub = store.subscribe(() => calls.push(1));
        store.dispatch({ type: 'SESSION_CREATE_SUCCESS', payload: file('a') });
        unsub();
        store.dispatch({ type: 'SESSION_CREATE_SUCCESS', payload: file('b') });
        expect(calls).toHaveLength(1);
    });
});
