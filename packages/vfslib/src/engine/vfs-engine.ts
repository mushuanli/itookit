/**
 * @file packages/vfslib/src/engine/vfs-engine.ts
 * @desc VFS 引擎 — 系统级核心操作
 *
 * 职责：
 * - 管理根后端
 * - Bootstrap 基础目录结构 (/etc, /dev, /module)
 * - 系统级路径解析与文件操作
 * - 持有 plugin pipeline、device registry、event bus、access controller
 */

import type {
    IStorageBackend,
    InodeRecord,
    MetaRecord,
    FSNodeType,
    FileContent,
    WriteOptions,
    DeleteOptions,
    RenameOptions,
    MoveOptions,
    IMountRouter,
} from '@itookit/common';

import {
    FSError,
    FSAlreadyExistsError,
    FSConflictError,
    SYSTEM_DIRS,
} from '@itookit/common';

import { PathResolver, type ResolvedInode } from './path-resolver';
import { AccessController } from './access-controller';
import { EventBus } from '../event/event-bus';
import { PluginPipeline } from './plugin-pipeline';
import { DeviceRegistry } from './device-registry';
import { deleteRecursive } from './tree-ops';
import { toBuffer, toString } from '../utils/encoding';
import * as P from '../utils/path';
import { toAssetDirName, validateFilename } from '../utils/validation';

export const ROOT_INO = 1;

export class VFSEngine {
    readonly resolver: PathResolver;
    readonly access: AccessController;
    readonly events: EventBus;
    readonly plugins: PluginPipeline;
    readonly devices: DeviceRegistry;

    private readonly backend: IStorageBackend;
    private _mountRouter: IMountRouter | null = null;
    private initialized = false;

    constructor(
        backend: IStorageBackend,
        options?: { maxSymlinkDepth?: number },
    ) {
        this.backend = backend;
        this.resolver = new PathResolver(options?.maxSymlinkDepth);
        this.access = new AccessController();
        this.events = new EventBus();
        this.plugins = new PluginPipeline();
        this.devices = new DeviceRegistry();
    }

    get store(): IStorageBackend {
        return this.backend;
    }

    getBackend(): IStorageBackend {
        return this.backend;
    }

    /** Wire in the mount router so path operations route to the correct backend. */
    setMountRouter(router: IMountRouter): void {
        this._mountRouter = router;
    }

    /** Returns the backend responsible for `systemPath`. Falls back to root backend. */
    getBackendForPath(systemPath: string): IStorageBackend {
        if (!this._mountRouter) return this.backend;
        return this._mountRouter.resolve(systemPath).mount.backend;
    }

    /** Returns the mount path (e.g. '/module/home') that owns `systemPath`. */
    getMountPathForPath(systemPath: string): string {
        if (!this._mountRouter) return '/';
        return this._mountRouter.resolve(systemPath).mount.mountPath;
    }

    /**
     * Returns the backend, local path, and mount path for a system path.
     * For root-backend paths the original systemPath is preserved and mountPath is '/'.
     * For mounted paths localPath is stripped of the mount prefix.
     */
    private getMountedStore(systemPath: string): { backend: IStorageBackend; localPath: string; mountPath: string } {
        if (!this._mountRouter) return { backend: this.backend, localPath: systemPath, mountPath: '/' };
        const { mount, relativePath } = this._mountRouter.resolve(systemPath);
        if (mount.backend === this.backend) return { backend: this.backend, localPath: systemPath, mountPath: '/' };
        const localPath = relativePath ? '/' + relativePath : '/';
        return { backend: mount.backend, localPath, mountPath: mount.mountPath };
    }

    inoToId(ino: number): string {
        return String(ino);
    }

    idToIno(id: string): number {
        const n = parseInt(id, 10);
        if (isNaN(n)) throw new FSError('EINVAL', `invalid node id: ${id}`);
        return n;
    }

    // ── Lifecycle ──

