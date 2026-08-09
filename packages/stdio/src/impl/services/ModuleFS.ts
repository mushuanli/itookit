/**
 * @file packages/stdio/src/impl/services/ModuleFS.ts
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
    FSEventPayloadMap,
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
    ISeqFileOperations,
    ISeqFileTransaction,
    IRefOperations,
    IRecordStore,
    IRecordTransaction,
    SeqFileEntry,
    RecordQuery,
    RecordQueryOptions,
    RecordQueryResult,
    RecordValue,
    Reference,
    RefType,
    RefQueryOptions,
    IDeviceHandle,
    DeviceContext,
    IStorageBackend,
    ISystemAccess,
} from '../../protocol';

import {
    FSNotFoundError,
    FSError,
    FSReadOnlyError,
    FSCapabilityError,
} from '../../protocol';

import { VFSEngine } from '../engine/vfs-engine';
import { ScopedView } from './ScopedView';
import { AccessController, type CallerIdentity } from '../engine/access-controller';
import { FSEventBus, TransactionEventBuffer } from '../event/event-bus';
import { PluginPipeline } from '../engine/plugin-pipeline';
import { DeviceRegistry } from '../engine/device-registry';
import { toBuffer, toString } from '../../utils/encoding';
import { isPath, isHiddenName, isAssetDirName, isInternalDirName } from '../../utils/validation';
import * as P from '../../utils/path';

import { FSMetaDriverAdapter } from './FSMetaDriverAdapter';
import { FileHandle } from '../file-io/File';

export interface ModuleFSDeps {
    moduleId: string;
    engine: VFSEngine;
    eventBus: FSEventBus;
    plugins: PluginPipeline;
    access: AccessController;
    devices: DeviceRegistry;
    mountId?: string;
    isSystem?: boolean;
    /**
     * ISystemAccess for /etc operations, injected into DeviceContext for device drivers.
     * Non-system modules receive this so openDevice() can pass it to device drivers.
     */
    systemAccess?: ISystemAccess;
    /**
     * Override the root real path for ScopedView. Used by the etc pseudo-module
     * so `/` maps to `/etc/` instead of `/module/etc/`.
     */
    rootRealPath?: string;
}

