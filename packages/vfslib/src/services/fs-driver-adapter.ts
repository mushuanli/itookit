/**
 * @file vfslib/src/services/fs-driver-adapter.ts
 * @desc Adapters that expose IFSDriver and IFSMetaDriver from ModuleFS.
 *
 * FSDriverAdapter wraps ModuleFS as IFSDriver (delegates all calls).
 * FSMetaDriverAdapter combines the existing capability sub-interfaces into IFSMetaDriver.
 *
 * Both are lazy-initialized as properties of ModuleFS — use ModuleFS.driver / ModuleFS.meta.
 */

import type {
    IFSDriver,
    IFSDriverTransaction,
    IFSMetaDriver,
    FSNode,
    DirEntry,
    FSSearchQuery,
    FSSearchResult,
    FSCapabilities,
    FSModuleStats,
    FileContent,
    ReadOptions,
    WriteOptions,
    CreateFileOptions,
    CreateDirectoryOptions,
    DeleteOptions,
    RenameOptions,
    MoveOptions,
    CopyOptions,
    ListOptions,
    TreeWalkOptions,
    TreeWalkCallback,
    FSEventType,
    FSEvent,
    IAssetOperations,
    ITagOperations,
    ISeqFileOperations,
    IRefOperations,
    IWatchOperations,
    IFSTransaction,
} from '@itookit/common';
import { FSCapabilityError } from '@itookit/common';
import type { ModuleFS } from './module-fs';

// ═══════════════════════════════════════════════════════════════
// FSDriverAdapter
// ═══════════════════════════════════════════════════════════════

/**
 * Wraps ModuleFS as IFSDriver by delegating all calls.
 * Since ModuleFS already implements every IFSDriver method,
 * this is a thin pass-through that satisfies the IFSDriver interface shape.
 */
export class FSDriverAdapter implements IFSDriver {
    constructor(private readonly fs: ModuleFS) {}

    get moduleId(): string { return this.fs.moduleId; }
    get capabilities(): FSCapabilities { return this.fs.capabilities; }

    // ── Events ──────────────────────────────────────────────
    on<E extends FSEventType>(event: E, callback: (event: FSEvent<E>) => void): () => void {
        return this.fs.on(event, callback);
    }
    onAny?(callback: (event: FSEvent) => void): () => void {
        return this.fs.onAny(callback);
    }

    // ── Read ────────────────────────────────────────────────
    getNode(idOrPath: string): Promise<FSNode | null> {
        return this.fs.getNode(idOrPath);
    }
    getChildren(idOrPath: string, options?: ListOptions & { fields?: 'full' }): Promise<FSNode[]>;
    getChildren(idOrPath: string, options: ListOptions & { fields: 'entry' }): Promise<DirEntry[]>;
    getChildren(idOrPath: string, options?: ListOptions): Promise<FSNode[] | DirEntry[]> {
        return this.fs.getChildren(idOrPath, options as any) as any;
    }
    readContent(idOrPath: string, options: ReadOptions & { encoding: 'utf-8' }): Promise<string>;
    readContent(idOrPath: string, options: ReadOptions & { encoding: 'binary' }): Promise<ArrayBuffer>;
    readContent(idOrPath: string, options?: ReadOptions): Promise<FileContent> {
        return this.fs.readContent(idOrPath, options as any) as any;
    }
    resolvePath(path: string): Promise<string | null> {
        return this.fs.resolvePath(path);
    }
    exists(idOrPath: string): Promise<boolean> {
        return this.fs.exists(idOrPath);
    }
    walkTree(callback: TreeWalkCallback, options?: TreeWalkOptions): Promise<number> {
        return this.fs.walkTree!(callback, options);
    }
    search(query: FSSearchQuery): Promise<FSSearchResult> {
        return this.fs.search(query);
    }
    getStats(): Promise<FSModuleStats> {
        return this.fs.getStats!();
    }

    // ── Write ───────────────────────────────────────────────
    createFile(options: CreateFileOptions): Promise<FSNode> {
        return this.fs.createFile(options);
    }
    createDirectory(options: CreateDirectoryOptions): Promise<FSNode> {
        return this.fs.createDirectory(options);
    }
    writeContent(idOrPath: string, content: FileContent, options?: WriteOptions): Promise<void> {
        return this.fs.writeContent(idOrPath, content, options);
    }
    appendContent(idOrPath: string, content: FileContent): Promise<void> {
        return this.fs.appendContent(idOrPath, content);
    }
    rename(idOrPath: string, newName: string, options?: RenameOptions): Promise<void> {
        return this.fs.rename(idOrPath, newName, options);
    }
    move(idsOrPaths: string[], targetParentIdOrPath: string | null, options?: MoveOptions): Promise<void> {
        return this.fs.move(idsOrPaths, targetParentIdOrPath, options);
    }
    delete(idsOrPaths: string[], options?: DeleteOptions): Promise<void> {
        return this.fs.delete(idsOrPaths, options);
    }
    updateMetadata(idOrPath: string, metadata: Record<string, unknown>): Promise<void> {
        return this.fs.updateMetadata(idOrPath, metadata);
    }

    // ── Copy ────────────────────────────────────────────────
    copy(sourceIdOrPath: string, targetParentIdOrPath: string | null, newName?: string, options?: CopyOptions): Promise<FSNode> {
        if (!this.fs.copy) throw new FSCapabilityError('copy', this.fs.moduleId);
        return this.fs.copy(sourceIdOrPath, targetParentIdOrPath, newName, options);
    }

    // ── Links ───────────────────────────────────────────────
    symlink(linkPath: string, targetPath: string): Promise<FSNode> {
        return this.fs.symlink(linkPath, targetPath);
    }
    readlink(idOrPath: string): Promise<string> {
        return this.fs.readlink(idOrPath);
    }
    hardlink(linkPath: string, targetPath: string): Promise<FSNode> {
        if (!this.fs.capabilities.hardlinks || !this.fs.hardlink) {
            throw new FSCapabilityError('hardlinks', this.fs.moduleId);
        }
        return this.fs.hardlink(linkPath, targetPath);
    }

    // ── Transaction ─────────────────────────────────────────
    transaction<T>(fn: (tx: IFSDriverTransaction) => Promise<T>): Promise<T> {
        if (!this.fs.transaction) throw new FSCapabilityError('transaction', this.fs.moduleId);
        // IFSDriverTransaction is structurally identical to IFSTransaction — cast is safe
        return this.fs.transaction(fn as (tx: IFSTransaction) => Promise<T>);
    }
}

// ═══════════════════════════════════════════════════════════════
// FSMetaDriverAdapter
// ═══════════════════════════════════════════════════════════════

export class FSMetaDriverAdapter implements IFSMetaDriver {
    readonly assets: IAssetOperations;
    readonly tags: ITagOperations;
    readonly seq?: ISeqFileOperations;
    readonly refs?: IRefOperations;
    readonly watcher?: IWatchOperations;

    constructor(fs: ModuleFS) {
        this.assets = fs.assets;
        this.tags = fs.tags;
        this.seq = fs.seq;
        this.refs = fs.refs;
        this.watcher = fs.watcher;
    }
}
