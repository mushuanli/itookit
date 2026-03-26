/**
 * @file packages/vfslib/src/services/module-fs.ts
 * @desc IModuleFS 实现 — 模块的 chroot 隔离文件系统视图
 *
 * 设计：
 * - ScopedView 负责路径翻译
 * - AccessController 负责权限检查
 * - PluginPipeline 负责中间件管道
 * - 能力子接口内联实现（避免类爆炸）
 * - 事件在操作完成后触发，事务内延迟到 commit
 */

import type {
    IModuleFS,
    IFSTransaction,
    FSNode,
    DirEntry,
    FSCapabilities,
    FSModuleStats,
    FSNodeType,
    FileContent,
    FSSearchQuery,
    FSSearchResult,
    FSEventType,
    FSEvent,
    FSOperationType,
    OperationContext,
    CreateFileOptions,
    CreateDirectoryOptions,
    WriteOptions,
    ReadOptions,
    DeleteOptions,
    RenameOptions,
    MoveOptions,
    CopyOptions,
    ListOptions,
    TreeWalkOptions,
    TreeWalkCallback,
    IAssetOperations,
    ITagOperations,
    ISeqFileOperations,
    IRefOperations,
    IWatchOperations,
    InodeRecord,
    MetaRecord,
    RefType,
    Reference,
    RefQueryOptions,
    TagDefinition,
    SeqFileEntry,
    RecordQuery,
    RecordQueryOptions,
    RecordQueryResult,
    FSNodeMovedPayload,
    IDeviceHandle,
    DeviceContext,
} from '@itookit/common';

import {
    FSNotFoundError,
    FSError,
    FSReadOnlyError,
    FSTypeMismatchError,
    FSCapabilityError,
} from '@itookit/common';

import { VFSEngine, ROOT_INO } from '../engine/vfs-engine';
import { toFSNode } from '../engine/node-mapper';
import { ScopedView } from './scoped-view';
import { AccessController, type CallerIdentity } from '../engine/access-controller';
import { EventBus, TransactionEventBuffer } from '../event/event-bus';
import { PluginPipeline } from '../engine/plugin-pipeline';
import { DeviceRegistry } from '../engine/device-registry';
import { deleteRecursive } from '../engine/tree-ops';
import type { ResolvedInode } from '../engine/path-resolver';
import { toBuffer, toString } from '../utils/encoding';
import {
    isPath,
    isHiddenName,
    isAssetDirName,
    isInternalDirName,
    toAssetDirName,
} from '../utils/validation';
import * as P from '../utils/path';
import { encodeId, decodeId } from './id-mapper';
import { moduleDEBUG } from '../utils/debug';

export interface ModuleFSDeps {
    moduleId: string;
    engine: VFSEngine;
    eventBus: EventBus;
    plugins: PluginPipeline;
    access: AccessController;
    devices: DeviceRegistry;
    mountId?: string;
    /** If true, the module bypasses all access control checks */
    isSystem?: boolean;
}

// ─── DeviceHandle ─────────────────────────────────────────────────────────────

/**
 * 打开设备文件后返回的句柄，将 driver + ctx 封装为统一接口。
 * 通过 ModuleFS.openDevice() 创建，不直接实例化。
 */
class DeviceHandle implements IDeviceHandle {
    constructor(
        private readonly _driver: import('@itookit/common').IDeviceDriver,
        public readonly ctx: DeviceContext,
    ) {}

    read(): Promise<FileContent> {
        return this._driver.read(this.ctx);
    }

    write(content: FileContent): Promise<void> {
        if (!this._driver.writable) throw new Error(`Device '${this._driver.handlerId}' is read-only`);
        return this._driver.write(this.ctx, content);
    }

    async *readStream(): AsyncIterable<string | ArrayBuffer> {
        if (!this._driver.readStream) throw new Error(`Device '${this._driver.handlerId}' is not streamable`);
        yield* this._driver.readStream(this.ctx);
    }

    ioctl(command: string | number, arg?: unknown): Promise<unknown> {
        if (!this._driver.ioctl) throw new Error(`Device '${this._driver.handlerId}' does not support ioctl`);
        return this._driver.ioctl(this.ctx, command, arg);
    }

    async close(): Promise<void> {
        await this._driver.close?.(this.ctx);
    }
}

// ─────────────────────────────────────────────────────────────────────────────

export class ModuleFS implements IModuleFS {
    readonly moduleId: string;
    readonly capabilities: FSCapabilities;

    readonly assets: IAssetOperations;
    readonly tags: ITagOperations;
    readonly refs: IRefOperations;
    readonly seq?: ISeqFileOperations;
    readonly watcher?: IWatchOperations;

    private readonly engine: VFSEngine;
    private readonly bus: EventBus;
    private readonly plugins: PluginPipeline;
    private readonly access: AccessController;
    private readonly devices: DeviceRegistry;
    private readonly scope: ScopedView;
    private readonly mountId: string;
    private readonly caller: CallerIdentity;
    private initialized = false;

    constructor(deps: ModuleFSDeps) {
        this.moduleId = deps.moduleId;
        this.engine = deps.engine;
        this.bus = deps.eventBus;
        this.plugins = deps.plugins;
        this.access = deps.access;
        this.devices = deps.devices;
        this.scope = new ScopedView(deps.moduleId);
        this.mountId = deps.mountId ?? 'mount_0';
        this.caller = { moduleId: deps.moduleId, isSystem: deps.isSystem ?? false };

        const backend = this.engine.getBackend();
        this.capabilities = Object.freeze({
            readonly: false,
            search: true,
            semanticSearch: false,
            syncable: false,
            assets: true,
            tags: true,
            transaction: true,
            deviceFiles: true,
            seqFiles: !!backend.records,
            references: true,
            symlinks: true,
            hardlinks: false,
            partialRead: !!backend.content.readRange,
            partialWrite: !!backend.content.appendData,
            treeWalk: true,
            streaming: false,
            watch: false,
            mount: false,
        });

        this.assets = new InlineAssetOps(this);
        this.tags = new InlineTagOps(this);
        this.refs = new InlineRefOps(this);
        if (this.capabilities.seqFiles) {
            this.seq = new InlineSeqOps(this);
        }
    }

    // ══════════════════════════════════════════════════════════
    // Lifecycle
    // ══════════════════════════════════════════════════════════

    async init(): Promise<void> {
        if (this.initialized) return;
        await this.engine.ensureModuleDir(this.moduleId);
        this.initialized = true;
    }

    async dispose(): Promise<void> {
        this.initialized = false;
    }

