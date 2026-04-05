/**
 * Tests for shouldFilterNode / isHiddenFile.
 * Verifies hidden files and asset-dir paths are correctly identified.
 */
import { describe, it, expect } from 'vitest';
import { isHiddenFile, shouldFilterNode } from '../src/utils/helpers';

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

    it('filters when moduleId is hidden', () => {
        expect(shouldFilterNode({ name: 'file.md', path: '/file.md', moduleId: '.hidden-module' })).toBe(true);
    });

    it('does NOT filter when moduleId is a normal module name', () => {
        expect(shouldFilterNode({ name: 'file.md', path: '/file.md', moduleId: 'workspace' })).toBe(false);
    });
});
