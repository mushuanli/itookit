/**
 * @file packages/vfslib/src/services/module-fs.ts
 * @desc IModuleFS + IFSDriver 实现 — 模块的 chroot 隔离文件系统视图（v4.1 path-based）
 *
 * v4.1 简化：
 * - 删除 ino 体系（ROOT_INO、ResolvedInode、toFSNode、path-resolver、tree-ops）
 * - 所有存储操作直接走 path-based VFSEngine + IStorageBackend
 * - _resolve → 返回 { node, realPath } 而不是 ResolvedInode
 */

import type {
    IModuleFS,
    IFSDriver,
    IFSDriverTransaction,
    FSNode,
    DirEntry,
    FSCapabilities,
    FileContent,
    FSSearchQuery,
    FSSearchResult,
    FSEventType,
    FSEvent,
    CreateFileOptions,
    CreateDirectoryOptions,
    WriteOptions,
    ReadOptions,
    DeleteOptions,
    ListOptions,
    TreeWalkOptions,
    TreeWalkCallback,
    IAssetOperations,
    ITagOperations,
    IDeviceHandle,
    DeviceContext,
    IStorageBackend,
} from '@itookit/common';

import {
    FSNotFoundError,
    FSError,
    FSReadOnlyError,
    FSCapabilityError,
} from '@itookit/common';

import { VFSEngine } from '../engine/vfs-engine';
import { ScopedView } from './scoped-view';
import { AccessController, type CallerIdentity } from '../engine/access-controller';
import { EventBus, TransactionEventBuffer } from '../event/event-bus';
import { PluginPipeline } from '../engine/plugin-pipeline';
import { DeviceRegistry } from '../engine/device-registry';
import { toBuffer, toString } from '../utils/encoding';
import { isPath, isHiddenName, isAssetDirName, isInternalDirName } from '../utils/validation';
import * as P from '../utils/path';

import { FSMetaDriverAdapter } from './fs-driver-adapter';
import { FileHandle } from '../file-io/File';

export interface ModuleFSDeps {
    moduleId: string;
    engine: VFSEngine;
    eventBus: EventBus;
    plugins: PluginPipeline;
    access: AccessController;
    devices: DeviceRegistry;
    mountId?: string;
    isSystem?: boolean;
    /**
     * CONFIG_MODULE 的系统级 IModuleFS 引用（isSystem=true）。
     * 注入给非系统模块，用于 openDevice 时为设备驱动提供系统身份访问能力。
     */
    systemFS?: import('@itookit/common').IModuleFS;
}

// ─── DeviceHandle ─────────────────────────────────────────────────────────────
class DeviceHandle implements IDeviceHandle {
    constructor(
        private readonly _driver: import('@itookit/common').IDeviceDriver,
        public readonly ctx: DeviceContext,
    ) {}
    read(): Promise<FileContent> { return this._driver.read(this.ctx); }
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
    async close(): Promise<void> { await this._driver.close?.(this.ctx); }
}

// ═══════════════════════════════════════════════════════════════
// ModuleFS
// ═══════════════════════════════════════════════════════════════

export class ModuleFS implements IModuleFS, IFSDriver {
    readonly moduleId: string;
    readonly capabilities: FSCapabilities;
    readonly assets: IAssetOperations;
    readonly tags: ITagOperations;
    readonly driver: IFSDriver;
    readonly meta: import('@itookit/common').IFSMetaDriver;

    private readonly engine: VFSEngine;
    private readonly bus: EventBus;
    private readonly access: AccessController;
    private readonly devices: DeviceRegistry;
    private readonly scope: ScopedView;
    private readonly mountId: string;
    private readonly caller: CallerIdentity;
    private readonly _moduleBackend: IStorageBackend;
    private readonly systemFS?: import('@itookit/common').IModuleFS;
    private initialized = false;