    // ══════════════════════════════════════════════════════════
    // Events
    // ══════════════════════════════════════════════════════════

    on<E extends FSEventType>(event: E, callback: (event: FSEvent<E>) => void): () => void {
        return this.bus.on(event, (evt) => {
            const pass = evt.moduleId === this.moduleId || !evt.moduleId;
            moduleDEBUG.filter(this.moduleId, event, pass, evt.moduleId);
            if (pass) callback(evt);
        });
    }

    onAny(callback: (event: FSEvent) => void): () => void {
        return this.bus.onAny((evt) => {
            if (evt.moduleId === this.moduleId || !evt.moduleId) callback(evt);
        });
    }

    // ══════════════════════════════════════════════════════════
    // Internal: Resolution & Mapping
    // ══════════════════════════════════════════════════════════

    /** @internal — used by inline capability implementations */
    async _resolve(idOrPath: string, _op?: string): Promise<ResolvedInode> {
        const realPath = await this._toReal(idOrPath);
        return this.engine.resolve(realPath);
    }

    /** @internal */
    async _tryResolve(idOrPath: string): Promise<ResolvedInode | null> {
        try {
            return await this._resolve(idOrPath);
        } catch (e) {
            if (e instanceof FSNotFoundError) return null;
            throw e;
        }
    }

    /** @internal */
    async _toReal(idOrPath: string): Promise<string> {
        if (isPath(idOrPath)) {
            return this.scope.toRealPath(idOrPath);
        }
        // ID → ino → walk parent chain to build path
        const decoded = decodeId(idOrPath);
        if (!decoded) throw new FSError('EINVAL', `invalid id: ${idOrPath}`, 'resolve');

        const inode = await this.engine.getBackend().inodes.getInode(decoded.ino);
        if (!inode) throw new FSNotFoundError(idOrPath, 'resolve');

        return this._buildAbsPath(inode);
    }

    /** @internal */
    _toVirtual(realPath: string): string {
        return this.scope.toVirtualPath(realPath);
    }

    /** @internal */
    _id(ino: number): string {
        return encodeId(this.mountId, ino);
    }

    /** @internal */
    _node(inode: InodeRecord, meta: MetaRecord | null, realPath: string): FSNode {
        return toFSNode(
            inode,
            meta,
            this._id(inode.ino),
            inode.parentIno ? this._id(inode.parentIno) : null,
            this.scope.toVirtualPath(realPath),
        );
    }

    /** @internal */
    _resolvedNode(r: ResolvedInode): FSNode {
        return this._node(r.inode, r.meta, r.fullPath);
    }

    /** @internal */
    _emit<E extends FSEventType>(
        type: E,
        payload: any,
    ): void {
        this.bus.emit(type, payload, { moduleId: this.moduleId, mountId: this.mountId });
    }

    /** @internal */
    get _backend() {
        return this.engine.getBackend();
    }

    /** @internal */
    get _stores() {
        return this.engine.store;
    }

    /** @internal */
    get _engine(): VFSEngine {
        return this.engine;
    }

    private async _buildAbsPath(inode: InodeRecord): Promise<string> {
        const parts: string[] = [];
        let current: InodeRecord | null = inode;
        while (current && current.ino !== ROOT_INO && current.parentIno !== current.ino) {
            parts.unshift(current.name);
            current = await this.engine.getBackend().inodes.getInode(current.parentIno);
        }
        return '/' + parts.join('/');
    }

    private assertWritable(idOrPath: string): void {
        if (isPath(idOrPath) && this.scope.isReadOnly(idOrPath)) {
            throw new FSReadOnlyError(idOrPath);
        }
    }

    private ctx(op: FSOperationType, path: string): OperationContext {
        return {
            operation: op,
            moduleId: this.moduleId,
            path: this._toVirtual(path),
            args: {},
        };
    }

    // ══════════════════════════════════════════════════════════
    // Read Operations
    // ══════════════════════════════════════════════════════════

    async getNode(idOrPath: string): Promise<FSNode | null> {
        const r = await this._tryResolve(idOrPath);
        return r ? this._resolvedNode(r) : null;
    }

    getChildren(idOrPath: string, options?: ListOptions & { fields?: 'full' }): Promise<FSNode[]>;
    getChildren(idOrPath: string, options: ListOptions & { fields: 'entry' }): Promise<DirEntry[]>;
    getChildren(idOrPath: string, options?: ListOptions): Promise<FSNode[] | DirEntry[]>;
    async getChildren(idOrPath: string, options?: ListOptions): Promise<FSNode[] | DirEntry[]> {
        const r = await this._resolve(idOrPath, 'getChildren');
        const children = await this.engine.getBackend().inodes.listChildren(r.ino);

        const filtered = children.filter(c => {
            if (!options?.includeHidden && isHiddenName(c.name)) return false;
            if (!options?.includeInternalDirs && isInternalDirName(c.name)) return false;
            if (!options?.includeAssetDirs && isAssetDirName(c.name)) return false;
            return true;
        });

        if (options?.fields === 'entry') {
            const entries: DirEntry[] = [];
            for (const c of filtered) {
                const meta = await this.engine.getBackend().meta.getMeta(c.ino);
                entries.push({
                    id: this._id(c.ino),
                    name: c.name,
                    type: c.type,
                    size: meta?.size,
                    modifiedAt: meta?.modifiedAt ?? c.createdAt,
                });
            }
            return entries;
        }

        const nodes: FSNode[] = [];
        for (const c of filtered) {
            const meta = await this.engine.getBackend().meta.getMeta(c.ino);
            nodes.push(this._node(c, meta, P.join(r.fullPath, c.name)));
        }
        return nodes;
    }

    readContent(idOrPath: string, options: ReadOptions & { encoding: 'utf-8' }): Promise<string>;
    readContent(idOrPath: string, options: ReadOptions & { encoding: 'binary' }): Promise<ArrayBuffer>;
    readContent(idOrPath: string, options?: ReadOptions): Promise<FileContent>;
    async readContent(idOrPath: string, options?: ReadOptions): Promise<FileContent> {
        const r = await this._resolve(idOrPath, 'readContent');

        // Device file delegation
        if (r.inode.type === 'device') {
            const handlerId = r.meta?.deviceHandlerId;
            if (!handlerId) throw new FSError('ENOTTY', 'no device handler', 'read', r.fullPath);
            const driver = this.devices.get(handlerId);
            return driver.read({
                nodeId: this._id(r.ino),
                name: r.name,
                metadata: r.meta?.metadata,
                sessionId: options?.deviceSessionId,
            });
        }

        // SeqFile: serialize to string
        if (r.inode.type === 'seqfile' && this.seq) {
            const entries = await this.seq.getAllEntries(idOrPath);
            const text = entries.map(e => `${e.key}=${e.value}`).join('\n');
            return options?.encoding === 'binary' ? toBuffer(text) : text;
        }

        if (!r.meta?.contentRef) {
            return options?.encoding === 'binary' ? new ArrayBuffer(0) : '';
        }

        const data = await this.engine.getBackend().content.getData(r.meta.contentRef);
        if (!data) {
            return options?.encoding === 'binary' ? new ArrayBuffer(0) : '';
        }

        // Partial read
        if (options?.offset !== undefined || options?.length !== undefined) {
            const offset = options.offset ?? 0;
            const length = options.length ?? (data.byteLength - offset);
            const slice = data.slice(offset, offset + length);
            return options?.encoding === 'binary' ? slice : toString(slice);
        }

        return options?.encoding === 'binary' ? data : toString(data);
    }

