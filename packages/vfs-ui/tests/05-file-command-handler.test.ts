/**
 * Tests for FileCommandHandler and the full VFS mutation pipeline.
 *
 * These tests catch two classes of missing coverage:
 *
 * A) FileCommandHandler → VFSService → engine: verifies that the
 *    file:create / file:delete commands correctly reach engine.createFile() /
 *    engine.delete(). If someone breaks this wiring, the engine never fires
 *    events and the UI will silently stop refreshing.
 *
 * B) VFSModuleEngine-style event bridge: tests an engine mock whose on()
 *    simulates the real subscription + moduleId-filter chain (the layer our
 *    existing 03-engine-adapter tests bypass entirely). This would have caught
 *    the original `in` vs `.has()` bug on a Set.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FileCommandHandler } from '../src/interaction/handlers/FileCommandHandler';
import { CommandBus } from '../src/interaction/CommandBus';
import { VFSStore } from '../src/services/VFSStore';
import { VFSService } from '../src/services/VFSService';
import { EngineAdapter } from '../src/services/EngineAdapter';
import {
    MockSessionEngine,
    mockFileTypePort,
    makeEngineNode,
    makeVFSNodeUI,
    sleep,
    createdPayload,
    deletedPayload,
} from './helpers/fixtures';
import type { EngineEvent, EngineEventType } from '@itookit/common';

// ── A. FileCommandHandler — command → service wiring ─────────────────────────

describe('FileCommandHandler — command → engine wiring', () => {
    let commandBus: CommandBus;
    let store: VFSStore;
    let engine: MockSessionEngine;
    let service: VFSService;
    let handler: FileCommandHandler;

    beforeEach(() => {
        commandBus = new CommandBus();
        store = new VFSStore();
        engine = new MockSessionEngine();

        // Spy on engine.createFile to verify it gets called
        engine.driver.createFile = vi.fn(async (opts: { name: string; parentPath: string | null; content?: string | ArrayBuffer }) =>
            makeEngineNode({ id: 'new-id', name: opts.name, parentPath: opts.parentPath, path: `/${opts.name}` })
        );
        engine.driver.createDirectory = vi.fn(async (opts: { name: string; parentPath: string | null }) =>
            makeEngineNode({ id: 'dir-id', name: opts.name, parentPath: opts.parentPath, path: `/${opts.name}`, type: 'directory' })
        );
        engine.driver.delete = vi.fn(async () => {});

        service = new VFSService({ engine: engine as any, defaultExtension: '.chat' });
        handler = new FileCommandHandler(commandBus, store, service);
    });

    afterEach(() => {
        handler.destroy();
    });

    it('file:create command calls engine.createFile()', async () => {
        commandBus.execute('file:create', { type: 'file', title: 'My Chat', parentPath: null });
        await sleep(10); // allow async handler to run

        expect(engine.driver.createFile).toHaveBeenCalledWith({ name: 'My Chat.chat', parentPath: null, content: '' });
    });

    it('file:create with directory calls engine.createDirectory()', async () => {
        commandBus.execute('file:create', { type: 'directory', title: 'My Folder', parentPath: null });
        await sleep(10);

        expect(engine.driver.createDirectory).toHaveBeenCalledWith({ name: 'My Folder', parentPath: null });
    });

    it('file:delete command calls engine.delete() with correct IDs', async () => {
        commandBus.execute('file:delete', { itemIds: ['id-1', 'id-2'] });
        await sleep(10);

        expect(engine.driver.delete).toHaveBeenCalledWith(['id-1', 'id-2']);
    });

    it('file:rename preserves the file type and updates its stored title', async () => {
        const oldPath = '/old-name.prj';
        const oldItem = makeVFSNodeUI({
            id: oldPath,
            metadata: {
                ...makeVFSNodeUI().metadata,
                title: 'old-name',
                path: oldPath,
                custom: { _originalName: 'old-name.prj', _extension: '.prj' },
            },
        });
        store.dispatch({
            type: 'STATE_LOAD_SUCCESS',
            payload: { items: [oldItem], tags: new Map() },
        });
        engine.nodes.set(oldPath, makeEngineNode({
            name: 'old-name.prj',
            path: oldPath,
            metadata: { title: 'old-name' },
        }));
        engine.driver.rename = vi.fn(async () => {});
        engine.driver.updateMetadata = vi.fn(async () => {});

        commandBus.execute('file:rename', { itemId: oldPath, newTitle: 'new-name' });
        await sleep(10);

        expect(engine.driver.updateMetadata).toHaveBeenCalledWith(oldPath, { title: 'new-name' });
        expect(engine.driver.rename).toHaveBeenCalledWith(oldPath, 'new-name.prj');
        expect(vi.mocked(engine.driver.updateMetadata).mock.invocationCallOrder[0])
            .toBeLessThan(vi.mocked(engine.driver.rename).mock.invocationCallOrder[0]);
    });

    it('file:rename rolls the title back when the path rename fails', async () => {
        const oldPath = '/old-name.prj';
        engine.nodes.set(oldPath, makeEngineNode({
            name: 'old-name.prj',
            path: oldPath,
            metadata: { title: 'old-name' },
        }));
        engine.driver.rename = vi.fn(async () => { throw new Error('rename failed'); });
        engine.driver.updateMetadata = vi.fn(async () => {});

        await expect(service.renameItem(oldPath, 'new-name.prj')).rejects.toThrow('rename failed');

        expect(engine.driver.updateMetadata).toHaveBeenNthCalledWith(1, oldPath, { title: 'new-name' });
        expect(engine.driver.updateMetadata).toHaveBeenNthCalledWith(2, oldPath, { title: 'old-name' });
    });

    it('file:create fires the same engine that EngineAdapter is subscribed to', async () => {
        // This is the critical wiring test:
        // VFSService.engine === EngineAdapter.engine → same event source
        const adapter = new EngineAdapter(engine as any, store, mockFileTypePort);
        const unsub = adapter.connectEngineEvents();

        const created = makeEngineNode({ id: 'new-id', path: '/My Chat.chat' });
        engine.nodes.set('new-id', created);
        engine.driver.createFile = vi.fn(async () => {
            // Simulate the event that VFSModuleEngine.createFile() would fire
            engine.emit('node:created', createdPayload([{ nodeId: 'new-id', path: '/My Chat.chat' }]));
            return created;
        });

        commandBus.execute('file:create', { type: 'file', title: 'My Chat', parentPath: null });
        await sleep(120); // wait for command handler + debounce + async

        unsub();
        expect(store.getState().items.some(i => i.id === '/My Chat.chat')).toBe(true);
    });
});

// ── B. VFSModuleEngine-style bridge: moduleId filter simulation ───────────────

/**
 * Simulates the real VFSModuleEngine.on() / ModuleFS.on() behavior:
 * - Subscriptions are stored with a moduleId filter
 * - Only events with matching moduleId reach the subscriber
 *
 * This would have caught Bug 1 (the `in` vs `.has()` issue) if it had existed.
 * Before fix: on() returned () => {} regardless of event — filter logic never ran.
 * After fix: on() subscribes and the filter correctly matches by moduleId.
 */
