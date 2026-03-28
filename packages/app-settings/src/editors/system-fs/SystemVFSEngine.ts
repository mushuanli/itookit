/**
 * @file SystemVFSEngine.ts
 * @desc Read-only cross-module ISessionEngine for the System FS Explorer debug view.
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

const DEV_DIR_ID  = '__dev__';
const DEV_PREFIX  = '__dev__|';
const MOD_PREFIX  = '__mod__';

const moduleNodeId = (moduleName: string): string => `${MOD_PREFIX}${moduleName}`;
const devNodeId    = (handlerId: string): string   => `${DEV_PREFIX}${handlerId}`;

const compositeId = (moduleName: string, realId: string): string =>
    `${moduleName}|${realId}`;

function parseComposite(id: string): { moduleName: string; realId: string } | null {
    if (id.startsWith(MOD_PREFIX) || id.startsWith(DEV_PREFIX) || id === DEV_DIR_ID) return null;
    const sep = id.indexOf('|');
    if (sep < 0) return null;
    return { moduleName: id.slice(0, sep), realId: id.slice(sep + 1) };
}

/**
 * 判断文件路径是否应屏蔽内容：路径任意分段以 "." 开头即视为敏感。
 * 例：/.connections/default 中，default 文件名不含 "."，但父目录 .connections 含，
 * 同样需要屏蔽内容。
 */
const isSensitivePath = (path: string): boolean =>
    path.split('/').filter(Boolean).some(seg => seg.startsWith('.'));

const BLOCKED_CONTENT = (name: string, path: string, mod: string): string =>
    `⛔ System / hidden / asset file — content not shown\n\n` +
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
        // _showAll bypasses shouldFilterNode so hidden/asset nodes are visible
        // in this debug view without modifying any shared UI layer code.
        metadata: { ...(node.metadata as Record<string, unknown>), _showAll: true },
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
    // Debug view: include all reserved entries (hidden, assetdirs, __config internal dirs).
    const children = await fs.getChildren(idOrPath, { includeHidden: true, includeAssetDirs: true, includeInternalDirs: true }) as FSNode[];
    const result: EngineNode[] = [];

    for (const child of children) {
        const cId = compositeId(moduleName, child.id);
        const engineNode = fsNodeToEngine(child, cId, parentId, moduleName);

        if (child.type === 'directory') {
            engineNode.children = await collectTree(fs, child.id, cId, moduleName);
        } else if (!isSensitivePath(child.path)) {
            // Eagerly load content so the editor receives it via item.content.data
            // without needing a custom factory or event-driven reload.
            // Skip files whose path contains any dot-prefix segment (hidden / system).
            try {
                const raw = await fs.readContent(child.id);
                engineNode.content = typeof raw === 'string' ? raw : undefined;
            } catch { /* unreadable files show as empty */ }
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
        const nodes: EngineNode[] = [];

        // 1. /dev/ — 虚拟设备目录
        nodes.push(this.buildDevDirNode());

        // 2. VFS 模块目录
        const modules = this.vfs.getAllModules();
        const moduleTrees = await Promise.all(modules.map(async mod => {
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
                metadata: { title: mod.name, description: mod.description ?? '', _showAll: true },
                moduleId: 'system',
                children,
            };
        }));

        nodes.push(...moduleTrees);
        return nodes;
    }

    async getChildren(parentId: string): Promise<EngineNode[]> {
        // /dev/ 目录
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
            const children = await fs.getChildren(parsed.realId, { includeHidden: true, includeAssetDirs: true, includeInternalDirs: true }) as FSNode[];
            return children.map(c => {
                const cId = compositeId(parsed.moduleName, c.id);
                return fsNodeToEngine(c, cId, parentId, parsed.moduleName);
            });
        } catch {
            return [];
        }
    }

    async getNode(id: string): Promise<EngineNode | null> {
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
        // /dev/ 目录本身
        if (id === DEV_DIR_ID) return '';

        // /dev/<handlerId> 设备节点 → 显示驱动元数据
        if (id.startsWith(DEV_PREFIX)) {
            const handlerId = id.slice(DEV_PREFIX.length);
            return this.buildDevContent(handlerId);
        }

        if (id.startsWith(MOD_PREFIX)) return '';

        const parsed = parseComposite(id);
        if (!parsed) return '';

        const node = await this.getNode(id);

        // Block content for files whose path contains any dot-prefix segment,
        // including files nested under hidden directories (e.g. .connections/default).
        if (node && isSensitivePath(node.path)) {
            return BLOCKED_CONTENT(node.name, node.path, parsed.moduleName);
        }

        try {
            const raw = await this.vfs.getEngine(parsed.moduleName).readContent(parsed.realId);
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

    // ── /dev/ helpers ─────────────────────────────────────────────────────────

    private buildDevDirNode(): EngineNode {
        return {
            id: DEV_DIR_ID,
            parentId: null,
            name: 'dev',
            type: 'directory' as const,
            path: '/dev',
            createdAt: 0,
            modifiedAt: 0,
            tags: [],
            metadata: { title: '/dev', description: 'Registered virtual device drivers' },
            moduleId: 'system',
            children: this.buildDevChildNodes(),
        };
    }

    private buildDevChildNodes(): EngineNode[] {
        return this.vfs.devices.list().map(handlerId =>
            this.buildDevFileNode(handlerId, DEV_DIR_ID),
        );
    }

    private buildDevFileNode(handlerId: string, parentId: string): EngineNode {
        const driver = this.vfs.devices.has(handlerId)
            ? this.vfs.devices.get(handlerId)
            : null;
        return {
            id: devNodeId(handlerId),
            parentId,
            name: handlerId,
            type: 'file' as const,
            path: `/dev/${handlerId}`,
            createdAt: 0,
            modifiedAt: 0,
            size: 0,
            tags: [],
            metadata: { title: handlerId, description: driver?.description ?? '' },
            moduleId: 'system',
        };
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

    // ── Search ────────────────────────────────────────────────────────────────

    async search(_query: EngineSearchQuery): Promise<EngineNode[]> {
        return [];
    }

    // ── Tags (no-op) ──────────────────────────────────────────────────────────

    async getAllTags(): Promise<Array<{ name: string; color?: string }>> { return []; }
    async setTags(_id: string, _tags: string[]): Promise<void> {}
    async setTagsBatch(_updates: Array<{ id: string; tags: string[] }>): Promise<void> {}

    // ── Assets (no-op) ────────────────────────────────────────────────────────

    async createAsset(): Promise<EngineNode> { return this.throwReadOnly('createAsset'); }
    async getAssetDirectoryId(): Promise<string | null> { return null; }
    async getAssets(): Promise<EngineNode[]> { return []; }

    // ── Mutations (read-only — all throw) ────────────────────────────────────

    private throwReadOnly(op: string): never {
        throw new Error(`[SystemVFSEngine] Read-only: ${op} is not allowed`);
    }

    async writeContent(): Promise<void>  { this.throwReadOnly('writeContent'); }
    async createFile(): Promise<EngineNode> { return this.throwReadOnly('createFile'); }
    async createDirectory(): Promise<EngineNode> { return this.throwReadOnly('createDirectory'); }
    async rename(): Promise<void>  { this.throwReadOnly('rename'); }
    async delete(): Promise<void>  { this.throwReadOnly('delete'); }
    async move(): Promise<void>    { this.throwReadOnly('move'); }
    async updateMetadata(): Promise<void> {}

    // ── Events (static snapshot — no events) ─────────────────────────────────

    on(_event: EngineEventType, _callback: (e: EngineEvent) => void): () => void {
        return () => {};
    }
}