// ─── DeviceHandle ─────────────────────────────────────────────────────────────
class DeviceHandle implements IDeviceHandle {
    constructor(
        private readonly _driver: import('../../protocol').IDeviceDriver,
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
// Record-backed metadata capabilities
// ═══════════════════════════════════════════════════════════════

function stringifyRecordValue(value: RecordValue): string {
    return typeof value === 'string' ? value : JSON.stringify(value);
}

const SEQ_FIELD_PREFIX = '__vfs_seq__:';
const seqField = (key: string): string => `${SEQ_FIELD_PREFIX}${key}`;
const seqKey = (field: string): string => field.slice(SEQ_FIELD_PREFIX.length);
const SEQ_COUNTER_PREFIX = '__vfs_seq_counter__:';

class InlineSeqTransaction implements ISeqFileTransaction {
    constructor(
        private readonly fs: ModuleFS,
        private readonly records: IRecordTransaction,
    ) {}

    private path(path: string): string { return this.fs._toRealPath(path); }

    async getEntry(path: string, key: string): Promise<string | null> {
        const value = await this.records.getRecordField(this.path(path), seqField(key));
        return value === undefined ? null : stringifyRecordValue(value);
    }

    async setEntry(path: string, key: string, value: string): Promise<void> {
        await this.records.setRecordField(this.path(path), seqField(key), value);
    }

    async deleteEntry(path: string, key: string): Promise<void> {
        await this.records.deleteRecordField(this.path(path), seqField(key));
    }

    async compareAndSet(
        path: string,
        key: string,
        options: { expected: string | null; value: string | null },
    ): Promise<boolean> {
        const current = await this.getEntry(path, key);
        if (current !== options.expected) return false;
        if (options.value === null) await this.deleteEntry(path, key);
        else await this.setEntry(path, key, options.value);
        return true;
    }

    async increment(path: string, key: string, delta = 1): Promise<number> {
        const current = Number(await this.getEntry(path, key) ?? '0');
        if (!Number.isSafeInteger(current) || !Number.isSafeInteger(delta)) {
            throw new FSError('EINVAL', 'SeqFile counter must be a safe integer', 'increment', key);
        }
        const next = current + delta;
        if (!Number.isSafeInteger(next)) throw new FSError('EINVAL', 'SeqFile counter overflow', 'increment', key);
        await this.setEntry(path, key, String(next));
        return next;
    }

    async append(path: string, prefix: string, value: string): Promise<string> {
        const sequence = await this.increment(path, `${SEQ_COUNTER_PREFIX}${prefix}`);
        const key = `${prefix}${String(sequence).padStart(16, '0')}`;
        await this.setEntry(path, key, value);
        return key;
    }

    async walkEntries(
        path: string,
        callback: (entry: SeqFileEntry) => boolean | Promise<boolean>,
        options?: { keyPrefix?: string; limit?: number; offset?: number },
    ): Promise<{ total: number; processed: number }> {
        return this.records.walkRecordFields(
            this.path(path),
            (key, value) => callback({ key: seqKey(key), value: stringifyRecordValue(value) }),
            { prefix: seqField(options?.keyPrefix ?? ''), limit: options?.limit, offset: options?.offset },
        );
    }
}

class InlineSeqFileOps implements ISeqFileOperations {
    constructor(
        private readonly fs: ModuleFS,
        private readonly records: IRecordStore,
    ) {}

    private async path(path: string): Promise<string> {
        return (await this.fs.resolveNode(path)).realPath;
    }

    async getEntry(path: string, key: string): Promise<string | null> {
        const value = await this.records.getRecordField(await this.path(path), seqField(key));
        return value === undefined ? null : stringifyRecordValue(value);
    }

    async getEntries(path: string, keys: string[]): Promise<Record<string, string>> {
        const entries = await Promise.all(keys.map(async key => [key, await this.getEntry(path, key)] as const));
        return Object.fromEntries(entries.filter((entry): entry is [string, string] => entry[1] !== null));
    }

    async setEntry(path: string, key: string, value: string): Promise<void> {
        await this.records.setRecordField(await this.path(path), seqField(key), value);
    }

    async setEntries(path: string, entries: Record<string, string>): Promise<void> {
        if (!this.records.transaction) {
            throw new FSCapabilityError('transactionalSeqFiles', this.fs.moduleId);
        }
        await this.transaction(async tx => {
            for (const [key, value] of Object.entries(entries)) await tx.setEntry(path, key, value);
        });
    }

    async deleteEntry(path: string, key: string): Promise<void> {
        await this.records.deleteRecordField(await this.path(path), seqField(key));
    }

    async hasEntry(path: string, key: string): Promise<boolean> {
        return (await this.records.getRecordField(await this.path(path), seqField(key))) !== undefined;
    }

    async walkEntries(
        path: string,
        callback: (entry: SeqFileEntry) => boolean | Promise<boolean>,
        options?: { keyPrefix?: string; limit?: number; offset?: number },
    ): Promise<{ total: number; processed: number }> {
        return this.records.walkRecordFields(
            await this.path(path),
            (key, value) => callback({
                key: seqKey(key),
                value: stringifyRecordValue(value),
            }),
            {
                prefix: seqField(options?.keyPrefix ?? ''),
                limit: options?.limit,
                offset: options?.offset,
            },
        );
    }

    async queryEntries(
        path: string,
        query: RecordQuery,
        options?: RecordQueryOptions,
    ): Promise<RecordQueryResult[]> {
        const results = await this.records.queryRecordFields(
            await this.path(path),
            { ...query, field: seqField(query.field) },
            options,
        );
        return results.map(result => ({ ...result, field: seqKey(result.field) }));
    }

    async createIndex(path: string, field: string): Promise<void> {
        await this.records.createRecordIndex(await this.path(path), seqField(field));
    }

    async deleteIndex(path: string, field: string): Promise<void> {
        await this.records.deleteRecordIndex(await this.path(path), seqField(field));
    }

    async transaction<T>(operation: (tx: ISeqFileTransaction) => Promise<T>): Promise<T> {
        if (!this.records.transaction) {
            throw new FSCapabilityError('transactionalSeqFiles', this.fs.moduleId);
        }
        return this.records.transaction(records => operation(new InlineSeqTransaction(this.fs, records)));
    }
}

const OUT_REF_PREFIX = '__vfs_ref_out__:';
const IN_REF_PREFIX = '__vfs_ref_in__:';

interface RefInput {
    targetPath?: string;
    targetIdOrPath?: string;
    refType: RefType;
    extra?: Record<string, unknown>;
}

function refField(prefix: string, refType: RefType, path: string): string {
    return `${prefix}${refType}:${encodeURIComponent(path)}`;
}

function isRefType(value: unknown): value is RefType {
    return value === 'mention'
        || value === 'depend'
        || value === 'related'
        || value === 'embed';
}

function parseReference(value: RecordValue): Reference | null {
    if (typeof value !== 'string') return null;
    try {
        const parsed: unknown = JSON.parse(value);
        if (typeof parsed !== 'object' || parsed === null) return null;
        const ref = parsed as Record<string, unknown>;
        if (typeof ref.sourcePath !== 'string' || typeof ref.targetPath !== 'string') return null;
        if (!isRefType(ref.refType) || typeof ref.createdAt !== 'number') return null;
        const extra = typeof ref.extra === 'object' && ref.extra !== null
            ? ref.extra as Record<string, unknown>
            : undefined;
        return {
            sourcePath: ref.sourcePath,
            targetPath: ref.targetPath,
            refType: ref.refType,
            createdAt: ref.createdAt,
            extra,
        };
    } catch {
        return null;
    }
}

class InlineRefOps implements IRefOperations {
    constructor(
        private readonly fs: ModuleFS,
        private readonly records: IRecordStore,
    ) {}

    async addRef(
        sourcePath: string,
        targetPath: string,
        refType: RefType,
        extra?: Record<string, unknown>,
    ): Promise<void> {
        const sourceReal = (await this.fs.resolveNode(sourcePath)).realPath;
        const targetReal = (await this.fs.resolveNode(targetPath)).realPath;
        const ref: Reference = { sourcePath, targetPath, refType, createdAt: Date.now(), extra };
        const encoded = JSON.stringify(ref);
        await this.records.setRecordField(sourceReal, refField(OUT_REF_PREFIX, refType, targetPath), encoded);
        await this.records.setRecordField(targetReal, refField(IN_REF_PREFIX, refType, sourcePath), encoded);
    }

    async removeRef(sourcePath: string, targetPath: string, refType: RefType): Promise<void> {
        const sourceReal = (await this.fs.resolveNode(sourcePath)).realPath;
        const targetReal = (await this.fs.resolveNode(targetPath)).realPath;
        await this.records.deleteRecordField(sourceReal, refField(OUT_REF_PREFIX, refType, targetPath));
        await this.records.deleteRecordField(targetReal, refField(IN_REF_PREFIX, refType, sourcePath));
    }

    walkOutgoing(
        path: string,
        callback: (ref: Reference) => boolean | Promise<boolean>,
        opts?: RefQueryOptions,
    ): Promise<number> {
        return this.walk(path, OUT_REF_PREFIX, callback, opts);
    }

    walkIncoming(
        path: string,
        callback: (ref: Reference) => boolean | Promise<boolean>,
        opts?: RefQueryOptions,
    ): Promise<number> {
        return this.walk(path, IN_REF_PREFIX, callback, opts);
    }

    async hasRef(sourcePath: string, targetPath: string, refType: RefType): Promise<boolean> {
        const sourceReal = (await this.fs.resolveNode(sourcePath)).realPath;
        const field = refField(OUT_REF_PREFIX, refType, targetPath);
        return (await this.records.getRecordField(sourceReal, field)) !== undefined;
    }

    async syncOutgoing(sourcePath: string, refs: RefInput[]): Promise<void> {
        const existing: Reference[] = [];
        await this.walkOutgoing(sourcePath, ref => {
            existing.push(ref);
            return true;
        });
        await Promise.all(existing.map(
            ref => this.removeRef(sourcePath, ref.targetPath, ref.refType),
        ));
        for (const ref of refs) {
            const targetPath = ref.targetPath ?? ref.targetIdOrPath;
            if (!targetPath) throw new FSError('EINVAL', 'reference target path is required', 'syncOutgoing');
            await this.addRef(sourcePath, targetPath, ref.refType, ref.extra);
        }
    }

    private async walk(
        path: string,
        prefix: string,
        callback: (ref: Reference) => boolean | Promise<boolean>,
        opts?: RefQueryOptions,
    ): Promise<number> {
        const realPath = (await this.fs.resolveNode(path)).realPath;
        const refs: Reference[] = [];
        await this.records.walkRecordFields(realPath, (_field, value) => {
            const ref = parseReference(value);
            if (ref && (!opts?.refTypes || opts.refTypes.includes(ref.refType))) refs.push(ref);
            return true;
        }, { prefix });
        return this.dispatch(refs, callback, opts);
    }

    private async dispatch(
        refs: Reference[],
        callback: (ref: Reference) => boolean | Promise<boolean>,
        opts?: RefQueryOptions,
    ): Promise<number> {
        const offset = opts?.offset ?? 0;
        const limit = opts?.limit ?? refs.length;
        let processed = 0;
        for (const ref of refs.slice(offset, offset + limit)) {
            processed++;
            if (!(await callback(ref))) break;
        }
        return processed;
    }
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
    readonly meta: import('../../protocol').IFSMetaDriver;

    private readonly engine: VFSEngine;
    private readonly bus: FSEventBus;
    private readonly access: AccessController;
    private readonly devices: DeviceRegistry;
    private readonly scope: ScopedView;
    private readonly mountId: string;
    private readonly caller: CallerIdentity;
    private readonly _moduleBackend: IStorageBackend;
    private readonly systemAccess?: ISystemAccess;
    private readonly _isCustomRoot: boolean;
    private initialized = false;
    /** Points to the active event target — bus normally, EventBuffer during a transaction. */
    private _emitTarget: import('../../eventbus').IEventEmitter<import('../../protocol').FSEventPayloadMap>;

    constructor(deps: ModuleFSDeps) {
        this.moduleId = deps.moduleId;
        this.engine = deps.engine;
        this.bus = deps.eventBus;
        this._emitTarget = deps.eventBus;
        this.access = deps.access;
        this.devices = deps.devices;
        this.scope = new ScopedView(deps.moduleId, deps.rootRealPath);
        this._isCustomRoot = deps.rootRealPath !== undefined;
        this.mountId = deps.mountId ?? 'mount_0';
        this.caller = { moduleId: deps.moduleId, isSystem: deps.isSystem ?? false };
        this.systemAccess = deps.systemAccess;
        this._moduleBackend = deps.engine.getBackendForPath(`/module/${deps.moduleId}`);
        const backend = this._moduleBackend;
        this.capabilities = Object.freeze({
            readonly: false, search: true, semanticSearch: false, syncable: false,
            assets: true, tags: true, deviceFiles: true,
            seqFiles: !!backend.records,
            transactionalSeqFiles: !!backend.records?.transaction,
            references: !!backend.records,
            symlinks: !!backend.symlink, hardlinks: false,
            partialRead: true, partialWrite: true, treeWalk: true,
            streaming: false, watch: false, mount: false,
        });

        this.assets = new InlineAssetOps(this);
        this.tags = new InlineTagOps(this);
        this.driver = this;
        const seq = backend.records ? new InlineSeqFileOps(this, backend.records) : undefined;
        const refs = backend.records ? new InlineRefOps(this, backend.records) : undefined;
        this.meta = new FSMetaDriverAdapter(this.assets, this.tags, seq, refs);
    }

    openFile(nodeId: string): import('../../protocol').IFile {
        return new FileHandle(this, nodeId);
    }

    // ══════════════════════════════════════════════════════════
    // Lifecycle
    // ══════════════════════════════════════════════════════════

    async init(): Promise<void> {
        if (this.initialized) return;
        // Skip ensureModuleDir when rootRealPath is set (e.g. /etc pseudo-module).
        // In that case the directory is created by bootstrap or is a system directory.
        if (!this._isCustomRoot) {
            await this.engine.ensureModuleDir(this.moduleId);
        }
        this.initialized = true;
    }

    async dispose(): Promise<void> { this.initialized = false; }

    // ══════════════════════════════════════════════════════════
    // Events
    // ══════════════════════════════════════════════════════════

    on<E extends FSEventType>(event: E, callback: (event: FSEvent<E>) => void): () => void {
        return this.bus.on(event, (payload, meta) => {
            if (meta.moduleId !== this.moduleId) return;
            callback({ type: event, payload, timestamp: meta.timestamp, moduleId: meta.moduleId as string | undefined, fromTransaction: meta.fromTransaction as boolean | undefined, mountId: meta.mountId as string | undefined } as FSEvent<E>);
        });
    }
    onAny(callback: (event: FSEvent) => void): () => void {
        return this.bus.onAny((payload, meta) => {
            if (meta.moduleId !== this.moduleId) return;
            callback({ type: meta.type as FSEventType, payload, timestamp: meta.timestamp, moduleId: meta.moduleId as string | undefined, fromTransaction: meta.fromTransaction as boolean | undefined, mountId: meta.mountId as string | undefined } as FSEvent);
        });
    }

    get _backend(): IStorageBackend { return this._moduleBackend; }
    get _engine(): VFSEngine { return this.engine; }
    /** @internal Convert a system path to this module's virtual namespace. */
    _toVirtualPath(path: string): string { return this.scope.toVirtualPath(path); }

    // ══════════════════════════════════════════════════════════
    // Path resolution helpers (centralized)
    // ══════════════════════════════════════════════════════════

    /** Map a system-path FSNode to a module-virtual-path FSNode. */
    private toVirtualNode(node: FSNode): FSNode {
        const mapPath = (p: string | null) => p ? this.scope.toVirtualPath(p) : null;
        const result = {
            ...node,
            path: mapPath(node.path)!,
            parentPath: mapPath(node.parentPath),
        };

        // Debug: verify virtualization actually changed the path
        if (node.path.startsWith('/module/') && result.path.startsWith('/module/')) {
            console.error('[ModuleFS] toVirtualNode FAILED to virtualize!', {
                moduleId: this.moduleId,
                input: { path: node.path, parentPath: node.parentPath },
                output: { path: result.path, parentPath: result.parentPath },
            });
        }

        return result;
    }

    /** Convert a virtual path to a system-real path. */
    private toRealPath(path: string): string {
        if (isPath(path)) {
            // Defend against double-mapping: only accept paths already under THIS
            // module's mount prefix (e.g. /module/anki/file.md).
            // Do NOT match just the mount root (/module/anki) because a user
            // directory named /module/anki is a legitimate virtual path whose
            // system form is /module/anki/module/anki — matching mountRoot would
            // conflate the two and resolve to the wrong backend path.
            const mountPrefix = `/module/${this.moduleId}/`;
            if (path.startsWith(mountPrefix)) {
                return path;
            }
            return this.scope.toRealPath(path);
        }
        throw new FSError('EINVAL', 'path-based engine requires paths, not IDs', 'resolve', path);
    }

    /** @internal Convert a module-relative path without performing I/O. */
    _toRealPath(path: string): string { return this.toRealPath(path); }

    /** Stat + return { node, realPath }. Throws if not found. @internal — exposed for InlineAssetOps */
    async resolveNode(path: string): Promise<{ node: FSNode; realPath: string }> {
        const realPath = this.toRealPath(path);
        const node = await this.engine.stat(realPath);
        if (!node) throw new FSNotFoundError(path);
        return { node, realPath };
    }

    /** Check writable + permissions. System callers bypass ScopedView read-only (same as AccessController). */
    private assertWritable(realPath: string): void {
        if (this.caller.isSystem) return;
        if (this.scope.isRealPathReadOnly(realPath)) throw new FSReadOnlyError(this.moduleId, realPath);
    }

    /** Emit a namespaced event. @internal — exposed for inline ops classes */
    _emit<E extends FSEventType>(type: E, payload: FSEventPayloadMap[E]): void {
        this._emitTarget.emit(type, payload, { moduleId: this.moduleId, mountId: this.mountId });
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
    async getChildren(path: string, options?: ListOptions): Promise<FSNode[] | DirEntry[]> {
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
                size: c.type === 'file' ? c.size : undefined,
                modifiedAt: c.modifiedAt,
            } as DirEntry));
        }
        // Filter out any child whose virtualized path equals the request path
        // (would create a self-cycle in the tree, crashing the renderer).
        const virtualChildren = filtered.map(c => this.toVirtualNode(c));
        return virtualChildren.filter(c => c.path !== path);
    }

    // IFSDriver overloaded readContent signatures
    readContent(path: string, options: ReadOptions & { encoding: 'utf-8' }): Promise<string>;
    readContent(path: string, options: ReadOptions & { encoding: 'binary' }): Promise<ArrayBuffer>;
    readContent(path: string, options?: ReadOptions): Promise<FileContent>;
    async readContent(path: string, options?: ReadOptions): Promise<FileContent> {
        const { realPath } = await this.resolveNode(path);
        this.access.checkAccess(this.caller, realPath, 'read');
        if (this._moduleBackend.records) {
            const text = await this.serializeSeqFile(realPath, this._moduleBackend.records);
            if (text !== null) {
                return options?.encoding === 'binary' ? toBuffer(text) : text;
            }
        }
        const data = await this.engine.readContent(realPath);
        if (options?.encoding === 'utf-8') return toString(data);
        return data;
    }

    private async serializeSeqFile(path: string, records: IRecordStore): Promise<string | null> {
        const lines: string[] = [];
        try {
            const result = await records.walkRecordFields(path, (field, value) => {
                lines.push(`${seqKey(field)}=${stringifyRecordValue(value)}`);
                return true;
            }, { prefix: SEQ_FIELD_PREFIX });
            return result.total > 0 ? lines.join('\n') : null;
        } catch (error) {
            if (isMissingRecordIndexError(error)) return null;
            throw error;
        }
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
        const typeFilter = options?.typeFilter
            ? new Set(Array.isArray(options.typeFilter) ? options.typeFilter : [options.typeFilter])
            : null;
        let processed = 0;
        const virtualCallback: TreeWalkCallback = async (node, depth) => {
            if (typeFilter && !typeFilter.has(node.type)) return true;
            processed++;
            return callback(this.toVirtualNode(node), depth);
        };
        await this.engine.walkTree(rootPath, virtualCallback, options);
        return processed;
    }

    async search(query: FSSearchQuery): Promise<FSSearchResult> {
        const moduleRoot = this.scope.toRealPath('/');
        const nodes = await this.engine.search(moduleRoot, query);
        // VFSEngine.search ignores the path argument when the backend implements search(),
        // so it returns nodes from all modules. Filter to this module's scope only.
        const scoped = nodes.filter(n => n.path === moduleRoot || n.path.startsWith(moduleRoot + '/'));
        const virtualized = scoped.map(n => this.toVirtualNode(n));
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
        const parentPath = options.parentPath
            ? this.toRealPath(options.parentPath)
            : this.scope.toRealPath('/');
        const existing = await this.engine.tryStat(P.join(parentPath, options.name));
        if (existing?.type === 'directory') return this.toVirtualNode(existing);
        return this.createFile({ ...options, type: 'directory', content: undefined });
    }

    async writeContent(path: string, content: FileContent, options?: WriteOptions): Promise<void> {
        const { node, realPath } = await this.resolveNode(path);
        this.access.checkAccess(this.caller, realPath, 'write');
        this.assertWritable(realPath);
        await this.engine.writeContent(realPath, content, options);
        this._emit('node:updated', {
            nodes: [{ path: this.toVirtualNode(node).path, changedFields: ['content'] }],
            reason: 'content',
        });
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
        this._emit('node:renamed', { nodes: [{ oldPath: virtualNode.path, newPath: newVirtualPath, oldName: node.name, newName }] });
    }

    async move(paths: string[], targetParentPath: string | null): Promise<void> {
        const targetPath = targetParentPath
            ? this.toRealPath(targetParentPath)
            : this.scope.toRealPath('/');
        this.access.checkAccess(this.caller, targetPath, 'write');
        this.assertWritable(targetPath);

        const nodes: Array<{ oldPath: string; newPath: string; oldParentPath: string | null; newParentPath: string | null }> = [];
        for (const src of paths) {
            const { node, realPath } = await this.resolveNode(src);
            const oldPath = this.toVirtualNode(node).path;
            const newParentVirtual = this.scope.toVirtualPath(targetPath);
            const newPath = `${newParentVirtual}/${node.name}`;
            nodes.push({ oldPath, newPath, oldParentPath: this.scope.toVirtualPath(node.parentPath!), newParentPath: newParentVirtual });
            await this.engine.move(realPath, targetPath);
        }
        this._emit('node:moved', { nodes });
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
        this._emit('node:updated', {
            nodes: [{ path: this.toVirtualNode(node).path, changedFields: ['metadata'] }],
            reason: 'metadata',
        });
    }

    // ── Copy ──
    async copy(sourcePath: string, targetParentPath: string | null, newName?: string): Promise<FSNode> {
        const { node } = await this.resolveNode(sourcePath);
        const name = newName ?? node.name;

        if (node.type === 'directory') {
            const newNode = await this.createDirectory({
                name,
                parentPath: targetParentPath,
                metadata: { ...node.metadata },
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
            parentPath: targetParentPath,
            type: node.type,
            content: fileContent as string | ArrayBuffer,
            metadata: { ...node.metadata },
            tags: [...node.tags],
        });
        this._emit('node:copied', {
            copies: [{
                sourcePath: this.toVirtualNode(node).path,
                targetPath: copied.path,
                targetParentPath: copied.parentPath,
            }],
        });
        return copied;
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
        if (!this.capabilities.symlinks) {
            throw new FSCapabilityError('symlinks', this.moduleId);
        }
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
        const handlerId = node.deviceHandlerId;
        if (!handlerId) throw new FSError('ENOTTY', 'no device handler', 'ioctl', node.path);
        const driver = this.devices.get(handlerId);
        if (!driver.ioctl) throw new FSError('ENOTTY', 'device does not support ioctl', 'ioctl', node.path);
        return driver.ioctl({ nodeId: node.path, name: node.name, metadata: node.metadata }, command, arg);
    }

    async openDevice(path: string, options?: Record<string, unknown>): Promise<IDeviceHandle> {
        const { node } = await this.resolveNode(path);
        if (node.type !== 'device') throw new FSError('ENOTTY', 'not a device file', 'openDevice', node.path);
        const handlerId = node.deviceHandlerId;
        if (!handlerId) throw new FSError('ENOTTY', 'no device handler', 'openDevice', node.path);
        const driver = this.devices.get(handlerId);
        // Inject systemFS so device drivers can read/write /etc hidden files
        // with system identity (driver can mask/filter sensitive data before
        // returning to the non-system caller).
        const baseCtx: DeviceContext = {
            nodeId: node.path,
            name: node.name,
            metadata: node.metadata,
            systemAccess: this.systemAccess,
        };
        let sessionId: string | undefined;
        if (driver.sessionable && driver.open) sessionId = await driver.open(baseCtx, options);
        return new DeviceHandle(driver, { ...baseCtx, sessionId });
    }

    // ══════════════════════════════════════════════════════════
    // Transaction
    // ══════════════════════════════════════════════════════════

    async transaction<T>(fn: (tx: IFSDriverTransaction) => Promise<T>): Promise<T> {
        const buffer = new TransactionEventBuffer(this.bus, { moduleId: this.moduleId });
        // Redirect _emit calls through the buffer for the duration of the transaction.
        this._emitTarget = buffer;

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
            this._emitTarget = this.bus;
            buffer.commit();
            return result;
        } catch (e) {
            this._emitTarget = this.bus;
            buffer.rollback();
            throw e;
        }
    }
}