    async initialize(): Promise<void> {
        if (this.initialized) return;
        await this.backend.init();
        await this.bootstrap();
        await this.plugins.initAll();
        await this.devices.initAll();
        this.initialized = true;
    }

    async dispose(): Promise<void> {
        if (!this.initialized) return;
        await this.plugins.disposeAll();
        await this.devices.disposeAll();
        this.events.removeAll();
        await this.backend.close();
        this.initialized = false;
    }

    // ── Bootstrap ── (always uses root backend)

    private async bootstrap(): Promise<void> {
        await this.backend.runInTransaction('readwrite', async (scope) => {
            const rootInode = await scope.inodes.getInode(ROOT_INO);
            if (!rootInode) {
                await scope.inodes.putInode({
                    ino: ROOT_INO,
                    parentIno: ROOT_INO,
                    name: '',
                    type: 'directory',
                    createdAt: Date.now(),
                    nlink: 1,
                });
                await scope.meta.putMeta({
                    ino: ROOT_INO,
                    modifiedAt: Date.now(),
                    size: 0,
                    version: 0,
                });
            }

            for (const dirName of SYSTEM_DIRS) {
                const existing = await scope.inodes.lookup(ROOT_INO, dirName);
                if (!existing) {
                    const ino = await scope.inodes.allocateIno();
                    await scope.inodes.putInode({
                        ino,
                        parentIno: ROOT_INO,
                        name: dirName,
                        type: 'directory',
                        createdAt: Date.now(),
                        nlink: 1,
                    });
                    await scope.meta.putMeta({
                        ino,
                        modifiedAt: Date.now(),
                        size: 0,
                        version: 0,
                    });
                }
            }
        });
    }

    // ── Path Resolution ──

    async resolve(path: string, followSymlink = true): Promise<ResolvedInode> {
        const { backend, localPath, mountPath } = this.getMountedStore(path);
        const r = await this.resolver.resolve(
            { inodes: backend.inodes, meta: backend.meta },
            ROOT_INO,
            localPath,
            followSymlink,
        );
        // For non-root backends fullPath is local to the mount (e.g. '/log.txt').
        // Restore the system path so callers can pass it back to engine methods.
        if (mountPath !== '/') {
            return { ...r, fullPath: r.fullPath === '/' ? mountPath : mountPath + r.fullPath };
        }
        return r;
    }

    async tryResolve(path: string, followSymlink = true): Promise<ResolvedInode | null> {
        const { backend, localPath, mountPath } = this.getMountedStore(path);
        const r = await this.resolver.tryResolve(
            { inodes: backend.inodes, meta: backend.meta },
            ROOT_INO,
            localPath,
            followSymlink,
        );
        if (!r) return null;
        if (mountPath !== '/') {
            return { ...r, fullPath: r.fullPath === '/' ? mountPath : mountPath + r.fullPath };
        }
        return r;
    }

    // ── Module Directory Management ── (always root backend — creates stubs)

    async ensureModuleDir(moduleName: string): Promise<number> {
        const moduleParent = await this.resolve('/module');
        const existing = await this.backend.inodes.lookup(moduleParent.ino, moduleName);
        if (existing) return existing.ino;

        let resultIno = 0;
        await this.backend.runInTransaction('readwrite', async (scope) => {
            const check = await scope.inodes.lookup(moduleParent.ino, moduleName);
            if (check) { resultIno = check.ino; return; }

            const ino = await scope.inodes.allocateIno();
            await scope.inodes.putInode({
                ino,
                parentIno: moduleParent.ino,
                name: moduleName,
                type: 'directory',
                createdAt: Date.now(),
                nlink: 1,
            });
            await scope.meta.putMeta({
                ino,
                modifiedAt: Date.now(),
                size: 0,
                version: 0,
            });
            resultIno = ino;
        });

        return resultIno;
    }

    async removeModuleDir(moduleName: string): Promise<void> {
        const resolved = await this.tryResolve(`/module/${moduleName}`);
        if (!resolved) return;

        await this.backend.runInTransaction('readwrite', async (scope) => {
            await deleteRecursive(scope, resolved.ino);
        });
    }

