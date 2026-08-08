/**
 * @file packages/vfslib/src/engine/vfs-engine.ts
 * @desc VFS 引擎 — 系统级核心操作（v4.1: path-based 后端）
 *
 * 职责：
 * - 管理根后端 + 挂载路由
 * - Bootstrap 基础目录结构 (/etc, /dev, /module)
 * - 系统级路径操作
 * - 持有 plugin pipeline、device registry、event bus、access controller
 *
 * v4.1 变更：
 * - 废弃 IInodeStore/IMetaStore/IContentStore 三层分离
 * - 所有存储操作通过 path-based IStorageBackend 接口
 * - 删除 PathResolver、node-mapper、ROOT_INO、contentRef 中间层
 */

import type {
    IStorageBackend,
    FSNode,
    FileContent,
    WriteOptions,
    DeleteOptions,
    IMountRouter,
} from '../protocol';

import { FSError, FSAlreadyExistsError, FSCapabilityError, SYSTEM_DIRS } from '../protocol';

import { AccessController } from './access-controller';
import { FSEventBus } from '../event/event-bus';
import { PluginPipeline } from './plugin-pipeline';
import { DeviceRegistry } from './device-registry';
import { toBuffer, toString } from '../utils/encoding';
import * as P from '../utils/path';
import { toAssetDirName, validateFilename } from '../utils/validation';

const IO_OPERATIONS = [
    'stat', 'list', 'read', 'write', 'mkdir',
    'delete', 'rename', 'metadata', 'search',
] as const;

type IOOperation = typeof IO_OPERATIONS[number];

export class VFSEngine {
    readonly access: AccessController;
    readonly events: FSEventBus;
    readonly plugins: PluginPipeline;
    readonly devices: DeviceRegistry;

    /** Counts of backend operations for performance diagnostics. */
    readonly ioStats: Record<IOOperation, number> = {
        stat: 0, list: 0, read: 0, write: 0, mkdir: 0,
        delete: 0, rename: 0, metadata: 0, search: 0,
    };
    resetIOStats(): void {
        IO_OPERATIONS.forEach(operation => { this.ioStats[operation] = 0; });
    }

    private readonly backend: IStorageBackend;
    private _mountRouter: IMountRouter | null = null;
    private initialized = false;

    private _inc(op: IOOperation): void { this.ioStats[op]++; }

    constructor(
        backend: IStorageBackend,
    ) {
        this.backend = backend;
        this.access = new AccessController();
        this.events = new FSEventBus();
        this.plugins = new PluginPipeline();
        this.devices = new DeviceRegistry();
    }

    get store(): IStorageBackend { return this.backend; }
    getBackend(): IStorageBackend { return this.backend; }

    setMountRouter(router: IMountRouter): void { this._mountRouter = router; }

    getBackendForPath(systemPath: string): IStorageBackend {
        if (!this._mountRouter) return this.backend;
        return this._mountRouter.resolve(systemPath).mount.backend;
    }

    getMountPathForPath(systemPath: string): string {
        if (!this._mountRouter) return '/';
        return this._mountRouter.resolve(systemPath).mount.mountPath;
    }

    /** Resolve backend + local path + mount path for a system path. */
    private resolveStore(systemPath: string): { backend: IStorageBackend; localPath: string; mountPath: string } {
        if (!this._mountRouter) return { backend: this.backend, localPath: systemPath, mountPath: '/' };
        const { mount, relativePath } = this._mountRouter.resolve(systemPath);
        if (mount.backend === this.backend) return { backend: this.backend, localPath: systemPath, mountPath: '/' };
        return { backend: mount.backend, localPath: relativePath ? '/' + relativePath : '/', mountPath: mount.mountPath };
    }

    /** Map a backend-local node to a system-path node. */
    private mapToSystemNode(node: FSNode, mountPath: string): FSNode {
        if (mountPath === '/') return node;
        const mapPath = (p: string | null) => p ? this.mapToSystemPath(p, mountPath) : null;
        return { ...node, path: mapPath(node.path)!, parentPath: mapPath(node.parentPath) };
    }

