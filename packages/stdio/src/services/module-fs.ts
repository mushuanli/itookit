/**
 * @file common/interfaces/fs/services/module-fs.ts
 * @desc 模块文件系统接口（面向模块/Agent 的唯一入口）
 *
 * 模块拿到的 IModuleFS 已经过 chroot 隔离：
 *   /         → /module/<moduleId>/
 *   /dev/     → /dev/  （只读，非隐藏文件）
 *   /etc/     → /etc/  （只读，非隐藏文件）
 *
 * 使用方式：
 * - CRUD:     fs.driver.createFile() / writeContent() / delete() 等
 * - 元数据:   fs.meta.assets / fs.meta.tags / fs.meta.seq 等
 * - 文件句柄: fs.openFile(nodeId) → IFile
 */

import type { FSNode, FSCapabilities } from '../core/types';
import type { FSEventEmitter } from '../core/events';
import type { IDeviceHandle } from '../device/device';
import type { IFSDriver } from './fs-driver';
import type { IFSMetaDriver } from './fs-meta-driver';
import type { IFile } from '../IFile';

// ═══════════════════════════════════════════════════════════════
// 核心接口
// ═══════════════════════════════════════════════════════════════

/**
 * 模块文件系统入口（面向模块/Agent 的薄包装器）
 *
 * CRUD 操作统一通过 driver.*，元数据操作通过 meta.*。
 * 不再直接暴露文件操作方法 — 使用 fs.driver.createFile() 等。
 */
export interface IModuleFS extends FSEventEmitter {
    /** 当前模块 ID */
    readonly moduleId: string;

    /** 能力声明 */
    readonly capabilities: FSCapabilities;

    /** 模块作用域文件驱动（CRUD + 链接 + 事务 + 搜索） */
    readonly driver: IFSDriver;

    /** 扩展元信息驱动（assetdir / tags / seqfile / refs） */
    readonly meta: IFSMetaDriver;

    /** 以 nodeId 打开文件，返回轻量句柄 */
    openFile(nodeId: string): IFile;

    /** 初始化（幂等） */
    init(): Promise<void>;

    /** 销毁（幂等） */
    dispose?(): Promise<void>;

    // ── VFS 特有设备操作（非 POSIX CRUD，不在 IFSDriver 内） ──

    /** 打开设备文件，返回绑定上下文的设备句柄 */
    openDevice?(path: string, options?: Record<string, unknown>): Promise<IDeviceHandle>;

    /** 创建设备文件节点 */
    createDeviceFile?(name: string, parentPath: string | null, handlerId: string): Promise<FSNode>;

    /** 设备控制命令 */
    ioctl?(path: string, command: string | number, arg?: unknown): Promise<unknown>;
}