    constructor(deps: ModuleFSDeps) {
        this.moduleId = deps.moduleId;
        this.engine = deps.engine;
        this.bus = deps.eventBus;
        this.access = deps.access;
        this.devices = deps.devices;
        this.scope = new ScopedView(deps.moduleId);
        this.mountId = deps.mountId ?? 'mount_0';
        this.caller = { moduleId: deps.moduleId, isSystem: deps.isSystem ?? false };
        this.systemFS = deps.systemFS;
        this._moduleBackend = deps.engine.getBackendForPath(`/module/${deps.moduleId}`);
        const backend = this._moduleBackend;
        this.capabilities = Object.freeze({
            readonly: false, search: true, semanticSearch: false, syncable: false,
            assets: true, tags: true, deviceFiles: true,
            seqFiles: !!backend.records, references: true,
            symlinks: !!backend.symlink, hardlinks: false,
            partialRead: true, partialWrite: true, treeWalk: true,
            streaming: false, watch: false, mount: false,
        });

        this.assets = new InlineAssetOps(this);
        this.tags = new InlineTagOps(this);
        this.driver = this;
        this.meta = new FSMetaDriverAdapter(this.assets, this.tags);
    }

    openFile(nodeId: string): import('@itookit/common').IFile {
        return new FileHandle(this, nodeId);
    }

    // ══════════════════════════════════════════════════════════
    // Lifecycle
    // ══════════════════════════════════════════════════════════

    async init(): Promise<void> {
        if (this.initialized) return;
        await this.engine.ensureModuleDir(this.moduleId);
        this.initialized = true;
    }

    async dispose(): Promise<void> { this.initialized = false; }

    // ══════════════════════════════════════════════════════════
    // Events
    // ══════════════════════════════════════════════════════════

    on<E extends FSEventType>(event: E, callback: (event: FSEvent<E>) => void): () => void {
        return this.bus.on(event, (e) => {
            if (e.moduleId === this.moduleId) callback(e);
        });
    }
    onAny(callback: (event: FSEvent) => void): () => void {
        return this.bus.onAny((e) => {
            if (e.moduleId === this.moduleId) callback(e);
        });
    }

    get _backend(): IStorageBackend { return this._moduleBackend; }
    get _engine(): VFSEngine { return this.engine; }

    // ══════════════════════════════════════════════════════════
    // Path resolution helpers (centralized)
    // ══════════════════════════════════════════════════════════

    /** Map a system-path FSNode to a module-virtual-path FSNode. */
    private toVirtualNode(node: FSNode): FSNode {
        const mapPath = (p: string | null) => p ? this.scope.toVirtualPath(p) : null;
        return {
            ...node,
            path: mapPath(node.path)!,
            parentPath: mapPath(node.parentPath),
        };
    }

    /** Convert a virtual path to a system-real path. */
    private toRealPath(path: string): string {
        if (isPath(path)) {
            // Defend against double-mapping: if the path is already a system path
            // (e.g. a caller passed "/module/etc/llm/config.json" directly),
            // return it as-is to avoid "/module/etc/module/etc/..." duplication.
            const mountPrefix = `/module/${this.moduleId}/`;
            if (path.startsWith(mountPrefix) || path.startsWith('/module/')) {
                return path;
            }
            return this.scope.toRealPath(path);
        }
        throw new FSError('EINVAL', 'path-based engine requires paths, not IDs', 'resolve', path);
    }

    /** Stat + return { node, realPath }. Throws if not found. @internal — exposed for InlineAssetOps */
    async resolveNode(path: string): Promise<{ node: FSNode; realPath: string }> {
        const realPath = this.toRealPath(path);
        const node = await this.engine.stat(realPath);
        if (!node) throw new FSNotFoundError(path);
        return { node, realPath };
    }

    /** Check writable + permissions. */
    private assertWritable(realPath: string): void {
        if (this.scope.isRealPathReadOnly(realPath)) throw new FSReadOnlyError(this.moduleId, realPath);
    }

    /** Emit a namespaced event. @internal — exposed for inline ops classes */
    _emit(type: FSEventType, payload: any): void {
        this.bus.emit(type, payload, { moduleId: this.moduleId, mountId: this.mountId });
    }

    // ══════════════════════════════════════════════════════════
    // IFSDriver Read
    // ══════════════════════════════════════════════════════════