    // ── System-Level Read ──

    async readBySystemPath(systemPath: string): Promise<FileContent> {
        const { backend, localPath } = this.getMountedStore(systemPath);
        const resolved = await this.resolver.resolve(
            { inodes: backend.inodes, meta: backend.meta },
            ROOT_INO,
            localPath,
        );
        if (!resolved.meta?.contentRef) return '';
        const data = await backend.content.getData(resolved.meta.contentRef);
        if (!data) return '';
        return toString(data);
    }

    // ── System-Level Operations ──

    async readContent(path: string): Promise<ArrayBuffer> {
        const { backend, localPath } = this.getMountedStore(path);
        const resolved = await this.resolver.resolve(
            { inodes: backend.inodes, meta: backend.meta },
            ROOT_INO,
            localPath,
        );
        if (resolved.inode.type === 'directory') {
            throw new FSError('EISDIR', 'cannot read directory', 'read', path);
        }
        if (!resolved.meta?.contentRef) return new ArrayBuffer(0);
        const data = await backend.content.getData(resolved.meta.contentRef);
        return data ?? new ArrayBuffer(0);
    }

    async writeContent(
        path: string,
        content: FileContent,
        opts?: WriteOptions,
    ): Promise<void> {
        const { backend, localPath } = this.getMountedStore(path);
        const resolved = await this.resolver.resolve(
            { inodes: backend.inodes, meta: backend.meta },
            ROOT_INO,
            localPath,
        );
        if (resolved.inode.type === 'directory') {
            throw new FSError('EISDIR', 'cannot write to directory', 'write', path);
        }

        if (opts?.expectedVersion != null && resolved.meta) {
            if (resolved.meta.version !== opts.expectedVersion) {
                throw new FSConflictError(path, opts.expectedVersion, resolved.meta.version);
            }
        }

        await backend.runInTransaction('readwrite', async (scope) => {
            const contentRef = String(resolved.ino);
            const buf = toBuffer(content);

            if (opts?.mode === 'append') {
                if (scope.content.appendData) {
                    await scope.content.appendData(contentRef, buf);
                } else {
                    const existing = await scope.content.getData(contentRef);
                    if (existing) {
                        const merged = new Uint8Array(existing.byteLength + buf.byteLength);
                        merged.set(new Uint8Array(existing), 0);
                        merged.set(new Uint8Array(buf), existing.byteLength);
                        await scope.content.putData(contentRef, merged.buffer as ArrayBuffer);
                    } else {
                        await scope.content.putData(contentRef, buf);
                    }
                }
            } else {
                await scope.content.putData(contentRef, buf);
            }

            const currentMeta = await scope.meta.getMeta(resolved.ino);
            const totalSize = opts?.mode === 'append'
                ? (currentMeta?.size ?? 0) + buf.byteLength
                : buf.byteLength;

            await scope.meta.patchMeta(resolved.ino, {
                modifiedAt: Date.now(),
                size: totalSize,
                version: (currentMeta?.version ?? 0) + 1,
                contentRef,
                ...(opts?.metadata ? { metadata: { ...currentMeta?.metadata, ...opts.metadata } } : {}),
            });
        });
    }

