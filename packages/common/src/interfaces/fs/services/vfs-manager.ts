/**
 * @file common/interfaces/fs/services/vfs-manager.ts
 * @desc 系统级 VFS 管理接口
 *
 * 面向系统管理者和框架内部，非模块开发者。
 *
 * 修正：
 * - 将挂载、设备、插件、同步、备份职责拆分为子服务接口
 * - IVFSManager 保留模块管理 + 跨模块协调 + 子服务访问器
 * - 减少接口表面积，遵循 ISP
 *
 * 职责边界：
 * ┌────────────────────┬──────────────────────────────────────┐
 * │ IModuleFS          │ 模块内文件操作                        │
 * │ IConfigService     │ 配置管理                              │
 * │ IVFSManager        │ 模块生命周期 + 跨模块协调 + 子服务入口 │
 * │   .mounts          │ 挂载管理                              │
 * │   .devices         │ 设备管理                              │
 * │   .plugins         │ 插件管理                              │
 * │   .sync            │ 同步服务（可选）                       │
 * │   .maintenance     │ 维护操作（gc/fsck/backup）             │
 * └────────────────────┴──────────────────────────────────────┘
 */

import type { FSNode, FSSearchResult, FSModuleStats, FileContent } from '../core/types';
import type { IModuleFS } from './module-fs';
import type { IStorageBackend } from '../storage/backend';
import type { IMountRouter, MountPoint, MountOptions } from '../mount/mount';
import type { ISyncService } from '../sync/sync';
import type { IPluginManager } from '../plugin/plugin';
import type { IDeviceManager } from '../device/device';

// ═══════════════════════════════════════════════════════════════
// 模块管理类型
// ═══════════════════════════════════════════════════════════════

export interface ModuleInfo {
    name: string;
    description?: string;
    rootNodeId?: string;
    isProtected?: boolean;
    syncEnabled?: boolean;
    /** System modules bypass all access control checks (hidden files, cross-module) */
    isSystem?: boolean;
}

export interface ModuleMountOptions {
    description?: string;
    isProtected?: boolean;
    syncEnabled?: boolean;
    /** System modules bypass all access control checks (hidden files, cross-module) */
    isSystem?: boolean;
}

// ═══════════════════════════════════════════════════════════════
// 事件
// ═══════════════════════════════════════════════════════════════

export type VFSManagerEventType =
    | 'node:created'
    | 'node:updated'
    | 'node:deleted'
    | 'module:mounted'
    | 'module:unmounted'
    | 'mount:added'
    | 'mount:removed';

export interface VFSManagerEventPayloadMap {
    'node:created': { nodeId: string; path: string; moduleId: string };
    'node:updated': { nodeId: string; path: string; moduleId: string };
    'node:deleted': { nodeIds: string[]; moduleId: string };
    'module:mounted': { moduleName: string };
    'module:unmounted': { moduleName: string };
    'mount:added': { mountPath: string; mountId: string; label?: string };
    'mount:removed': { mountPath: string; mountId: string };
}

export interface VFSManagerEvent<
    T extends VFSManagerEventType = VFSManagerEventType,
> {
    type: T;
    payload: T extends keyof VFSManagerEventPayloadMap
    ? VFSManagerEventPayloadMap[T]
    : unknown;
    timestamp: number;
}

// ═══════════════════════════════════════════════════════════════
// 全局标签
// ═══════════════════════════════════════════════════════════════

export interface GlobalTagInfo {
    name: string;
    color?: string;
    refCount?: number;
}

// ═══════════════════════════════════════════════════════════════
// 同步支持
// ═══════════════════════════════════════════════════════════════

export interface SyncableFileInfo {
    /** 系统级全路径: /module/{moduleName}/relative/path */
    path: string;
    nodeId: string;
    type: 'file' | 'directory';
    modifiedAt: number;
    moduleName: string;
    mountId: string;
}

// ═══════════════════════════════════════════════════════════════
// 导入导出
// ═══════════════════════════════════════════════════════════════

export interface ModuleExportData {
    version: number;
    moduleName: string;
    exportedAt: number;
    nodes: FSNode[];
    contents: Record<string, string>;
    moduleMetadata?: Record<string, unknown>;
}

// ═══════════════════════════════════════════════════════════════
// 跨模块搜索
// ═══════════════════════════════════════════════════════════════

export interface VFSSearchQuery {
    /** 搜索范围：undefined 搜所有，string[] 搜指定模块 */
    modules?: string[];
    /** 文件名匹配 */
    name?: {
        exact?: string;
        contains?: string;
        startsWith?: string;
        endsWith?: string;
        pattern?: string;
    };
    text?: string;
    type?: import('../core/types').FSNodeType | import('../core/types').FSNodeType[];
    tags?: {
        all?: string[];
        any?: string[];
        none?: string[];
    };
    metadata?: Record<string, unknown>;
    modifiedAfter?: number;
    modifiedBefore?: number;
    limit?: number;
    offset?: number;
    orderBy?: 'name' | 'modifiedAt' | 'createdAt' | 'size';
    orderDirection?: 'asc' | 'desc';
}

// ═══════════════════════════════════════════════════════════════
// 系统统计
// ═══════════════════════════════════════════════════════════════

export interface VFSSystemStats {
    moduleCount: number;
    modules: Record<string, FSModuleStats>;
    totalFiles: number;
    totalSize: number;
    mountCount: number;
    deviceCount: number;
    pluginCount: number;
    storageBackend: string;
    availableSpace?: number;
}