    async getNode(path: string): Promise<FSNode | null> {
        try {
            const realPath = this.toRealPath(path);
            const node = await this.engine.stat(realPath);
            return node ? this.toVirtualNode(node) : null;
        } catch { return null; }
    }

    // IFSDriver overloaded getChildren signatures
    getChildren(path: string, options?: ListOptions & { fields?: 'full' }): Promise<FSNode[]>;
    getChildren(path: string, options: ListOptions & { fields: 'entry' }): Promise<DirEntry[]>;
    getChildren(path: string, options?: ListOptions): Promise<FSNode[] | DirEntry[]>;
    async getChildren(path: string, options?: any): Promise<FSNode[] | DirEntry[]> {
        const realPath = this.toRealPath(path);
        this.access.checkAccess(this.caller, realPath, 'list');
        const children = await this.engine.listChildren(realPath);
        const filtered = children.filter(c => {
            if (!options?.includeHidden && isHiddenName(c.name)) return false;
            if (!options?.includeAssetDirs && isAssetDirName(c.name)) return false;
            if (!options?.includeInternalDirs && isInternalDirName(c.name)) return false;
            return true;
        });
        if (options?.fields === 'entry') {
            return filtered.map(c => ({
                path: this.scope.toVirtualPath(c.path), name: c.name, type: c.type,
                size: (c as any).size, modifiedAt: c.modifiedAt
            } as DirEntry));
        }
        return filtered.map(c => this.toVirtualNode(c));
    }

    // IFSDriver overloaded readContent signatures
    readContent(path: string, options: ReadOptions & { encoding: 'utf-8' }): Promise<string>;
    readContent(path: string, options: ReadOptions & { encoding: 'binary' }): Promise<ArrayBuffer>;
    readContent(path: string, options?: ReadOptions): Promise<FileContent>;
    async readContent(path: string, options?: ReadOptions): Promise<FileContent> {
        const { realPath } = await this.resolveNode(path);
        this.access.checkAccess(this.caller, realPath, 'read');
        const data = await this.engine.readContent(realPath);
        if (options?.encoding === 'utf-8') return toString(data);
        return data;
    }

    async resolvePath(path: string): Promise<string | null> {
        try {
            const realPath = this.toRealPath(path);
            const node = await this.engine.stat(realPath);
            // Return the VIRTUAL path, not the system path.
            // Callers pass this return value to other ModuleFS methods
            // (writeContent, readContent, getChildren, etc.) which expect virtual paths.
            return node ? path : null;
        } catch { return null; }
    }

    async exists(path: string): Promise<boolean> {
        try {
            const realPath = this.toRealPath(path);
            const node = await this.engine.tryStat(realPath);
            return node !== null;
        } catch { return false; }
    }

    async walkTree(callback: TreeWalkCallback, options?: TreeWalkOptions): Promise<number> {
        const rootPath = options?.rootPath ? this.toRealPath(options.rootPath) : this.scope.toRealPath('/');
        return this.engine.walkTree(rootPath, callback as any, options);
    }

    async search(query: FSSearchQuery): Promise<FSSearchResult> {
        const moduleRoot = this.scope.toRealPath('/');
        const nodes = await this.engine.search(moduleRoot, query);
        return { nodes, total: nodes.length, hasMore: false };
    }

    async getStats(): Promise<import('@itookit/common').FSModuleStats> {
        let fileCount = 0, directoryCount = 0, totalSize = 0;
        await this.walkTree((node) => {
            if (node.type === 'directory') directoryCount++;
            else { fileCount++; totalSize += (node as any).size ?? 0; }
        });
        return { fileCount, directoryCount, totalSize, lastModifiedAt: Date.now() };
    }

    // ══════════════════════════════════════════════════════════
    // IFSDriver Write
    // ══════════════════════════════════════════════════════════

