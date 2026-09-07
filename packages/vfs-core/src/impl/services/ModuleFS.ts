/**
 * @file packages/vfs-core/src/impl/services/ModuleFS.ts
 * @desc IModuleFS 薄外观 — chroot 隔离文件系统视图（v4.1 path-based）。
 *
 * CRUD 委托 ModuleDriver；路径/事件/序列化委托 ModuleContext；
 * seq/ref/asset/tag 能力委托独立的能力类（依赖 EnginePort）。
 */

import type {
    IModuleFS,
    FSNode,
    FSEventType,
    FSEvent,
    IAssetOperations,
    ITagOperations,
    IDeviceHandle,
    DeviceContext,
} from '../../protocol';
import { FSError } from '../../protocol';

import { FileHandle } from '../file-io/File';
import { DeviceHandle } from '../devices/DeviceHandle';

import { AssetOps } from '../capabilities/AssetOps';
import { TagOps } from '../capabilities/TagOps';
import { SeqFileOps } from '../capabilities/SeqFileOps';
import { RefOps } from '../capabilities/RefOps';
import { ModuleContext } from './ModuleContext';
import { ModuleDriver } from './ModuleDriver';

export type { ModuleFSDeps } from './ModuleContext';

export class ModuleFS implements IModuleFS {
    readonly moduleId: string;
    readonly capabilities: import('../../protocol').FSCapabilities;
    readonly assets: IAssetOperations;
    readonly tags: ITagOperations;
    readonly driver: import('../../protocol').IFSDriver;
    readonly meta: import('../../protocol').IFSMetaDriver;

    private readonly ctx: ModuleContext;
    private readonly _driver: ModuleDriver;

    constructor(deps: import('./ModuleContext').ModuleFSDeps) {
        this.ctx = new ModuleContext(deps);
        this.moduleId = this.ctx.moduleId;
        this.capabilities = this.ctx.capabilities;

        this._driver = new ModuleDriver(this.ctx);
        this.driver = this._driver;

        this.assets = new AssetOps(this.ctx);
        this._driver.assets = this.assets;
        this.tags = new TagOps(this.ctx);

        const records = this.ctx.records;
        const seq = records ? new SeqFileOps(this.ctx, records) : undefined;
        const refs = records ? new RefOps(this.ctx, records) : undefined;
        this.meta = {
            assets: this.assets,
            tags: this.tags,
            ...(seq ? { seq } : {}),
            ...(refs ? { refs } : {}),
        };
    }

    // ── IModuleFS ─────────────────────────────────────────────────────────────

    openFile(nodeId: string): import('../../protocol').IFile {
        return new FileHandle(this, nodeId);
    }

    async init(): Promise<void> {
        if (this.ctx.initialized) return;
        if (!this.ctx.isCustomRoot) {
            await this.ctx.engine.ensureModuleDir(this.moduleId);
        }
        const backend = this.ctx.backend;
        if (backend.prepareRecordPaths) {
            const { mountPath } = this.ctx.engine.recordLocation(this.ctx.toRealPath('/'), backend);
            await backend.prepareRecordPaths(mountPath);
        }
        this.ctx.initialized = true;
    }

    async dispose(): Promise<void> { this.ctx.initialized = false; }

    on<E extends FSEventType>(event: E, callback: (event: FSEvent<E>) => void): () => void {
        return this._driver.on(event, callback);
    }

    onAny(callback: (event: FSEvent) => void): () => void {
        return this._driver.onAny(callback);
    }

    // ── VFS 特有设备操作 ───────────────────────────────────────────────────────

    async createDeviceFile(name: string, parentPath: string | null, handlerId: string): Promise<FSNode> {
        const realParentPath = parentPath ? this.ctx.toRealPath(parentPath) : this.ctx.scope.toRealPath('/dev');
        return this.ctx.engine.createFile(realParentPath, name, 'device', undefined, undefined, { deviceHandlerId: handlerId });
    }

    async ioctl(path: string, command: string | number, arg?: unknown): Promise<unknown> {
        const { node } = await this.ctx.resolveNode(path);
        if (node.type !== 'device') throw new FSError('ENOTTY', 'not a device file', 'ioctl', node.path);
        const handlerId = node.deviceHandlerId;
        if (!handlerId) throw new FSError('ENOTTY', 'no device handler', 'ioctl', node.path);
        const driver = this.ctx.devices.get(handlerId);
        if (!driver.ioctl) throw new FSError('ENOTTY', 'device does not support ioctl', 'ioctl', node.path);
        return driver.ioctl({ nodeId: node.path, name: node.name, metadata: node.metadata }, command, arg);
    }

    async openDevice(path: string, options?: Record<string, unknown>): Promise<IDeviceHandle> {
        const { node } = await this.ctx.resolveNode(path);
        if (node.type !== 'device') throw new FSError('ENOTTY', 'not a device file', 'openDevice', node.path);
        const handlerId = node.deviceHandlerId;
        if (!handlerId) throw new FSError('ENOTTY', 'no device handler', 'openDevice', node.path);
        const driver = this.ctx.devices.get(handlerId);
        const baseCtx: DeviceContext = {
            nodeId: node.path,
            name: node.name,
            metadata: node.metadata,
            systemAccess: this.ctx.systemAccess,
        };
        let sessionId: string | undefined;
        if (driver.sessionable && driver.open) sessionId = await driver.open(baseCtx, options);
        return new DeviceHandle(driver, { ...baseCtx, sessionId });
    }
}
