/**
 * @file SystemVFSEngine.ts
 * @desc Read-only cross-module ISessionEngine for the System FS Explorer debug view.
 *
 * Tree layout:
 *   <moduleName>/          ← synthetic directory node per VFS module
 *     actual/files.md      ← remapped from the real module's file tree
 *     .hidden-file         ← visible in tree but content is BLOCKED
 *
 * Node ID encoding:
 *   Module dir : "__mod__<moduleName>"
 *   Real node  : "<moduleName>|<realNodeId>"
 *
 * All write operations (createFile, delete, rename, …) throw a read-only error.
 * Content of files whose name starts with "." is replaced with a placeholder.
 */
import type {
    ISessionEngine,
    IVFSManager,
    IModuleFS,
    FSNode,
    EngineNode,
    EngineSearchQuery,
    EngineEvent,
    EngineEventType,
} from '@itookit/common';

// ── ID helpers ────────────────────────────────────────────────────────────────

const MOD_PREFIX = '__mod__';

const moduleNodeId = (moduleName: string): string => `${MOD_PREFIX}${moduleName}`;

const compositeId = (moduleName: string, realId: string): string =>
    `${moduleName}|${realId}`;

function parseComposite(id: string): { moduleName: string; realId: string } | null {
    if (id.startsWith(MOD_PREFIX)) return null;
    const sep = id.indexOf('|');
    if (sep < 0) return null;
    return { moduleName: id.slice(0, sep), realId: id.slice(sep + 1) };
}

const isHiddenName = (name: string): boolean => name.startsWith('.');

const BLOCKED_CONTENT = (name: string, path: string, mod: string): string =>
    `⛔ System / hidden file — content not shown\n\n` +
    `Name  : ${name}\n` +
    `Path  : ${path}\n` +
    `Module: ${mod}\n`;

// ── FSNode → EngineNode conversion ───────────────────────────────────────────

function fsNodeToEngine(node: FSNode, id: string, parentId: string | null, moduleId: string): EngineNode {
    const base = {
        id,
        parentId,
        name: node.name,
        path: node.path,
        createdAt: node.createdAt,
        modifiedAt: node.modifiedAt,
        tags: [...(node.tags ?? [])] as string[],
        metadata: node.metadata as Record<string, unknown> | undefined,
        moduleId,
    };

    if (node.type === 'file') {
        return { ...base, type: 'file' as const, size: node.size };
    }
    return { ...base, type: 'directory' as const };
}

// Collect all nodes recursively from a module, building the full tree.
async function collectTree(
    fs: IModuleFS,
    idOrPath: string,
    parentId: string,
    moduleName: string,
): Promise<EngineNode[]> {
    const children = await fs.getChildren(idOrPath) as FSNode[];
    const result: EngineNode[] = [];

    for (const child of children) {
        const cId = compositeId(moduleName, child.id);
        const engineNode = fsNodeToEngine(child, cId, parentId, moduleName);

        if (child.type === 'directory') {
            engineNode.children = await collectTree(fs, child.id, cId, moduleName);
        }
        result.push(engineNode);
    }
    return result;
}

// ── Engine ────────────────────────────────────────────────────────────────────

export class SystemVFSEngine implements ISessionEngine {
    constructor(private readonly vfs: IVFSManager) {}

    async init(): Promise<void> {}

    // ── Tree ─────────────────────────────────────────────────────────────────

    async loadTree(): Promise<EngineNode[]> {
        const modules = this.vfs.getAllModules();

        // Load all modules in parallel — avoids serial await chain for large workspaces.
        return Promise.all(modules.map(async mod => {
            const dirId = moduleNodeId(mod.name);
            let children: EngineNode[] = [];

            try {
                const fs = this.vfs.getEngine(mod.name);
                await fs.init();
                children = await collectTree(fs, '/', dirId, mod.name);
            } catch {
                // Module inaccessible — show as empty placeholder directory.
            }

            return {
                id: dirId,
                parentId: null,
                name: mod.name,
                type: 'directory' as const,
                path: `/${mod.name}`,
                createdAt: 0,
                modifiedAt: 0,
                tags: [],
                metadata: { title: mod.name, description: mod.description ?? '' },
                moduleId: 'system',
                children,
            };
        }));
    }

    async getChildren(parentId: string): Promise<EngineNode[]> {
        if (parentId.startsWith(MOD_PREFIX)) {
            const moduleName = parentId.slice(MOD_PREFIX.length);
            try {
                const fs = this.vfs.getEngine(moduleName);
                return await collectTree(fs, '/', parentId, moduleName);
            } catch {
                return [];
            }
        }

        const parsed = parseComposite(parentId);
        if (!parsed) return [];

        try {
            const fs = this.vfs.getEngine(parsed.moduleName);
            const children = await fs.getChildren(parsed.realId) as FSNode[];
            return children.map(c => {
                const cId = compositeId(parsed.moduleName, c.id);
                return fsNodeToEngine(c, cId, parentId, parsed.moduleName);
            });
        } catch {
            return [];
        }
    }

