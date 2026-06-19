/**
 * @file SystemVFSEngine.ts
 * @desc Read-only cross-module IModuleFS for the System FS Explorer debug view.
 *
 * Tree layout:
 *   dev/                     ← synthetic /dev directory: registered device drivers
 *     llm                    ← FSDeviceNode info (content = JSON metadata)
 *     null / zero / random   ← built-in devices
 *   <moduleName>/            ← synthetic directory node per VFS module
 *     ordinary-file.md       ← content shown
 *     .hidden-file           ← content BLOCKED (dot prefix = system/hidden)
 *     _asset-dir/            ← content BLOCKED (underscore prefix = asset/special)
 *
 * Node ID encoding:
 *   /dev dir    : "__dev__"
 *   /dev device : "__dev__|<handlerId>"
 *   Module dir  : "__mod__<moduleName>"
 *   Real node   : "<moduleName>|<realNodeId>"
 *
 * All write operations throw a read-only error.
 *
 * v3.3: Refactored from IFSEngine → IModuleFS.
 */
import type {
    IModuleFS,
    IFSDriver,
    IVFSManager,
    FSNode,
    FSFileNode,
    FSDirectoryNode,
    FSSearchResult,
    FSCapabilities,
    IAssetOperations,
    ITagOperations,
    FileContent,
    ReadOptions,
} from '@itookit/common';
import { FSCapabilityError } from '@itookit/common';

// ── System FS internal types ─────────────────────────────────────────────────

/** FSNode with a composite id for cross-module addressing */
type SystemFSNode<T extends FSNode = FSNode> = T & { id: string };

// ── ID helpers ────────────────────────────────────────────────────────────────

const DEV_DIR_ID = '__dev__';
const DEV_PREFIX = '__dev__|';
const MOD_PREFIX = '__mod__';

const moduleNodeId = (moduleName: string): string => `${MOD_PREFIX}${moduleName}`;
const devNodeId = (handlerId: string): string => `${DEV_PREFIX}${handlerId}`;

const compositeId = (moduleName: string, realId: string): string =>
    `${moduleName}|${realId}`;

function parseComposite(id: string): { moduleName: string; realId: string } | null {
    if (id.startsWith(MOD_PREFIX) || id.startsWith(DEV_PREFIX) || id === DEV_DIR_ID) return null;
    const sep = id.indexOf('|');
    if (sep < 0) return null;
    return { moduleName: id.slice(0, sep), realId: id.slice(sep + 1) };
}

const isSensitivePath = (path: string): boolean =>
    path.split('/').filter(Boolean).some(seg => seg.startsWith('.'));

const BLOCKED_CONTENT = (name: string, path: string, mod: string): string =>
    `⛔ System / hidden / asset file — content not shown\n\n` +
    `Name  : ${name}\n` +
    `Path  : ${path}\n` +
    `Module: ${mod}\n`;

// ── FSNode wrapper for composite IDs ──────────────────────────────────────────

function wrapFSNode(node: FSNode, id: string, parentPath: string | null, moduleId: string): SystemFSNode {
    if (node.type === 'directory') {
        return {
            ...node,
            id,
            parentPath,
            moduleId,
            tags: node.tags ? [...node.tags] : [],
            metadata: { ...(node.metadata as Record<string, unknown>), _showAll: true },
        } as SystemFSNode<FSDirectoryNode>;
    }
    return {
        ...node,
        id,
        parentPath,
        moduleId,
        tags: node.tags ? [...node.tags] : [],
        metadata: { ...(node.metadata as Record<string, unknown>), _showAll: true },
    } as SystemFSNode<FSFileNode>;
}

// ── Tree collection ───────────────────────────────────────────────────────────

async function collectTree(
    fs: IModuleFS,
    path: string,
    parentPath: string,
    moduleName: string,
): Promise<FSNode[]> {
    const children = await fs.driver.getChildren(path, {
        includeHidden: true, includeAssetDirs: true, includeInternalDirs: true,
    }) as FSNode[];
    const result: FSNode[] = [];

    for (const child of children) {
        const cId = compositeId(moduleName, child.path);
        const wrapped = wrapFSNode(child, cId, parentPath, moduleName);

        // Pre-load content for non-sensitive files (used by editor via item.content.data)
        if (child.type !== 'directory' && !isSensitivePath(child.path)) {
            try {
                const raw = await fs.driver.readContent(child.path);
                (wrapped as any)._content = raw;
            } catch { /* unreadable */ }
        }
        result.push(wrapped);
    }
    return result;
}

// ── Capabilities ──────────────────────────────────────────────────────────────

