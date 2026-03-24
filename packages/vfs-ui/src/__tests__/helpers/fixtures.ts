/**
 * Shared test fixtures and mock factories for vfs-ui tests.
 */
import type { EngineNode, EngineEventType, EngineEvent, ISessionEngine } from '@itookit/common';
import type { IFileTypePort } from '../../contracts/ports';
import type { VFSNodeUI } from '../../contracts/types';

// ── Wait helpers ────────────────────────────────────────────────────────────

/** Wait ms real milliseconds (for debounce + async flushing in EngineAdapter tests). */
export const sleep = (ms: number): Promise<void> =>
    new Promise(r => setTimeout(r, ms));

// ── EngineNode factory ───────────────────────────────────────────────────────

export const makeEngineNode = (overrides: Partial<EngineNode> = {}): EngineNode => ({
    id: 'node-1',
    parentId: null,
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
        parentId: null,
        path: '/test.chat',
        moduleId: 'chat',
        custom: { _originalName: 'test.chat', _extension: '.chat' },
    },
    content: { format: 'text/markdown', summary: '', searchableText: '', data: '' },
    ...overrides,
});

// ── MockSessionEngine ────────────────────────────────────────────────────────

/**
 * Minimal ISessionEngine mock that:
 * - Stores event handlers via on() so tests can call emit()
 * - Returns nodes from an internal map via getNode()
 * - Returns '' for readContent()
 */
export class MockSessionEngine implements Pick<ISessionEngine,
    'on' | 'loadTree' | 'getNode' | 'readContent' | 'writeContent' |
    'createFile' | 'createDirectory' | 'delete' | 'rename' | 'move' |
    'setTags' | 'setTagsBatch' | 'getAllTags' | 'search' | 'updateMetadata'
> {
    private handlers = new Map<string, Array<(e: EngineEvent) => void>>();
    /** Pre-populated node map for getNode() responses. */
    readonly nodes = new Map<string, EngineNode>();

    on(event: EngineEventType, callback: (e: EngineEvent) => void): () => void {
        if (!this.handlers.has(event)) this.handlers.set(event, []);
        this.handlers.get(event)!.push(callback);
        return () => {
            const arr = this.handlers.get(event) ?? [];
            const idx = arr.indexOf(callback);
            if (idx >= 0) arr.splice(idx, 1);
        };
    }

    /** Fire a VFS event — simulates ModuleFS emitting through VFSModuleEngine */
    emit(type: EngineEventType, payload: unknown): void {
        this.handlers.get(type)?.forEach(cb => cb({ type, payload }));
    }

    async loadTree(): Promise<EngineNode[]> {
        return [];
    }

    async getNode(id: string): Promise<EngineNode | null> {
        return this.nodes.get(id) ?? null;
    }

    async readContent(_id: string): Promise<string | ArrayBuffer> {
        return '';
    }

    async writeContent(_id: string, _content: string | ArrayBuffer): Promise<void> {}

    async createFile(name: string, parentId: string | null): Promise<EngineNode> {
        return makeEngineNode({ id: `created-${Date.now()}`, name, parentId });
    }

    async createDirectory(name: string, parentId: string | null): Promise<EngineNode> {
        return makeEngineNode({ id: `dir-${Date.now()}`, name, parentId, type: 'directory' });
    }

    async delete(_ids: string[]): Promise<void> {}
    async rename(_id: string, _newName: string): Promise<void> {}
    async move(_ids: string[], _targetParentId: string | null): Promise<void> {}
    async setTags(_id: string, _tags: string[]): Promise<void> {}
    async setTagsBatch(_updates: Array<{ id: string; tags: string[] }>): Promise<void> {}
    async getAllTags(): Promise<Array<{ name: string; color?: string }>> { return []; }
    async search(): Promise<EngineNode[]> { return []; }
    async updateMetadata(_id: string, _metadata: Record<string, unknown>): Promise<void> {}
}

// ── MockFileTypePort ─────────────────────────────────────────────────────────

export const mockFileTypePort: IFileTypePort = {
    getIcon: (_name: string, isDir?: boolean) => (isDir ? '📁' : '📄'),
    resolveEditorFactory: () => null as any,
    resolveContentParser: () => undefined,
};

// ── FSNodeCreatedPayload builders ────────────────────────────────────────────

export const createdPayload = (nodes: Array<{ nodeId: string; parentId?: string | null; path: string; type?: 'file' | 'directory' }>) => ({
    nodes: nodes.map(n => ({ nodeId: n.nodeId, parentId: n.parentId ?? null, path: n.path, type: n.type ?? 'file' })),
});

export const updatedPayload = (nodes: Array<{ nodeId: string; path: string }>) => ({
    nodes: nodes.map(n => ({ nodeId: n.nodeId, path: n.path })),
    reason: 'content' as const,
});

export const deletedPayload = (requestedIds: string[], allDeletedIds?: string[]) => ({
    requestedIds,
    allDeletedIds: allDeletedIds ?? requestedIds,
});