    async resolvePath(path: string): Promise<string | null> {
        const r = await this._tryResolve(path);
        return r ? this._id(r.ino) : null;
    }

    async exists(idOrPath: string): Promise<boolean> {
        return (await this._tryResolve(idOrPath)) !== null;
    }

    async walkTree(callback: TreeWalkCallback, options?: TreeWalkOptions): Promise<number> {
        const rootRealPath = options?.rootIdOrPath
            ? await this._toReal(options.rootIdOrPath)
            : `/module/${this.moduleId}`;

        const maxDepth = options?.maxDepth ?? -1;
        const limit = options?.limit ?? Infinity;
        let count = 0;

        const walk = async (currentPath: string, depth: number): Promise<boolean> => {
            if (maxDepth >= 0 && depth > maxDepth) return true;
            if (count >= limit) return false;

            const children = await this.engine.getBackend().inodes.listChildren(
                (await this.engine.resolve(currentPath)).ino,
            );

            for (const child of children) {
                if (count >= limit) return false;
                if (!options?.includeHidden && isHiddenName(child.name)) continue;
                if (isInternalDirName(child.name)) continue;
                if (isAssetDirName(child.name)) continue;

                if (options?.typeFilter) {
                    const types = Array.isArray(options.typeFilter)
                        ? options.typeFilter
                        : [options.typeFilter];
                    if (!types.includes(child.type)) continue;
                }

                const childRealPath = P.join(currentPath, child.name);
                const meta = await this.engine.getBackend().meta.getMeta(child.ino);
                const node = this._node(child, meta, childRealPath);

                count++;
                const result = await callback(node, depth);
                if (result === false) return false;
                if (result === 'skip') continue;

                if (child.type === 'directory') {
                    if (!(await walk(childRealPath, depth + 1))) return false;
                }
            }
            return true;
        };

        await walk(rootRealPath, 0);
        return count;
    }

    async search(query: FSSearchQuery): Promise<FSSearchResult> {
        const limit = query.limit ?? 50;
        const offset = query.offset ?? 0;
        const results: FSNode[] = [];

        await this.walkTree(async (node) => {
            if (results.length >= offset + limit) return false;

            // Type filter
            if (query.type) {
                const types = Array.isArray(query.type) ? query.type : [query.type];
                if (!types.includes(node.type)) return;
            }

            // Name filter
            if (query.name) {
                const n = node.name;
                if (query.name.exact && n !== query.name.exact) return;
                if (query.name.contains && !n.includes(query.name.contains)) return;
                if (query.name.startsWith && !n.startsWith(query.name.startsWith)) return;
                if (query.name.endsWith && !n.endsWith(query.name.endsWith)) return;
            }

            // Tag filter
            if (query.tags) {
                const nodeTags = node.tags ?? [];
                if (query.tags.all && !query.tags.all.every(t => nodeTags.includes(t))) return;
                if (query.tags.any && !query.tags.any.some(t => nodeTags.includes(t))) return;
                if (query.tags.none && query.tags.none.some(t => nodeTags.includes(t))) return;
            }

            // Time range
            if (query.modifiedAfter && node.modifiedAt < query.modifiedAfter) return;
            if (query.modifiedBefore && node.modifiedAt > query.modifiedBefore) return;

            // Metadata filter
            if (query.metadata) {
                const meta = node.metadata ?? {};
                for (const [k, v] of Object.entries(query.metadata)) {
                    if (meta[k] !== v) return;
                }
            }

            // Text search (name + content)
            if (query.text) {
                const lower = query.text.toLowerCase();
                let matched = node.name.toLowerCase().includes(lower);
                if (!matched && node.type === 'file') {
                    try {
                        const content = await this.readContent(node.id, { encoding: 'utf-8' });
                        if (typeof content === 'string') {
                            matched = content.toLowerCase().includes(lower);
                        }
                    } catch {
                        // skip unreadable
                    }
                }
                if (!matched) return;
            }

            results.push(node);
        }, { maxDepth: -1, includeHidden: false });

        const paged = results.slice(offset, offset + limit);
        return {
            nodes: paged,
            total: results.length,
            hasMore: results.length > offset + limit,
        };
    }

    async getStats(): Promise<FSModuleStats> {
        let fileCount = 0;
        let directoryCount = 0;
        let totalSize = 0;
        let lastModifiedAt = 0;
        const typeBreakdown: Partial<Record<FSNodeType, number>> = {};

        await this.walkTree((node) => {
            if (node.type === 'directory') directoryCount++;
            else fileCount++;
            if ('size' in node) totalSize += (node as any).size ?? 0;
            if (node.modifiedAt > lastModifiedAt) lastModifiedAt = node.modifiedAt;
            typeBreakdown[node.type] = (typeBreakdown[node.type] ?? 0) + 1;
        }, { includeHidden: true });

        return { fileCount, directoryCount, totalSize, lastModifiedAt, typeBreakdown };
    }

    // ══════════════════════════════════════════════════════════
    // Write Operations
    // ══════════════════════════════════════════════════════════

    async createFile(options: CreateFileOptions): Promise<FSNode> {
        const parentRealPath = options.parentIdOrPath
            ? await this._toReal(options.parentIdOrPath)
            : `/module/${this.moduleId}`;

        this.assertWritable(this._toVirtual(parentRealPath));
        this.access.checkCreate(this.caller, options.name, parentRealPath);

        const c = this.ctx('create', parentRealPath);
        c.args = { ...options };
        let resultNode!: FSNode;

        await this.plugins.execute('create', c, async () => {
            const resolved = await this.engine.createFile(
                parentRealPath,
                options.name,
                options.type ?? 'file',
                options.content,
                options.metadata as Record<string, unknown>,
                { overwrite: options.overwrite, recursive: options.recursive },
            );
            const nodeRealPath = P.join(parentRealPath, options.name);
            resultNode = this._node(resolved.inode, resolved.meta, nodeRealPath);
            c.result = resultNode;
        });

        resultNode = (c.result as FSNode) ?? resultNode;
        this._emit('node:created', {
            nodes: [{
                nodeId: resultNode.id,
                parentId: resultNode.parentId,
                path: resultNode.path,
                type: resultNode.type,
            }],
        });
        return resultNode;
    }

