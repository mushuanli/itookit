/**
 * Shared test fixtures and mock factories for vfs-ui tests.
 */
import type { EngineNode, EngineEventType, EngineEvent } from '@itookit/common';
import type { IFileTypePort } from '../../src/contracts/ports';
import type { VFSNodeUI } from '../../src/contracts/types';

// ── Wait helpers ────────────────────────────────────────────────────────────

/** Wait ms real milliseconds (for debounce + async flushing in EngineAdapter tests). */
export const sleep = (ms: number): Promise<void> =>
    new Promise(r => setTimeout(r, ms));

// ── EngineNode factory ───────────────────────────────────────────────────────

export const makeEngineNode = (overrides: Partial<EngineNode> = {}): EngineNode => ({
    id: 'node-1',
    parentPath: null,
    name: 'test.chat',
    type: 'file',
    path: '/test.chat',
    createdAt: 1000000,
    modifiedAt: 1000000,
    tags: [],
    metadata: {},
    moduleId: 'chat',
    ...overrides,
});

export const makeDirectoryNode = (overrides: Partial<EngineNode> = {}): EngineNode =>
    makeEngineNode({ id: 'dir-1', name: 'folder', type: 'directory', path: '/folder', children: [], ...overrides });

// ── VFSNodeUI factory ────────────────────────────────────────────────────────

export const makeVFSNodeUI = (overrides: Partial<VFSNodeUI> = {}): VFSNodeUI => ({
    id: 'node-1',
    type: 'file',
    version: '1.0',
    icon: '📄',
    metadata: {
        title: 'test',
        tags: [],
        createdAt: new Date(1000000).toISOString(),
        lastModified: new Date(1000000).toISOString(),
        parentPath: null,
        path: '/test.chat',
        moduleId: 'chat',
        custom: { _originalName: 'test.chat', _extension: '.chat' },
    },
    content: { format: 'text/markdown', summary: '', searchableText: '', data: '' },
    ...overrides,
});

// ── MockSessionEngine ────────────────────────────────────────────────────────

/**
 * Minimal IModuleFS mock that:
 * - Exposes driver.on() for EngineAdapter.connectEngineEvents()
 * - Returns nodes from an internal map via driver.getNode() (by id or path fallback)
 * - Returns [] for driver.getChildren()
 */
export class MockSessionEngine {
    private handlers = new Map<string, Array<(e: EngineEvent) => void>>();
    /** Pre-populated node map for driver.getNode() responses. Keyed by id or path. */
    readonly nodes = new Map<string, EngineNode>();

    driver = {
        on: (event: EngineEventType, callback: (e: EngineEvent) => void): (() => void) => {
            if (!this.handlers.has(event)) this.handlers.set(event, []);
            this.handlers.get(event)!.push(callback);
            return () => {
                const arr = this.handlers.get(event) ?? [];
                const idx = arr.indexOf(callback);
                if (idx >= 0) arr.splice(idx, 1);
            };
        },

        getChildren: async (_parentPath: string): Promise<EngineNode[]> => {
            return [];
        },

        getNode: async (idOrPath: string): Promise<EngineNode | null> => {
            // Direct lookup by id first, then fallback to path scan
            if (this.nodes.has(idOrPath)) return this.nodes.get(idOrPath) ?? null;
            for (const node of this.nodes.values()) {
                if (node.path === idOrPath) return node;
            }
            return null;
        },

        createFile: async (opts: { name: string; parentPath: string | null; content?: string | ArrayBuffer; recursive?: boolean }): Promise<EngineNode> =>
            makeEngineNode({ id: `created-${Date.now()}`, name: opts.name, parentPath: opts.parentPath }),

        createDirectory: async (opts: { name: string; parentPath: string | null; recursive?: boolean }): Promise<EngineNode> =>
            makeEngineNode({ id: `dir-${Date.now()}`, name: opts.name, parentPath: opts.parentPath, type: 'directory' }),

        delete: async (_ids: string[]): Promise<void> => {},

        rename: async (_id: string, _newName: string): Promise<void> => {},

        move: async (_ids: string[], _targetParentId: string | null): Promise<void> => {},

        search: async (_query?: any): Promise<EngineNode[]> => [],

        updateMetadata: async (_id: string, _metadata: Record<string, unknown>): Promise<void> => {},
    };

    meta = {
        tags: {
            setTags: async (_id: string, _tags: string[]): Promise<void> => {},
        },
        assets: {
            hasAssetDir: async (_ownerPath: string): Promise<boolean> => false,
            putAsset: async (_ownerPath: string, _assetName: string, _content: string | ArrayBuffer): Promise<EngineNode> =>
                makeEngineNode({}),
        },
    };

    /** Fire a VFS event — simulates ModuleFS emitting through VFSModuleEngine */
    emit(type: EngineEventType, payload: unknown): void {
        this.handlers.get(type)?.forEach(cb => cb({ type, payload }));
    }
}

// ── MockFileTypePort ─────────────────────────────────────────────────────────

export const mockFileTypePort: IFileTypePort = {
    getIcon: (_name: string, isDir?: boolean) => (isDir ? '📁' : '📄'),
    resolveEditorFactory: () => null as any,
    resolveContentParser: () => undefined,
};

// ── FSNodeCreatedPayload builders ────────────────────────────────────────────

export const createdPayload = (nodes: Array<{ nodeId: string; parentPath?: string | null; path: string; type?: 'file' | 'directory' }>) => ({
    nodes: nodes.map(n => ({ nodeId: n.nodeId, parentPath: n.parentPath ?? null, path: n.path, type: n.type ?? 'file' })),
});

export const updatedPayload = (nodes: Array<{ nodeId: string; path: string }>) => ({
    nodes: nodes.map(n => ({ nodeId: n.nodeId, path: n.path })),
    reason: 'content' as const,
});

export const deletedPayload = (requestedPaths: string[], allDeletedPaths?: string[]) => ({
    requestedPaths,
    allDeletedPaths: allDeletedPaths ?? requestedPaths,
});
