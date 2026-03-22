/**
 * @file common/interfaces/fs/IVFSManager.ts
 * @desc 系统级 VFS 管理接口
 *
 * 重构要点：
 * - 剥离 Config 到 IConfigService
 * - 删除与 IModuleFS 重复的 CRUD（createFile/createDirectory/delete/getNode）
 *   消费方通过 getEngine(moduleName).xxx() 操作
 * - 保留高频便捷方法 read/write/exists（DX 友好）
 * - 标签/同步/备份方法保留（体量不大，拆出去反而增加理解成本）
 * - exportModule 返回类型化数据
 *
 * 职责边界（精简后）：
 * ┌────────────────────┬──────────────────────────────────┐
 * │ IModuleFS          │ 模块内文件操作                    │
 * │ IConfigService     │ 配置管理                          │
 * │ IVFSManager        │ 模块生命周期 + 跨模块协调 + 系统级│
 * └────────────────────┴──────────────────────────────────┘
 */

import type { FSNode, FSSearchQuery, FSModuleStats } from './types';
import type { IModuleFS } from './IModuleFS';

// ═══════════════════════════════════════════════════════════════
// 模块管理类型
// ═══════════════════════════════════════════════════════════════

export interface ModuleInfo {
    name: string;
    description?: string;
    rootNodeId?: string;
    isProtected?: boolean;
    syncEnabled?: boolean;
}

export interface ModuleMountOptions {
    description?: string;
    isProtected?: boolean;
    syncEnabled?: boolean;
}

// ═══════════════════════════════════════════════════════════════
// 事件类型
// ═══════════════════════════════════════════════════════════════

export type VFSManagerEventType =
    | 'node:created'
    | 'node:updated'
    | 'node:deleted'
    | 'module:mounted'
    | 'module:unmounted';

export interface VFSManagerEventPayloadMap {
    'node:created': { nodeId: string; path: string; moduleId: string };
    'node:updated': { nodeId: string; path: string; moduleId: string };
    'node:deleted': { nodeIds: string[]; moduleId: string };
    'module:mounted': { moduleName: string };
    'module:unmounted': { moduleName: string };
}

export interface VFSManagerEvent<
    T extends VFSManagerEventType = VFSManagerEventType
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
    /** 系统级全路径: /{moduleName}/relative/path */
    path: string;
    nodeId: string;
    type: 'file' | 'directory';
    modifiedAt: number;
    moduleName: string;
}

// ═══════════════════════════════════════════════════════════════
// 导入导出
// ═══════════════════════════════════════════════════════════════

/**
 * 模块导出数据（类型化，替代 unknown）
 */
export interface ModuleExportData {
    /** 导出格式版本 */
    version: number;
    /** 模块名 */
    moduleName: string;
    /** 导出时间 */
    exportedAt: number;
    /** 节点元数据列表 */
    nodes: FSNode[];
    /** 文件内容：nodeId → base64 或 UTF-8 */
    contents: Record<string, string>;
    /** 模块级元数据 */
    moduleMetadata?: Record<string, unknown>;
}

// ═══════════════════════════════════════════════════════════════
// 跨模块搜索
// ═══════════════════════════════════════════════════════════════

export interface VFSSearchQuery extends FSSearchQuery {
    /** 搜索范围：undefined 搜所有，string[] 搜指定模块 */
    modules?: string[];
}

// ═══════════════════════════════════════════════════════════════
// 系统统计
// ═══════════════════════════════════════════════════════════════

export interface VFSSystemStats {
    moduleCount: number;
    modules: Record<string, FSModuleStats>;
    totalFiles: number;
    totalSize: number;
    storageBackend: string;
    availableSpace?: number;
}

// ═══════════════════════════════════════════════════════════════
// 核心接口
// ═══════════════════════════════════════════════════════════════

export interface IVFSManager {

    // ==================== 模块管理 ====================