    async createDirectory(options: CreateDirectoryOptions): Promise<FSNode> {
        const parentRealPath = options.parentIdOrPath
            ? await this._toReal(options.parentIdOrPath)
            : `/module/${this.moduleId}`;

        this.assertWritable(this._toVirtual(parentRealPath));
        this.access.checkCreate(this.caller, options.name, parentRealPath);

        const c = this.ctx('create', parentRealPath);
        let resultNode!: FSNode;

        await this.plugins.execute('create', c, async () => {
            const resolved = await this.engine.createDirectory(
                parentRealPath,
                options.name,
                options.metadata as Record<string, unknown>,
                { recursive: options.recursive },
            );
            const nodeRealPath = P.join(parentRealPath, options.name);
            resultNode = this._node(resolved.inode, resolved.meta, nodeRealPath);
            c.result = resultNode;
        });

        resultNode = (c.result as FSNode) ?? resultNode;
        this._emit('node:created', {
            nodes: [{
                nodeId: resultNode.id,
                parentId: resultNode.parentId,
                path: resultNode.path,
                type: resultNode.type,
            }],
        });
        return resultNode;
    }

    async writeContent(
        idOrPath: string,
        content: FileContent,
        options?: WriteOptions,
    ): Promise<void> {
        const r = await this._resolve(idOrPath, 'writeContent');
        const virtualPath = this._toVirtual(r.fullPath);
        this.assertWritable(virtualPath);

        // Device delegation
        if (r.inode.type === 'device') {
            const handlerId = r.meta?.deviceHandlerId;
            if (!handlerId) throw new FSError('ENOTTY', 'no device handler', 'write', r.fullPath);
            const driver = this.devices.get(handlerId);
            if (!driver.writable) throw new FSReadOnlyError(virtualPath, 'write');
            await driver.write({
                nodeId: this._id(r.ino),
                name: r.name,
                metadata: r.meta?.metadata,
                sessionId: options?.deviceSessionId,
            }, content);
            return;
        }

        const nodeId = this._id(r.ino);
        const c = this.ctx('write', r.fullPath);
        c.args = { content, options };

        await this.plugins.execute('write', c, async () => {
            await this.engine.writeContent(r.fullPath, content, options);
        });

        this._emit('node:updated', {
            nodes: [{ nodeId, path: virtualPath, changedFields: ['content'] }],
            reason: 'content',
        });
    }

    async appendContent(idOrPath: string, content: FileContent): Promise<void> {
        await this.writeContent(idOrPath, content, { mode: 'append' });
    }

    async rename(
        idOrPath: string,
        newName: string,
        options?: RenameOptions,
    ): Promise<void> {
        const r = await this._resolve(idOrPath, 'rename');
        const virtualPath = this._toVirtual(r.fullPath);
        this.assertWritable(virtualPath);

        const oldName = r.name;
        const c = this.ctx('rename', r.fullPath);
        c.args = { newName, options };

        await this.plugins.execute('rename', c, async () => {
            await this.engine.rename(r.fullPath, newName, options);
        });

        const oldVirtual = virtualPath;
        const newVirtual = P.join(P.dirname(virtualPath), newName);
        this._emit('node:renamed', {
            nodes: [{
                nodeId: this._id(r.ino),
                oldName,
                newName,
                oldPath: oldVirtual,
                newPath: newVirtual,
            }],
        });
    }

    async move(
        idsOrPaths: string[],
        targetParentIdOrPath: string | null,
        options?: MoveOptions,
    ): Promise<void> {
        const targetRealPath = targetParentIdOrPath
            ? await this._toReal(targetParentIdOrPath)
            : `/module/${this.moduleId}`;
        this.assertWritable(this._toVirtual(targetRealPath));

        const movedNodes: FSNodeMovedPayload['nodes'] = [];

        for (const idOrPath of idsOrPaths) {
            const r = await this._resolve(idOrPath, 'move');
            const oldVirtual = this._toVirtual(r.fullPath);

            const c = this.ctx('move', r.fullPath);
            c.args = { targetParentIdOrPath, options };

            await this.plugins.execute('move', c, async () => {
                await this.engine.move(r.fullPath, targetRealPath, options);
            });

            const newRealPath = P.join(targetRealPath, r.name);
            movedNodes.push({
                nodeId: this._id(r.ino),
                oldPath: oldVirtual,
                newPath: this._toVirtual(newRealPath),
                oldParentId: this._id(r.parentIno),
                newParentId: targetParentIdOrPath
                    ? this._id((await this.engine.resolve(targetRealPath)).ino)
                    : null,
            });
        }

        if (movedNodes.length > 0) {
            this._emit('node:moved', { nodes: movedNodes });
        }
    }

    async delete(idsOrPaths: string[], options?: DeleteOptions): Promise<void> {
        const requestedIds: string[] = [];
        const allDeletedIds: string[] = [];

        for (const idOrPath of idsOrPaths) {
            let r: ResolvedInode;
            try {
                r = await this._resolve(idOrPath, 'delete');
            } catch (e) {
                if (options?.force && e instanceof FSNotFoundError) continue;
                throw e;
            }

            this.assertWritable(this._toVirtual(r.fullPath));
            const nodeId = this._id(r.ino);
            requestedIds.push(nodeId);

            const c = this.ctx('delete', r.fullPath);
            c.args = { options };

            await this.plugins.execute('delete', c, async () => {
                const deletedInos = await this.engine.delete(r.fullPath, options);
                for (const ino of deletedInos) {
                    allDeletedIds.push(this._id(ino));
                }
            });
        }

        if (requestedIds.length > 0) {
            this._emit('node:deleted', { requestedIds, allDeletedIds });
        }
    }

