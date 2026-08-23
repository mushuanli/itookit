/**
 * @file packages/vfs-core/src/impl/services/ModuleDriver.ts
 * @desc IFSDriver 实现 — 模块的 chroot 隔离 CRUD。
 *
 * 依赖 ModuleContext 共享状态，不再与 ModuleFS 互相回环。
 * 写操作统一经过 PluginPipeline（before/after 中间件 + 短路）。
 */

import type {
    IFSDriver,
    IFSDriverTransaction,
    FSNode,
    DirEntry,
    FileContent,
    FSCapabilities,
    FSEventType,
    FSEvent,
    FSSearchQuery,
    FSSearchResult,
    CreateFileOptions,
    CreateDirectoryOptions,
    WriteOptions,
    ReadOptions,
    DeleteOptions,
    ListOptions,
    TreeWalkOptions,
    TreeWalkCallback,
    FSOperationType,
    OperationContext,
    IAssetOperations,
    FSNodeMetadata,
} from '../../protocol';
import { FSCapabilityError } from '../../protocol';

import { TransactionEventBuffer } from '../event/event-bus';
import { toBuffer, toString } from '../../utils/encoding';
import { isHiddenName, isAssetDirName, isInternalDirName } from '../../utils/validation';
import * as P from '../../utils/path';

import { ModuleContext } from './ModuleContext';

export class ModuleDriver implements IFSDriver {
    readonly moduleId: string;
    readonly capabilities: FSCapabilities;

    /** Injected by ModuleFS so the plugin pipeline can expose asset/metadata helpers. */
    assets?: IAssetOperations;

    constructor(private readonly ctx: ModuleContext) {
        this.moduleId = ctx.moduleId;
        this.capabilities = ctx.capabilities;
    }

    // ── Events（IFSDriver extends FSEventEmitter）──────────────────────────

    on<E extends FSEventType>(event: E, callback: (event: FSEvent<E>) => void): () => void {
        return this.ctx.bus.on(event, (payload, meta) => {
            if (meta.moduleId !== this.ctx.moduleId) return;
            callback({ type: event, payload, timestamp: meta.timestamp, moduleId: meta.moduleId as string | undefined, fromTransaction: meta.fromTransaction as boolean | undefined, mountId: meta.mountId as string | undefined } as FSEvent<E>);
        });
    }

    onAny(callback: (event: FSEvent) => void): () => void {
        return this.ctx.bus.onAny((payload, meta) => {
            if (meta.moduleId !== this.ctx.moduleId) return;
            callback({ type: meta.type as FSEventType, payload, timestamp: meta.timestamp, moduleId: meta.moduleId as string | undefined, fromTransaction: meta.fromTransaction as boolean | undefined, mountId: meta.mountId as string | undefined } as FSEvent);
        });
    }

    // ── plugin pipeline helper ──────────────────────────────────────────────

    /** Resolve a single-file operation target (throws if missing, like the op itself). */
    private resolveTarget(path: string): () => Promise<FSNode | null> {
        return async () => (await this.ctx.resolveNode(path)).node;
    }

    /** Inject asset/metadata helpers into the plugin operation context. */
    private applyRestrictedApi(ctx: OperationContext): void {
        const assets = this.assets;
        if (assets) {
            ctx.getAssetDir = (p) => assets.getAssetDirPath(p);
            ctx.putAsset = async (p, n, c) => { await assets.putAsset(p, n, c); };
            ctx.getAsset = (p, n) => assets.getAsset(p, n);
            ctx.listAssets = (p) => assets.listAssets(p);
            ctx.deleteAsset = (p, n) => assets.deleteAsset(p, n);
        }
        ctx.getMetadata = async (p) => {
            const node = await this.getNode(p);
            return node?.metadata as Readonly<FSNodeMetadata> | null ?? null;
        };
        ctx.patchMetadata = (p, patch) => this.updateMetadata(p, patch as Record<string, unknown>);
    }

    private async runOperation<T>(
        operation: FSOperationType,
        path: string | undefined,
        resolveTarget: (() => Promise<FSNode | null>) | undefined,
        args: Record<string, unknown>,
        coreOp: (args: Record<string, unknown>, node: FSNode | undefined) => Promise<T>,
    ): Promise<T> {
        let result: T;
        const node = resolveTarget ? await resolveTarget() : undefined;
        const ctx: OperationContext = { operation, moduleId: this.ctx.moduleId, path, node: node ?? undefined, args };
        this.applyRestrictedApi(ctx);
        await this.ctx.plugins.execute(operation, ctx, async () => {
            result = await coreOp(ctx.args, node ?? undefined);
            ctx.result = result;
        });
        return result!;
    }

    // ══════════════════════════════════════════════════════════
    // Read
    // ══════════════════════════════════════════════════════════

