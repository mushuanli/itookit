/**
 * Tests for NodeListStateTransformer.
 *
 * Critical: verifies the change-detection contract used by BaseComponent.update().
 * BaseComponent compares state keys with !==. If transformState() returns the
 * same reference for a changed field, render() will NOT be called.
 */
import { describe, it, expect } from 'vitest';
import { NodeListStateTransformer } from '../ui/components/NodeList/NodeListState';
import type { VFSUIState } from '../contracts/types';
import { makeVFSNodeUI } from './helpers/fixtures';

// ── Minimal VFSUIState factory ────────────────────────────────────────────────

const makeState = (overrides: Partial<VFSUIState> = {}): VFSUIState => ({
    items: [],
    activeId: null,
    expandedFolderIds: new Set(),
    expandedOutlineIds: new Set(),
    expandedOutlineH1Ids: new Set(),
    selectedItemIds: new Set(),
    creatingItem: null,
    moveOperation: null,
    searchQuery: '',
    uiSettings: { sortBy: 'title', density: 'comfortable', showSummary: true, showTags: true, showBadges: true },
    tags: new Map(),
    isSidebarCollapsed: false,
    readOnly: false,
    status: 'idle',
    error: null,
    ...overrides,
});

const transformer = new NodeListStateTransformer();

// ── items change detection ────────────────────────────────────────────────────

describe('NodeListStateTransformer — change detection', () => {
    it('items is a new reference on every transform() call (required for re-render)', () => {
        // BaseComponent.update() uses !== to detect changes.
        // If items is the same reference, re-render is skipped.
        const state = makeState({ items: [makeVFSNodeUI({ id: 'f1' })] });
        const result1 = transformer.transform(state);
        const result2 = transformer.transform(state);

        // JSON.parse(JSON.stringify()) creates a new reference each time
        expect(result1.items).not.toBe(result2.items);
    });

    it('items reference changes when items are added', () => {
        const state1 = makeState({ items: [] });
        const state2 = makeState({ items: [makeVFSNodeUI({ id: 'f1' })] });

        const r1 = transformer.transform(state1);
        const r2 = transformer.transform(state2);

        expect(r1.items).not.toBe(r2.items);
        expect(r2.items).toHaveLength(1);
    });

    it('returns different items when an item is removed', () => {
        const item = makeVFSNodeUI({ id: 'f1' });
        const state1 = makeState({ items: [item] });
        const state2 = makeState({ items: [] });

        const r1 = transformer.transform(state1);
        const r2 = transformer.transform(state2);

        expect(r1.items).toHaveLength(1);
        expect(r2.items).toHaveLength(0);
    });

    it('activeId propagates correctly', () => {
        const state = makeState({ activeId: 'f1' });
        const result = transformer.transform(state);
        expect(result.activeId).toBe('f1');
    });

    it('status propagates correctly', () => {
        const state = makeState({ status: 'loading' });
        const result = transformer.transform(state);
        expect(result.status).toBe('loading');
    });
});

// ── Search / filter ───────────────────────────────────────────────────────────

describe('NodeListStateTransformer — search filtering', () => {
    it('empty searchQuery returns all items', () => {
        const state = makeState({
            items: [
                makeVFSNodeUI({ id: 'f1', metadata: { ...makeVFSNodeUI().metadata, title: 'Alpha' } }),
                makeVFSNodeUI({ id: 'f2', metadata: { ...makeVFSNodeUI().metadata, title: 'Beta' } }),
            ],
            searchQuery: '',
        });
        const result = transformer.transform(state);
        expect(result.items).toHaveLength(2);
    });

    it('text search filters items by title', () => {
        const item1 = makeVFSNodeUI({ id: 'f1' });
        item1.metadata.title = 'Meeting Notes';
        const item2 = makeVFSNodeUI({ id: 'f2' });
        item2.metadata.title = 'Project Plan';

        const state = makeState({ items: [item1, item2], searchQuery: 'meeting' });
        const result = transformer.transform(state);

        const ids = result.items.map(i => i.id);
        expect(ids).toContain('f1');
        expect(ids).not.toContain('f2');
    });

    it('visibleItemIds includes all item ids when no folders', () => {
        const state = makeState({
            items: [makeVFSNodeUI({ id: 'f1' }), makeVFSNodeUI({ id: 'f2' })],
        });
        const result = transformer.transform(state);
        expect(result.visibleItemIds).toContain('f1');
        expect(result.visibleItemIds).toContain('f2');
    });
});