    async updateMetadata(
        idOrPath: string,
        metadata: Record<string, unknown>,
    ): Promise<void> {
        const r = await this._resolve(idOrPath, 'updateMetadata');
        this.assertWritable(this._toVirtual(r.fullPath));

        const c = this.ctx('updateMetadata', r.fullPath);
        c.args = { metadata };

        await this.plugins.execute('updateMetadata', c, async () => {
            await this.engine.updateMetadata(r.fullPath, metadata);
        });

        this._emit('node:updated', {
            nodes: [{
                nodeId: this._id(r.ino),
                path: this._toVirtual(r.fullPath),
                changedFields: ['metadata'],
            }],
            reason: 'metadata',
        });
    }

    // ══════════════════════════════════════════════════════════
    // Copy
    // ══════════════════════════════════════════════════════════

    async copy(
        sourceIdOrPath: string,
        targetParentIdOrPath: string | null,
        newName?: string,
        _options?: CopyOptions,
    ): Promise<FSNode> {
        const sourceR = await this._resolve(sourceIdOrPath, 'copy');
        const targetRealPath = targetParentIdOrPath
            ? await this._toReal(targetParentIdOrPath)
            : `/module/${this.moduleId}`;
        this.assertWritable(this._toVirtual(targetRealPath));

        const c = this.ctx('copy', sourceR.fullPath);
        let resultNode!: FSNode;

        await this.plugins.execute('copy', c, async () => {
            const backend = this._backend;
            const targetParentR = await this.engine.resolve(targetRealPath);
            const mapping = await backend.runInTransaction('readwrite', async (scope) => {
                const { copyRecursive: cr } = await import('../engine/tree-ops');
                return cr(scope, sourceR.ino, targetParentR.ino, newName ?? sourceR.name);
            });
            const newIno = mapping.get(sourceR.ino)!;
            const inode = (await backend.inodes.getInode(newIno))!;
            const meta = await backend.meta.getMeta(newIno);
            const nodeRealPath = P.join(targetRealPath, newName ?? sourceR.name);
            resultNode = this._node(inode, meta, nodeRealPath);
            c.result = resultNode;
        });

        resultNode = (c.result as FSNode) ?? resultNode;

        this._emit('node:copied', {
            copies: [{
                sourceId: this._id(sourceR.ino),
                targetId: resultNode.id,
                targetPath: resultNode.path,
                targetParentId: resultNode.parentId,
            }],
        });       return resultNode;
    }

    // ══════════════════════════════════════════════════════════
    // Links
    // ══════════════════════════════════════════════════════════

    async symlink(linkPath: string, targetPath: string): Promise<FSNode> {
        const dir = P.dirname(linkPath);
        const name = P.basename(linkPath);
        const realDir = this.scope.toRealPath(dir);
        this.assertWritable(dir);
        this.access.checkCreate(this.caller, name, realDir);

        // Translate absolute virtual paths to real paths so the engine can resolve them.
        // Relative paths are left unchanged (resolved relative to the symlink's directory).
        const realTarget = targetPath.startsWith('/')
            ? this.scope.toRealPath(targetPath)
            : targetPath;
        const resolved = await this.engine.createSymlink(realDir, name, realTarget);
        const nodeRealPath = P.join(realDir, name);
        const node = this._node(resolved.inode, resolved.meta, nodeRealPath);

        this._emit('node:created', {
            nodes: [{
                nodeId: node.id,
                parentId: node.parentId,
                path: node.path,
                type: 'symlink',
            }],
        });

        return node;
    }

    async readlink(idOrPath: string): Promise<string> {
        // Resolve without following the final symlink so we can inspect its target
        const realPath = await this._toReal(idOrPath);
        const r = await this.engine.resolve(realPath, false);
        if (r.inode.type !== 'symlink') {
            throw new FSError('EINVAL', 'not a symlink', 'readlink', r.fullPath);
        }
        return r.meta?.symlinkTarget ?? '';
    }

    // ══════════════════════════════════════════════════════════
    // Device
    // ══════════════════════════════════════════════════════════

    async ioctl(
        idOrPath: string,
        command: string | number,
        arg?: unknown,
    ): Promise<unknown> {
        const r = await this._resolve(idOrPath, 'ioctl');
        if (r.inode.type !== 'device') {
            throw new FSError('ENOTTY', 'not a device file', 'ioctl', r.fullPath);
        }
        const handlerId = r.meta?.deviceHandlerId;
        if (!handlerId) throw new FSError('ENOTTY', 'no device handler', 'ioctl', r.fullPath);
        const driver = this.devices.get(handlerId);
        if (!driver.ioctl) {
            throw new FSError('ENOTTY', 'device does not support ioctl', 'ioctl', r.fullPath);
        }
        return driver.ioctl(
            { nodeId: this._id(r.ino), name: r.name, metadata: r.meta?.metadata },
            command,
            arg,
        );
    }

    /**
     * 在 parentIdOrPath 下创建 type=device 的文件节点。
     * handlerId 必须已注册到 DeviceRegistry。
     */
    async createDeviceFile(
        name: string,
        parentIdOrPath: string | null,
        handlerId: string,
    ): Promise<FSNode> {
        if (!this.devices.has(handlerId)) {
            throw new FSError('ENOTTY', `device handler '${handlerId}' not registered`, 'createDeviceFile', name);
        }

        const parentRealPath = parentIdOrPath
            ? await this._toReal(parentIdOrPath)
            : `/module/${this.moduleId}`;

        this.assertWritable(this._toVirtual(parentRealPath));
        this.access.checkCreate(this.caller, name, parentRealPath);

        const c = this.ctx('create', parentRealPath);
        c.args = { name, handlerId };
        let resultNode!: FSNode;

        await this.plugins.execute('create', c, async () => {
            const resolved = await this.engine.createFile(
                parentRealPath, name, 'device',
                undefined,
                { deviceHandlerId: handlerId },
            );
            const nodeRealPath = P.join(parentRealPath, name);
            resultNode = this._node(resolved.inode, resolved.meta, nodeRealPath);
            c.result = resultNode;
        });

        resultNode = (c.result as FSNode) ?? resultNode;
        this._emit('node:created', {
            nodes: [{ nodeId: resultNode.id, parentId: resultNode.parentId, path: resultNode.path, type: resultNode.type }],
        });
        return resultNode;
    }