    /** 挂载模块（幂等） */
    mount(moduleName: string, options?: ModuleMountOptions): Promise<void>;

    /** 批量挂载 */
    mountAll(
        modules: Array<{ name: string; options?: ModuleMountOptions }>
    ): Promise<void>;

    /**
     * 卸载模块
     * @param removeData - 是否同时删除数据（默认 false）
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
     * 除了下方的 read/write/exists 便捷方法外，
     * 其余操作一律通过 getEngine() 获取引擎后调用。
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
    //
    // 仅保留 3 个最高频方法。
    // 其余操作统一通过 getEngine(moduleName).xxx() 调用（DRY）。
    //

    /**
     * 读取文件内容
     * @throws FSNotFoundError
     */
    read(moduleName: string, path: string): Promise<string | ArrayBuffer>;

    /**
     * 写入文件内容（upsert 语义：不存在则创建，含中间目录）
     */
    write(
        moduleName: string,
        path: string,
        content: string | ArrayBuffer
    ): Promise<void>;

    /** 检查路径是否存在 */
    exists(moduleName: string, path: string): Promise<boolean>;

    // ==================== 跨模块搜索 ====================

    /**
     * 跨模块搜索
     * 分发到各模块的 search()，合并结果。
     */
    search(query: VFSSearchQuery): Promise<FSNode[]>;

    /**
     * 通过全局节点 ID 获取节点（不限模块）
     * 用于跨模块引用、链接跳转。
     */
    getNodeById(nodeId: string): Promise<(FSNode & { moduleName: string }) | null>;

    // ==================== 全局标签 ====================

    /** 汇总所有模块标签 */
    getAllTags(): Promise<GlobalTagInfo[]>;

    /** 更新全局标签定义 */
    updateTagDefinition(
        tagName: string,
        updates: { color?: string }
    ): Promise<void>;

    /** 按标签查找节点 ID（跨模块） */
    findByTag(tagName: string): Promise<string[]>;

    // ==================== 同步支持 ====================

    /**
     * 索引所有可同步文件
     * ⚠️ 大型系统应使用 walkAllFiles 替代
     */
    indexAllFiles(excludeModules?: string[]): Promise<SyncableFileInfo[]>;

    /** 遍历所有可同步文件（回调方式） */
    walkAllFiles?(
        callback: (file: SyncableFileInfo) => boolean | void,
        excludeModules?: string[]
    ): Promise<number>;

    /**
     * 通过系统级全路径读取
     *
     * 路径格式:
     *   /module/{moduleName}/relative/path  → 业务模块文件
     *   /__config/app.conf                  → 配置文件
     *   /dev/llm                            → 设备文件
     *
     * @example
     * ```ts
     * await vfs.readBySystemPath('/module/notes/hello.md');
     * await vfs.readBySystemPath('/__config/app.conf');
     * ```
     */
    readBySystemPath(systemPath: string): Promise<string | ArrayBuffer>;

    // ==================== 备份与导入导出 ====================

    /** 全量备份 */
    createBackup(): Promise<string>;

    /** 恢复备份 ⚠️ 覆盖所有数据 */
    restoreBackup(jsonContent: string): Promise<void>;

    /** 导出模块（类型化返回） */
    exportModule(moduleName: string): Promise<ModuleExportData>;

    /** 导入模块 */
    importModule(data: ModuleExportData): Promise<void>;

    // ==================== 统计 ====================

    getSystemStats?(): Promise<VFSSystemStats>;

    // ==================== 事件 ====================

    on<E extends VFSManagerEventType>(
        eventType: E,
        handler: (event: VFSManagerEvent<E>) => void
    ): () => void;

    onAny(
        handler: (type: string, event: VFSManagerEvent) => void
    ): () => void;

    // ==================== 插件 ====================

    getPlugin<T>(pluginId: string): T | null;

    // ==================== 生命周期 ====================

    /** 关闭 VFS，销毁所有引擎和连接 */
    shutdown(): Promise<void>;
}