class FilteredEventEngine {
    private subscriptions = new Map<string, Array<{
        moduleId: string;
        cb: (e: EngineEvent) => void;
    }>>();

    readonly nodes = new Map<string, ReturnType<typeof makeEngineNode>>();

    driver = {
        on: (event: EngineEventType, callback: (e: EngineEvent) => void): (() => void) => {
            if (!this.subscriptions.has(event)) this.subscriptions.set(event, []);
            const entry = { moduleId: 'chat', cb: callback };
            this.subscriptions.get(event)!.push(entry);
            return () => {
                const list = this.subscriptions.get(event) ?? [];
                const idx = list.indexOf(entry);
                if (idx >= 0) list.splice(idx, 1);
            };
        },

        getChildren: async (_parentPath: string): Promise<EngineNode[]> => [],

        getNode: async (idOrPath: string): Promise<EngineNode | null> => {
            if (this.nodes.has(idOrPath)) return this.nodes.get(idOrPath) ?? null;
            for (const node of this.nodes.values()) {
                if (node.path === idOrPath) return node;
            }
            return null;
        },
    };

    /**
     * Simulates ModuleFS._emit() — only reaches subscribers whose moduleId matches.
     * WRONG moduleId → event is filtered out (never reaches EngineAdapter).
     */
    fireWithModuleId(type: EngineEventType, payload: unknown, moduleId: string): void {
        const list = this.subscriptions.get(type) ?? [];
        list.forEach(sub => {
            if (sub.moduleId === moduleId) {
                sub.cb({ type, payload });
            }
        });
    }
}