    async createFile(
        parentPath: string,
        name: string,
        type: FSNodeType = 'file',
        content?: FileContent,
        metadata?: Record<string, unknown>,
        opts?: { overwrite?: boolean; recursive?: boolean },
    ): Promise<{ ino: number; inode: InodeRecord; meta: MetaRecord }> {
        const err = validateFilename(name);
        if (err) throw new FSError('EINVAL', err, 'createFile', name);

        const { backend, localPath: parentLocalPath } = this.getMountedStore(parentPath);

        let parentIno: number;
        if (opts?.recursive) {
            parentIno = await this.ensureDirectoryPath(backend, parentLocalPath);
        } else {
            const parent = await this.resolver.resolve(
                { inodes: backend.inodes, meta: backend.meta },
                ROOT_INO,
                parentLocalPath,
            );
            parentIno = parent.ino;
        }

        const existing = await backend.inodes.lookup(parentIno, name);
        if (existing && !opts?.overwrite) {
            throw new FSAlreadyExistsError(P.join(parentPath, name), 'createFile');
        }

        let resultIno = 0;

        await backend.runInTransaction('readwrite', async (scope) => {
            if (existing && opts?.overwrite) {
                await deleteRecursive(scope, existing.ino);
            }

            const ino = await scope.inodes.allocateIno();
            const now = Date.now();
            const contentRef = String(ino);
            let size = 0;

            if (content !== undefined) {
                const buf = toBuffer(content);
                await scope.content.putData(contentRef, buf);
                size = buf.byteLength;
            }

            await scope.inodes.putInode({
                ino,
                parentIno,
                name,
                type,
                createdAt: now,
                nlink: 1,
            });

            await scope.meta.putMeta({
                ino,
                modifiedAt: now,
                size,
                version: 0,
                contentRef: content !== undefined ? contentRef : undefined,
                metadata: metadata as any,
            });

            resultIno = ino;
        });

        const inode = (await backend.inodes.getInode(resultIno))!;
        const meta = (await backend.meta.getMeta(resultIno))!;
        return { ino: resultIno, inode, meta };
    }

    async createDirectory(
        parentPath: string,
        name: string,
        metadata?: Record<string, unknown>,
        opts?: { recursive?: boolean },
    ): Promise<{ ino: number; inode: InodeRecord; meta: MetaRecord }> {
        const err = validateFilename(name);
        if (err) throw new FSError('EINVAL', err, 'createDirectory', name);

        const { backend, localPath: parentLocalPath } = this.getMountedStore(parentPath);

        let parentIno: number;
        if (opts?.recursive) {
            parentIno = await this.ensureDirectoryPath(backend, parentLocalPath);
        } else {
            const parent = await this.resolver.resolve(
                { inodes: backend.inodes, meta: backend.meta },
                ROOT_INO,
                parentLocalPath,
            );
            parentIno = parent.ino;
        }

        const existing = await backend.inodes.lookup(parentIno, name);
        if (existing) {
            if (existing.type === 'directory') {
                const meta = await backend.meta.getMeta(existing.ino);
                return { ino: existing.ino, inode: existing, meta: meta! };
            }
            throw new FSAlreadyExistsError(P.join(parentPath, name), 'createDirectory');
        }

        let resultIno = 0;

        await backend.runInTransaction('readwrite', async (scope) => {
            const ino = await scope.inodes.allocateIno();
            const now = Date.now();

            await scope.inodes.putInode({
                ino,
                parentIno,
                name,
                type: 'directory',
                createdAt: now,
                nlink: 1,
            });

            await scope.meta.putMeta({
                ino,
                modifiedAt: now,
                size: 0,
                version: 0,
                metadata: metadata as any,
            });

            resultIno = ino;
        });

        const inode = (await backend.inodes.getInode(resultIno))!;
        const meta = (await backend.meta.getMeta(resultIno))!;
        return { ino: resultIno, inode, meta };
    }

    async delete(path: string, opts?: DeleteOptions): Promise<number[]> {
        if (P.isRoot(path)) {
            throw new FSError('EINVAL', 'cannot delete root', 'delete', '/');
        }

        const { backend, localPath } = this.getMountedStore(path);
        const resolved = await this.resolver.resolve(
            { inodes: backend.inodes, meta: backend.meta },
            ROOT_INO,
            localPath,
        );
        const { ino, parentIno, name, inode } = resolved;

        if (inode.type === 'directory' && !opts?.recursive) {
            if (await backend.inodes.hasChildren(ino)) {
                throw new FSError('ENOTEMPTY', 'directory not empty', 'delete', path);
            }
        }

        const allDeleted: number[] = [];

        await backend.runInTransaction('readwrite', async (scope) => {
            const assetStrategy = opts?.assetDirStrategy ?? 'remove';
            if (assetStrategy === 'remove' && (inode.type === 'file' || inode.type === 'seqfile')) {
                const assetDirName = toAssetDirName(name);
                const assetEntry = await scope.inodes.lookup(parentIno, assetDirName);
                if (assetEntry) {
                    const assetDeleted = await deleteRecursive(scope, assetEntry.ino);
                    allDeleted.push(...assetDeleted);
                }
            }

            const deleted = await deleteRecursive(scope, ino);
            allDeleted.push(...deleted);
        });

        return allDeleted;
    }

