/**
 * Integration tests for EngineAdapter event handling.
 *
 * Verifies the full pipeline:
 *   VFS event (FSNodeCreatedPayload / ...) → EngineAdapter → VFSStore dispatch → state change
 *
 * These tests catch payload-shape mismatches and Set.has() vs `in` bugs.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EngineAdapter } from '../services/EngineAdapter';
import { VFSStore } from '../services/VFSStore';
import {
    MockSessionEngine,
    mockFileTypePort,
    makeEngineNode,
    makeDirectoryNode,
    makeVFSNodeUI,
    sleep,
    createdPayload,
    updatedPayload,
    deletedPayload,
} from './helpers/fixtures';

// ── Debounce timing constants (must exceed EngineAdapter's internal delays) ──
// create/update: 50ms → use 120ms; delete: 20ms → use 80ms
const AFTER_CREATE = 120;
const AFTER_DELETE = 80;
const AFTER_UPDATE = 120;

// ── Helpers ──────────────────────────────────────────────────────────────────

let engine: MockSessionEngine;
let store: VFSStore;
let adapter: EngineAdapter;
let unsub: (() => void) | null;

beforeEach(() => {
    engine = new MockSessionEngine();
    store = new VFSStore();
    adapter = new EngineAdapter(engine as any, store, mockFileTypePort);
    unsub = adapter.connectEngineEvents();
});

afterEach(() => {
    unsub?.();
    adapter.destroy();
});

// ── node:created → SESSION_CREATE_SUCCESS ────────────────────────────────────

describe('node:created event', () => {
    it('adds a new file to store after debounce', async () => {
        const node = makeEngineNode({ id: 'f1', name: 'chat.chat', path: '/chat.chat' });
        engine.nodes.set('f1', node);

        engine.emit('node:created', createdPayload([{ nodeId: 'f1', path: '/chat.chat' }]));

        // Before debounce fires — store should still be empty
        expect(store.getState().items).toHaveLength(0);

        await sleep(AFTER_CREATE);

        expect(store.getState().items).toHaveLength(1);
        expect(store.getState().items[0].id).toBe('f1');
        expect(store.getState().activeId).toBe('f1');
    });

    it('adds a new directory to store', async () => {
        const node = makeDirectoryNode({ id: 'd1', name: 'folder', path: '/folder' });
        engine.nodes.set('d1', node);

        engine.emit('node:created', createdPayload([{ nodeId: 'd1', path: '/folder', type: 'directory' }]));
        await sleep(AFTER_CREATE);

        const items = store.getState().items;
        expect(items).toHaveLength(1);
        expect(items[0].type).toBe('directory');
        // Directory creation should NOT set activeId
        expect(store.getState().activeId).toBeNull();
    });

    it('coalesces multiple create events into one batch', async () => {
        engine.nodes.set('f1', makeEngineNode({ id: 'f1', path: '/a.chat' }));
        engine.nodes.set('f2', makeEngineNode({ id: 'f2', name: 'b.chat', path: '/b.chat' }));

        // Fire two events rapidly — both should coalesce into one processQueue call
        engine.emit('node:created', createdPayload([{ nodeId: 'f1', path: '/a.chat' }]));
        engine.emit('node:created', createdPayload([{ nodeId: 'f2', path: '/b.chat' }]));

        await sleep(AFTER_CREATE);

        expect(store.getState().items).toHaveLength(2);
    });

    it('inserts file into parent directory when parentId is set', async () => {
        // Pre-populate store with a directory
        store.dispatch({
            type: 'STATE_LOAD_SUCCESS',
            payload: {
                items: [makeVFSNodeUI({ id: 'dir-1', type: 'directory', content: undefined, children: [] })],
                tags: new Map(),
            },
        });

        const childNode = makeEngineNode({ id: 'child-1', parentId: 'dir-1', path: '/folder/child-1.chat' });
        engine.nodes.set('child-1', childNode);

        engine.emit('node:created', createdPayload([{ nodeId: 'child-1', parentId: 'dir-1', path: '/folder/child-1.chat' }]));
        await sleep(AFTER_CREATE);

        const dir = store.getState().items.find(i => i.id === 'dir-1');
        expect(dir?.children?.some(c => c.id === 'child-1')).toBe(true);
    });

    it('IGNORES asset-dir files (path inside _ prefix directory)', async () => {
        // Asset dir files like /_my-session.chat/000_00000_s.chat must be filtered
        const assetNode = makeEngineNode({
            id: 'asset-1',
            name: '000_00000_s.chat',
            path: '/_my-session.chat/000_00000_s.chat',
        });
        engine.nodes.set('asset-1', assetNode);

        engine.emit('node:created', createdPayload([{
            nodeId: 'asset-1',
            path: '/_my-session.chat/000_00000_s.chat',
        }]));
        await sleep(AFTER_CREATE);

        expect(store.getState().items).toHaveLength(0);
    });

    it('IGNORES the asset directory itself (_ prefix name)', async () => {
        const assetDir = makeDirectoryNode({
            id: 'asset-dir-1',
            name: '_my-session.chat',
            path: '/_my-session.chat',
        });
        engine.nodes.set('asset-dir-1', assetDir);

        engine.emit('node:created', createdPayload([{
            nodeId: 'asset-dir-1',
            path: '/_my-session.chat',
            type: 'directory',
        }]));
        await sleep(AFTER_CREATE);

        expect(store.getState().items).toHaveLength(0);
    });

    it('IGNORES hidden dot-prefix nodes', async () => {
        const hiddenNode = makeEngineNode({ id: 'h1', name: '.hidden', path: '/.hidden' });
        engine.nodes.set('h1', hiddenNode);

        engine.emit('node:created', createdPayload([{ nodeId: 'h1', path: '/.hidden' }]));
        await sleep(AFTER_CREATE);

        expect(store.getState().items).toHaveLength(0);
    });

    it('returns null from getNode → item is not added', async () => {
        // engine.nodes does NOT have 'ghost-1' → getNode returns null
        engine.emit('node:created', createdPayload([{ nodeId: 'ghost-1', path: '/ghost.chat' }]));
        await sleep(AFTER_CREATE);

        expect(store.getState().items).toHaveLength(0);
    });
});

// ── node:deleted → ITEM_DELETE_SUCCESS ──────────────────────────────────────

describe('node:deleted event', () => {
    const preloadFile = (id: string) => {
        store.dispatch({
            type: 'STATE_LOAD_SUCCESS',
            payload: {
                items: [makeVFSNodeUI({ id, metadata: { ...makeVFSNodeUI().metadata, path: `/${id}` } })],
                tags: new Map(),
            },
        });
    };

    it('removes file from store after debounce', async () => {
        preloadFile('f1');
        expect(store.getState().items).toHaveLength(1);

        engine.emit('node:deleted', deletedPayload(['f1']));
        await sleep(AFTER_DELETE);

        expect(store.getState().items).toHaveLength(0);
    });

    it('uses allDeletedIds (not requestedIds alone) for cascade deletions', async () => {
        // Pre-load both parent and child
        store.dispatch({
            type: 'STATE_LOAD_SUCCESS',
            payload: {
                items: [
                    makeVFSNodeUI({ id: 'parent' }),
                    makeVFSNodeUI({ id: 'child' }),
                ],
                tags: new Map(),
            },
        });

        // requestedIds = only 'parent', but allDeletedIds includes cascaded 'child' too
        engine.emit('node:deleted', deletedPayload(['parent'], ['parent', 'child']));
        await sleep(AFTER_DELETE);

        expect(store.getState().items).toHaveLength(0);
    });

    it('node:deleted with multiple allDeletedIds handles batch deletion', async () => {
        // In the real VFS, node:batch_deleted maps to the same FS node:deleted event.
        // EngineAdapter subscribes only to node:deleted (no duplicate batch subscription).
        // Simulate a batch delete by emitting node:deleted with multiple IDs.
        store.dispatch({
            type: 'STATE_LOAD_SUCCESS',
            payload: {
                items: [makeVFSNodeUI({ id: 'f1' }), makeVFSNodeUI({ id: 'f2' })],
                tags: new Map(),
            },
        });

        engine.emit('node:deleted', deletedPayload(['f1', 'f2']));
        await sleep(AFTER_DELETE);

        expect(store.getState().items).toHaveLength(0);
    });

    it('clears activeId when active file is deleted', async () => {
        store.dispatch({ type: 'SESSION_CREATE_SUCCESS', payload: makeVFSNodeUI({ id: 'f1' }) });
        expect(store.getState().activeId).toBe('f1');

        engine.emit('node:deleted', deletedPayload(['f1']));
        await sleep(AFTER_DELETE);

        expect(store.getState().activeId).toBeNull();
    });
});

// ── node:updated → ITEMS_BATCH_UPDATE_SUCCESS ────────────────────────────────

describe('node:updated event', () => {
    it('updates existing item in store', async () => {
        // Pre-load with icon '📄'
        store.dispatch({
            type: 'STATE_LOAD_SUCCESS',
            payload: { items: [makeVFSNodeUI({ id: 'f1', icon: '📄' })], tags: new Map() },
        });

        // Update: engine.getNode returns node with new icon
        const updatedNode = makeEngineNode({ id: 'f1', path: '/f1.chat' });
        engine.nodes.set('f1', { ...updatedNode, icon: '🔥' });

        engine.emit('node:updated', updatedPayload([{ nodeId: 'f1', path: '/f1.chat' }]));
        await sleep(AFTER_UPDATE);

        expect(store.getState().items[0].icon).toBe('🔥');
    });

    it('REMOVES item from store when updated node becomes a filtered (hidden) node', async () => {
        // Pre-load a regular file
        store.dispatch({
            type: 'STATE_LOAD_SUCCESS',
            payload: { items: [makeVFSNodeUI({ id: 'f1' })], tags: new Map() },
        });

        // After update, getNode returns a node that shouldFilterNode → true (dot prefix path)
        engine.nodes.set('f1', makeEngineNode({ id: 'f1', name: '.hidden', path: '/.hidden' }));

        engine.emit('node:updated', updatedPayload([{ nodeId: 'f1', path: '/.hidden' }]));
        await sleep(AFTER_UPDATE);

        // shouldFilterNode returned true → ITEM_DELETE_SUCCESS was dispatched
        expect(store.getState().items).toHaveLength(0);
    });

    it('node:updated with multiple nodes handles batch update (same FS event as batch_updated)', async () => {
        // node:batch_updated maps to same FS node:updated — EngineAdapter subscribes only to node:updated.
        store.dispatch({
            type: 'STATE_LOAD_SUCCESS',
            payload: {
                items: [makeVFSNodeUI({ id: 'a', icon: '📄' }), makeVFSNodeUI({ id: 'b', icon: '📄' })],
                tags: new Map(),
            },
        });

        engine.nodes.set('a', makeEngineNode({ id: 'a', path: '/a.chat', icon: '🅰' }));
        engine.nodes.set('b', makeEngineNode({ id: 'b', path: '/b.chat', icon: '🅱' }));

        engine.emit('node:updated', updatedPayload([
            { nodeId: 'a', path: '/a.chat' },
            { nodeId: 'b', path: '/b.chat' },
        ]));
        await sleep(AFTER_UPDATE);

        const ids = store.getState().items.map(i => i.id);
        expect(ids).toContain('a');
        expect(ids).toContain('b');
    });
});

// ── connectEngineEvents subscriptions ────────────────────────────────────────

describe('connectEngineEvents subscription lifecycle', () => {
    it('returned unsubscribe stops receiving events', async () => {
        const node = makeEngineNode({ id: 'f1', path: '/f1.chat' });
        engine.nodes.set('f1', node);

        // Unsubscribe immediately after subscribing
        unsub?.();
        unsub = null;

        engine.emit('node:created', createdPayload([{ nodeId: 'f1', path: '/f1.chat' }]));
        await sleep(AFTER_CREATE);

        // Should receive nothing
        expect(store.getState().items).toHaveLength(0);
    });

    it('subscribes to exactly 4 base FS event types (no duplicate batch subscriptions)', () => {
        // batch events (node:batch_updated/moved/deleted) map to the same underlying FS
        // event as their base counterparts. Subscribing to both would fire handleEvent twice
        // for a single FS event. EngineAdapter now subscribes only to the 4 base types.
        const origOn = engine.on.bind(engine);
        // Rebuild adapter with an instrumented engine
        const spy = new MockSessionEngine();
        const registeredTypes: string[] = [];
        spy.on = (event, cb) => {
            registeredTypes.push(event);
            return origOn(event, cb);
        };

        const tempAdapter = new EngineAdapter(spy as any, store, mockFileTypePort);
        tempAdapter.connectEngineEvents();
        tempAdapter.destroy();

        const expected = [
            'node:created', 'node:updated', 'node:deleted', 'node:moved',
        ];
        expected.forEach(t => expect(registeredTypes).toContain(t));
        // Batch variants must NOT be subscribed (they share the same FS event as their base)
        ['node:batch_updated', 'node:batch_moved', 'node:batch_deleted'].forEach(t =>
            expect(registeredTypes).not.toContain(t)
        );
        expect(registeredTypes).toHaveLength(4);
    });
});

// ── loadData ──────────────────────────────────────────────────────────────────

describe('loadData', () => {
    it('dispatches STATE_LOAD_SUCCESS with mapped tree', async () => {
        const node = makeEngineNode({ id: 'f1', path: '/f1.chat' });
        node.content = 'hello';

        // Override loadTree to return nodes
        engine.loadTree = async () => [node];

        await adapter.loadData();

        const state = store.getState();
        expect(state.status).toBe('success');
        expect(state.items).toHaveLength(1);
        expect(state.items[0].id).toBe('f1');
    });

    it('filters hidden nodes from tree during load', async () => {
        const hidden = makeEngineNode({ id: 'h1', name: '.hidden', path: '/.hidden' });
        const assetDir = makeDirectoryNode({ id: 'ad1', name: '_session.chat', path: '/_session.chat' });
        const visible = makeEngineNode({ id: 'v1', name: 'visible.chat', path: '/visible.chat' });

        engine.loadTree = async () => [hidden, assetDir, visible];

        await adapter.loadData();

        const ids = store.getState().items.map(i => i.id);
        expect(ids).not.toContain('h1');
        expect(ids).not.toContain('ad1');
        expect(ids).toContain('v1');
    });

    it('dispatches ITEMS_LOAD_ERROR on loadTree failure', async () => {
        engine.loadTree = async () => { throw new Error('storage error'); };

        await adapter.loadData();

        expect(store.getState().status).toBe('error');
    });
});