    async getNode(path: string): Promise<FSNode | null> {
        try {
            const realPath = this.ctx.toRealPath(path);
            const node = await this.ctx.engine.stat(realPath);
            return node ? this.ctx.toVirtualNode(node) : null;
        } catch { return null; }
    }

    getChildren(path: string, options?: ListOptions & { fields?: 'full' }): Promise<FSNode[]>;
    getChildren(path: string, options: ListOptions & { fields: 'entry' }): Promise<DirEntry[]>;
    getChildren(path: string, options?: ListOptions): Promise<FSNode[] | DirEntry[]>;
    async getChildren(path: string, options?: ListOptions): Promise<FSNode[] | DirEntry[]> {
        const realPath = this.ctx.toRealPath(path);
        this.ctx.access.checkAccess(this.ctx.caller, realPath, 'list');
        const children = await this.ctx.engine.listChildren(realPath);

        const filtered = children.filter(c => {
            if (!options?.includeHidden && isHiddenName(c.name)) return false;
            if (!options?.includeAssetDirs && isAssetDirName(c.name)) return false;
            if (!options?.includeInternalDirs && isInternalDirName(c.name)) return false;
            return true;
        });
        if (options?.fields === 'entry') {
            return filtered.map(c => ({
                path: this.ctx.scope.toVirtualPath(c.path), name: c.name, type: c.type,
                size: c.type === 'file' ? c.size : undefined,
                modifiedAt: c.modifiedAt,
            } as DirEntry));
        }
        // Filter out any child whose virtualized path equals the request path
        // (would create a self-cycle in the tree, crashing the renderer).
        const virtualChildren = filtered.map(c => this.ctx.toVirtualNode(c));
        return virtualChildren.filter(c => c.path !== path);
    }

    readContent(path: string, options: ReadOptions & { encoding: 'utf-8' }): Promise<string>;
    readContent(path: string, options: ReadOptions & { encoding: 'binary' }): Promise<ArrayBuffer>;
    readContent(path: string, options?: ReadOptions): Promise<FileContent>;
    async readContent(path: string, options?: ReadOptions): Promise<FileContent> {
        const { realPath } = await this.ctx.resolveNode(path);
        this.ctx.access.checkAccess(this.ctx.caller, realPath, 'read');
        if (this.ctx.moduleBackend.records) {
            const text = await this.ctx.serializeSeqFile(realPath, this.ctx.moduleBackend.records);
            if (text !== null) {
                return options?.encoding === 'binary' ? toBuffer(text) : text;
            }
        }
        const data = await this.ctx.engine.readContent(realPath, options);
        if (options?.encoding === 'utf-8') return toString(data);
        return data;
    }

    async resolvePath(path: string): Promise<string | null> {
        try {
            const realPath = this.ctx.toRealPath(path);
            const node = await this.ctx.engine.stat(realPath);
            return node ? path : null;
        } catch { return null; }
    }

    async exists(path: string): Promise<boolean> {
        try {
            const realPath = this.ctx.toRealPath(path);
            const node = await this.ctx.engine.tryStat(realPath);
            return node !== null;
        } catch { return false; }
    }

    async walkTree(callback: TreeWalkCallback, options?: TreeWalkOptions): Promise<number> {
        const rootPath = options?.rootPath ? this.ctx.toRealPath(options.rootPath) : this.ctx.scope.toRealPath('/');
        const typeFilter = options?.typeFilter
            ? new Set(Array.isArray(options.typeFilter) ? options.typeFilter : [options.typeFilter])
            : null;
        let processed = 0;
        const virtualCallback: TreeWalkCallback = async (node, depth) => {
            if (typeFilter && !typeFilter.has(node.type)) return true;
            processed++;
            return callback(this.ctx.toVirtualNode(node), depth);
        };
        await this.ctx.engine.walkTree(rootPath, virtualCallback, options);
        return processed;
    }

    async search(query: FSSearchQuery): Promise<FSSearchResult> {
        const moduleRoot = this.ctx.scope.toRealPath('/');
        const nodes = await this.ctx.engine.search(moduleRoot, query);
        const scoped = nodes.filter(n => n.path === moduleRoot || n.path.startsWith(moduleRoot + '/'));
        const virtualized = scoped.map(n => this.ctx.toVirtualNode(n));
        return { nodes: virtualized, total: virtualized.length, hasMore: false };
    }

    async getStats(): Promise<import('../../protocol').FSModuleStats> {
        let fileCount = 0, directoryCount = 0, totalSize = 0;
        await this.walkTree((node) => {
            if (node.type === 'directory') directoryCount++;
            else {
                fileCount++;
                if (node.type === 'file') totalSize += node.size;
            }
        });
        return { fileCount, directoryCount, totalSize, lastModifiedAt: Date.now() };
    }

