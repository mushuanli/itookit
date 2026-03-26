/**
 * @file packages/vfslib/src/services/vfs-manager.ts
 * @desc IVFSManager 实现
 *
 * 顶层协调器。模块开发者不直接使用此类，
 * 通过 getEngine() 获取 IModuleFS。
 */

import type {
    IVFSManager,
    IModuleFS,
    FSNode,
    FSSearchResult,
    FileContent,
    FSModuleStats,
    ModuleInfo,
    ModuleMountOptions,
    VFSManagerEventType,
    VFSManagerEvent,
    VFSManagerEventPayloadMap,
    VFSSearchQuery,
    VFSSystemStats,
    GlobalTagInfo,
    ModuleExportData,
    IMountService,
    IMaintenanceService,
    IStorageBackend,
    IPluginManager,
    IDeviceManager,
    IMountRouter,
    MountPoint,
    MountOptions,
    ISyncService,
} from '@itookit/common';

import {
    FSModuleNotFoundError,
    FSAlreadyExistsError,
    FSError,
    CONFIG_MODULE,
    type IDeviceDriver,
} from '@itookit/common';

import { VFSEngine } from '../engine/vfs-engine';
import { ModuleFS, type ModuleFSDeps } from './module-fs';
import { EventBus } from '../event/event-bus';
import { encodeId } from './id-mapper';
import * as P from '../utils/path';

export class VFSManager implements IVFSManager {
    private readonly engine: VFSEngine;
    private readonly modules = new Map<string, ModuleInfo>();
    private readonly engines = new Map<string, IModuleFS>();
    private readonly managerBus = new EventBus();

    readonly mounts: IMountService;
    readonly devices: IDeviceManager;
    readonly plugins: IPluginManager;
    readonly maintenance: IMaintenanceService;
    readonly sync: ISyncService | null = null;

    private initialized = false;

    constructor(engine: VFSEngine) {
        this.engine = engine;
        this.devices = engine.devices;
        this.plugins = engine.plugins;
        this.mounts = new MountService(engine);
        this.maintenance = new MaintenanceService(this);
    }

    // ══════════════════════════════════════════════════════════
    // Lifecycle
    // ══════════════════════════════════════════════════════════

    async initialize(): Promise<void> {
        if (this.initialized) return;
        await this.engine.initialize();
        // __config 是系统级配置模块，isSystem: true 使其 engine 可写 dot-prefix 路径
        await this.mount(CONFIG_MODULE, { isSystem: true, description: 'System configuration' });
        this.initialized = true;
    }

    async dispose(): Promise<void> {
        if (!this.initialized) return;

        for (const eng of this.engines.values()) {
            await eng.dispose?.();
        }
        this.engines.clear();
        this.modules.clear();
        this.managerBus.removeAllListeners();
        await this.engine.dispose();
        this.initialized = false;
    }

    /**
     * 注册设备驱动并在 /dev/<handlerId> 创建对应的设备文件节点（幂等）。
     *
     * 等同于 `devices.register(driver)` + 在 VFS 文件树中创建 FSDeviceNode，
     * 之后可通过路径访问：`engine.openDevice('/dev/llm', opts)`。
     */
    async registerDevice(driver: IDeviceDriver): Promise<void> {
        this.devices.register(driver);

        try {
            await this.engine.createFile(
                '/dev',
                driver.handlerId,
                'device',
                undefined,
                { deviceHandlerId: driver.handlerId },
            );
        } catch (e) {
            // 幂等：文件已存在时忽略
            if (!(e instanceof FSAlreadyExistsError)) throw e;
        }
    }

    async ensureSystemDirectory(path: string): Promise<void> {
        const lastSlash = path.lastIndexOf('/');
        const parentPath = path.slice(0, lastSlash) || '/';
        const name = path.slice(lastSlash + 1);
        try {
            await this.engine.createFile(parentPath, name, 'directory', undefined, undefined, { recursive: true });
        } catch (e) {
            if (!(e instanceof FSAlreadyExistsError)) throw e;
        }
    }

    async createDeviceNode(
        handlerId: string,
        devPath: string,
        nodeMetadata?: Record<string, unknown>,
    ): Promise<void> {
        const lastSlash = devPath.lastIndexOf('/');
        const parentPath = devPath.slice(0, lastSlash) || '/';
        const name = devPath.slice(lastSlash + 1);
        try {
            await this.engine.createFile(
                parentPath,
                name,
                'device',
                undefined,
                { deviceHandlerId: handlerId, metadata: nodeMetadata },
                { recursive: true },
            );
        } catch (e) {
            // 幂等：文件已存在时忽略
            if (!(e instanceof FSAlreadyExistsError)) throw e;
        }
    }