    async rename(path: string, newName: string, opts?: RenameOptions): Promise<void> {
        const err = validateFilename(newName);
        if (err) throw new FSError('EINVAL', err, 'rename', newName);

        const { backend, localPath } = this.getMountedStore(path);
        const resolved = await this.resolver.resolve(
            { inodes: backend.inodes, meta: backend.meta },
            ROOT_INO,
            localPath,
        );
        const { ino, parentIno, name } = resolved;
        if (name === newName) return;

        await backend.runInTransaction('readwrite', async (scope) => {
            const conflict = await scope.inodes.lookup(parentIno, newName);
            if (conflict && conflict.ino !== ino) {
                throw new FSAlreadyExistsError(P.join(P.dirname(path), newName), 'rename');
            }

            await scope.inodes.updateInode(ino, { name: newName });
            await scope.meta.patchMeta(ino, { modifiedAt: Date.now() });

            if (opts?.syncAssetDir !== false) {
                const oldAssetName = toAssetDirName(name);
                const newAssetName = toAssetDirName(newName);
                const assetInode = await scope.inodes.lookup(parentIno, oldAssetName);
                if (assetInode) {
                    await scope.inodes.updateInode(assetInode.ino, { name: newAssetName });
                }
            }
        });
    }

    async move(path: string, targetParentPath: string, opts?: MoveOptions): Promise<void> {
        const src = this.getMountedStore(path);
        const dst = this.getMountedStore(targetParentPath);

        if (src.backend !== dst.backend) {
            throw new FSError('EXMOUNT', 'cross-mount move not supported', 'move', path);
        }

        const backend = src.backend;
        const resolved = await this.resolver.resolve(
            { inodes: backend.inodes, meta: backend.meta },
            ROOT_INO,
            src.localPath,
        );
        const targetParent = await this.resolver.resolve(
            { inodes: backend.inodes, meta: backend.meta },
            ROOT_INO,
            dst.localPath,
        );

        if (targetParent.inode.type !== 'directory') {
            throw new FSError('ENOTDIR', 'target is not a directory', 'move', targetParentPath);
        }

        await backend.runInTransaction('readwrite', async (scope) => {
            const conflict = await scope.inodes.lookup(targetParent.ino, resolved.name);
            if (conflict) {
                throw new FSAlreadyExistsError(P.join(targetParentPath, resolved.name), 'move');
            }

            await scope.inodes.updateInode(resolved.ino, { parentIno: targetParent.ino });
            await scope.meta.patchMeta(resolved.ino, { modifiedAt: Date.now() });

            if (opts?.syncAssetDir !== false && (resolved.inode.type === 'file' || resolved.inode.type === 'seqfile')) {
                const assetDirName = toAssetDirName(resolved.name);
                const assetInode = await scope.inodes.lookup(resolved.parentIno, assetDirName);
                if (assetInode) {
                    await scope.inodes.updateInode(assetInode.ino, { parentIno: targetParent.ino });
                }
            }
        });
    }

    async updateMetadata(path: string, metadata: Record<string, unknown>): Promise<void> {
        const { backend, localPath } = this.getMountedStore(path);
        const resolved = await this.resolver.resolve(
            { inodes: backend.inodes, meta: backend.meta },
            ROOT_INO,
            localPath,
        );
        await backend.runInTransaction('readwrite', async (scope) => {
            const current = await scope.meta.getMeta(resolved.ino);
            await scope.meta.patchMeta(resolved.ino, {
                metadata: { ...current?.metadata, ...metadata },
                modifiedAt: Date.now(),
            });
        });
    }

