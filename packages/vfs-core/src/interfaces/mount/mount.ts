/**
 * @file packages/vfs-core/src/interfaces/mount/mount.ts
 * @desc 挂载系统
 *
 * 将逻辑路径树映射到多个物理存储后端。
 *
 * 约束：
 * - 根 "/" 必须有且仅有一个挂载
 * - 挂载点必须是目录路径
 * - 子路径挂载优先于父路径（最长前缀匹配）
 */

import type { IStorageBackend } from '../storage/backend';
import type { FSCapabilities } from '../core/types';

export interface MountPoint {
    readonly mountId: string;
    readonly mountPath: string;
    readonly backend: IStorageBackend;
    readonly options: MountOptions;
    readonly mountedAt: number;
    readonly capabilities: FSCapabilities;
}

export interface MountOptions {
    /** @default false */
    readonly?: boolean;
    /** 显示名称 */
    label?: string;
    /** 是否参与同步 @default false */
    syncable?: boolean;
    /** 同步优先级（越小越高） @default 100 */
    syncPriority?: number;
    /** 同步方向 @default 'bidirectional' */
    syncDirection?: 'push' | 'pull' | 'bidirectional';
    /**
     * 跨挂载点操作策略
     * - 'copy-delete': 复制到目标后端 → 删除源（默认）
     * - 'deny': 拒绝跨挂载点操作
     * @default 'copy-delete'
     */
    crossMountStrategy?: 'copy-delete' | 'deny';
}

export interface ResolvedMount {
    readonly mount: MountPoint;
    /**
     * 在该后端内的相对路径
     *
     * 例如全局路径 "/archive/2024/note.md"
     * 挂载点 "/archive" → relativePath = "2024/note.md"
     * 挂载点 "/" → relativePath = "archive/2024/note.md"
     */
    readonly relativePath: string;
}

export interface IMountRouter {
    /**
     * 挂载存储后端到指定路径
     * @throws FSError('EEXIST') 路径已有挂载
     * @throws FSError('EINVAL') 路径不合法
     */
    mount(
        mountPath: string,
        backend: IStorageBackend,
        options?: MountOptions,
    ): Promise<MountPoint>;

    /**
     * 卸载
     * @param force 是否强制（忽略活跃句柄）
     * @throws FSError('ENOENT') 挂载点不存在
     * @throws FSError('EBUSY') 有活跃句柄且 force=false
     * @throws FSError('EINVAL') 不可卸载根挂载 "/"
     */
    unmount(mountPath: string, force?: boolean): Promise<void>;

    /**
     * 解析路径到挂载点（最长前缀匹配）
     * 性能要求：O(depth)，depth 通常 < 10
     */
    resolve(absolutePath: string): ResolvedMount;

    /** 判断路径是否跨越挂载点边界 */
    isCrossMount(srcPath: string, destPath: string): boolean;

    /** 列出所有挂载点 */
    listMounts(): MountPoint[];

    /** 按 ID 获取挂载点 */
    getMount(mountId: string): MountPoint | null;

    /** 按路径获取挂载点 */
    getMountByPath(mountPath: string): MountPoint | null;
}
