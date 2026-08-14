/**
 * @file packages/stdio/src/impl/services/vfs-manager.ts
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
    ModuleInfo,
    ModuleMountOptions,
    VFSManagerEventType,
    VFSManagerEvent,
    VFSManagerEventPayloadMap,
    VFSSearchQuery,
    GlobalTagInfo,
    IMountService,
    IMaintenanceService,
    IPluginManager,
    IDeviceManager,
    ISystemAccess,
    FSEventType,
} from '../../protocol';

import {
    FSModuleNotFoundError,
    FSAlreadyExistsError,
    FSError,
    ETC_DIR,
    type IDeviceDriver,
} from '../../protocol';
import type { EventMeta } from '../../eventbus';

import { VFSEngine } from '../engine/vfs-engine';
import { ModuleFS, type ModuleFSDeps } from './ModuleFS';
import { MountService } from './MountService';
import { MaintenanceService } from './MaintenanceService';
import * as P from '../../utils/path';

export class VFSManager implements IVFSManager {
    private readonly engine: VFSEngine;
    private readonly modules = new Map<string, ModuleInfo>();
    private readonly engines = new Map<string, IModuleFS>();

    readonly mounts: IMountService;
    readonly devices: IDeviceManager;
    readonly plugins: IPluginManager;
    readonly maintenance: IMaintenanceService;

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
        // Wire system-module checker so AccessController can distinguish system vs
        // regular module paths for hidden-file access control (Linux-like semantics).
        this.engine.access.setSystemModuleChecker(
            (moduleId) => this.modules.get(moduleId)?.isSystem ?? false,
        );
        // /etc is now a rootfs built-in directory (bootstrap creates it).
        // No mount() call needed — systemAccess and etc engine are created on demand.
        this.initialized = true;
    }

    async dispose(): Promise<void> {
        if (!this.initialized) return;

        for (const eng of this.engines.values()) {
            await eng.dispose?.();
        }
        this.engines.clear();
        this.modules.clear();
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
                nodeMetadata,
                { deviceHandlerId: handlerId, recursive: true },
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

        // ensureModuleDir always operates in the root backend (creates a stub entry).
        await this.engine.ensureModuleDir(moduleName);

        // v4.1: path-based — rootNodeId is the system path
        const modulePath = `/module/${moduleName}`;
        this.modules.set(moduleName, {
            name: moduleName,
            description: options?.description,
            rootNodeId: modulePath,
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
        // etc is not a module anymore — no special guard needed

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

        // /etc is a rootfs built-in directory, not a mounted module.
        // Create a special ModuleFS with root at /etc/ (instead of /module/etc/).
        if (moduleName === 'etc') {
            return this.createEtcEngine();
        }

        if (!this.modules.has(moduleName)) {
            throw new FSModuleNotFoundError(moduleName);
        }

        const moduleInfo = this.modules.get(moduleName)!;
        const { mount } = this.mounts.router.resolve(`/module/${moduleName}`);
        // Resolve systemAccess for non-system modules so openDevice can inject
        // it into DeviceContext, allowing device drivers to proxy /etc files.
        const systemAccess = moduleInfo.isSystem
            ? undefined
            : this.createSystemAccess();

        const deps: ModuleFSDeps = {
            moduleId: moduleName,
            engine: this.engine,
            eventBus: this.engine.events,
            plugins: this.engine.plugins,
            access: this.engine.access,
            devices: this.engine.devices,
            mountId: mount.mountId,
            isSystem: moduleInfo.isSystem,
            systemAccess,
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
    // System Access
    // ══════════════════════════════════════════════════════════

    /**
     * Create an ISystemAccess backed by direct /etc engine operations.
     * Used by getEngine() to inject into non-system modules' DeviceContext.
     */
    private createSystemAccess(): ISystemAccess {
        const engine = this.engine;
        const etcRoot = '/etc';
        return {
            async readEtc(relativePath: string): Promise<string> {
                const clean = relativePath.startsWith('/') ? relativePath.slice(1) : relativePath;
                const fullPath = clean ? P.join(etcRoot, clean) : etcRoot;
                return engine.readEtcFile(fullPath);
            },
            async writeEtc(relativePath: string, content: string): Promise<void> {
                const clean = relativePath.startsWith('/') ? relativePath.slice(1) : relativePath;
                const fullPath = P.join(etcRoot, clean);
                const parentDir = P.dirname(fullPath);
                await engine.ensureDirectoryPath(parentDir);
                await engine.writeEtcFile(fullPath, content);
            },
            async listEtc(relativePath?: string): Promise<string[]> {
                const fullPath = relativePath ? P.join(etcRoot, relativePath) : etcRoot;
                return engine.listEtcDir(fullPath);
            },
            async deleteEtc(relativePath: string): Promise<void> {
                const clean = relativePath.startsWith('/') ? relativePath.slice(1) : relativePath;
                const fullPath = P.join(etcRoot, clean);
                try {
                    await engine.delete(fullPath, { force: true });
                } catch { /* file may not exist */ }
            },
        };
    }

    /**
     * Create a special IModuleFS for /etc that maps root to /etc/ directly
     * (not /module/etc/). Used internally by getEngine('etc') so existing
     * consumers like ConfigService continue to work.
     */
    private createEtcEngine(): IModuleFS {
        const deps: ModuleFSDeps = {
            moduleId: 'etc',
            engine: this.engine,
            eventBus: this.engine.events,
            plugins: this.engine.plugins,
            access: this.engine.access,
            devices: this.engine.devices,
            mountId: 'mount_0',
            isSystem: true,
            rootRealPath: ETC_DIR,
            // etc doesn't need systemAccess — it IS the system config store
            systemAccess: undefined,
        };
        const fs = new ModuleFS(deps);
        fs.init().catch(() => {});
        this.engines.set('etc', fs);
        return fs;
    }

    // ══════════════════════════════════════════════════════════
    // Cross-Module Convenience
    // ══════════════════════════════════════════════════════════

    async read(moduleName: string, path: string): Promise<FileContent> {
        return this.getEngine(moduleName).driver.readContent(path);
    }

    async write(moduleName: string, path: string, content: FileContent): Promise<void> {
        const eng = this.getEngine(moduleName);
        const exists = await eng.driver.exists(path);
        if (exists) {
            await eng.driver.writeContent(path, content);
        } else {
            const dir = P.dirname(path);
            const name = P.basename(path);
            await eng.driver.createFile({
                name,
                parentPath: dir === '/' ? null : dir,
                content: content as string | ArrayBuffer,
                recursive: true,
            });
        }
    }

    async exists(moduleName: string, path: string): Promise<boolean> {
        return this.getEngine(moduleName).driver.exists(path);
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
                const result = await this.getEngine(mod).driver.search(query);
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
                const node = await this.getEngine(modName).driver.getNode(nodeId);
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
                if (eng.meta.tags) {
                    const tags = await eng.meta.tags.getAllTags();
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

    async updateTagDefinition(tagName: string, updates: { color?: string }): Promise<void> {
        // Tag definitions are stored in /etc/tags.json (system-level, not per-module).
        const tagsPath = '/etc/tags.json';
        try {
            const raw = await this.engine.readEtcFile(tagsPath);
            const tags = raw ? JSON.parse(raw) : {};
            if (tags[tagName]) {
                Object.assign(tags[tagName], updates);
                await this.engine.ensureDirectoryPath('/etc');
                await this.engine.writeEtcFile(tagsPath, JSON.stringify(tags, null, 2));
            }
        } catch { /* ignore */ }
    }

    async findByTag(tagName: string): Promise<string[]> {
        const results: string[] = [];
        for (const modName of this.modules.keys()) {
            try {
                const eng = this.getEngine(modName);
                if (eng.meta.tags) {
                    await eng.meta.tags.walkByTag(tagName, (id) => {
                        results.push(id);
                        return true;
                    });
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
        return this.engine.events.on(eventType as FSEventType, (payload, meta) => {
            this.eachManagerEvent(meta, payload, (type, event) => {
                if (type === eventType) handler(event as VFSManagerEvent<E>);
            });
        });
    }

    onAny(
        handler: (type: string, event: VFSManagerEvent) => void,
    ): () => void {
        return this.engine.events.onAny((payload, meta) => {
            if (!MANAGER_EVENT_TYPES.has(meta.type as VFSManagerEventType)) return;
            this.eachManagerEvent(meta, payload, (type, event) => handler(type, event));
        });
    }

    /**
     * Expand one FSEvent into one or more VFSManager events.
     * node:created/updated/deleted carry a batch of nodes; VFSManager exposes
     * one event per node (moduleId comes from event meta). Other types pass through.
     */
    private eachManagerEvent(
        meta: EventMeta,
        payload: unknown,
        emit: (type: VFSManagerEventType, event: VFSManagerEvent) => void,
    ): void {
        const type = meta.type as VFSManagerEventType;
        const moduleId = (meta.moduleId as string | undefined) ?? '';

        if (type === 'node:created' || type === 'node:updated') {
            const nodes = (payload as { nodes?: Array<{ path: string }> }).nodes ?? [];
            for (const n of nodes) {
                emit(type, {
                    type,
                    payload: { nodeId: n.path, path: n.path, moduleId },
                    timestamp: meta.timestamp,
                } as VFSManagerEvent);
            }
            return;
        }
        if (type === 'node:deleted') {
            const requested = (payload as { requestedPaths?: string[] }).requestedPaths ?? [];
            emit(type, {
                type,
                payload: { nodeIds: requested, moduleId },
                timestamp: meta.timestamp,
            } as VFSManagerEvent);
            return;
        }
        emit(type, {
            type,
            payload: payload as VFSManagerEventPayloadMap[VFSManagerEventType],
            timestamp: meta.timestamp,
        } as VFSManagerEvent);
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
        payload: VFSManagerEventPayloadMap[E],
    ): void {
        this.engine.events.emit(type as FSEventType, payload as never);
    }
}

const MANAGER_EVENT_TYPES = new Set<VFSManagerEventType>([
    'node:created',
    'node:updated',
    'node:deleted',
    'module:mounted',
    'module:unmounted',
    'mount:added',
    'mount:removed',
]);