function isMissingRecordIndexError(error: unknown): boolean {
    return error instanceof Error && error.name === 'NotFoundError';
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
        // Use ModuleFS.createFile (not raw engine) so toRealPath adds the
        // mount prefix, routing the asset to the correct module directory.
        const result = await this.fs.createFile({
            name: assetName,
            parentPath: assetDir,
            content: buf as string | ArrayBuffer,
            overwrite: true,
        });
        return result;
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
            return assetDir ? this.fs._toVirtualPath(assetDir) : null;
        } catch { return null; }
    }

    async ensureAssetDir(ownerIdOrPath: string): Promise<string> {
        const { realPath } = await this.fs.resolveNode(ownerIdOrPath);
        const assetDir = await this._engine().ensureAssetDir(realPath);
        return this.fs._toVirtualPath(assetDir);
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

    async getAllTags(): Promise<import('../../protocol').TagDefinition[]> {
        const tags = await this.fs._backend.getAllTags();
        return tags.map(t => ({ name: t }));
    }

    async setTags(path: string, tags: string[]): Promise<void> {
        const { realPath } = await this.fs.resolveNode(path);
        await this.fs._backend.setTags(realPath, tags);
        this.emitTagUpdate(path);
    }

    async addTag(path: string, tag: string): Promise<void> {
        const { node, realPath } = await this.fs.resolveNode(path);
        const newTags = [...new Set([...node.tags, tag])];
        await this.fs._backend.setTags(realPath, newTags);
        this.emitTagUpdate(path);
    }

    async removeTag(path: string, tag: string): Promise<void> {
        const { node, realPath } = await this.fs.resolveNode(path);
        const newTags = node.tags.filter(t => t !== tag);
        await this.fs._backend.setTags(realPath, newTags);
        this.emitTagUpdate(path);
    }

    private emitTagUpdate(path: string): void {
        this.fs._emit('node:updated', {
            nodes: [{ path, changedFields: ['tags'] }],
            reason: 'tags',
        });
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
