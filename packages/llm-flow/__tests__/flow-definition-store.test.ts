import { describe, expect, it } from 'vitest';
import type { FlowDraft, FlowRevision } from '@itookit/common';
import type { FlowStore } from '../src/flow-definition-store';
import { FlowDefinitionStore } from '../src/flow-definition-store';
import { flowRevisionDigest } from '../src/flow/validation';

interface MemoryFile { nodeId: string; name: string; content: string; }

function memoryStore(): FlowStore {
    const files = new Map<string, MemoryFile>();
    const assets = new Map<string, Map<string, string>>();
    return {
        listFiles: async () => [...files.values()].map(file => ({ nodeId: file.nodeId, name: file.name })),
        findFile: async name => {
            const file = [...files.values()].find(item => item.name === name);
            return file ? { nodeId: file.nodeId, name: file.name } : null;
        },
        createFile: async (name, content) => {
            const nodeId = `/${name}`;
            files.set(nodeId, { nodeId, name, content });
            return { nodeId, name };
        },
        readFile: async nodeId => files.get(nodeId)?.content ?? null,
        writeFile: async (nodeId, content) => {
            const file = files.get(nodeId);
            if (file) file.content = content;
        },
        renameFile: async (nodeId, newName) => {
            const file = files.get(nodeId);
            if (!file) return;
            files.delete(nodeId);
            file.nodeId = `/${newName}`;
            file.name = newName;
            files.set(file.nodeId, file);
        },
        deleteFile: async nodeId => { files.delete(nodeId); },
        createAsset: async (nodeId, filename, content) => {
            if (!assets.has(nodeId)) assets.set(nodeId, new Map());
            assets.get(nodeId)!.set(filename, typeof content === 'string' ? content : new TextDecoder().decode(content));
            return filename;
        },
        readAsset: async (nodeId, filename) => assets.get(nodeId)?.get(filename) ?? null,
        listAssets: async nodeId => [...(assets.get(nodeId)?.keys() ?? [])].map(name => ({ name, path: name })),
    };
}

function revision(number: number, name: string): FlowRevision {
    const withoutDigest = {
        id: 'flow' as FlowRevision['id'],
        revision: number,
        name,
        nodes: [],
        edges: [],
        createdAt: Date.now(),
    };
    return { ...withoutDigest, digest: flowRevisionDigest(withoutDigest) } as FlowRevision;
}

describe('FlowDefinitionStore', () => {
    it('creates, lists and saves drafts with engine-owned optimistic versions', async () => {
        const store = new FlowDefinitionStore(memoryStore());
        const created = await store.createDraft({ id: 'draft', name: 'Draft' });
        expect(created.draftVersion).toBe(1);
        await expect(store.listDrafts()).resolves.toMatchObject([{ id: 'draft', name: 'Draft' }]);

        const saved = await store.saveDraft({ ...created, name: 'Changed' }, 1);
        expect(saved).toMatchObject({ name: 'Changed', draftVersion: 2 });
        await expect(store.saveDraft({ ...saved, name: 'Stale' }, 1))
            .rejects.toThrow(/version conflict/);
        await expect(store.loadDraft('draft')).resolves.toMatchObject({
            name: 'Changed',
            draftVersion: 2,
        });
        await expect(store.createDraft({ id: '../escape', name: 'Unsafe' }))
            .rejects.toThrow(/Flow ID/);
    });

    it('publishes immutable revisions from a matching draft snapshot', async () => {
        const store = new FlowDefinitionStore(memoryStore());
        const draft = await store.createDraft({ id: 'published', name: 'Published' });
        const first = await store.createRevision(draft);
        const changed: FlowDraft = { ...draft, draftVersion: 2, name: 'Published v2' };
        const second = await store.createRevision(changed);
        expect(first.revision).toBe(1);
        expect(second.revision).toBe(2);
        await expect(store.loadRevision('published', 1)).resolves.toMatchObject({
            name: 'Published',
        });
    });

    it('loads immutable v3 revisions and the latest pointer', async () => {
        const store = new FlowDefinitionStore(memoryStore());
        await store.createDraft({ id: 'flow', name: 'Flow' });
        const first = revision(1, 'v1');
        const second = revision(2, 'v2');
        await store.saveRevision(first);
        await store.saveRevision(second);
        await expect(store.loadRevision('flow', 1)).resolves.toMatchObject({ name: 'v1' });
        await expect(store.loadRevision('flow')).resolves.toMatchObject({ name: 'v2' });
        await expect(store.saveRevision({ ...second, name: 'changed' })).rejects.toThrow(/digest mismatch|immutable/);
    });
});

describe('builtin Flow installation receipts', () => {
    it('does not resurrect a deleted template after the store is recreated', async () => {
        const storage = memoryStore();
        const first = new FlowDefinitionStore(storage);
        const draft = { id: 'builtin', name: 'Builtin', nodes: [], edges: [], draftVersion: 1, updatedAt: 0, layout: {} } as FlowDraft;
        expect(await first.installBuiltinDraft(draft)).not.toBeNull();
        await storage.deleteFile('/builtin.flow');
        const restarted = new FlowDefinitionStore(storage);
        expect(await restarted.installBuiltinDraft(draft)).toBeNull();
        expect(await restarted.listDrafts()).toEqual([]);
        expect(await storage.findFile('builtin.flow')).toBeNull();
    });
    it('records existing templates without overwriting edits and respects a later deletion', async () => {
        const storage = memoryStore(); const store = new FlowDefinitionStore(storage);
        const existing = await store.createDraft({ id: 'builtin', name: 'User edited' });
        expect(await store.installBuiltinDraft({ ...existing, name: 'Replacement' })).toBeNull();
        expect((await store.loadDraft('builtin'))?.name).toBe('User edited');
        await storage.deleteFile('/builtin.flow');
        expect(await new FlowDefinitionStore(storage).installBuiltinDraft(existing)).toBeNull();
    });
});

it('explicitly restores a missing builtin without overwriting edits or enabling startup resurrection', async () => {
    const storage = memoryStore(); const store = new FlowDefinitionStore(storage);
    const template = { id: 'builtin', name: 'Builtin', nodes: [], edges: [], draftVersion: 1, updatedAt: 0, layout: {} } as FlowDraft;
    await store.installBuiltinDraft(template);
    await storage.deleteFile('/builtin.flow');
    const restored = await store.installBuiltinDraft(template, { restoreMissing: true });
    expect(restored?.id).toBe('builtin');
    await store.saveDraft({ ...restored!, name: 'Edited' }, restored!.draftVersion);
    expect(await store.installBuiltinDraft(template, { restoreMissing: true })).toBeNull();
    expect((await store.loadDraft('builtin'))?.name).toBe('Edited');
    await storage.deleteFile('/builtin.flow');
    expect(await new FlowDefinitionStore(storage).installBuiltinDraft(template)).toBeNull();
});