    async getNode(id: string): Promise<EngineNode | null> {
        if (id.startsWith(MOD_PREFIX)) {
            const moduleName = id.slice(MOD_PREFIX.length);
            const info = this.vfs.getModule(moduleName);
            if (!info) return null;
            return {
                id,
                parentId: null,
                name: moduleName,
                type: 'directory',
                path: `/${moduleName}`,
                createdAt: 0,
                modifiedAt: 0,
                tags: [],
                metadata: { title: moduleName, description: info.description ?? '' },
                moduleId: 'system',
            };
        }

        const parsed = parseComposite(id);
        if (!parsed) return null;

        try {
            const fs = this.vfs.getEngine(parsed.moduleName);
            const node = await fs.getNode(parsed.realId) as FSNode | null;
            if (!node) return null;
            return fsNodeToEngine(node, id, null, parsed.moduleName);
        } catch {
            return null;
        }
    }

    // ── Content ───────────────────────────────────────────────────────────────

    async readContent(id: string): Promise<string | ArrayBuffer> {
        if (id.startsWith(MOD_PREFIX)) return '';

        const parsed = parseComposite(id);
        if (!parsed) return '';

        const node = await this.getNode(id);

        // Block hidden/system config file content
        if (node && isHiddenName(node.name)) {
            return BLOCKED_CONTENT(node.name, node.path, parsed.moduleName);
        }

        try {
            const raw = await this.vfs.getEngine(parsed.moduleName).readContent(parsed.realId);
            // FileContent can be string | ArrayBuffer | Uint8Array — normalise to string | ArrayBuffer
            if (typeof raw === 'string') return raw;
            if (raw instanceof ArrayBuffer) return raw;
            // Uint8Array → ArrayBuffer
            return (raw as Uint8Array).buffer.slice(
                (raw as Uint8Array).byteOffset,
                (raw as Uint8Array).byteOffset + (raw as Uint8Array).byteLength,
            ) as ArrayBuffer;
        } catch (e) {
            return `⚠️ Could not read content\n\n${e}`;
        }
    }

    // ── Search ────────────────────────────────────────────────────────────────

    async search(_query: EngineSearchQuery): Promise<EngineNode[]> {
        return [];
    }

    // ── Tags (no-op) ──────────────────────────────────────────────────────────

    async getAllTags(): Promise<Array<{ name: string; color?: string }>> {
        return [];
    }

    async setTags(_id: string, _tags: string[]): Promise<void> {}

    async setTagsBatch(_updates: Array<{ id: string; tags: string[] }>): Promise<void> {}

    // ── Assets (no-op) ────────────────────────────────────────────────────────

    async createAsset(_ownerNodeId: string, _filename: string, _content: string | ArrayBuffer): Promise<EngineNode> {
        return this.throwReadOnly('createAsset');
    }

    async getAssetDirectoryId(_ownerNodeId: string): Promise<string | null> {
        return null;
    }

    async getAssets(_ownerNodeId: string): Promise<EngineNode[]> {
        return [];
    }

    // ── Mutations (read-only — all throw) ────────────────────────────────────

    private throwReadOnly(op: string): never {
        throw new Error(`[SystemVFSEngine] Read-only: ${op} is not allowed`);
    }

    async writeContent(_id: string, _content: string | ArrayBuffer): Promise<void> {
        this.throwReadOnly('writeContent');
    }

    async createFile(_name: string, _parentId: string | null, _content?: string | ArrayBuffer): Promise<EngineNode> {
        return this.throwReadOnly('createFile');
    }

    async createDirectory(_name: string, _parentId: string | null): Promise<EngineNode> {
        return this.throwReadOnly('createDirectory');
    }

    async rename(_id: string, _newName: string): Promise<void> {
        this.throwReadOnly('rename');
    }

    async delete(_ids: string[]): Promise<void> {
        this.throwReadOnly('delete');
    }

    async move(_ids: string[], _targetParentId: string | null): Promise<void> {
        this.throwReadOnly('move');
    }

    async updateMetadata(_id: string, _metadata: Record<string, unknown>): Promise<void> {}

    // ── Events (static snapshot — no events) ─────────────────────────────────

    on(_event: EngineEventType, _callback: (e: EngineEvent) => void): () => void {
        return () => {};
    }
}