    async createFile(options: CreateFileOptions): Promise<FSNode> {
        const parentPath = options.parentPath ? this.toRealPath(options.parentPath) : this.scope.toRealPath('/');
        this.access.checkAccess(this.caller, parentPath, 'write');
        this.assertWritable(parentPath);

        const node = await this.engine.createFile(parentPath, options.name,
            options.type ?? 'file', options.content, options.metadata,
            { overwrite: options.overwrite, recursive: options.recursive });

        const virtual = this.toVirtualNode(node);
        this._emit('node:created', { nodes: [{ path: virtual.path, parentPath: virtual.parentPath, type: virtual.type }] });
        return virtual;
    }

    async createDirectory(options: CreateDirectoryOptions): Promise<FSNode> {
        return this.createFile({ ...options, type: 'directory', content: undefined });
    }

    async writeContent(path: string, content: FileContent, options?: WriteOptions): Promise<void> {
        const { node, realPath } = await this.resolveNode(path);
        this.access.checkAccess(this.caller, realPath, 'write');
        this.assertWritable(realPath);
        await this.engine.writeContent(realPath, content, options);
        this._emit('node:updated', { nodes: [{ path: node.path, changedFields: ['content'] }] });
    }

    async appendContent(path: string, content: FileContent): Promise<void> {
        return this.writeContent(path, content, { mode: 'append' });
    }

    async rename(path: string, newName: string): Promise<void> {
        const { node, realPath } = await this.resolveNode(path);
        this.access.checkAccess(this.caller, realPath, 'write');
        this.assertWritable(realPath);
        await this.engine.rename(realPath, newName);
        const newRealPath = `${P.dirname(realPath)}/${newName}`;
        const newVirtualPath = this.scope.toVirtualPath(newRealPath);
        const virtualNode = this.toVirtualNode(node);
        this._emit('node:renamed', { nodes: [{ nodeId: newVirtualPath, oldName: node.name, newName, oldPath: virtualNode.path, newPath: newVirtualPath }] });
    }

    async move(paths: string[], targetParentPath: string | null): Promise<void> {
        const targetPath = targetParentPath
            ? this.toRealPath(targetParentPath)
            : this.scope.toRealPath('/');
        this.access.checkAccess(this.caller, targetPath, 'write');
        this.assertWritable(targetPath);

        for (const src of paths) {
            const { realPath } = await this.resolveNode(src);
            await this.engine.move(realPath, targetPath);
        }
        this._emit('node:moved', {});
    }

    async delete(paths: string[], options?: DeleteOptions): Promise<void> {
        for (const path of paths) {
            const realPath = this.toRealPath(path);
            this.access.checkAccess(this.caller, realPath, 'delete');
            this.assertWritable(realPath);
            await this.engine.delete(realPath, options);
        }
        this._emit('node:deleted', { requestedPaths: paths, allDeletedPaths: paths });
    }

    async updateMetadata(path: string, metadata: Record<string, unknown>): Promise<void> {
        const { node, realPath } = await this.resolveNode(path);
        this.access.checkAccess(this.caller, realPath, 'write');
        await this.engine.updateMetadata(realPath, metadata);
        this._emit('node:updated', { nodes: [{ path: node.path, changedFields: ['metadata'] }] });
    }

    // ── Copy ──
    async copy(sourcePath: string, targetParentPath: string | null, newName?: string): Promise<FSNode> {
        const { node, realPath } = await this.resolveNode(sourcePath);
        const targetPath = targetParentPath ? this.toRealPath(targetParentPath) : P.dirname(realPath);
        const name = newName ?? node.name;

        if (node.type === 'directory') {
            const newNode = await this.createDirectory({ name, parentPath: targetParentPath, metadata: node.metadata as any });
            const children = await this.getChildren(sourcePath);
            for (const child of children) {
                await this.copy(child.path, newNode.path);
            }
            return newNode;
        }

        const fileContent = await this.readContent(sourcePath);
        return this.createFile({ name, parentPath: targetPath, type: node.type, content: fileContent as string | ArrayBuffer, metadata: node.metadata as any, tags: [...node.tags] });
    }