    async removeDeviceNode(devPath: string): Promise<void> {
        try {
            await this.engine.delete(devPath);
        } catch {
            // Node doesn't exist — ignore silently
        }
    }

    // ══════════════════════════════════════════════════════════
    // Module Management
    // ══════════════════════════════════════════════════════════

    async mount(moduleName: string, options?: ModuleMountOptions): Promise<void> {
        if (this.modules.has(moduleName)) return;

        const rootIno = await this.engine.ensureModuleDir(moduleName);
        this.modules.set(moduleName, {
            name: moduleName,
            description: options?.description,
            rootNodeId: encodeId('mount_0', rootIno),
            isProtected: options?.isProtected,
            syncEnabled: options?.syncEnabled,
            isSystem: options?.isSystem,
        });

        this.emitManager('module:mounted', { moduleName });
    }

    async mountAll(
        modules: Array<{ name: string; options?: ModuleMountOptions }>,
    ): Promise<void> {
        for (const m of modules) {
            await this.mount(m.name, m.options);
        }
    }

    async unmount(moduleName: string, removeData?: boolean): Promise<void> {
        if (moduleName === CONFIG_MODULE) {
            throw new FSError('EINVAL', 'cannot unmount __config', 'unmount');
        }

        const eng = this.engines.get(moduleName);
        if (eng) {
            await eng.dispose?.();
            this.engines.delete(moduleName);
        }

        if (removeData) {
            await this.engine.removeModuleDir(moduleName);
        }

        this.modules.delete(moduleName);
        this.emitManager('module:unmounted', { moduleName });
    }

    getModule(moduleName: string): ModuleInfo | null {
        return this.modules.get(moduleName) ?? null;
    }

    getAllModules(): ModuleInfo[] {
        return Array.from(this.modules.values());
    }

    // ══════════════════════════════════════════════════════════
    // Engine Management
    // ══════════════════════════════════════════════════════════

    getEngine(moduleName: string): IModuleFS {
        const cached = this.engines.get(moduleName);
        if (cached) return cached;

        if (!this.modules.has(moduleName)) {
            throw new FSModuleNotFoundError(moduleName);
        }

        const moduleInfo = this.modules.get(moduleName)!;
        const deps: ModuleFSDeps = {
            moduleId: moduleName,
            engine: this.engine,
            eventBus: this.engine.events,
            plugins: this.engine.plugins,
            access: this.engine.access,
            devices: this.engine.devices,
            mountId: 'mount_0',
            isSystem: moduleInfo.isSystem,
        };
        const fs = new ModuleFS(deps);
        fs.init().catch(() => {}); // lazy init
        this.engines.set(moduleName, fs);
        return fs;
    }

    registerEngine(moduleName: string, engine: IModuleFS): void {
        if (this.engines.has(moduleName)) {
            throw new FSError('EEXIST', `engine already registered: ${moduleName}`, 'registerEngine');
        }
        this.engines.set(moduleName, engine);
        if (!this.modules.has(moduleName)) {
            this.modules.set(moduleName, { name: moduleName });
        }
    }

    // ══════════════════════════════════════════════════════════
    // Cross-Module Convenience
    // ══════════════════════════════════════════════════════════

    async read(moduleName: string, path: string): Promise<FileContent> {
        return this.getEngine(moduleName).readContent(path);
    }

    async write(moduleName: string, path: string, content: FileContent): Promise<void> {
        const eng = this.getEngine(moduleName);
        if (await eng.exists(path)) {
            await eng.writeContent(path, content);
        } else {
            const dir = P.dirname(path);
            const name = P.basename(path);
            await eng.createFile({
                name,
                parentIdOrPath: dir === '/' ? null : dir,
                content: content as string | ArrayBuffer,
                recursive: true,
            });
        }
    }

    async exists(moduleName: string, path: string): Promise<boolean> {
        return this.getEngine(moduleName).exists(path);
    }

    // ══════════════════════════════════════════════════════════
    // Cross-Module Search
    // ══════════════════════════════════════════════════════════