    private mapToSystemPath(path: string, mountPath: string): string {
        if (mountPath === '/') return path;
        return path === '/' ? mountPath : mountPath + path;
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
        this.events.clear();
        await this.backend.close();
        this.initialized = false;
    }

    private async bootstrap(): Promise<void> {
        // Ensure root and system directories exist
        this._inc('stat');
        if (!(await this.backend.stat('/'))) {
            this._inc('mkdir'); await this.backend.mkdir('/');
        }
        for (const dirName of SYSTEM_DIRS) {
            this._inc('stat');
            if (!(await this.backend.stat(`/${dirName}`))) {
                this._inc('mkdir'); await this.backend.mkdir(`/${dirName}`);
            }
        }
        // Ensure default system subdirectories exist (idempotent — only creates if missing)
        await this.initDefaultConfig();
    }

    /**
     * Ensure default system subdirectories under /etc exist.
     * Idempotent — does not overwrite existing files or directories.
     * Actual config file initialization is handled by the app layer via
     * ConfigService / ISystemAccess on first write.
     */
    private async initDefaultConfig(): Promise<void> {
        const etcSubdirs = ['/etc/llm'];
        for (const dir of etcSubdirs) {
            await this.ensureDirectoryPath(dir);
        }
    }

    // ── Path Resolution ──

    /** Stat a path (throws if not found) */
    async stat(path: string): Promise<import('../protocol').FSNode> {
        const { backend, localPath, mountPath } = this.resolveStore(path);
        this._inc('stat'); const node = await backend.stat(localPath === '/' ? '/' : localPath);
        if (!node) throw new FSError('ENOENT', 'not found', 'stat', path);
        return this.mapToSystemNode(node, mountPath);
    }

    /** Stat that returns null on not found */
    async tryStat(path: string): Promise<import('../protocol').FSNode | null> {
        const { backend, localPath } = this.resolveStore(path);
        return backend.stat(localPath === '/' ? '/' : localPath);
    }

    // ── Module Directory Management ──

    async ensureModuleDir(moduleName: string): Promise<void> {
        const path = `/module/${moduleName}`;
        const { backend, localPath } = this.resolveStore(path);
        this._inc('stat'); const existing = await backend.stat(localPath);
        if (existing) return;
        this._inc('mkdir'); await backend.mkdir(localPath);
    }

    async removeModuleDir(moduleName: string): Promise<void> {
        const path = `/module/${moduleName}`;
        const { backend, localPath } = this.resolveStore(path);
        this._inc('stat'); const existing = await backend.stat(localPath);
        if (!existing) return;
        this._inc('delete'); await backend.delete(localPath, { recursive: true });
    }

    // ── Read ──

    async readBySystemPath(systemPath: string): Promise<FileContent> {
        const { backend, localPath } = this.resolveStore(systemPath);
        try {
            this._inc('read'); const data = await backend.read(localPath);
            return toString(data.buffer as ArrayBuffer);
        } catch {
            return '';
        }
    }

    async readContent(path: string): Promise<ArrayBuffer> {
        const { backend, localPath } = this.resolveStore(path);
        this._inc('stat'); const node = await backend.stat(localPath);
        if (!node) throw new FSError('ENOENT', 'not found', 'read', path);
        if (node.type === 'directory') throw new FSError('EISDIR', 'cannot read directory', 'read', path);
        try {
            this._inc('read'); const data = await backend.read(localPath);
            return (data as Uint8Array).buffer as ArrayBuffer;
        } catch {
            return new ArrayBuffer(0);
        }
    }

    // ── Write ──

    async writeContent(
        path: string,
        content: FileContent,
        options?: WriteOptions,
    ): Promise<void> {
        const { backend, localPath } = this.resolveStore(path);
        const raw = toBuffer(content);
        let buf = raw instanceof Uint8Array ? raw : new Uint8Array(raw);

        if (options?.mode === 'append') {
            try {
                this._inc('read'); const existing = await backend.read(localPath);
                const merged = new Uint8Array(existing.byteLength + buf.byteLength);
                merged.set(new Uint8Array(existing), 0);
                merged.set(buf, existing.byteLength);
                buf = merged;
            } catch { /* file doesn't exist yet, just write */ }
        }

        this._inc('write'); await backend.write(localPath, buf);
    }

