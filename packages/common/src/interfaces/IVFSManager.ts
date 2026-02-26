/**
 * @file common/interfaces/IVFSManager.ts
 * @desc 系统级 VFS 管理接口
 *
 * 职责边界:
 * - IModuleFS: 模块内的文件操作（"我是笔记模块，我操作我的文件"）
 * - IVFSManager: 跨模块的系统管理（"我是管理员，我管理所有模块"）
 *
 * 使用者: SettingsService, SyncService, 应用初始化代码
 * 不应被普通工作区/编辑器直接依赖
 */
import type { IModuleFS } from './IModuleFS';

// ============================================
// 模块信息
// ============================================

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

// ============================================
// VFS 事件（系统级）
// ============================================

export type VFSEventType =
    | 'node:created'
    | 'node:updated'
    | 'node:deleted'
    | 'module:mounted'
    | 'module:unmounted'
    | 'sync:*'; // 通配符，匹配所有 sync: 前缀事件

export interface VFSEvent {
    type: string;
    path?: string;
    moduleId?: string;
    data?: unknown;
    timestamp: number;
}

// ============================================
// 全局标签
// ============================================

export interface GlobalTagInfo {
    name: string;
    color?: string;
    refCount?: number;
}

// ============================================
// 核心接口
// ============================================

export interface IVFSManager {
    // ==================== 模块管理 ====================

    /**
     * 挂载模块
     * 如果模块已存在，不抛出错误（幂等）
     */
    mount(moduleName: string, options?: ModuleMountOptions): Promise<void>;

    /** 获取模块信息，不存在返回 null */
    getModule(moduleName: string): ModuleInfo | null;

    /** 获取所有已挂载模块 */
    getAllModules(): ModuleInfo[];

    /**
     * 为指定模块创建 IModuleFS 实例
     * 这是 IVFSManager 与 IModuleFS 的桥梁
     */
    createEngine(moduleName: string): IModuleFS;

    // ==================== 跨模块文件操作 ====================

    /**
     * 在指定模块中读取文件
     * @param moduleName - 目标模块名
     * @param path - 模块内路径
     */
    read(moduleName: string, path: string): Promise<string | ArrayBuffer>;

    /**
     * 在指定模块中写入文件
     * 如果文件不存在，行为由实现决定（建议自动创建）
     */
    write(
        moduleName: string,
        path: string,
        content: string | ArrayBuffer
    ): Promise<void>;

    /**
     * 在指定模块中创建文件
     */
    createFile(
        moduleName: string,
        path: string,
        content?: string | ArrayBuffer
    ): Promise<void>;

    /**
     * 在指定模块中创建目录
     */
    createDirectory(moduleName: string, path: string): Promise<void>;

    /**
     * 获取指定模块中的节点信息
     */
    getNode(moduleName: string, path: string): Promise<VFSNodeInfo | null>;

    /**
     * 通过全局 ID 获取节点（不限模块）
     */
    getNodeById(nodeId: string): Promise<VFSNodeInfo | null>;

    /**
     * 更新节点元数据（通过全局 ID）
     */
    updateMetadata(
        nodeId: string,
        metadata: Record<string, unknown>
    ): Promise<void>;

    // ==================== 全局标签系统 ====================

    /** 获取所有模块中的标签汇总 */
    getAllTags(): Promise<GlobalTagInfo[]>;

    /** 更新标签定义（颜色等） */
    updateTagDefinition(
        tagName: string,
        updates: { color?: string }
    ): Promise<void>;

    /** 按标签查找节点 ID（跨模块） */
    findByTag(tagName: string): Promise<string[]>;

    /** 从节点移除指定标签 */
    removeTag(nodeId: string, tagName: string): Promise<void>;

    // ==================== 备份与导入导出 ====================

    /** 创建全量备份（JSON 字符串） */
    createBackup(): Promise<string>;

    /** 恢复全量备份 */
    restoreBackup(jsonContent: string): Promise<void>;

    /** 导出单个模块的数据 */
    exportModule(moduleName: string): Promise<unknown>;

    /** 导入模块数据 */
    importModule(data: unknown): Promise<void>;

    // ==================== 同步支持 ====================

    /**
     * 索引所有可同步文件
     * 替代 SettingsService 中直接访问 kernel 的逻辑
     * @param excludeModules - 要排除的系统模块列表
     */
    indexAllFiles(excludeModules?: string[]): Promise<SyncableFileInfo[]>;

    /**
     * 通过系统级全路径读取文件内容
     * @param systemPath - 如 '/notes/hello.md'（含模块前缀）
     */
    readBySystemPath(systemPath: string): Promise<string | ArrayBuffer>;

    // ==================== 事件系统 ====================

    /**
     * 订阅全局文件系统事件
     * 
     * 接收所有模块的节点变更事件
     * event.path 为系统级全路径（如 '/notes/hello.md'）
     * event.moduleId 标识来源模块
     */
    on(eventType: VFSEventType, handler: (event: VFSEvent) => void): () => void;

    /**
     * 订阅所有事件（含插件自定义事件如 sync:*）
     * 主要用于 SyncService、日志系统
     */
    onAny(handler: (type: string, event: VFSEvent) => void): () => void;

    // ==================== 插件系统 ====================

    /**
     * 获取已注册的插件实例
     * @param pluginId - 插件标识符
     */
    getPlugin<T>(pluginId: string): T | null;

    // ==================== 生命周期 ====================

    /** 关闭 VFS，释放所有资源 */
    shutdown(): Promise<void>;
}

// ============================================
// 辅助类型
// ============================================

export interface VFSNodeInfo {
    nodeId: string;
    name: string;
    path: string;
    type: 'file' | 'directory';
    modifiedAt: number;
    metadata?: Record<string, unknown>;
}

export interface SyncableFileInfo {
    /** 系统级全路径: /{moduleName}/relative/path */
    path: string;
    nodeId: string;
    type: 'file' | 'directory';
    modifiedAt: number;
    /** 所属模块名 */
    moduleName: string;
}