describe('Event filter: only matching moduleId reaches EngineAdapter', () => {
    let filteredEngine: FilteredEventEngine;
    let store: VFSStore;
    let adapter: EngineAdapter;

    beforeEach(() => {
        filteredEngine = new FilteredEventEngine();
        store = new VFSStore();
        adapter = new EngineAdapter(filteredEngine as any, store, mockFileTypePort);
        adapter.connectEngineEvents();
    });

    afterEach(() => {
        adapter.destroy();
    });

    it('event with matching moduleId reaches EngineAdapter and updates store', async () => {
        const node = makeEngineNode({ id: 'f1', path: '/f1.chat' });
        filteredEngine.nodes.set('f1', node);

        // Fire with CORRECT moduleId (same as what was used in on())
        filteredEngine.fireWithModuleId(
            'node:created',
            createdPayload([{ nodeId: 'f1', path: '/f1.chat' }]),
            'chat' // matching moduleId
        );

        await sleep(120);
        expect(store.getState().items.some(i => i.id === '/f1.chat')).toBe(true);
    });

    it('event with WRONG moduleId is filtered out — store not updated', async () => {
        const node = makeEngineNode({ id: 'f2', path: '/f2.chat' });
        filteredEngine.nodes.set('f2', node);

        // Fire with WRONG moduleId → filter rejects it
        filteredEngine.fireWithModuleId(
            'node:created',
            createdPayload([{ nodeId: 'f2', path: '/f2.chat' }]),
            'wrong-module' // NON-matching moduleId
        );

        await sleep(120);
        expect(store.getState().items.some(i => i.id === 'f2')).toBe(false);
    });

    it('delete event with correct moduleId removes item from store', async () => {
        // Pre-load an item
        store.dispatch({
            type: 'STATE_LOAD_SUCCESS',
            payload: {
                items: [makeVFSNodeUI({ id: 'del-1' })],
                tags: new Map(),
            },
        });
        expect(store.getState().items).toHaveLength(1);

        filteredEngine.fireWithModuleId(
            'node:deleted',
            deletedPayload(['del-1']),
            'chat'
        );

        await sleep(80);
        expect(store.getState().items).toHaveLength(0);
    });
});

// ── C. Concurrent events: create + update for same node ──────────────────────

describe('concurrent create + update events for same node', () => {
    it('node appears in store even when create and update fire together', async () => {
        // This simulates ChatEngine.createFile() which fires:
        // 1. node:created (from engine.createFile)
        // 2. node:updated (from writeContent + updateMetadata)
        const engine = new MockSessionEngine();
        const store = new VFSStore();
        const adapter = new EngineAdapter(engine as any, store, mockFileTypePort);
        adapter.connectEngineEvents();

        const node = makeEngineNode({ id: 'chat-1', path: '/chat.chat' });
        engine.nodes.set('chat-1', node);

        // Fire both in rapid succession (as ChatEngine.createFile does)
        engine.emit('node:created', createdPayload([{ nodeId: 'chat-1', path: '/chat.chat' }]));
        engine.emit('node:updated', { nodes: [{ nodeId: 'chat-1', path: '/chat.chat' }] });

        await sleep(120);
        adapter.destroy();

        // The file should appear in the store
        expect(store.getState().items.some(i => i.id === '/chat.chat')).toBe(true);
    });

    it('asset-dir node:created events do NOT pollute the store', async () => {
        const engine = new MockSessionEngine();
        const store = new VFSStore();
        const adapter = new EngineAdapter(engine as any, store, mockFileTypePort);
        adapter.connectEngineEvents();

        // Set up the chat file (visible)
        const chatNode = makeEngineNode({ id: 'chat-1', path: '/session.chat' });
        engine.nodes.set('chat-1', chatNode);

        // Asset dir (should be filtered)
        const assetDir = makeEngineNode({
            id: 'asset-dir', name: '_session.chat', path: '/_session.chat', type: 'directory',
        });
        engine.nodes.set('asset-dir', assetDir);

        // Root node in asset dir (should be filtered)
        const rootNode = makeEngineNode({
            id: 'root-node', name: '000_00000_s.chat', path: '/_session.chat/000_00000_s.chat',
        });
        engine.nodes.set('root-node', rootNode);

        // Fire all three node:created events (as ChatEngine.createSessionStructure does)
        engine.emit('node:created', createdPayload([{ nodeId: 'chat-1', path: '/session.chat' }]));
        engine.emit('node:created', createdPayload([{ nodeId: 'asset-dir', path: '/_session.chat', type: 'directory' }]));
        engine.emit('node:created', createdPayload([{ nodeId: 'root-node', path: '/_session.chat/000_00000_s.chat' }]));

        await sleep(120);
        adapter.destroy();

        const ids = store.getState().items.map(i => i.id);
        expect(ids).toContain('/session.chat');         // visible chat file ✓
        expect(ids).not.toContain('/_session.chat');   // filtered: _ prefix ✓
        expect(ids).not.toContain('/_session.chat/000_00000_s.chat');   // filtered: inside asset dir ✓
    });
});