    // ── Create ──

    async createFile(
        parentPath: string,
        name: string,
        type: import('../protocol').FSNodeType = 'file',
        content?: FileContent,
        metadata?: Record<string, unknown>,
        opts?: { overwrite?: boolean; recursive?: boolean; deviceHandlerId?: string },
    ): Promise<import('../protocol').FSNode> {
        validateFilename(name);

        // Ensure intermediate directories when recursive is requested
        if (opts?.recursive) {
            await this.ensureDirectoryPath(parentPath);
        }

        const { backend, localPath: parentLocal, mountPath } = this.resolveStore(parentPath);
        const fullPath = parentLocal === '/' ? `/${name}` : `${parentLocal}/${name}`;

        if (!opts?.overwrite) {
            this._inc('stat'); const existing = await backend.stat(fullPath);
            if (existing) throw new FSAlreadyExistsError(name, parentPath);
        }

        if (type === 'directory') {
            this._inc('mkdir'); const node = await backend.mkdir(fullPath);
            if (metadata) { this._inc('metadata'); await backend.updateMetadata(fullPath, metadata); }
            return this.mapToSystemNode(node, mountPath);
        }

        const raw = content ? toBuffer(content) : new Uint8Array(0);
        const buf = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
        this._inc('write'); const node = await backend.write(fullPath, buf);
        if (metadata) { this._inc('metadata'); await backend.updateMetadata(fullPath, metadata); }
        return this.mapToSystemNode(node, mountPath);
    }

    async createDirectory(
        parentPath: string,
        name: string,
        metadata?: Record<string, unknown>,
    ): Promise<import('../protocol').FSNode> {
        return this.createFile(parentPath, name, 'directory', undefined, metadata);
    }

    // ── Delete ──

    async delete(path: string, options?: DeleteOptions): Promise<void> {
        const { backend, localPath } = this.resolveStore(path);
        this._inc('stat'); const node = await backend.stat(localPath);
        if (!node) {
            if (options?.force) return;
            throw new FSError('ENOENT', 'not found', 'delete', path);
        }
        this._inc('delete'); await backend.delete(localPath, { recursive: options?.recursive });

        // Cascade: delete companion asset dir
        if (node.type !== 'directory' && options?.assetDirStrategy !== 'keep') {
            const parentDir = P.dirname(localPath);
            const assetDirName = toAssetDirName(nameFromPath(localPath));
            try {
                this._inc('delete'); await backend.delete(`${parentDir}/${assetDirName}`, { recursive: true });
            } catch { /* asset dir may not exist */ }
        }
    }

    // ── Rename / Move ──

    async rename(path: string, newName: string): Promise<void> {
        validateFilename(newName);
        const { backend, localPath } = this.resolveStore(path);
        const dir = P.dirname(localPath);
        const newPath = dir === '/' ? `/${newName}` : `${dir}/${newName}`;

        this._inc('stat'); const existing = await backend.stat(newPath);
        if (existing) throw new FSAlreadyExistsError(newName, dir);

        this._inc('rename'); await backend.rename(localPath, newPath);

        // Rename companion asset dir
        const oldAssetName = toAssetDirName(nameFromPath(localPath));
        const newAssetName = toAssetDirName(newName);
        try {
            this._inc('rename'); await backend.rename(`${dir}/${oldAssetName}`, `${dir}/${newAssetName}`);
        } catch { /* no asset dir */ }
    }

    async move(sourcePath: string, targetParentPath: string): Promise<void> {
        const { backend: srcBackend, localPath: srcLocal } = this.resolveStore(sourcePath);
        const { backend: dstBackend, localPath: dstLocal } = this.resolveStore(targetParentPath);

        if (srcBackend !== dstBackend) {
            throw new FSError('EXMOUNT', 'cross-mount move not supported by engine; use copy+delete', 'move', sourcePath);
        }

        const name = nameFromPath(srcLocal);
        const newPath = dstLocal === '/' ? `/${name}` : `${dstLocal}/${name}`;

        await srcBackend.rename(srcLocal, newPath);

        // Move companion asset dir
        const srcDir = P.dirname(srcLocal);
        const assetDirName = toAssetDirName(name);
        try {
            await srcBackend.rename(`${srcDir}/${assetDirName}`, `${dstLocal}/${assetDirName}`);
        } catch { /* no asset dir */ }
    }