    // ══════════════════════════════════════════════════════════
    // Write
    // ══════════════════════════════════════════════════════════

    async createFile(options: CreateFileOptions): Promise<FSNode> {
        const parentPath = options.parentPath ? this.ctx.toRealPath(options.parentPath) : this.ctx.scope.toRealPath('/');
        return this.runOperation('create', parentPath, undefined, { ...options }, async (args) => {
            const o = args as unknown as CreateFileOptions;
            this.ctx.access.checkAccess(this.ctx.caller, parentPath, 'write');
            this.ctx.assertWritable(parentPath);

            const node = await this.ctx.engine.createFile(parentPath, o.name,
                o.type ?? 'file', o.content, o.metadata,
                { overwrite: o.overwrite, recursive: o.recursive });

            const virtual = this.ctx.toVirtualNode(node);
            this.ctx.emit('node:created', { nodes: [{ path: virtual.path, parentPath: virtual.parentPath, type: virtual.type }] });
            return virtual;
        });
    }

    async createDirectory(options: CreateDirectoryOptions): Promise<FSNode> {
        const parentPath = options.parentPath
            ? this.ctx.toRealPath(options.parentPath)
            : this.ctx.scope.toRealPath('/');
        const existing = await this.ctx.engine.tryStat(P.join(parentPath, options.name));
        if (existing?.type === 'directory') return this.ctx.toVirtualNode(existing);
        return this.createFile({ ...options, type: 'directory', content: undefined });
    }

    async writeContent(path: string, content: FileContent, options?: WriteOptions): Promise<void> {
        return this.runOperation('write', path, this.resolveTarget(path), { content, options }, async (args, node) => {
            const a = args as { content: FileContent; options?: WriteOptions };
            const realPath = this.ctx.toRealPath(path);
            this.ctx.access.checkAccess(this.ctx.caller, realPath, 'write');
            this.ctx.assertWritable(realPath);
            await this.ctx.engine.writeContent(realPath, a.content, a.options);
            const eventPath = node ? this.ctx.toVirtualNode(node).path : path;
            this.ctx.emit('node:updated', {
                nodes: [{ path: eventPath, changedFields: ['content'] }],
                reason: 'content',
            });
        });
    }

    async appendContent(path: string, content: FileContent): Promise<void> {
        return this.writeContent(path, content, { mode: 'append' });
    }

    async rename(path: string, newName: string): Promise<void> {
        return this.runOperation('rename', path, this.resolveTarget(path), { newName }, async (args, node) => {
            const a = args as { newName: string };
            const realPath = this.ctx.toRealPath(path);
            this.ctx.access.checkAccess(this.ctx.caller, realPath, 'write');
            this.ctx.assertWritable(realPath);
            await this.ctx.engine.rename(realPath, a.newName);
            const newRealPath = P.dirname(realPath) + '/' + a.newName;
            const newVirtualPath = this.ctx.scope.toVirtualPath(newRealPath);
            const virtualNode = node ? this.ctx.toVirtualNode(node) : null;
            this.ctx.emit('node:renamed', { nodes: [{ oldPath: virtualNode?.path ?? path, newPath: newVirtualPath, oldName: node?.name ?? '', newName: a.newName }] });
        });
    }

    async move(paths: string[], targetParentPath: string | null): Promise<void> {
        return this.runOperation('move', targetParentPath ?? undefined, undefined, { paths, targetParentPath }, async (args) => {
            const a = args as { paths: string[]; targetParentPath: string | null };
            const targetPath = a.targetParentPath
                ? this.ctx.toRealPath(a.targetParentPath)
                : this.ctx.scope.toRealPath('/');
            this.ctx.access.checkAccess(this.ctx.caller, targetPath, 'write');
            this.ctx.assertWritable(targetPath);

            const nodes: Array<{ oldPath: string; newPath: string; oldParentPath: string | null; newParentPath: string | null }> = [];
            for (const src of a.paths) {
                const { node, realPath } = await this.ctx.resolveNode(src);
                const oldPath = this.ctx.toVirtualNode(node).path;
                const newParentVirtual = this.ctx.scope.toVirtualPath(targetPath);
                const newPath = newParentVirtual + '/' + node.name;
                nodes.push({ oldPath, newPath, oldParentPath: this.ctx.scope.toVirtualPath(node.parentPath!), newParentPath: newParentVirtual });
                await this.ctx.engine.move(realPath, targetPath);
            }
            this.ctx.emit('node:moved', { nodes });
        });
    }

    async delete(paths: string[], options?: DeleteOptions): Promise<void> {
        return this.runOperation('delete', undefined, undefined, { paths, options }, async (args) => {
            const a = args as { paths: string[]; options?: DeleteOptions };
            for (const path of a.paths) {
                const realPath = this.ctx.toRealPath(path);
                this.ctx.access.checkAccess(this.ctx.caller, realPath, 'delete');
                this.ctx.assertWritable(realPath);
                await this.ctx.engine.delete(realPath, a.options);
            }
            this.ctx.emit('node:deleted', { requestedPaths: a.paths, allDeletedPaths: a.paths });
        });
    }