    async createSymlink(
        parentPath: string,
        name: string,
        target: string,
    ): Promise<{ ino: number; inode: InodeRecord; meta: MetaRecord }> {
        const err = validateFilename(name);
        if (err) throw new FSError('EINVAL', err, 'createSymlink', name);

        const { backend, localPath: parentLocalPath } = this.getMountedStore(parentPath);
        const parent = await this.resolver.resolve(
            { inodes: backend.inodes, meta: backend.meta },
            ROOT_INO,
            parentLocalPath,
        );
        let resultIno = 0;

        await backend.runInTransaction('readwrite', async (scope) => {
            const conflict = await scope.inodes.lookup(parent.ino, name);
            if (conflict) {
                throw new FSAlreadyExistsError(P.join(parentPath, name), 'symlink');
            }

            const ino = await scope.inodes.allocateIno();
            const now = Date.now();

            await scope.inodes.putInode({
                ino,
                parentIno: parent.ino,
                name,
                type: 'symlink',
                createdAt: now,
                nlink: 1,
            });

            await scope.meta.putMeta({
                ino,
                modifiedAt: now,
                size: 0,
                version: 0,
                symlinkTarget: target,
            });

            resultIno = ino;
        });

        const inode = (await backend.inodes.getInode(resultIno))!;
        const meta = (await backend.meta.getMeta(resultIno))!;
        return { ino: resultIno, inode, meta };
    }

    async readSymlink(path: string): Promise<string> {
        const { backend, localPath } = this.getMountedStore(path);
        const resolved = await this.resolver.resolve(
            { inodes: backend.inodes, meta: backend.meta },
            ROOT_INO,
            localPath,
            false,
        );
        if (resolved.inode.type !== 'symlink') {
            throw new FSError('EINVAL', 'not a symlink', 'readlink', path);
        }
        return resolved.meta?.symlinkTarget ?? '';
    }

    async createHardlink(
        parentPath: string,
        name: string,
        targetPath: string,
    ): Promise<{ ino: number; inode: InodeRecord; meta: MetaRecord }> {
        const err = validateFilename(name);
        if (err) throw new FSError('EINVAL', err, 'hardlink', name);

        const srcMount = this.getMountedStore(targetPath);
        const dstMount = this.getMountedStore(parentPath);
        if (srcMount.backend !== dstMount.backend) {
            throw new FSError('EXMOUNT', 'cross-mount hardlink not supported', 'hardlink', targetPath);
        }

        const backend = srcMount.backend;
        const target = await this.resolver.resolve(
            { inodes: backend.inodes, meta: backend.meta },
            ROOT_INO,
            srcMount.localPath,
        );
        if (target.inode.type === 'directory') {
            throw new FSError('EINVAL', 'cannot hardlink a directory', 'hardlink', targetPath);
        }

        const parent = await this.resolver.resolve(
            { inodes: backend.inodes, meta: backend.meta },
            ROOT_INO,
            dstMount.localPath,
        );

        await backend.runInTransaction('readwrite', async (scope) => {
            const conflict = await scope.inodes.lookup(parent.ino, name);
            if (conflict) {
                throw new FSAlreadyExistsError(P.join(parentPath, name), 'hardlink');
            }

            await scope.inodes.updateInode(target.ino, { nlink: target.inode.nlink + 1 });

            const ino = await scope.inodes.allocateIno();
            await scope.inodes.putInode({
                ino,
                parentIno: parent.ino,
                name,
                type: target.inode.type,
                createdAt: Date.now(),
                nlink: 1,
            });

            await scope.meta.putMeta({
                ino,
                modifiedAt: Date.now(),
                size: target.meta?.size ?? 0,
                version: 0,
                contentRef: target.meta?.contentRef,
                contentHash: target.meta?.contentHash,
                mimeType: target.meta?.mimeType,
                metadata: target.meta?.metadata ? { ...target.meta.metadata } : undefined,
                tags: target.meta?.tags ? [...target.meta.tags] : undefined,
                extra: { hardlinkSource: target.ino },
            });
        });

        const inode = (await backend.inodes.getInode(target.ino))!;
        const meta = (await backend.meta.getMeta(target.ino))!;
        return { ino: target.ino, inode, meta };
    }