    async search(query: VFSSearchQuery): Promise<FSSearchResult> {
        const targetModules = query.modules ?? Array.from(this.modules.keys());
        const allResults: FSNode[] = [];

        for (const mod of targetModules) {
            if (!this.modules.has(mod)) continue;
            try {
                const result = await this.getEngine(mod).search(query);
                for (const node of result.nodes) {
                    allResults.push({ ...node, moduleId: mod } as FSNode);
                }
            } catch {
                // skip failing modules
            }
        }

        const limit = query.limit ?? 50;
        const offset = query.offset ?? 0;
        const paged = allResults.slice(offset, offset + limit);

        return {
            nodes: paged,
            total: allResults.length,
            hasMore: allResults.length > offset + limit,
        };
    }

    async getNodeById(nodeId: string): Promise<(FSNode & { moduleName: string }) | null> {
        for (const modName of this.modules.keys()) {
            try {
                const node = await this.getEngine(modName).getNode(nodeId);
                if (node) return { ...node, moduleName: modName } as FSNode & { moduleName: string };
            } catch {
                continue;
            }
        }
        return null;
    }

    // ══════════════════════════════════════════════════════════
    // Global Tags
    // ══════════════════════════════════════════════════════════

    async getAllTags(): Promise<GlobalTagInfo[]> {
        const tagMap = new Map<string, GlobalTagInfo>();
        for (const modName of this.modules.keys()) {
            try {
                const eng = this.getEngine(modName);
                if (eng.tags) {
                    const tags = await eng.tags.getAllTags();
                    for (const t of tags) {
                        const existing = tagMap.get(t.name);
                        tagMap.set(t.name, {
                            name: t.name,
                            color: existing?.color ?? t.color,
                            refCount: (existing?.refCount ?? 0) + 1,
                        });
                    }
                }
            } catch {
                continue;
            }
        }
        return Array.from(tagMap.values());
    }

    async updateTagDefinition(tagName:string, updates: { color?: string }): Promise<void> {
        const eng = this.getEngine(CONFIG_MODULE);
        if (eng.tags?.updateTagDefinition) {
            await eng.tags.updateTagDefinition(tagName, updates);
        }
    }

    async findByTag(tagName: string): Promise<string[]> {
        const results: string[] = [];
        for (const modName of this.modules.keys()) {
            try {
                const eng = this.getEngine(modName);
                if (eng.tags) {
                    const ids = await eng.tags.findByTag(tagName);
                    results.push(...ids);
                }
            } catch {
                continue;
            }
        }
        return results;
    }

    // ══════════════════════════════════════════════════════════
    // System-Level Read
    // ══════════════════════════════════════════════════════════

    async readBySystemPath(systemPath: string): Promise<FileContent> {
        return this.engine.readBySystemPath(systemPath);
    }

    // ══════════════════════════════════════════════════════════
    // Events
    // ══════════════════════════════════════════════════════════

    on<E extends VFSManagerEventType>(
        eventType: E,
        handler: (event: VFSManagerEvent<E>) => void,
    ): () => void {
        return this.managerBus.on(eventType as any, handler as any);
    }

    onAny(
        handler: (type: string, event: VFSManagerEvent) => void,
    ): () => void {
        return this.managerBus.onAny((event) => {
            handler(event.type, event as any);
        });
    }

    // ══════════════════════════════════════════════════════════
    // Internal: access for MaintenanceService
    // ══════════════════════════════════════════════════════════

    /** @internal */
    get _engine(): VFSEngine {
        return this.engine;
    }

    /** @internal */
    get _modules(): Map<string, ModuleInfo> {
        return this.modules;
    }

    private emitManager<E extends VFSManagerEventType>(
        type: E,
        payload: E extends keyof VFSManagerEventPayloadMap ? VFSManagerEventPayloadMap[E] : unknown,
    ): void {
        this.managerBus.emit(type as any, payload as any);
    }
}

// ═══════════════════════════════════════════════════════════════
// MountService
// ═══════════════════════════════════════════════════════════════

class MountService implements IMountService {
    readonly router: IMountRouter;

    constructor(engine: VFSEngine) {
        this.router = new InlineMountRouter(engine);
    }

    async mountBackend(
        mountPath: string,
        backend: IStorageBackend,
        options?: MountOptions,
    ): Promise<MountPoint> {
        return this.router.mount(mountPath, backend, options);
    }

    async unmountBackend(mountPath: string, force?: boolean): Promise<void> {
        await this.router.unmount(mountPath, force);
    }