const READONLY_CAPS: FSCapabilities = Object.freeze({
    readonly: true, search: true, semanticSearch: false, syncable: false,
    assets: false, tags: false, deviceFiles: false,
    seqFiles: false, references: false, symlinks: false, hardlinks: false,
    partialRead: false, partialWrite: false, treeWalk: false,
    streaming: false, watch: false, mount: false,
});

const noopTags: ITagOperations = {
    getAllTags: async () => [],
    setTags: async () => {},
    addTag: async () => {},
    removeTag: async () => {},
    walkByTag: async () => ({ total: 0, processed: 0 }),
};

const noopAssets: IAssetOperations = {
    putAsset: async () => ({ type: 'file' } as FSFileNode),
    getAsset: async () => null,
    getAssetDirPath: async () => null,
    ensureAssetDir: async () => { throw new FSCapabilityError('assets', 'system'); },
    listAssets: async () => [],
    deleteAsset: async () => {},
    removeAssetDir: async () => {},
    hasAssetDir: async () => false,
};

// ═══════════════════════════════════════════════════════════════════════════════
// SystemVFSEngine
// ═══════════════════════════════════════════════════════════════════════════════

export class SystemVFSEngine implements IModuleFS {
    readonly moduleId = 'system';
    readonly capabilities: FSCapabilities = READONLY_CAPS;
    readonly driver: IFSDriver;
    readonly meta: import('@itookit/common').IFSMetaDriver = {
        assets: noopAssets,
        tags: noopTags,
    };

    constructor(private readonly vfs: IVFSManager) {
        this.driver = new SystemFSDriver(this.vfs);
    }

    async init(): Promise<void> {}
    openFile(_nodeId: string): never { throw new Error('not supported'); }

    on = (e: any, cb: any) => this.driver.on(e, cb);
}

// ═══════════════════════════════════════════════════════════════════════════════
// SystemFSDriver
// ═══════════════════════════════════════════════════════════════════════════════

class SystemFSDriver implements IFSDriver {
    readonly moduleId = 'system';
    readonly capabilities: FSCapabilities = READONLY_CAPS;

    constructor(private readonly vfs: IVFSManager) {}

    // ── Events (no-op) ───────────────────────────────
    on(): () => void { return () => {}; }

    // ── Read ─────────────────────────────────────────

    async getNode(id: string): Promise<FSNode | null> {
        if (id === DEV_DIR_ID) return this.buildDevDirNode();

        if (id.startsWith(DEV_PREFIX)) {
            const handlerId = id.slice(DEV_PREFIX.length);
            return this.buildDevFileNode(handlerId, DEV_DIR_ID);
        }

        if (id.startsWith(MOD_PREFIX)) {
            const moduleName = id.slice(MOD_PREFIX.length);
            const info = this.vfs.getModule(moduleName);
            if (!info) return null;
            return {
                id,
                parentPath: null,
                name: moduleName,
                type: 'directory' as const,
                path: `/${moduleName}`,
                createdAt: 0,
                modifiedAt: 0,
                version: 0,
                tags: [],
                metadata: { title: moduleName, description: info.description ?? '', _showAll: true },
                moduleId: 'system',
            } as SystemFSNode<FSDirectoryNode>;
        }

        const parsed = parseComposite(id);
        if (!parsed) return null;

        try {
            const fs = this.vfs.getEngine(parsed.moduleName);
            const node = await fs.driver.getNode(parsed.realId);
            if (!node) return null;
            return wrapFSNode(node, id, null, parsed.moduleName);
        } catch {
            return null;
        }
    }

