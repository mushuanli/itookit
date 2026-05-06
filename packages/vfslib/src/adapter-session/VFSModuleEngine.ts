// @file packages/vfslib/src/adapter-session/VFSModuleEngine.ts

import { toBuffer } from '../utils/encoding';

import type {
    IVFSManager,
    IModuleFS,
    FSNode,
    IFSEngine,
} from '@itookit/common';
import { engineDEBUG } from '../utils/debug';
import type {
    EngineNode,
    EngineSearchQuery,
    EngineEvent,
    EngineEventType,
    NodeType,
    SRSItemData,
} from '@itookit/common';

// Maps EngineEventType → FSEventType (batch events collapse to their base type)
const ENGINE_TO_FS_EVENT: Partial<Record<EngineEventType, string>> = {
    'node:batch_updated': 'node:updated',
    'node:batch_moved':   'node:moved',
    'node:batch_deleted': 'node:deleted',
};

const FS_SUPPORTED_EVENTS = new Set([
    'node:created', 'node:updated', 'node:deleted', 'node:moved', 'node:renamed', 'error',
]);

/**
 * VFSModuleEngine — 将 IVFSManager 适配为 IFSEngine
 *
 * 与旧版 @itookit/vfs 的 VFSModuleEngine 保持相同的公共 API，
 * 内部改为通过 IModuleFS 操作，彻底脱离旧 VFS 实现。
 */
export class VFSModuleEngine implements IFSEngine {
    constructor(
        public readonly moduleName: string,
        private readonly vfs: IVFSManager,
        private readonly mountOptions?: { isSystem?: boolean; description?: string },
    ) {}

    /** 获取模块的 IModuleFS（需先调用 init()） */
    getModuleFS(): IModuleFS {
        return this.vfs.getEngine(this.moduleName);
    }

    // ── 生命周期 ──────────────────────────────────────────────

    async init(): Promise<void> {
        await this.vfs.mount(this.moduleName, this.mountOptions);
        await this.getModuleFS().init();
    }

    // ── 读取操作 ──────────────────────────────────────────────

    private async collectChildren(idOrPath: string): Promise<EngineNode[]> {
        const children = await this.getModuleFS().getChildren(idOrPath) as FSNode[];
        return Promise.all(children.map(async child => {
            const engineNode = this.toEngineNode(child);
            if (child.type === 'directory') {
                engineNode.children = await this.collectChildren(child.id);
            }
            return engineNode;
        }));
    }

    async getChildren(parentId: string): Promise<EngineNode[]> {
        const children = await this.getModuleFS().getChildren(parentId) as FSNode[];
        return children.map(n => this.toEngineNode(n));
    }

    async readContent(id: string): Promise<string | ArrayBuffer> {
        const content = await this.getModuleFS().readContent(id);
        if (typeof content === 'string') return content;
        return toBuffer(content);
    }

    async getNode(id: string): Promise<EngineNode | null> {
        const node = await this.getModuleFS().getNode(id);
        return node ? this.toEngineNode(node) : null;
    }

    async search(query: EngineSearchQuery): Promise<EngineNode[]> {
        // Name-contains is the primary filter for mention autocomplete (user types a filename prefix).
        const nameQuery = query.text ? { contains: query.text } : undefined;
        const tagsQuery = query.tags ? { any: query.tags } : undefined;

        // Cross-module search: delegate to IVFSManager when scope is specified.
        const hasScope = Array.isArray(query.scope) && query.scope.length > 0;
        if (hasScope) {
            const modules = query.scope![0] === '*' ? undefined : query.scope;
            const result = await this.vfs.search({
                modules,
                name: nameQuery,
                type: query.type as any,
                tags: tagsQuery,
                limit: query.limit,
            });
            return Array.from(result.nodes).map(n => ({
                ...this.toEngineNode(n),
                // Use the node's own moduleId from cross-module results.
                moduleId: n.moduleId ?? this.moduleName,
            }));
        }

        // Module-local search.
        const result = await this.getModuleFS().search({
            name: nameQuery,
            type: query.type as any,
            tags: tagsQuery,
            limit: query.limit,
        });
        return Array.from(result.nodes).map(n => this.toEngineNode(n));
    }

    async getAllTags(): Promise<Array<{ name: string; color?: string }>> {
        const tags = await (this.getModuleFS().tags?.getAllTags() ?? Promise.resolve([]));
        return tags;
    }