    async updateMetadata(path: string, metadata: Record<string, unknown>): Promise<void> {
        return this.runOperation('updateMetadata', path, this.resolveTarget(path), { metadata }, async (args, node) => {
            const a = args as { metadata: Record<string, unknown> };
            const realPath = this.ctx.toRealPath(path);
            this.ctx.access.checkAccess(this.ctx.caller, realPath, 'write');
            await this.ctx.engine.updateMetadata(realPath, a.metadata);
            const eventPath = node ? this.ctx.toVirtualNode(node).path : path;
            this.ctx.emit('node:updated', {
                nodes: [{ path: eventPath, changedFields: ['metadata'] }],
                reason: 'metadata',
            });
        });
    }

    // ── Copy ──
    async copy(sourcePath: string, targetParentPath: string | null, newName?: string): Promise<FSNode> {
        return this.runOperation('copy', sourcePath, this.resolveTarget(sourcePath), { targetParentPath, newName }, async (args, node) => {
            const a = args as { targetParentPath: string | null; newName?: string };
            const resolved = node ?? (await this.ctx.resolveNode(sourcePath)).node;
            const name = a.newName ?? resolved.name;

            if (resolved.type === 'directory') {
                const newNode = await this.createDirectory({
                    name,
                    parentPath: a.targetParentPath,
                    metadata: { ...resolved.metadata },
                });
                const children = await this.getChildren(sourcePath);
                for (const child of children) {
                    await this.copy(child.path, newNode.path);
                }
                return newNode;
            }

            const fileContent = await this.readContent(sourcePath);
            const copied = await this.createFile({
                name,
                parentPath: a.targetParentPath,
                type: resolved.type,
                content: fileContent as string | ArrayBuffer,
                metadata: { ...resolved.metadata },
                tags: [...resolved.tags],
            });
            this.ctx.emit('node:copied', {
                copies: [{
                    sourcePath: this.ctx.toVirtualNode(resolved).path,
                    targetPath: copied.path,
                    targetParentPath: copied.parentPath,
                }],
            });
            return copied;
        });
    }

    // ── Symlink ──
    async symlink(linkPath: string, targetPath: string): Promise<FSNode> {
        return this.runOperation('symlink', linkPath, undefined, { targetPath }, async (args) => {
            const a = args as { targetPath: string };
            const dir = P.dirname(linkPath);
            const name = P.basename(linkPath);
            const realDir = this.ctx.toRealPath(dir);
            this.ctx.access.checkAccess(this.ctx.caller, realDir, 'write');
            this.ctx.assertWritable(realDir);
            const node = await this.ctx.engine.createSymlink(realDir, name, a.targetPath);
            const virtual = this.ctx.toVirtualNode(node);
            this.ctx.emit('node:created', { nodes: [{ path: virtual.path, parentPath: virtual.parentPath, type: 'symlink' }] });
            return virtual;
        });
    }

    async readlink(path: string): Promise<string> {
        if (!this.ctx.capabilities.symlinks) {
            throw new FSCapabilityError('symlinks', this.ctx.moduleId);
        }
        const { realPath } = await this.ctx.resolveNode(path);
        return this.ctx.engine.readSymlink(realPath);
    }

    async hardlink(): Promise<FSNode> {
        throw new FSCapabilityError('hardlinks', this.ctx.moduleId);
    }

    // ══════════════════════════════════════════════════════════
    // Transaction
    // ══════════════════════════════════════════════════════════

    async transaction<T>(fn: (tx: IFSDriverTransaction) => Promise<T>): Promise<T> {
        const buffer = new TransactionEventBuffer(this.ctx.bus, { moduleId: this.ctx.moduleId });
        return this.ctx.withEventTarget(buffer, async () => {
            const tx: IFSDriverTransaction = {
                getNode: (id) => this.getNode(id),
                readContent: this.readContent.bind(this),
                createFile: (opts) => this.createFile(opts),
                createDirectory: (opts) => this.createDirectory(opts),
                writeContent: (id, content, opts) => this.writeContent(id, content, opts),
                rename: (id, newName, _opts) => this.rename(id, newName),
                move: (ids, target, _opts) => this.move(ids, target),
                delete: (ids, opts) => this.delete(ids, opts),
                updateMetadata: (id, meta) => this.updateMetadata(id, meta),
            };

            try {
                const result = await fn(tx);
                buffer.commit();
                return result;
            } catch (e) {
                buffer.rollback();
                throw e;
            }
        });
    }
}