    async getChildren(parentId: string, _options?: any): Promise<FSNode[]> {
        if (parentId === '/') {
            const nodes: FSNode[] = [this.buildDevDirNode()];
            const modules = this.vfs.getAllModules();
            nodes.push(...modules.map(mod => ({
                id: moduleNodeId(mod.name),
                parentPath: null,
                name: mod.name,
                type: 'directory' as const,
                path: `/${mod.name}`,
                createdAt: 0,
                modifiedAt: 0,
                version: 0,
                tags: [] as string[],
                metadata: { title: mod.name, description: mod.description ?? '', _showAll: true },
                moduleId: 'system',
            } as SystemFSNode<FSDirectoryNode>)));
            return nodes;
        }

        if (parentId === DEV_DIR_ID) {
            return this.buildDevChildNodes();
        }

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
            const children = await fs.driver.getChildren(parsed.realId, {
                includeHidden: true, includeAssetDirs: true, includeInternalDirs: true,
            }) as FSNode[];
            return children.map(c => {
                const cId = compositeId(parsed.moduleName, c.path);
                return wrapFSNode(c, cId, parentId, parsed.moduleName);
            });
        } catch {
            return [];
        }
    }

    async readContent(id: string, options: ReadOptions & { encoding: 'utf-8' }): Promise<string>;
    async readContent(id: string, options: ReadOptions & { encoding: 'binary' }): Promise<ArrayBuffer>;
    async readContent(id: string, options?: ReadOptions): Promise<FileContent>;
    async readContent(id: string, _options?: any): Promise<FileContent> {
        if (id === DEV_DIR_ID) return '';

        if (id.startsWith(DEV_PREFIX)) {
            const handlerId = id.slice(DEV_PREFIX.length);
            return this.buildDevContent(handlerId);
        }

        if (id.startsWith(MOD_PREFIX)) return '';

        const parsed = parseComposite(id);
        if (!parsed) return '';

        const node = await this.getNode(id);

        if (node && isSensitivePath(node.path)) {
            return BLOCKED_CONTENT(node.name, node.path, parsed.moduleName);
        }

        try {
            const raw = await this.vfs.getEngine(parsed.moduleName).driver.readContent(parsed.realId);
            if (typeof raw === 'string') return raw;
            if (raw instanceof ArrayBuffer) return raw;
            return (raw as Uint8Array).buffer.slice(
                (raw as Uint8Array).byteOffset,
                (raw as Uint8Array).byteOffset + (raw as Uint8Array).byteLength,
            ) as ArrayBuffer;
        } catch (e) {
            return `⚠️ Could not read content\n\n${e}`;
        }
    }

    async resolvePath(): Promise<string | null> { return null; }
    async exists(): Promise<boolean> { return false; }
    async search(): Promise<FSSearchResult> { return { nodes: [], total: 0, hasMore: false }; }

    // ── Write (all throw read-only) ──────────────────
    async writeContent(): Promise<void> { throw new Error('Read-only'); }
    async appendContent(): Promise<void> { throw new Error('Read-only'); }
    async createFile(): Promise<FSNode> { throw new Error('Read-only'); }
    async createDirectory(): Promise<FSNode> { throw new Error('Read-only'); }
    async rename(): Promise<void> { throw new Error('Read-only'); }
    async delete(): Promise<void> { throw new Error('Read-only'); }
    async move(): Promise<void> { throw new Error('Read-only'); }
    async updateMetadata(): Promise<void> {}

    // ── Links ────────────────────────────────────────
    async symlink(): Promise<FSNode> { throw new FSCapabilityError('symlinks', this.moduleId); }
    async readlink(): Promise<string> { throw new FSCapabilityError('symlinks', this.moduleId); }
    async hardlink(): Promise<FSNode> { throw new FSCapabilityError('hardlinks', this.moduleId); }
    async transaction(): Promise<never> { throw new FSCapabilityError('transaction', this.moduleId); }

    // ── /dev/ helpers ───────────────────────────────

    private buildDevDirNode(): SystemFSNode<FSDirectoryNode> {
        return {
            id: DEV_DIR_ID,
            parentPath: null,
            name: 'dev',
            type: 'directory' as const,
            path: '/dev',
            createdAt: 0,
            modifiedAt: 0,
            version: 0,
            tags: [],
            metadata: { title: '/dev', description: 'Registered virtual device drivers', _showAll: true },
            moduleId: 'system',
        } as SystemFSNode<FSDirectoryNode>;
    }

    private buildDevChildNodes(): FSNode[] {
        return this.vfs.devices.list().map(handlerId =>
            this.buildDevFileNode(handlerId, DEV_DIR_ID),
        );
    }

    private buildDevFileNode(handlerId: string, parentPath: string): SystemFSNode<FSFileNode> {
        const driver = this.vfs.devices.has(handlerId)
            ? this.vfs.devices.get(handlerId)
            : null;
        return {
            id: devNodeId(handlerId),
            parentPath,
            name: handlerId,
            type: 'file' as const,
            path: `/dev/${handlerId}`,
            createdAt: 0,
            modifiedAt: 0,
            size: 0,
            version: 0,
            tags: [],
            metadata: { title: handlerId, description: driver?.description ?? '', _showAll: true },
            moduleId: 'system',
        } as SystemFSNode<FSFileNode>;
    }

    private buildDevContent(handlerId: string): string {
        if (!this.vfs.devices.has(handlerId)) return `⚠️ Device '${handlerId}' not found`;
        const driver = this.vfs.devices.get(handlerId);
        return JSON.stringify({
            handlerId: driver.handlerId,
            description: driver.description ?? null,
            writable: driver.writable,
            streamable: driver.streamable ?? false,
            sessionable: driver.sessionable ?? false,
        }, null, 2);
    }
}