    // ── SRS (Spaced Repetition) ───────────────────────────────
    //
    // SRS data for a file lives in its asset dir as a seqfile named 'srs':
    //   note.anki  →  _note.anki/srs   (type='seqfile', key=clozeId, value=JSON)
    //
    // The asset dir is automatically renamed/moved/deleted with the owner file
    // by vfs-engine's naming-convention cascade (_<filename> lookup).

    /**
     * fileId → module-relative seqfile path (e.g. '/_note.anki/srs').
     * Paths are faster to resolve than encoded IDs (forward-only inode traversal).
     * Invalidated on rename/move/delete since the path changes.
     */
    private srsSeqFilePaths = new Map<string, string>();

    /** Compute the module-relative seqfile path for a given file node. */
    private srsPath(filePath: string): string {
        const lastSlash = filePath.lastIndexOf('/');
        const dir = filePath.substring(0, lastSlash);
        const filename = filePath.substring(lastSlash + 1);
        return `${dir}/_${filename}/srs`;
    }

    /**
     * Resolve seqfile path for a file, creating the seqfile lazily if needed.
     * Asset dir is created via recursive:true if it doesn't exist yet.
     */
    private async getOrCreateSRSSeqFilePath(fileId: string): Promise<string | null> {
        const cached = this.srsSeqFilePaths.get(fileId);
        if (cached) return cached;

        const fs = this.getModuleFS();
        if (!fs.seq) return null;

        const fileNode = await fs.getNode(fileId);
        if (!fileNode || fileNode.type !== 'file') return null;

        const path = this.srsPath(fileNode.path);
        const lastSlash = path.lastIndexOf('/');

        if (!await fs.exists(path)) {
            await fs.createFile({
                name: 'srs',
                parentIdOrPath: path.substring(0, lastSlash),
                type: 'seqfile',
                recursive: true,
            });
        }

        this.srsSeqFilePaths.set(fileId, path);
        return path;
    }

    /**
     * Resolve seqfile path without creating it.
     * Returns null if the file has no SRS data yet.
     */
    private async getSRSSeqFilePath(fileId: string): Promise<string | null> {
        const cached = this.srsSeqFilePaths.get(fileId);
        if (cached) return cached;

        const fs = this.getModuleFS();
        if (!fs.seq) return null;

        const fileNode = await fs.getNode(fileId);
        if (!fileNode || fileNode.type !== 'file') return null;

        const path = this.srsPath(fileNode.path);
        if (!await fs.exists(path)) return null;

        this.srsSeqFilePaths.set(fileId, path);
        return path;
    }

    async getSRSStatus(fileId: string): Promise<Record<string, SRSItemData>> {
        const fs = this.getModuleFS();
        const seqPath = await this.getSRSSeqFilePath(fileId);
        if (!seqPath || !fs.seq) return {};
        const result: Record<string, SRSItemData> = {};
        await fs.seq.walkEntries(seqPath, (e) => {
            result[e.key] = JSON.parse(e.value) as SRSItemData;
            return true;
        });
        return result;
    }

    async updateSRSStatus(fileId: string, clozeId: string, status: SRSItemData): Promise<void> {
        const fs = this.getModuleFS();
        const seqPath = await this.getOrCreateSRSSeqFilePath(fileId);
        if (!seqPath || !fs.seq) return;
        await fs.seq.setEntry(seqPath, clozeId, JSON.stringify(status));
    }

    async getDueCards(limit?: number): Promise<Array<{ fileId: string; clozeId: string; status: SRSItemData }>> {
        const fs = this.getModuleFS();
        if (!fs.seq) return [];
        const now = Date.now();
        const result: Array<{ fileId: string; clozeId: string; status: SRSItemData }> = [];
        const files = this.flattenFiles(await this.collectChildren('/'));
        for (const node of files) {
            if (limit && result.length >= limit) break;
            const seqPath = await this.getSRSSeqFilePath(node.id);
            if (!seqPath) continue;
            await fs.seq.walkEntries(seqPath, (e) => {
                if (limit && result.length >= limit) return false;
                const s = JSON.parse(e.value) as SRSItemData;
                if (!s.dueAt || s.dueAt <= now) {
                    result.push({ fileId: node.id, clozeId: e.key, status: s });
                }
                return true;
            });
        }
        return result;
    }

    private flattenFiles(nodes: EngineNode[]): EngineNode[] {
        const result: EngineNode[] = [];
        for (const n of nodes) {
            if (n.type === 'file') result.push(n);
            else if (n.children) result.push(...this.flattenFiles(n.children));
        }
        return result;
    }

    // ── 写入操作 ──────────────────────────────────────────────

