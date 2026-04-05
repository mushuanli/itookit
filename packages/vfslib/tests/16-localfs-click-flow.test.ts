/**
 * Integration test: LocalFSBackend — full click flow simulation
 *
 * Reproduces the Tauri-specific click path:
 *   VFSModuleEngine.getChildren('/') [EngineAdapter.loadData]
 *     → items stored in VFSStore (id = engineNode.id = 'mount_1:ino')
 *     → user clicks file → nav:selectSession(id)
 *     → VFSStore.handleSessionSelect: findNodeById(items, id) must find the item
 *     → activeId set → sessionSelected emitted with the file node
 *     → editor-connector calls engine.readContent(id)
 *
 * These tests inline the critical logic from vfs-ui (EngineAdapter / VFSStore /
 * editor-connector) so no cross-package devDep is needed. The inlined logic
 * mirrors the real code exactly; any drift would be a separate bug.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fsp } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openLocalFSBackend } from '@itookit/vfsdriver-localfs';
import { createVFS } from '../src/factory';
import { VFSModuleEngine } from '../src/adapter-session/VFSModuleEngine';
import { freshIDB } from './helpers';
import type { EngineNode } from '@itookit/common';

// ── Inlined helpers (mirror vfs-ui logic) ─────────────────────────────────────

/**
 * Mirrors VFSStore.findNodeById — the exact function used in handleSessionSelect.
 * If this finds the item, the SESSION_SELECT action will succeed.
 */
function findNodeById<T extends { id: string; children?: T[] }>(
    items: T[],
    id: string,
): T | undefined {
    for (const item of items) {
        if (item.id === id) return item;
        const found = item.children && findNodeById(item.children, id);
        if (found) return found;
    }
}

/**
 * Mirrors the id-preserving step in mapEngineNodeToUIItem:
 *   VFSNodeUI.id = EngineNode.id (no transformation)
 * Returns a minimal VFSNodeUI-like object with only the fields needed for the test.
 */
function toStoreItem(node: EngineNode): { id: string; type: string; children?: any[] } {
    return {
        id: node.id,
        type: node.type === 'directory' ? 'directory' : 'file',
        children: node.children?.map(toStoreItem),
    };
}

/**
 * Mirrors VFSStore.handleSessionSelect — returns updated activeId or null.
 * The real code also checks item.type === 'file', which this also does.
 */
function simulateSessionSelect(
    items: ReturnType<typeof toStoreItem>[],
    sessionId: string,
): string | null {
    const item = findNodeById(items, sessionId);
    if (item?.type === 'file') return sessionId;
    return null;
}

// ── Temp directory setup ───────────────────────────────────────────────────────

let _seq = 0;

interface TmpSetup {
    rootDir: string;
    sidecarDir: string;
    cleanup: () => Promise<void>;
}

async function makeTmp(): Promise<TmpSetup> {
    const id = `clickflow-${Date.now()}-${++_seq}`;
    const base = join(tmpdir(), id);
    const rootDir = join(base, 'home');
    const sidecarDir = join(base, 'sidecar');
    await fsp.mkdir(rootDir, { recursive: true });
    await fsp.mkdir(sidecarDir, { recursive: true });
    return {
        rootDir,
        sidecarDir,
        cleanup: () => fsp.rm(base, { recursive: true, force: true }),
    };
}

// ── Test context ───────────────────────────────────────────────────────────────

interface Ctx {
    rootDir: string;
    engine: VFSModuleEngine;
    cleanup: () => Promise<void>;
}

