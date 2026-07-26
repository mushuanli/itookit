import { describe, expect, it } from 'vitest';
import type { FlowDraft, FlowRevision } from '@itookit/common';
import type { IChatEngine } from '../src/persistence/types';
import { FlowDefinitionStore } from '../src/persistence/flow-definition-store';
import { flowRevisionDigest } from '../src/flow/validation';

function memoryEngine(): IChatEngine {
    const assets = new Map<string, string>();
    return {
        createAsset: async (_nodeId: string, name: string, content: string | ArrayBuffer) => {
            assets.set(name, typeof content === 'string' ? content : new TextDecoder().decode(content));
            return name;
        },
        getAssets: async () => [...assets.keys()].map(path => ({ path, name: path })),
        readAsset: async (_nodeId: string, name: string) => assets.get(name) ?? null,
    } as unknown as IChatEngine;
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
        const store = new FlowDefinitionStore(memoryEngine(), 'llm-flows');
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
        const store = new FlowDefinitionStore(memoryEngine(), 'llm-flows');
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
        const store = new FlowDefinitionStore(memoryEngine(), 'llm-flows');
        const first = revision(1, 'v1');
        const second = revision(2, 'v2');
        await store.saveRevision(first);
        await store.saveRevision(second);
        await expect(store.loadRevision('flow', 1)).resolves.toMatchObject({ name: 'v1' });
        await expect(store.loadRevision('flow')).resolves.toMatchObject({ name: 'v2' });
        await expect(store.saveRevision({ ...second, name: 'changed' })).rejects.toThrow(/digest mismatch|immutable/);
    });
});
