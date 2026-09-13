import type { IFileSystem } from './file-system';
import type { FileContent } from '../core/types';
import type { IOOperation } from '../core/io-stats';
import type { IStorageBackend } from '../storage/backend';
import type { IMountRouter, MountPoint, MountOptions } from '../mount/mount';
import type { IPluginManager } from '../plugin/plugin';
import type { IDeviceManager, IDeviceDriver, IDeviceHandle } from '../device/device';

export interface IMountService {
    /** 底层挂载路由器（高级用法） */
    readonly router: IMountRouter;

    /**
     * 挂载存储后端到指定路径
     * @emits mount:added
     */
    mountBackend(
        mountPath: string,
        backend: IStorageBackend,
        options?: MountOptions,
    ): Promise<MountPoint>;

    /**
     * 卸载存储后端
     * @param force 是否强制
     * @throws FSError('EINVAL') 不可卸载根挂载 "/"
     * @emits mount:removed
     */
    unmountBackend(mountPath: string, force?: boolean): Promise<void>;

    /** 列出所有挂载点 */
    listMounts(): MountPoint[];

    /** 获取路径所在的挂载点信息 */
    getMountForPath(absolutePath: string): MountPoint;
}

/** Host-only ownership and device interface. There is no application/module registry. */
export interface IVFSManager {
    initialize(): Promise<void>;
    dispose(): Promise<void>;
    openFileSystem(rootPath: string): Promise<IFileSystem>;
    readonly mounts: IMountService;
    readonly devices: IDeviceManager;
    readonly plugins: IPluginManager;
    registerDevice(driver: IDeviceDriver): Promise<void>;
    openDevice(path: string, options?: Record<string, unknown>): Promise<IDeviceHandle>;
    ensureSystemDirectory(path: string): Promise<void>;
    createDeviceNode(handlerId: string, devPath: string, metadata?: Record<string, unknown>): Promise<void>;
    removeDeviceNode(devPath: string): Promise<void>;
    readBySystemPath(path: string): Promise<FileContent>;

    /**
     * Snapshot of instrumented engine operations for diagnostics. Mutating the copy
     * does not affect the engine. Counts do not represent exhaustive backend calls or IPC.
     */
    readonly ioStats: Readonly<Record<IOOperation, number>>;

    /** Reset instrumented engine operation counts for diagnostic sampling. */
    resetIOStats(): void;
}