    listMounts(): MountPoint[] {
        return this.router.listMounts();
    }

    getMountForPath(absolutePath: string): MountPoint {
        return this.router.resolve(absolutePath).mount;
    }
}

// ═══════════════════════════════════════════════════════════════
// Inline Mount Router (single-backend default)
// ═══════════════════════════════════════════════════════════════

class InlineMountRouter implements IMountRouter {
    private readonly mounts = new Map<string, MountPoint>();
    private nextId = 1;

    constructor(engine: VFSEngine) {
        const backend = engine.getBackend();
        this.mounts.set('/', {
            mountId: 'mount_0',
            mountPath: '/',
            backend,
            options: { label: 'Root' },
            mountedAt: Date.now(),
            capabilities: {
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
                mount: true,
            },
        });
    }

    async mount(
        mountPath: string,
        backend: IStorageBackend,
        options?: MountOptions,
    ): Promise<MountPoint> {
        const norm = P.normalize(mountPath);
        if (this.mounts.has(norm)) {
            throw new FSError('EEXIST', `mount already exists: ${norm}`, 'mount', norm);
        }

        await backend.init();
        const mp: MountPoint = {
            mountId: `mount_${this.nextId++}`,
            mountPath: norm,
            backend,
            options: options ?? {},
            mountedAt: Date.now(),
            capabilities: {
                readonly: options?.readonly ?? false,
                search: true,
                semanticSearch: false,
                syncable: options?.syncable ?? false,
                assets: true,
                tags: true,
                transaction: true,
                deviceFiles: false,
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
            },
        };
        this.mounts.set(norm, mp);
        return mp;
    }

    async unmount(mountPath: string, _force?: boolean): Promise<void> {
        const norm = P.normalize(mountPath);
        if (norm === '/') {
            throw new FSError('EINVAL', 'cannot unmount root', 'unmount', '/');
        }
        const mp = this.mounts.get(norm);
        if (!mp) {
            throw new FSError('ENOENT', `mount not found: ${norm}`, 'unmount', norm);
        }
        await mp.backend.close();
        this.mounts.delete(norm);
    }

    resolve(absolutePath: string): import('@itookit/common').ResolvedMount {
        const norm = P.normalize(absolutePath);
        let bestMatch: MountPoint | null = null;
        let bestLen = 0;

        for (const [path, mp] of this.mounts) {
            if (P.isUnder(norm, path) && path.length > bestLen) {
                bestMatch = mp;
                bestLen = path.length;
            }
        }

        if (!bestMatch) bestMatch = this.mounts.get('/')!;

        const relativePath = bestLen <= 1
            ? norm.slice(1)
            : P.relative(bestMatch.mountPath, norm);

        return { mount: bestMatch, relativePath };
    }

    isCrossMount(srcPath: string, destPath: string): boolean {
        return this.resolve(srcPath).mount.mountId !== this.resolve(destPath).mount.mountId;
    }

    listMounts(): MountPoint[] {
        return Array.from(this.mounts.values());
    }

    getMount(mountId: string): MountPoint | null {
        for (const mp of this.mounts.values()) {
            if (mp.mountId === mountId) return mp;
        }
        return null;
    }

    getMountByPath(mountPath: string): MountPoint | null {
        return this.mounts.get(P.normalize(mountPath)) ?? null;
    }
}

// ═══════════════════════════════════════════════════════════════
// Inline Maintenance Service
// ═══════════════════════════════════════════════════════════════

class MaintenanceService implements IMaintenanceService {
    constructor(private readonly manager: VFSManager) {}

    async getSystemStats(): Promise<VFSSystemStats> {
        const moduleStats: Record<string, FSModuleStats> = {};
        let totalFiles = 0;
        let totalSize = 0;

        for (const modName of this.manager._modules.keys()) {
            try {
                const eng = this.manager.getEngine(modName);
                const stats = await eng.getStats?.();
                if (stats) {
                    moduleStats[modName] = stats;
                    totalFiles += stats.fileCount;
                    totalSize += stats.totalSize;
                }
            } catch {
                continue;
            }
        }

        return {
            moduleCount: this.manager._modules.size,
            modules: moduleStats,
            totalFiles,
            totalSize,
            mountCount: this.manager.mounts.listMounts().length,
            deviceCount: this.manager.devices.list().length,
            pluginCount: this.manager.plugins.list().length,
            storageBackend: this.manager._engine.getBackend().name,
        };
    }