    // ── Symlink ──
    async symlink(linkPath: string, targetPath: string): Promise<FSNode> {
        const dir = P.dirname(linkPath);
        const name = P.basename(linkPath);
        const realDir = this.toRealPath(dir);
        this.access.checkAccess(this.caller, realDir, 'write');
        this.assertWritable(realDir);
        const node = await this.engine.createSymlink(realDir, name, targetPath);
        const virtual = this.toVirtualNode(node);
        this._emit('node:created', { nodes: [{ path: virtual.path, parentPath: virtual.parentPath, type: 'symlink' }] });
        return virtual;
    }

    async readlink(path: string): Promise<string> {
        const { realPath } = await this.resolveNode(path);
        return this.engine.readSymlink(realPath);
    }

    async hardlink(): Promise<FSNode> {
        throw new FSCapabilityError('hardlinks', this.moduleId);
    }

    // ── Device ──
    async createDeviceFile(name: string, parentPath: string | null, handlerId: string): Promise<FSNode> {
        const realParentPath = parentPath ? this.toRealPath(parentPath) : this.scope.toRealPath('/dev');
        return this.engine.createFile(realParentPath, name, 'device', undefined, undefined, { deviceHandlerId: handlerId });
    }

    async ioctl(path: string, command: string | number, arg?: unknown): Promise<unknown> {
        const { node } = await this.resolveNode(path);
        if (node.type !== 'device') throw new FSError('ENOTTY', 'not a device file', 'ioctl', node.path);
        const handlerId = (node as any).deviceHandlerId;
        if (!handlerId) throw new FSError('ENOTTY', 'no device handler', 'ioctl', node.path);
        const driver = this.devices.get(handlerId);
        if (!driver.ioctl) throw new FSError('ENOTTY', 'device does not support ioctl', 'ioctl', node.path);
        return driver.ioctl({ nodeId: node.path, name: node.name, metadata: node.metadata }, command, arg);
    }

    async openDevice(path: string, options?: Record<string, unknown>): Promise<IDeviceHandle> {
        const { node } = await this.resolveNode(path);
        if (node.type !== 'device') throw new FSError('ENOTTY', 'not a device file', 'openDevice', node.path);
        const handlerId = (node as any).deviceHandlerId;
        if (!handlerId) throw new FSError('ENOTTY', 'no device handler', 'openDevice', node.path);
        const driver = this.devices.get(handlerId);
        // Inject systemFS so device drivers can read/write /etc hidden files
        // with system identity (driver can mask/filter sensitive data before
        // returning to the non-system caller).
        const baseCtx: DeviceContext = {
            nodeId: node.path,
            name: node.name,
            metadata: node.metadata,
            systemFS: this.systemFS,
        };
        let sessionId: string | undefined;
        if (driver.sessionable && driver.open) sessionId = await driver.open(baseCtx, options);
        return new DeviceHandle(driver, { ...baseCtx, sessionId });
    }

    // ══════════════════════════════════════════════════════════
    // Transaction
    // ══════════════════════════════════════════════════════════

    async transaction<T>(fn: (tx: IFSDriverTransaction) => Promise<T>): Promise<T> {
        const buffer = new TransactionEventBuffer(this.bus, this.moduleId);
        const originalEmit = this.bus.emit.bind(this.bus);
        const bufferedEmit: typeof originalEmit = (type, payload, opts) => {
            if (opts?.moduleId === this.moduleId) buffer.add(type, payload as any, opts?.mountId);
            else originalEmit(type, payload, opts);
        };
        (this.bus as any).emit = bufferedEmit;

        const tx: IFSDriverTransaction = {
            getNode: (id) => this.getNode(id),
            readContent: (id, opts) => this.readContent(id, opts),
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
            (this.bus as any).emit = originalEmit;
            buffer.commit();
            return result;
        } catch (e) {
            (this.bus as any).emit = originalEmit;
            buffer.rollback();
            throw e;
        }
    }
}

// ═══════════════════════════════════════════════════════════════
// InlineAssetOps
// ═══════════════════════════════════════════════════════════════

class InlineAssetOps implements IAssetOperations {
    constructor(private readonly fs: ModuleFS) {}

    private _engine() { return this.fs._engine; }