    /**
     * 打开设备文件，返回绑定上下文的 DeviceHandle。
     *
     * 对 sessionable 设备自动调用 driver.open() 建立会话；
     * 无状态设备直接绑定 nodeId 返回句柄。
     */
    async openDevice(idOrPath: string, options?: Record<string, unknown>): Promise<IDeviceHandle> {
        const r = await this._resolve(idOrPath, 'openDevice');
        if (r.inode.type !== 'device') {
            throw new FSError('ENOTTY', 'not a device file', 'openDevice', r.fullPath);
        }

        const handlerId = r.meta?.deviceHandlerId as string | undefined;
        if (!handlerId) throw new FSError('ENOTTY', 'no device handler', 'openDevice', r.fullPath);

        const driver = this.devices.get(handlerId);
        const baseCtx: DeviceContext = {
            nodeId: this._id(r.ino),
            name: r.name,
            metadata: r.meta?.metadata as Record<string, unknown> | undefined,
        };

        let sessionId: string | undefined;
        if (driver.sessionable && driver.open) {
            sessionId = await driver.open(baseCtx, options);
        }

        return new DeviceHandle(driver, { ...baseCtx, sessionId });
    }

    // ══════════════════════════════════════════════════════════
    // Transaction
    // ══════════════════════════════════════════════════════════

    async transaction<T>(fn: (tx: IFSTransaction) => Promise<T>): Promise<T> {
        if (!this.capabilities.transaction) {
            throw new FSCapabilityError('transaction', this.moduleId);
        }

        const buffer = new TransactionEventBuffer(this.bus, this.moduleId);

        // Swap event bus to buffer during transaction
        const originalEmit = this.bus.emit.bind(this.bus);
        const bufferedEmit: typeof originalEmit = (type, payload, opts) => {
            if (opts?.moduleId === this.moduleId) {
                buffer.add(type, payload as any, opts?.mountId);
            } else {
                originalEmit(type, payload, opts);
            }
        };

        // Temporarily replace emit
        const realEmit = this.bus.emit;
        (this.bus as any).emit = bufferedEmit;

        try {
            const result = await this._backend.runInTransaction('readwrite', async (_scope) => {
                const tx: IFSTransaction = {
                    getNode: (id) => this.getNode(id),
                    readContent: (id, opts) => this.readContent(id, opts),
                    createFile: (opts) => this.createFile(opts),
                    createDirectory: (opts) => this.createDirectory(opts),
                    writeContent: (id, content, opts) => this.writeContent(id, content, opts),
                    rename: (id, newName, opts) => this.rename(id, newName, opts),
                    move: (ids, target, opts) => this.move(ids, target, opts),
                    delete: (ids, opts) => this.delete(ids, opts),
                    updateMetadata: (id, meta) => this.updateMetadata(id, meta),
                };
                return fn(tx);
            });

            // Restore emit and flush buffered events
            (this.bus as any).emit = realEmit;
            buffer.commit();
            return result;
        } catch (e) {
            (this.bus as any).emit = realEmit;
            buffer.rollback();
            throw e;
        }
    }
}

// ═══════════════════════════════════════════════════════════════
// Inline Asset Operations
// ═══════════════════════════════════════════════════════════════

class InlineAssetOps implements IAssetOperations {
    constructor(private readonly fs: ModuleFS) {}

    async putAsset(
        ownerIdOrPath: string,
        assetName: string,
        content: FileContent,
    ): Promise<FSNode> {
        const ownerR = await this.fs._resolve(ownerIdOrPath, 'putAsset');
        if (ownerR.inode.type === 'directory') {
            throw new FSError('EISDIR', 'cannot attach assets to directory', 'putAsset', ownerR.fullPath);
        }

        const assetDirIno = await this.fs._engine.ensureAssetDir(ownerR.fullPath);
        const assetDirName = toAssetDirName(ownerR.name);
        const assetDirPath = P.join(P.dirname(ownerR.fullPath), assetDirName);

        const backend = this.fs._backend;
        const existing = await backend.inodes.lookup(assetDirIno, assetName);

        let resultNode!: FSNode;

        await backend.runInTransaction('readwrite', async (scope) => {
            let ino: number;
            if (existing) {
                ino = existing.ino;
            } else {
                ino = await scope.inodes.allocateIno();
                await scope.inodes.putInode({
                    ino,
                    parentIno: assetDirIno,
                    name: assetName,
                    type: 'file',
                    createdAt: Date.now(),
                    nlink: 1,
                });
            }

            const contentRef = `data_${ino}`;
            const buf = toBuffer(content);
            await scope.content.putData(contentRef, buf);

            const currentMeta = existing ? await scope.meta.getMeta(ino) : null;
            await scope.meta.putMeta({
                ino,
                modifiedAt: Date.now(),
                size: buf.byteLength,
                version: (currentMeta?.version ?? 0) + (existing ? 1 : 0),
                contentRef,
            });

            const inode = (await scope.inodes.getInode(ino))!;
            const meta = await scope.meta.getMeta(ino);
            resultNode = this.fs._node(inode, meta, P.join(assetDirPath, assetName));
        });

        return resultNode;
    }

    async getAsset(ownerIdOrPath: string, assetName: string): Promise<FileContent | null> {
        const assetDirIno = await this.getAssetDirIno(ownerIdOrPath);
        if (assetDirIno === null) return null;

        const entry = await this.fs._backend.inodes.lookup(assetDirIno, assetName);
        if (!entry) return null;

        const meta = await this.fs._backend.meta.getMeta(entry.ino);
        if (!meta?.contentRef) return null;

        return this.fs._backend.content.getData(meta.contentRef);
    }

    async getAssetDirId(ownerIdOrPath: string): Promise<string | null> {
        const ino = await this.getAssetDirIno(ownerIdOrPath);
        return ino !== null ? this.fs._id(ino) : null;
    }

    async ensureAssetDir(ownerIdOrPath: string): Promise<string> {
        const ownerR = await this.fs._resolve(ownerIdOrPath, 'ensureAssetDir');
        const ino = await this.fs._engine.ensureAssetDir(ownerR.fullPath);
        return this.fs._id(ino);
    }

    async listAssets(ownerIdOrPath: string, includeHidden?: boolean): Promise<string[]> {
        const assetDirIno = await this.getAssetDirIno(ownerIdOrPath);
        if (assetDirIno === null) return [];

        const children = await this.fs._backend.inodes.listChildren(assetDirIno);
        return children
            .filter(c => includeHidden || !isHiddenName(c.name))
            .map(c => c.name);
    }

    async deleteAsset(ownerIdOrPath: string, assetName: string): Promise<void> {
        const assetDirIno = await this.getAssetDirIno(ownerIdOrPath);
        if (assetDirIno === null) return;

        const entry = await this.fs._backend.inodes.lookup(assetDirIno, assetName);
        if (!entry) return;

        await this.fs._backend.runInTransaction('readwrite', async (scope) => {
            await deleteRecursive(scope, entry.ino);
        });
    }