    async gc(): Promise<{ cleaned: number; freedBytes: number }> {
        // Stub — a full implementation would scan orphaned content refs
        return { cleaned: 0, freedBytes: 0 };
    }

    async fsck(): Promise<{
        ok: boolean;
        errors: Array<{ path: string; issue: string; severity: 'warning' | 'error' }>;
    }> {
        const errors: Array<{ path: string; issue: string; severity: 'warning' | 'error' }> = [];

        for (const modName of this.manager._modules.keys()) {
            try {
                const eng = this.manager.getEngine(modName);
                await eng.walkTree?.((node) => {
                    if (node.type === 'symlink' && !(node as any).symlinkTarget) {
                        errors.push({
                            path: node.path,
                            issue: 'symlink has no target',
                            severity: 'error',
                        });
                    }
                }, { includeHidden: true });
            } catch (e) {
                errors.push({
                    path: `/module/${modName}`,
                    issue: `scan failed: ${e}`,
                    severity: 'error',
                });
            }
        }

        return { ok: errors.length === 0, errors };
    }

    async createBackup(): Promise<string> {
        const backup: Record<string, any> = {
            version: 1,
            createdAt: Date.now(),
            modules: {} as Record<string, ModuleExportData>,
        };

        for (const modName of this.manager._modules.keys()) {
            backup.modules[modName] = await this.exportModule(modName);
        }

        return JSON.stringify(backup);
    }

    async restoreBackup(jsonContent: string): Promise<void> {
        const backup = JSON.parse(jsonContent);
        if (backup.version !== 1) {
            throw new FSError('EINVAL', `unsupported backup version: ${backup.version}`, 'restore');
        }
        for (const data of Object.values(backup.modules)) {
            await this.importModule(data as ModuleExportData);
        }
    }

    async exportModule(moduleName: string): Promise<ModuleExportData> {
        const eng = this.manager.getEngine(moduleName);
        const nodes: FSNode[] = [];
        const contents: Record<string, string> = {};

        await eng.walkTree?.((node) => {
            nodes.push(node);
            if (node.type === 'file') {
                eng.readContent(node.id, { encoding: 'utf-8' })
                    .then(c => {
                        if (typeof c === 'string') contents[node.id] = c;
                    })
                    .catch(() => {});
            }
        }, { includeHidden: true });

        // Await content reads — the above is fire-and-forget due to walkTree callback
        // Better approach: collect promises
        const contentPromises: Promise<void>[] = [];
        for (const node of nodes) {
            if (node.type === 'file') {
                contentPromises.push(
                    eng.readContent(node.id, { encoding: 'utf-8' })
                        .then(c => {
                            if (typeof c === 'string') contents[node.id] = c;
                        })
                        .catch(() => {}),
                );
            }
        }
        await Promise.all(contentPromises);

        return {
            version: 1,
            moduleName,
            exportedAt: Date.now(),
            nodes,
            contents,
        };
    }

    async importModule(data: ModuleExportData): Promise<void> {
        await this.manager.mount(data.moduleName);
        const eng = this.manager.getEngine(data.moduleName);

        // Sort: directories first, by depth
        const sorted = [...data.nodes].sort((a, b) => {
            if (a.type === 'directory' && b.type !== 'directory') return -1;
            if (a.type !== 'directory' && b.type === 'directory') return 1;
            return P.depth(a.path) - P.depth(b.path);
        });

        for (const node of sorted) {
            // Use path-derived parent instead of node.parentId (which is an inode-based
            // ID from the source machine and does not exist on the target machine).
            const parentPath = P.dirname(node.path);
            try {
                if (node.type === 'directory') {
                    await eng.createDirectory({
                        name: node.name,
                        parentIdOrPath: parentPath,
                        metadata: node.metadata as any,
                        recursive: true,
                    });
                } else if (node.type === 'file' || node.type === 'seqfile') {
                    await eng.createFile({
                        name: node.name,
                        parentIdOrPath: parentPath,
                        content: data.contents[node.id],
                        metadata: node.metadata as any,
                        tags: node.tags ? [...node.tags] : undefined,
                        type: node.type,
                        recursive: true,
                        overwrite: true,
                    });
                }
            } catch (e) {
                console.warn(`[importModule] Failed to create ${node.path}:`, e);
            }
        }
    }
}