    // ── List ──

    async listChildren(path: string): Promise<import('../protocol').FSNode[]> {
        const { backend, localPath, mountPath } = this.resolveStore(path);
        this._inc('list'); const nodes = await backend.list(localPath === '/' ? '/' : localPath);
        return nodes.map(n => this.mapToSystemNode(n, mountPath));
    }

    // ── Metadata ──

    async updateMetadata(path: string, metadata: Record<string, unknown>): Promise<void> {
        const { backend, localPath } = this.resolveStore(path);
        this._inc('metadata'); await backend.updateMetadata(localPath, metadata);
    }

    // ── Symlink ──

    async createSymlink(parentPath: string, name: string, target: string): Promise<import('../protocol').FSNode> {
        const { backend, localPath: parentLocal, mountPath } = this.resolveStore(parentPath);
        const fullPath = parentLocal === '/' ? `/${name}` : `${parentLocal}/${name}`;
        if (!backend.symlink) throw new FSCapabilityError('symlinks', 'engine');
        await backend.symlink(fullPath, target);
        this._inc('stat'); const node = await backend.stat(fullPath);
        if (!node) throw new FSError('EIO', 'symlink created but not found', 'symlink', fullPath);
        return this.mapToSystemNode(node, mountPath);
    }

    async readSymlink(path: string): Promise<string> {
        const { backend, localPath } = this.resolveStore(path);
        if (!backend.readlink) throw new FSCapabilityError('symlinks', 'engine');
        return backend.readlink(localPath);
    }

    // ── Asset Dir ──

    async getAssetDirPath(filePath: string): Promise<string | null> {
        const { backend, localPath, mountPath } = this.resolveStore(filePath);
        const parentDir = P.dirname(localPath);
        const name = nameFromPath(localPath);
        const assetDirName = toAssetDirName(name);
        const assetPath = parentDir === '/' ? `/${assetDirName}` : `${parentDir}/${assetDirName}`;
        this._inc('stat'); const exists = await backend.stat(assetPath);
        return exists ? this.mapToSystemPath(assetPath, mountPath) : null;
    }

    async ensureAssetDir(filePath: string): Promise<string> {
        const { backend, localPath, mountPath } = this.resolveStore(filePath);
        const parentDir = P.dirname(localPath);
        const name = nameFromPath(localPath);
        const assetDirName = toAssetDirName(name);
        const assetPath = parentDir === '/' ? `/${assetDirName}` : `${parentDir}/${assetDirName}`;

        this._inc('stat'); const existing = await backend.stat(assetPath);
        if (existing) return this.mapToSystemPath(assetPath, mountPath);

        this._inc('mkdir'); await backend.mkdir(assetPath);
        return this.mapToSystemPath(assetPath, mountPath);
    }

    // ── Search ──

    async search(path: string, query: import('../protocol').FSSearchQuery): Promise<import('../protocol').FSNode[]> {
        const { backend, localPath, mountPath } = this.resolveStore(path);
        const unpagedQuery = { ...query, offset: 0, limit: Number.MAX_SAFE_INTEGER };
        let nodes: import('../protocol').FSNode[];
        if (backend.search) {
            nodes = await backend.search(unpagedQuery);
        } else {
            nodes = [];
            await this._walkAndCollect(backend, '/', unpagedQuery, nodes);
        }
        const scoped = nodes.filter(node => isPathInScope(node.path, localPath));
        const offset = query.offset ?? 0;
        const limit = query.limit ?? 50;
        return scoped
            .slice(offset, offset + limit)
            .map(node => this.mapToSystemNode(node, mountPath));
    }

    private async _walkAndCollect(
        backend: IStorageBackend,
        dirPath: string,
        query: import('../protocol').FSSearchQuery,
        results: import('../protocol').FSNode[],
    ): Promise<void> {
        if (query.limit && results.length >= query.limit) return;
        try {
            this._inc('list'); const children = await backend.list(dirPath);
            for (const child of children) {
                if (query.limit && results.length >= query.limit) break;
                if (matchSearch(child, query)) results.push(child);
                if (child.type === 'directory') {
                    await this._walkAndCollect(backend, child.path, query, results);
                }
            }
        } catch { /* skip */ }
    }