    // ── AssetDir helpers ──

    async ensureAssetDir(filePath: string): Promise<number> {
        const { backend, localPath } = this.getMountedStore(filePath);
        const resolved = await this.resolver.resolve(
            { inodes: backend.inodes, meta: backend.meta },
            ROOT_INO,
            localPath,
        );
        if (resolved.inode.type !== 'file' && resolved.inode.type !== 'seqfile') {
            throw new FSError('EINVAL', 'only file and seqfile can have assetdir', 'assetdir', filePath);
        }

        const assetDirName = toAssetDirName(resolved.name);
        const existing = await backend.inodes.lookup(resolved.parentIno, assetDirName);
        if (existing) return existing.ino;

        let resultIno = 0;
        await backend.runInTransaction('readwrite', async (scope) => {
            const check = await scope.inodes.lookup(resolved.parentIno, assetDirName);
            if (check) { resultIno = check.ino; return; }

            const ino = await scope.inodes.allocateIno();
            const now = Date.now();

            await scope.inodes.putInode({
                ino,
                parentIno: resolved.parentIno,
                name: assetDirName,
                type: 'directory',
                createdAt: now,
                nlink: 1,
            });

            await scope.meta.putMeta({
                ino,
                modifiedAt: now,
                size: 0,
                version: 0,
                isAssetDir: true,
                ownerFileIno: resolved.ino,
            });

            await scope.meta.patchMeta(resolved.ino, { assetDirIno: ino });

            resultIno = ino;
        });

        return resultIno;
    }

    async getAssetDirIno(filePath: string): Promise<number | null> {
        const { backend, localPath } = this.getMountedStore(filePath);
        const resolved = await this.resolver.resolve(
            { inodes: backend.inodes, meta: backend.meta },
            ROOT_INO,
            localPath,
        );
        const assetDirName = toAssetDirName(resolved.name);
        const entry = await backend.inodes.lookup(resolved.parentIno, assetDirName);
        return entry?.ino ?? null;
    }

    // ── Internal helpers ──

    async listChildren(path: string): Promise<InodeRecord[]> {
        const { backend, localPath } = this.getMountedStore(path);
        const resolved = await this.resolver.resolve(
            { inodes: backend.inodes, meta: backend.meta },
            ROOT_INO,
            localPath,
        );
        if (resolved.inode.type !== 'directory') {
            throw new FSError('ENOTDIR', 'not a directory', 'list', path);
        }
        const children: InodeRecord[] = [];
        await backend.inodes.walkTree(resolved.ino, (inode) => {
            children.push(inode);
            return 'skip';
        }, { maxDepth: 0 });
        return children;
    }

    private async ensureDirectoryPath(backend: IStorageBackend, localPath: string): Promise<number> {
        const segs = P.segments(P.normalize(localPath));
        let currentIno = ROOT_INO;

        for (const seg of segs) {
            const existing = await backend.inodes.lookup(currentIno, seg);
            if (existing) {
                if (existing.type !== 'directory') {
                    throw new FSError('ENOTDIR', `${seg} is not a directory`, 'ensurePath');
                }
                currentIno = existing.ino;
            } else {
                const ino = await backend.inodes.allocateIno();
                await backend.inodes.putInode({
                    ino,
                    parentIno: currentIno,
                    name: seg,
                    type: 'directory',
                    createdAt: Date.now(),
                    nlink: 1,
                });
                await backend.meta.putMeta({
                    ino,
                    modifiedAt: Date.now(),
                    size: 0,
                    version: 0,
                });
                currentIno = ino;
            }
        }

        return currentIno;
    }
}