    async removeAssetDir(ownerIdOrPath: string, removeContent?: boolean): Promise<void> {
        const assetDirIno = await this.getAssetDirIno(ownerIdOrPath);
        if (assetDirIno === null) return;

        if (removeContent !== false) {
            await this.fs._backend.runInTransaction('readwrite', async (scope) => {
                await deleteRecursive(scope, assetDirIno);
            });
        }

        // Clear owner reference
        const ownerR = await this.fs._resolve(ownerIdOrPath, 'removeAssetDir');
        await this.fs._backend.meta.patchMeta(ownerR.ino, { assetDirIno: undefined });
    }

    async hasAssetDir(ownerIdOrPath: string): Promise<boolean> {
        return (await this.getAssetDirIno(ownerIdOrPath)) !== null;
    }

    private async getAssetDirIno(ownerIdOrPath: string): Promise<number | null> {
        const ownerR = await this.fs._resolve(ownerIdOrPath, 'getAssetDirIno');
        const assetDirName = toAssetDirName(ownerR.name);
        const entry = await this.fs._backend.inodes.lookup(ownerR.parentIno, assetDirName);
        return entry?.ino ?? null;
    }

}

// ═══════════════════════════════════════════════════════════════
// Inline Tag Operations
// ═══════════════════════════════════════════════════════════════

class InlineTagOps implements ITagOperations {
    constructor(private readonly fs: ModuleFS) {}

    async getAllTags(): Promise<TagDefinition[]> {
        const tagMap = new Map<string, TagDefinition>();
        await this.fs.walkTree((node) => {
            if (node.tags) {
                for (const t of node.tags) {
                    if (!tagMap.has(t)) tagMap.set(t, { name: t });
                }
            }
        }, { includeHidden: true });
        return Array.from(tagMap.values());
    }

    async setTags(idOrPath: string, tags: string[]): Promise<void> {
        const r = await this.fs._resolve(idOrPath, 'setTags');
        await this.fs._backend.meta.patchMeta(r.ino, { tags, modifiedAt: Date.now() });
        this.fs._emit('node:updated', {
            nodes: [{ nodeId: this.fs._id(r.ino), path: this.fs._toVirtual(r.fullPath), changedFields: ['tags'] }],
            reason: 'tags',
        });
    }

    async addTag(idOrPath: string, tag: string): Promise<void> {
        const r = await this.fs._resolve(idOrPath, 'addTag');
        const meta = await this.fs._backend.meta.getMeta(r.ino);
        const current = meta?.tags ?? [];
        if (current.includes(tag)) return;
        await this.setTags(idOrPath, [...current, tag]);
    }

    async removeTag(idOrPath: string, tag: string): Promise<void> {
        const r = await this.fs._resolve(idOrPath, 'removeTag');
        const meta = await this.fs._backend.meta.getMeta(r.ino);
        const current = meta?.tags ?? [];
        if (!current.includes(tag)) return;
        await this.setTags(idOrPath, current.filter(t => t !== tag));
    }

    async findByTag(tag: string): Promise<string[]> {
        const inos = await this.fs._backend.meta.queryByTag(tag);
        return inos.map(ino => this.fs._id(ino));
    }
}

// ═══════════════════════════════════════════════════════════════
// Inline Ref Operations (in-memory index stored in meta.extra)
// ═══════════════════════════════════════════════════════════════

class InlineRefOps implements IRefOperations {
    constructor(private readonly fs: ModuleFS) {}

    async addRef(
        sourceIdOrPath: string,
        targetIdOrPath: string,
        refType: RefType,
        extra?: Record<string, unknown>,
    ): Promise<void> {
        if (await this.hasRef(sourceIdOrPath, targetIdOrPath, refType)) return;

        const sourceR = await this.fs._resolve(sourceIdOrPath, 'addRef');
        const targetR = await this.fs._resolve(targetIdOrPath, 'addRef');
        const now = Date.now();

        await this.fs._backend.runInTransaction('readwrite', async (scope) => {
            // Add outgoing ref on source
            const sMeta = await scope.meta.getMeta(sourceR.ino);
            const outRefs = this.getRefList(sMeta, '_outRefs');
            outRefs.push({
                targetId: this.fs._id(targetR.ino),
                refType,
                createdAt: now,
                extra,
            });
            await scope.meta.patchMeta(sourceR.ino, {
                extra: { ...sMeta?.extra, _outRefs: outRefs },
            });

            // Add incoming ref on target
            const tMeta = await scope.meta.getMeta(targetR.ino);
            const inRefs = this.getRefList(tMeta, '_inRefs');
            inRefs.push({
                sourceId: this.fs._id(sourceR.ino),
                refType,
                createdAt: now,
                extra,
            });
            await scope.meta.patchMeta(targetR.ino, {
                extra: { ...tMeta?.extra, _inRefs: inRefs },
            });
        });
    }

    async removeRef(
        sourceIdOrPath: string,
        targetIdOrPath: string,
        refType: RefType,
    ):Promise<void> {
        const sourceR = await this.fs._resolve(sourceIdOrPath, 'removeRef');
        const targetR = await this.fs._resolve(targetIdOrPath, 'removeRef');
        const targetId = this.fs._id(targetR.ino);
        const sourceId = this.fs._id(sourceR.ino);

        await this.fs._backend.runInTransaction('readwrite', async (scope) => {
            const sMeta = await scope.meta.getMeta(sourceR.ino);
            const outRefs = this.getRefList(sMeta, '_outRefs')
                .filter((r: any) => !(r.targetId === targetId && r.refType === refType));
            await scope.meta.patchMeta(sourceR.ino, {
                extra: { ...sMeta?.extra, _outRefs: outRefs },
            });

            const tMeta = await scope.meta.getMeta(targetR.ino);
            const inRefs = this.getRefList(tMeta, '_inRefs')
                .filter((r: any) => !(r.sourceId === sourceId && r.refType === refType));
            await scope.meta.patchMeta(targetR.ino, {
                extra: { ...tMeta?.extra, _inRefs: inRefs },
            });
        });
    }

    async getOutgoing(idOrPath: string, opts?: RefQueryOptions): Promise<Reference[]> {
        const r = await this.fs._resolve(idOrPath, 'getOutgoing');
        const meta = await this.fs._backend.meta.getMeta(r.ino);
        const sourceId = this.fs._id(r.ino);

        let refs: Reference[] = this.getRefList(meta, '_outRefs').map((raw: any) => ({
            sourceId,
            targetId: raw.targetId,
            refType: raw.refType,
            createdAt: raw.createdAt,
            extra: raw.extra,
        }));

        if (opts?.refTypes?.length) {
            refs = refs.filter(ref => opts.refTypes!.includes(ref.refType));
        }
        if (opts?.offset) refs = refs.slice(opts.offset);
        if (opts?.limit) refs = refs.slice(0, opts.limit);
        return refs;
    }

