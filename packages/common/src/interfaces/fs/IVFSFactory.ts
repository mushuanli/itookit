
// common/interfaces/fs/IVFSFactory.ts
/**
 * @file common/interfaces/fs/IVFSFactory.ts
 * @desc VFS 工厂类型定义
 *
 * 仅在应用初始化层（Composition Root）使用。
 * 各平台提供不同的工厂实现，消费方只依赖 IVFSManager 接口。
 *
 * 初始化流程:
 * 1. 工厂创建 IVFSManager 实例
 * 2. 自动挂载 __config 模块（默认初始化）
 * 3. 写入 initialConfigs（如果提供且配置文件不存在）
 * 4. 挂载 modules 列表中的模块（静态初始化）
 * 5. 返回就绪的 IVFSManager 实例
 *
 * @example
 * ```ts
 * // Browser
 * import { createBrowserVFS } from '@itookit/vfs-browser';
 * const vfs = await createBrowserVFS({
 *   dbName: 'MindOS',
 *   modules: [
 *     { name: 'notes', options: { syncEnabled: true } },
 *     { name: 'chat' },
 *   ],
 *   initialConfigs: {
 *     app: { 'theme': 'dark', 'language': 'zh-CN' },
 *   },
 * });
 *
 * // Electron
 * import { createElectronVFS } from '@itookit/vfs-electron';
 * const vfs = await createElectronVFS({
 *   rootDir: '/home/user/data',
 *   enableWatch: true,
 * });
 *
 * // Test
 * import { createMemoryVFS } from '@itookit/vfs-memory';
 * const vfs = await createMemoryVFS();
 * ```
 */

import type { IVFSManager, ModuleMountOptions } from './IVFSManager';

/**
 * VFS 工厂配置选项（跨平台通用）
 */
export interface VFSFactoryOptions {
    /** 数据库/存储名称 */
    dbName?: string;

    /** 数据库/存储版本（用于 schema 迁移） */
    dbVersion?: number;

    /**
     * 初始化时自动挂载的模块列表
     *
     * __config 模块始终自动挂载，无需在此列出。
     */
    modules?: Array<{
        name: string;
        options?: ModuleMountOptions;
    }>;

    /**
     * 初始配置数据
     *
     * 仅在首次创建时写入 __config 模块。
     * 如果配置文件已有数据，不会覆盖。
     *
     * 键为配置文件名（如 'app', 'theme'），
     * 值为该配置文件的初始键值对。
     */
    initialConfigs?: Record<string, Record<string, string>>;

    /** 是否启用标签系统 */
    enableTags?: boolean;

    /** 是否启用资产目录功能 */
    enableAssets?: boolean;

    /** 支持同步的模块名列表 */
    syncableModules?: string[];
}

/**
 * 浏览器平台扩展选项
 */
export interface BrowserVFSOptions extends VFSFactoryOptions {
    /**
     * 存储适配器类型
     * @default 'indexeddb'
     */
    storageAdapter?: 'indexeddb' | 'opfs';
}

/**
 * Electron 平台扩展选项
 */
export interface ElectronVFSOptions extends VFSFactoryOptions {
    /** 数据文件根目录（必填） */
    rootDir: string;

    /** 是否启用文件监听 */
    enableWatch?: boolean;
}

/**
 * 创建 IVFSManager 实例的工厂函数签名
 *
 * 不同平台提供不同实现，应用初始化层选择对应的工厂函数，
 * 创建实例后通过依赖注入传递给各 Service / Engine。
 */
export type VFSFactory<T extends VFSFactoryOptions = VFSFactoryOptions> = (
    options: T
) => Promise<IVFSManager>;