    async putAsset(ownerIdOrPath: string, assetName: string, content: FileContent): Promise<FSNode> {
        const { realPath } = await this.fs.resolveNode(ownerIdOrPath);
        const assetDir = await this._engine().ensureAssetDir(realPath);
        const buf = toBuffer(content);
        return this._engine().createFile(assetDir, assetName, 'file', buf);
    }

    async getAsset(ownerIdOrPath: string, assetName: string): Promise<FileContent | null> {
        try {
            const { realPath } = await this.fs.resolveNode(ownerIdOrPath);
            const assetDir = await this._engine().getAssetDirPath(realPath);
            if (!assetDir) return null;
            const assetPath = `${assetDir}/${assetName}`;
            const data = await this._engine().readContent(assetPath);
            return data;
        } catch { return null; }
    }

    async getAssetDirPath(ownerPath: string): Promise<string | null> {
        try {
            const { realPath } = await this.fs.resolveNode(ownerPath);
            const assetDir = await this._engine().getAssetDirPath(realPath);
            return assetDir || null;
        } catch { return null; }
    }

    async ensureAssetDir(ownerIdOrPath: string): Promise<string> {
        const { realPath } = await this.fs.resolveNode(ownerIdOrPath);
        return this._engine().ensureAssetDir(realPath);
    }

    async listAssets(ownerIdOrPath: string): Promise<string[]> {
        try {
            const { realPath } = await this.fs.resolveNode(ownerIdOrPath);
            const assetPath = await this._engine().getAssetDirPath(realPath);
            if (!assetPath) return [];
            const children = await this._engine().listChildren(assetPath);
            return children.map(c => c.name);
        } catch { return []; }
    }

    async deleteAsset(ownerIdOrPath: string, assetName: string): Promise<void> {
        const { realPath } = await this.fs.resolveNode(ownerIdOrPath);
        const assetDir = await this._engine().getAssetDirPath(realPath);
        if (!assetDir) return;
        const assetPath = `${assetDir}/${assetName}`;
        await this._engine().delete(assetPath);
    }

    async removeAssetDir(ownerIdOrPath: string): Promise<void> {
        const { realPath } = await this.fs.resolveNode(ownerIdOrPath);
        const assetPath = await this._engine().getAssetDirPath(realPath);
        if (assetPath) await this._engine().delete(assetPath, { recursive: true });
    }

    async hasAssetDir(ownerIdOrPath: string): Promise<boolean> {
        const dirPath = await this.getAssetDirPath(ownerIdOrPath);
        return dirPath !== null;
    }
}

// ═══════════════════════════════════════════════════════════════
// InlineTagOps
// ═══════════════════════════════════════════════════════════════

class InlineTagOps implements ITagOperations {
    constructor(private readonly fs: ModuleFS) {}

    async getAllTags(): Promise<import('@itookit/common').TagDefinition[]> {
        const tags = await this.fs._backend.getAllTags();
        return tags.map(t => ({ name: t }));
    }

    async setTags(path: string, tags: string[]): Promise<void> {
        const { realPath } = await this.fs.resolveNode(path);
        await this.fs._backend.setTags(realPath, tags);
        this.fs._emit('node:updated', { nodes: [{ path }] });
    }

    async addTag(path: string, tag: string): Promise<void> {
        const { node, realPath } = await this.fs.resolveNode(path);
        const newTags = [...new Set([...node.tags, tag])];
        await this.fs._backend.setTags(realPath, newTags);
    }

    async removeTag(path: string, tag: string): Promise<void> {
        const { node, realPath } = await this.fs.resolveNode(path);
        const newTags = node.tags.filter(t => t !== tag);
        await this.fs._backend.setTags(realPath, newTags);
    }

    async walkByTag(tag: string, callback: (path: string) => boolean | Promise<boolean>): Promise<{ total: number; processed: number }> {
        // Simplified: walk tree and filter by tag
        let processed = 0;
        await this.fs.walkTree((node) => {
            if (node.tags.includes(tag)) {
                processed++;
                return callback(node.path);
            }
            return true;
        });
        return { total: processed, processed };
    }
}