    async createFile(
        name: string,
        parentIdOrPath: string | null,
        content: string | ArrayBuffer = '',
        metadata?: Record<string, unknown>,
    ): Promise<EngineNode> {
        const node = await this.getModuleFS().createFile({
            name,
            parentIdOrPath,
            content,
            metadata,
        });
        const result = this.toEngineNode(node);
        result.content = content;
        return result;
    }

    async createDirectory(
        name: string,
        parentIdOrPath: string | null,
    ): Promise<EngineNode> {
        const node = await this.getModuleFS().createDirectory({ name, parentIdOrPath });
        const result = this.toEngineNode(node);
        result.children = [];
        return result;
    }

    async createAsset(
        ownerNodeId: string,
        filename: string,
        content: string | ArrayBuffer,
    ): Promise<EngineNode> {
        const node = await this.getModuleFS().assets!.putAsset(ownerNodeId, filename, content);
        return this.toEngineNode(node);
    }

    async getAssetDirectoryId(ownerNodeId: string): Promise<string | null> {
        return this.getModuleFS().assets?.getAssetDirId(ownerNodeId) ?? null;
    }

    async getAssets(ownerNodeId: string): Promise<EngineNode[]> {
        const assets = this.getModuleFS().assets;
        if (!assets) return [];
        const dirId = await assets.getAssetDirId(ownerNodeId);
        if (!dirId) return [];
        const children = await this.getModuleFS().getChildren(dirId) as FSNode[];
        return children.map(n => this.toEngineNode(n));
    }

    async writeContent(id: string, content: string | ArrayBuffer): Promise<void> {
        await this.getModuleFS().writeContent(id, content);
    }

    async rename(id: string, newName: string): Promise<void> {
        this.srsSeqFilePaths.delete(id); // path changes after rename
        await this.getModuleFS().rename(id, newName);
    }

    async move(ids: string[], targetParentId: string | null): Promise<void> {
        ids.forEach(id => this.srsSeqFilePaths.delete(id)); // path changes after move
        await this.getModuleFS().move(ids, targetParentId);
    }

    async delete(ids: string[]): Promise<void> {
        ids.forEach(id => this.srsSeqFilePaths.delete(id));
        await this.getModuleFS().delete(ids, { recursive: true });
    }

    async updateMetadata(id: string, metadata: Record<string, unknown>): Promise<void> {
        await this.getModuleFS().updateMetadata(id, metadata);
    }

    async setTags(id: string, tags: string[]): Promise<void> {
        await this.getModuleFS().tags?.setTags(id, tags);
    }

    async setTagsBatch(updates: Array<{ id: string; tags: string[] }>): Promise<void> {
        const tagsOps = this.getModuleFS().tags;
        if (!tagsOps) return;
        await Promise.all(updates.map(u => tagsOps.setTags(u.id, u.tags)));
    }

    // ── 事件订阅 ──────────────────────────────────────────────

    on(event: EngineEventType, callback: (event: EngineEvent) => void): () => void {
        const fs = this.getModuleFS();
        // Map batch engine events to their underlying FS event type
        const fsEvent = ENGINE_TO_FS_EVENT[event] ?? event;
        if (!FS_SUPPORTED_EVENTS.has(fsEvent)) return () => {};
        engineDEBUG.subscribe(this.moduleName, event, fsEvent);
        const unsub = fs.on(fsEvent as any, (e) => {
            engineDEBUG.callback(this.moduleName, event, e.payload);
            callback({ type: event, payload: e.payload });
        });
        return () => {
            engineDEBUG.unsubscribe(this.moduleName, fsEvent);
            unsub();
        };
    }

    // ── 路径解析 ──────────────────────────────────────────────

    async resolvePath(path: string): Promise<string | null> {
        return this.getModuleFS().resolvePath(path);
    }

    async pathExists(path: string): Promise<boolean> {
        return this.getModuleFS().exists(path);
    }

    // ── 内部辅助 ──────────────────────────────────────────────

    private toEngineNode(node: FSNode): EngineNode {
        const type: NodeType =
            node.type === 'file' || node.type === 'directory' ? node.type : 'file';

        return {
            id: node.id,
            parentId: node.parentId,
            name: node.name,
            type,
            path: node.path,
            size: node.type === 'file' ? node.size : 0,
            createdAt: node.createdAt,
            modifiedAt: node.modifiedAt,
            tags: node.tags ? [...node.tags] : [],
            metadata: node.metadata,
            moduleId: this.moduleName,
            icon: node.icon ?? (node.metadata?.icon as string | undefined),
            assetDirId: node.type === 'file' ? node.assetDirId : undefined,
        };
    }
}