// ═══════════════════════════════════════════════════════════════
// 维护子服务
// ═══════════════════════════════════════════════════════════════

export interface IMaintenanceService {
    /** 全局统计 */
    getSystemStats(): Promise<VFSSystemStats>;

    /**
     * 垃圾回收
     * 清理孤儿 inode、无主 content、断裂引用等。
     */
    gc(): Promise<{ cleaned: number; freedBytes: number }>;

    /**
     * 文件系统完整性检查
     */
    fsck(): Promise<{
        ok: boolean;
        errors: Array<{
            path: string;
            issue: string;
            severity: 'warning' | 'error';
        }>;
    }>;

    /** 全量备份 */
    createBackup(): Promise<string>;

    /** 恢复备份 ⚠️ 覆盖所有数据 */
    restoreBackup(jsonContent: string): Promise<void>;

    /** 导出模块（类型化返回） */
    exportModule(moduleName: string): Promise<ModuleExportData>;

    /** 导入模块 */
    importModule(data: ModuleExportData): Promise<void>;
}

// ═══════════════════════════════════════════════════════════════
// 挂载管理子服务
// ═══════════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════════
// 核心接口
// ═══════════════════════════════════════════════════════════════

export interface IVFSManager {

    // ==================== 生命周期 ====================

    /**
     * 初始化 VFS
     *
     * - 初始化 root 存储后端
     * - 创建基础目录结构（/etc, /dev, /module）
     * - 注册内置设备驱动
     * - 加载插件
     */
    initialize(): Promise<void>;

    /** 关闭 VFS，释放所有资源 */
    dispose(): Promise<void>;

    // ==================== 子服务访问器 ====================

    /** 挂载管理 */
    readonly mounts: IMountService;

    /** 设备管理 */
    readonly devices: IDeviceManager;

    /** 插件管理 */
    readonly plugins: IPluginManager;

    /** 维护操作（gc/fsck/backup/export/import） */
    readonly maintenance: IMaintenanceService;

    /**
     * 同步服务（可选能力）
     * VFS 实例未配置同步能力时返回 null。
     */
    readonly sync: ISyncService | null;

    // ==================== 模块管理 ====================

    /**
     * 挂载模块（幂等）
     * 自动创建 /module/<moduleName>/ 目录（如不存在）。
     */
    mount(moduleName: string, options?: ModuleMountOptions): Promise<void>;

    /** 批量挂载 */
    mountAll(
        modules: Array<{ name: string; options?: ModuleMountOptions }>,
    ): Promise<void>;

    /**
     * 卸载模块
     * @param removeData 是否同时删除数据（默认 false）
     */
    unmount(moduleName: string, removeData?: boolean): Promise<void>;

    /** 获取模块信息 */
    getModule(moduleName: string): ModuleInfo | null;

    /** 获取所有已挂载模块 */
    getAllModules(): ModuleInfo[];

    // ==================== 引擎管理 ====================

    /**
     * 获取模块的 IModuleFS 实例（单例缓存）
     *
     * 这是消费方访问模块内文件操作的唯一入口。
     *
     * @throws FSModuleNotFoundError
     */
    getEngine(moduleName: string): IModuleFS;

    /**
     * 注册自定义引擎
     * @throws FSAlreadyExistsError
     */
    registerEngine(moduleName: string, engine: IModuleFS): void;

    // ==================== 跨模块便捷操作 ====================

    /**
     * 读取文件内容
     *
     * 仅保留 3 个最高频便捷方法。
     * 其余操作统一通过 getEngine(moduleName).xxx() 调用。
     *
     * @throws FSNotFoundError
     */
    read(moduleName: string, path: string): Promise<FileContent>;

    /**
     * 写入文件内容（upsert 语义：不存在则创建，含中间目录）
     */
    write(
        moduleName: string,
        path: string,
        content: FileContent,
    ): Promise<void>;

    /** 检查路径是否存在 */
    exists(moduleName: string, path: string): Promise<boolean>;

    // ==================== 跨模块搜索 ====================

    /**
     * 跨模块搜索
     * 分发到各模块的 search()，合并结果。
     */
    search(query: VFSSearchQuery): Promise<FSSearchResult>;

    /**
     * 通过全局节点 ID 获取节点（不限模块）
     */
    getNodeById(nodeId: string): Promise<(FSNode & { moduleName: string }) | null>;

    // ==================== 全局标签 ====================

    /** 汇总所有模块标签 */
    getAllTags(): Promise<GlobalTagInfo[]>;

    /** 更新全局标签定义 */
    updateTagDefinition(
        tagName: string,
        updates: { color?: string },
    ): Promise<void>;

    /** 按标签查找节点 ID（跨模块） */
    findByTag(tagName: string): Promise<string[]>;

    // ==================== 系统级文件操作 ====================

    /**
     * 系统级路径读取（绕过 chroot 隔离）
     *
     * 路径格式:
     *   /module/{moduleName}/relative/path  → 业务模块文件
     *   /__config/app.conf                  → 配置文件
     *   /dev/llm                            → 设备文件
     */
    readBySystemPath(systemPath: string): Promise<FileContent>;

    // ==================== 事件 ====================

    on<E extends VFSManagerEventType>(
        eventType: E,
        handler: (event: VFSManagerEvent<E>) => void,
    ): () => void;

    onAny(
        handler: (type: string, event: VFSManagerEvent) => void,
    ): () => void;
}
