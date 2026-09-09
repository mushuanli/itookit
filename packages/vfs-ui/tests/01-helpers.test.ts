/**
 * Tests for shouldFilterNode / isHiddenFile.
 * Verifies hidden files and asset-dir paths are correctly identified.
 */
import { describe, it, expect } from 'vitest';
import { isHiddenFile, isItemReadOnly, replacePathPrefix, shouldFilterNode } from '../src/utils/helpers';
import { partitionDeletable } from '../src/utils/delete-guard';

// ── isHiddenFile ─────────────────────────────────────────────────────────────

describe('isHiddenFile', () => {
    it('filters dot-prefix names', () => {
        expect(isHiddenFile('.hidden')).toBe(true);
        expect(isHiddenFile('.abc123')).toBe(true);
    });

    it('filters double-underscore prefix names', () => {
        expect(isHiddenFile('__system')).toBe(true);
        expect(isHiddenFile('__config')).toBe(true);
    });

    it('does NOT filter regular names', () => {
        expect(isHiddenFile('notes.md')).toBe(false);
        expect(isHiddenFile('my-session.chat')).toBe(false);
    });

    it('does NOT filter single-underscore prefix (that is asset dir, handled by shouldFilterNode)', () => {
        expect(isHiddenFile('_my-session.chat')).toBe(false);
    });
});

describe('replacePathPrefix', () => {
    it('remaps a node and its descendants without touching sibling prefixes', () => {
        expect(replacePathPrefix('/old', '/old', '/new')).toBe('/new');
        expect(replacePathPrefix('/old/child.prj', '/old', '/new')).toBe('/new/child.prj');
        expect(replacePathPrefix('/old-copy/child.prj', '/old', '/new'))
            .toBe('/old-copy/child.prj');
    });
});

// ── shouldFilterNode ─────────────────────────────────────────────────────────

describe('shouldFilterNode', () => {
    it('filters node with dot-prefix name', () => {
        expect(shouldFilterNode({ name: '.hidden', path: '/.hidden' })).toBe(true);
    });

    it('filters node with double-underscore prefix name', () => {
        expect(shouldFilterNode({ name: '__config', path: '/__config' })).toBe(true);
    });

    it('filters node inside a dot-prefix path segment', () => {
        expect(shouldFilterNode({ name: 'node.json', path: '/.session-id/node.json' })).toBe(true);
    });

    it('filters asset dir node (single underscore prefix name)', () => {
        expect(shouldFilterNode({ name: '_my-session.chat', path: '/_my-session.chat' })).toBe(true);
    });

    it('filters node INSIDE an asset dir (underscore path segment)', () => {
        expect(shouldFilterNode({
            name: '000_00001_u.chat',
            path: '/_my-session.chat/000_00001_u.chat',
        })).toBe(true);
    });

    it('filters node inside nested asset dir', () => {
        expect(shouldFilterNode({
            name: 'settings.yaml',
            path: '/folder/_my-session.chat/settings.yaml',
        })).toBe(true);
    });

    it('does NOT filter regular file at root', () => {
        expect(shouldFilterNode({ name: 'notes.md', path: '/notes.md' })).toBe(false);
    });

    it('does NOT filter regular file inside a regular folder', () => {
        expect(shouldFilterNode({ name: 'chat.chat', path: '/folder/chat.chat' })).toBe(false);
    });

    it('does NOT filter directory with regular name', () => {
        expect(shouldFilterNode({ name: 'my-folder', path: '/my-folder' })).toBe(false);
    });

    it('filters when viewId is hidden', () => {
        expect(shouldFilterNode({ name: 'file.md', path: '/file.md', viewId: '.hidden-module' })).toBe(true);
    });

    it('does NOT filter when viewId is a normal module name', () => {
        expect(shouldFilterNode({ name: 'file.md', path: '/file.md', viewId: 'workspace' })).toBe(false);
    });
});

describe('per-item read-only marker', () => {
    it('detects the backend read-only marker', () => {
        const marked = { metadata: { custom: { _readOnly: true } } };
        const plain = { metadata: { custom: {} } };
        expect(isItemReadOnly(marked)).toBe(true);
        expect(isItemReadOnly(plain)).toBe(false);
        expect(isItemReadOnly({})).toBe(false);
    });

    it('splits delete requests into deletable and blocked entries', () => {
        const items = [
            { id: '/a/tasks/t', metadata: { custom: { _readOnly: true } } },
            { id: '/a/note.md', metadata: { custom: {} } },
        ] as never;

        expect(partitionDeletable(items, ['/a/tasks/t', '/a/note.md']))
            .toEqual({ deletable: ['/a/note.md'], blocked: ['/a/tasks/t'] });
        expect(partitionDeletable(items, ['/a/tasks/t']))
            .toEqual({ deletable: [], blocked: ['/a/tasks/t'] });
    });
});