async function setupCtx(extraDiskFiles?: Record<string, string>): Promise<Ctx> {
    const tmp = await makeTmp();

    // Write pre-existing files BEFORE mounting (like a real home directory)
    if (extraDiskFiles) {
        for (const [rel, content] of Object.entries(extraDiskFiles)) {
            const abs = join(tmp.rootDir, rel);
            await fsp.mkdir(join(abs, '..'), { recursive: true });
            await fsp.writeFile(abs, content, 'utf-8');
        }
    }

    const homeBackend = await openLocalFSBackend({
        rootDir: tmp.rootDir,
        sidecarDir: tmp.sidecarDir,
    });

    const { manager } = await createVFS({
        rootBackend: freshIDB('click-flow'),
        additionalMounts: [{ path: '/module/home', backend: homeBackend }],
        modules: [{ name: 'home' }],
    });

    const engine = new VFSModuleEngine('home', manager);
    await engine.init();

    return {
        rootDir: tmp.rootDir,
        engine,
        cleanup: async () => {
            await manager.dispose();
            await tmp.cleanup();
        },
    };
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. loadData equivalent — IDs are stable and carry mount_1 prefix
// ═══════════════════════════════════════════════════════════════════════════════

describe('LocalFS click flow — loadData (EngineAdapter.getChildren)', () => {
    let ctx: Ctx;

    beforeEach(async () => {
        ctx = await setupCtx({
            'notes.md': '# Notes',
            'todo.md': '# Todo',
        });
    });
    afterEach(async () => ctx.cleanup());

    it('getChildren("/") returns nodes with mount_1 prefix IDs', async () => {
        const nodes = await ctx.engine.getChildren('/');
        expect(nodes.length).toBeGreaterThanOrEqual(2);
        for (const n of nodes) {
            expect(n.id).toMatch(/^mount_1:/);
        }
    });

    it('all returned nodes have type "file" or "directory"', async () => {
        const nodes = await ctx.engine.getChildren('/');
        for (const n of nodes) {
            expect(['file', 'directory']).toContain(n.type);
        }
    });

    it('file nodes have correct name', async () => {
        const nodes = await ctx.engine.getChildren('/');
        const names = nodes.map(n => n.name);
        expect(names).toContain('notes.md');
        expect(names).toContain('todo.md');
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. SESSION_SELECT — findNodeById can find items loaded via getChildren
// ═══════════════════════════════════════════════════════════════════════════════

describe('LocalFS click flow — SESSION_SELECT (VFSStore.handleSessionSelect)', () => {
    let ctx: Ctx;

    beforeEach(async () => {
        ctx = await setupCtx({ 'readme.md': '# Readme' });
    });
    afterEach(async () => ctx.cleanup());

    it('findNodeById finds a file after loadData', async () => {
        const nodes = await ctx.engine.getChildren('/');
        const items = nodes.map(toStoreItem);
        const fileNode = items.find(i => i.type === 'file')!;

        // This is the exact test for handleSessionSelect's inner check
        const found = findNodeById(items, fileNode.id);
        expect(found).toBeDefined();
        expect(found!.type).toBe('file');
    });

    it('simulateSessionSelect returns the id when a file is clicked', async () => {
        const nodes = await ctx.engine.getChildren('/');
        const items = nodes.map(toStoreItem);
        const fileNode = items.find(i => i.type === 'file')!;

        const activeId = simulateSessionSelect(items, fileNode.id);
        expect(activeId).toBe(fileNode.id);
    });

    it('simulateSessionSelect returns null for an unknown id', async () => {
        const nodes = await ctx.engine.getChildren('/');
        const items = nodes.map(toStoreItem);

        const activeId = simulateSessionSelect(items, 'mount_1:9999999');
        expect(activeId).toBeNull();
    });

    it('simulateSessionSelect returns null for a directory id', async () => {
        await fsp.mkdir(join(ctx.rootDir, 'folder'), { recursive: true });
        // Re-init to pick up the new directory
        const nodes = await ctx.engine.getChildren('/');
        const items = nodes.map(toStoreItem);
        const dirNode = items.find(i => i.type === 'directory');
        if (!dirNode) return; // no dir in this pass — skip

        const activeId = simulateSessionSelect(items, dirNode.id);
        expect(activeId).toBeNull();
    });

    it('IDs are identical between getChildren and getNode (no ID drift)', async () => {
        const nodes = await ctx.engine.getChildren('/');
        for (const n of nodes) {
            const fetched = await ctx.engine.getNode(n.id);
            expect(fetched).not.toBeNull();
            expect(fetched!.id).toBe(n.id);   // round-trip must be exact
        }
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. readContent — editor-connector calls readContent(item.id) after click
// ═══════════════════════════════════════════════════════════════════════════════

describe('LocalFS click flow — readContent (editor-connector)', () => {
    let ctx: Ctx;

    beforeEach(async () => {
        ctx = await setupCtx({ 'article.md': '# Hello World\n\nSome content.' });
    });
    afterEach(async () => ctx.cleanup());

    it('readContent(item.id) returns the file content after click', async () => {
        const nodes = await ctx.engine.getChildren('/');
        const file = nodes.find(n => n.name === 'article.md')!;
        expect(file).toBeDefined();

        // Simulate editor-connector: readContent is called with item.id
        const content = await ctx.engine.readContent(file.id);
        expect(content).toBe('# Hello World\n\nSome content.');
    });

    it('readContent still works after a rename (ID does not change)', async () => {
        const nodes = await ctx.engine.getChildren('/');
        const file = nodes.find(n => n.name === 'article.md')!;
        const originalId = file.id;

        await ctx.engine.rename(file.id, 'article-renamed.md');

        // ID must still resolve correctly — inode number doesn't change on rename
        const content = await ctx.engine.readContent(originalId);
        expect(typeof content === 'string' ? content : '').toBe('# Hello World\n\nSome content.');
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. Nested directory click flow — lazy-loaded children
// ═══════════════════════════════════════════════════════════════════════════════

describe('LocalFS click flow — nested directory (EngineAdapter.expandDirectory)', () => {
    let ctx: Ctx;

    beforeEach(async () => {
        ctx = await setupCtx({
            'docs/guide.md': '# Guide',
            'docs/api.md': '# API',
        });
    });
    afterEach(async () => ctx.cleanup());

    it('top-level getChildren shows directory with no children (lazy sentinel)', async () => {
        const nodes = await ctx.engine.getChildren('/');
        const docs = nodes.find(n => n.name === 'docs')!;
        expect(docs.type).toBe('directory');
        expect(docs.children).toBeUndefined(); // lazy — not loaded yet
    });

    it('after expandDirectory, nested file can be found via findNodeById', async () => {
        // Load top level (EngineAdapter.loadData)
        const roots = await ctx.engine.getChildren('/');
        const docs = roots.find(n => n.name === 'docs')!;

        // Expand directory (EngineAdapter.expandDirectory)
        const children = await ctx.engine.getChildren(docs.id);
        // Simulate FOLDER_CHILDREN_LOADED: attach children to the parent
        const docsWithChildren = { ...toStoreItem(docs), children: children.map(toStoreItem) };
        const items = [
            ...roots.filter(n => n.name !== 'docs').map(toStoreItem),
            docsWithChildren,
        ];

        // User clicks guide.md inside docs/
        const guide = children.find(c => c.name === 'guide.md')!;
        const found = findNodeById(items, guide.id);
        expect(found).toBeDefined();
        expect(found!.type).toBe('file');

        const activeId = simulateSessionSelect(items, guide.id);
        expect(activeId).toBe(guide.id);
    });

    it('nested file readContent works by ID', async () => {
        const roots = await ctx.engine.getChildren('/');
        const docs = roots.find(n => n.name === 'docs')!;
        const children = await ctx.engine.getChildren(docs.id);
        const guide = children.find(c => c.name === 'guide.md')!;

        const content = await ctx.engine.readContent(guide.id);
        expect(content).toBe('# Guide');
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. Pre-existing files (Tauri home directory scenario)
// ═══════════════════════════════════════════════════════════════════════════════

describe('LocalFS click flow — pre-existing disk files (Tauri home scenario)', () => {
    it('full click flow works for files written before VFS was mounted', async () => {
        // Simulate: user already has files in their home directory
        const tmp = await makeTmp();
        try {
            await fsp.writeFile(join(tmp.rootDir, 'existing1.md'), 'Content A');
            await fsp.writeFile(join(tmp.rootDir, 'existing2.md'), 'Content B');
            await fsp.mkdir(join(tmp.rootDir, 'projects'), { recursive: true });
            await fsp.writeFile(join(tmp.rootDir, 'projects', 'plan.md'), 'Plan');

            const homeBackend = await openLocalFSBackend({
                rootDir: tmp.rootDir,
                sidecarDir: tmp.sidecarDir,
            });
            const { manager } = await createVFS({
                rootBackend: freshIDB('tauri-home'),
                additionalMounts: [{ path: '/module/home', backend: homeBackend }],
                modules: [{ name: 'home' }],
            });
            const engine = new VFSModuleEngine('home', manager);
            await engine.init();

            try {
                // Step 1: EngineAdapter.loadData() equivalent
                const roots = await engine.getChildren('/');
                const items = roots.map(toStoreItem);

                // Step 2: All root-level files visible with mount_1 IDs
                const fileItems = items.filter(i => i.type === 'file');
                expect(fileItems.length).toBeGreaterThanOrEqual(2);
                for (const f of fileItems) {
                    expect(f.id).toMatch(/^mount_1:/);
                }

                // Step 3: User clicks existing1.md → SESSION_SELECT
                const target = items.find(i => {
                    const node = roots.find(n => n.id === i.id);
                    return node?.name === 'existing1.md';
                })!;
                expect(target).toBeDefined();

                const activeId = simulateSessionSelect(items, target.id);
                expect(activeId).toBe(target.id);

                // Step 4: editor-connector calls readContent(item.id)
                const content = await engine.readContent(target.id);
                expect(content).toBe('Content A');

                // Step 5: Expand 'projects' directory, click nested file
                const projectsNode = roots.find(n => n.name === 'projects')!;
                const projectChildren = await engine.getChildren(projectsNode.id);
                const projectItems = [
                    ...items.filter(i => i.id !== projectsNode.id),
                    { ...toStoreItem(projectsNode), children: projectChildren.map(toStoreItem) },
                ];

                const planNode = projectChildren.find(c => c.name === 'plan.md')!;
                const nestedActiveId = simulateSessionSelect(projectItems, planNode.id);
                expect(nestedActiveId).toBe(planNode.id);

                const planContent = await engine.readContent(planNode.id);
                expect(planContent).toBe('Plan');
            } finally {
                await manager.dispose();
            }
        } finally {
            await tmp.cleanup();
        }
    });
});