    // ── System /etc Operations ──

    /**
     * 以系统身份写入任意路径（绕过 AccessController）。
     * 由 ISystemAccess 实现调用，调用方负责传入已拼接的完整路径。
     */
    async writeEtcFile(path: string, content: string): Promise<void> {
        const { backend, localPath } = this.resolveStore(path);
        this._inc('write');
        const buf = new TextEncoder().encode(content);
        await backend.write(localPath, buf);
    }

    /**
     * 以系统身份读取任意路径（绕过 AccessController）。
     */
    async readEtcFile(path: string): Promise<string> {
        const { backend, localPath } = this.resolveStore(path);
        try {
            this._inc('read');
            const data = await backend.read(localPath);
            return toString(data.buffer as ArrayBuffer);
        } catch {
            return '';
        }
    }

    /**
     * 列出任意目录下的条目名称。
     */
    async listEtcDir(path: string): Promise<string[]> {
        const { backend, localPath } = this.resolveStore(path);
        this._inc('list');
        const children = await backend.list(localPath);
        return children.map(c => c.name);
    }

    // ── Ensure Directory Path (recursive mkdir) ──

    async ensureDirectoryPath(systemPath: string): Promise<void> {
        const { backend } = this.resolveStore(systemPath);
        const parts = systemPath.split('/').filter(Boolean);
        let current = '';
        for (const seg of parts) {
            current += '/' + seg;
            this._inc('stat'); const exists = await backend.stat(current);
            if (!exists) {
                this._inc('mkdir'); await backend.mkdir(current);
            }
        }
    }

    // ── Walk Tree ──

    async walkTree(
        rootPath: string,
        callback: (node: import('../protocol').FSNode, depth: number) => boolean | void | 'skip' | Promise<boolean | void | 'skip'>,
        options?: { maxDepth?: number; includeHidden?: boolean; includeAssetDirs?: boolean },
    ): Promise<number> {
        const { backend, localPath } = this.resolveStore(rootPath);
        return this._walkDFS(backend, localPath, callback, 0, options?.maxDepth ?? -1, options);
    }

    private async _walkDFS(
        backend: IStorageBackend,
        path: string,
        callback: (node: import('../protocol').FSNode, depth: number) => boolean | void | 'skip' | Promise<boolean | void | 'skip'>,
        depth: number,
        maxDepth: number,
        options?: { includeHidden?: boolean; includeAssetDirs?: boolean },
    ): Promise<number> {
        let count = 0;
        this._inc('list'); const children = await backend.list(path === '/' ? '/' : path);
        for (const child of children) {
            if (!options?.includeHidden && child.name.startsWith('.')) continue;
            if (!options?.includeAssetDirs && child.name.startsWith('_')) continue;
            const result = await callback(child, depth);
            count++;
            if (result === false) return count;
            if (result !== 'skip' && child.type === 'directory' && (maxDepth < 0 || depth < maxDepth)) {
                count += await this._walkDFS(backend, child.path, callback, depth + 1, maxDepth, options);
            }
        }
        return count;
    }
}

// ── Helpers ──

function nameFromPath(path: string): string {
    if (path === '/' || path === '') return '';
    const parts = path.split('/').filter(Boolean);
    return parts[parts.length - 1] || '';
}

function isPathInScope(path: string, rootPath: string): boolean {
    if (rootPath === '/') return true;
    return path === rootPath || path.startsWith(`${rootPath}/`);
}

function matchSearch(node: import('../protocol').FSNode, query: import('../protocol').FSSearchQuery): boolean {
    if (query.type) {
        const types = Array.isArray(query.type) ? query.type : [query.type];
        if (!types.includes(node.type)) return false;
    }
    if (query.name?.contains && !node.name.toLowerCase().includes(query.name.contains.toLowerCase())) return false;
    if (query.tags?.all && !query.tags.all.every(t => node.tags.includes(t))) return false;
    if (query.tags?.any && !query.tags.any.some(t => node.tags.includes(t))) return false;
    return true;
}