    async getIncoming(idOrPath: string, opts?: RefQueryOptions): Promise<Reference[]> {
        const r = await this.fs._resolve(idOrPath, 'getIncoming');
        const meta = await this.fs._backend.meta.getMeta(r.ino);
        const targetId = this.fs._id(r.ino);

        let refs: Reference[] = this.getRefList(meta, '_inRefs').map((raw: any) => ({
            sourceId: raw.sourceId,
            targetId,
            refType: raw.refType,
            createdAt: raw.createdAt,
            extra: raw.extra,
        }));

        if (opts?.refTypes?.length) {
            refs = refs.filter(ref => opts.refTypes!.includes(ref.refType));
        }
        if (opts?.offset) refs = refs.slice(opts.offset);
        if (opts?.limit) refs = refs.slice(0, opts.limit);
        return refs;
    }

    async hasRef(
        sourceIdOrPath: string,
        targetIdOrPath: string,
        refType: RefType,
    ): Promise<boolean> {
        const targetR = await this.fs._resolve(targetIdOrPath, 'hasRef');
        const targetId = this.fs._id(targetR.ino);
        const outgoing = await this.getOutgoing(sourceIdOrPath, { refTypes: [refType] });
        return outgoing.some(r => r.targetId === targetId);
    }

    async syncOutgoing(
        sourceIdOrPath: string,
        refs: Array<{
            targetIdOrPath: string;
            refType: RefType;
            extra?: Record<string, unknown>;
        }>,
    ): Promise<void> {
        // Remove all existing outgoing
        const existing = await this.getOutgoing(sourceIdOrPath);
        for (const ref of existing) {
            await this.removeRef(sourceIdOrPath, ref.targetId, ref.refType);
        }
        // Add new refs
        for (const ref of refs) {
            await this.addRef(sourceIdOrPath, ref.targetIdOrPath, ref.refType, ref.extra);
        }
    }

    private getRefList(meta: MetaRecord | null, key: string): any[] {
        if (!meta?.extra) return [];
        const list = (meta.extra as any)[key];
        return Array.isArray(list) ? list : [];
    }
}

// ═══════════════════════════════════════════════════════════════
// Inline SeqFile Operations
// ═══════════════════════════════════════════════════════════════

class InlineSeqOps implements ISeqFileOperations {
    constructor(private readonly fs: ModuleFS) {}

    private get records() {
        const backend = this.fs._backend;
        if (!backend.records) {
            throw new FSCapabilityError('seqFiles', this.fs.moduleId);
        }
        return backend.records;
    }

    private async mustBeSeqFile(idOrPath: string, op: string): Promise<ResolvedInode> {
        const r = await this.fs._resolve(idOrPath, op);
        if (r.inode.type !== 'seqfile') {
            throw new FSTypeMismatchError(r.fullPath, 'seqfile', r.inode.type);
        }
        return r;
    }

    async getEntry(fileIdOrPath: string, key: string): Promise<string | null> {
        const r = await this.mustBeSeqFile(fileIdOrPath, 'seqGet');
        const val = await this.records.getRecordField(r.ino, key);
        return val !== undefined ? String(val) : null;
    }

    async getEntries(fileIdOrPath: string, keys: string[]): Promise<Record<string, string>> {
        const result: Record<string, string> = {};
        for (const key of keys) {
            const val = await this.getEntry(fileIdOrPath, key);
            if (val !== null) result[key] = val;
        }
        return result;
    }

    async getAllEntries(fileIdOrPath: string): Promise<SeqFileEntry[]> {
        const r = await this.mustBeSeqFile(fileIdOrPath, 'seqGetAll');
        const fields = await this.records.getAllRecordFields(r.ino);
        return Object.entries(fields).map(([key, value]) => ({
            key,
            value: String(value),
        }));
    }

    async setEntry(fileIdOrPath: string, key: string, value: string): Promise<void> {
        const r = await this.mustBeSeqFile(fileIdOrPath, 'seqSet');
        await this.records.setRecordField(r.ino, key, value);
        await this.fs._backend.meta.patchMeta(r.ino, {
            modifiedAt: Date.now(),
            version: (r.meta?.version ?? 0) + 1,
        });
        this.fs._emit('node:updated', {
            nodes: [{
                nodeId: this.fs._id(r.ino),
                path: this.fs._toVirtual(r.fullPath),
                changedFields: ['content'],
            }],
            reason: 'content',
        });
    }

    async setEntries(fileIdOrPath: string, entries: Record<string, string>): Promise<void> {
        const r = await this.mustBeSeqFile(fileIdOrPath, 'seqSetBatch');
        for (const [key, value] of Object.entries(entries)) {
            await this.records.setRecordField(r.ino, key, value);
        }
        await this.fs._backend.meta.patchMeta(r.ino, {
            modifiedAt: Date.now(),
            version: (r.meta?.version ?? 0) + 1,
        });
        this.fs._emit('node:updated', {
            nodes: [{
                nodeId: this.fs._id(r.ino),
                path: this.fs._toVirtual(r.fullPath),
                changedFields: ['content'],
            }],
            reason: 'content',
        });
    }

    async deleteEntry(fileIdOrPath: string, key: string): Promise<void> {
        const r = await this.mustBeSeqFile(fileIdOrPath, 'seqDelete');
        await this.records.deleteRecordField(r.ino, key);
        await this.fs._backend.meta.patchMeta(r.ino, {
            modifiedAt: Date.now(),
            version: (r.meta?.version ?? 0) + 1,
        });
    }

    async hasEntry(fileIdOrPath: string, key: string): Promise<boolean> {
        return (await this.getEntry(fileIdOrPath, key)) !== null;
    }

    async queryEntries(
        fileIdOrPath: string,
        query: RecordQuery,
        options?: RecordQueryOptions,
    ): Promise<RecordQueryResult[]> {
        const r = await this.mustBeSeqFile(fileIdOrPath, 'seqQuery');
        return this.records.queryRecordFields(r.ino, query, options);
    }

    async createIndex(fileIdOrPath: string, field: string): Promise<void> {
        const r = await this.mustBeSeqFile(fileIdOrPath, 'createIndex');
        await this.records.createRecordIndex(r.ino, field);
    }

    async deleteIndex(fileIdOrPath: string, field: string): Promise<void> {
        const r = await this.mustBeSeqFile(fileIdOrPath, 'deleteIndex');
        await this.records.deleteRecordIndex(r.ino, field);
    }
}
