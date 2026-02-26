/**
 * @file common/interfaces/IVFSFactory.ts
 * @desc VFS 工厂类型定义
 *
 * 仅在应用初始化层（Composition Root）使用。
 * 各平台提供不同的工厂实现，消费方只依赖 IVFSManager 接口。
 *
 * 使用示例:
 *
 * ```ts
 * // Browser
 * import { createBrowserVFS }
 * from '@itookit/vfs-browser';
 * const vfs = await createBrowserVFS({ dbName: 'MindOS' });
 *
 * // Electron
 * import { createElectronVFS } from '@itookit/vfs-electron';
 * const vfs = await createElectronVFS({ rootDir: '/home/user/data' });
 *
 * // Test
 * import { createMemoryVFS } from '@itookit/vfs-memory';
 * const vfs = await createMemoryVFS();
 * ```
 */

import type { IVFSManager } from './IVFSManager';

/**
 * VFS 工厂配置选项
 *
 * 这些选项是跨平台通用的。
 * 特定平台的扩展选项通过泛型或交叉类型处理。
 */
export interface VFSFactoryOptions {
    /** 数据库/存储名称 */
    dbName?: string;

    /** 数据库/存储版本（用于 schema 迁移） */
    dbVersion?: number;

    /** 默认模块名（初始化后自动挂载） */
    defaultModule?: string;

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
     * IndexedDB 存储适配器类型
     * @default 'indexeddb'
     */
    storageAdapter?: 'indexeddb' | 'opfs';
}

/**
 * Electron 平台扩展选项
 */
export interface ElectronVFSOptions extends VFSFactoryOptions {
    /** 数据文件根目录 */
    rootDir: string;

    /** 是否启用文件监听 */
    enableWatch?: boolean;
}

/**
 * 创建 IVFSManager 实例的工厂函数签名
 *
 * 不同平台提供不同实现:
 * - Browser: createBrowserVFS(options: BrowserVFSOptions)
 * - Electron: createElectronVFS(options: ElectronVFSOptions)
 * - Test: createMemoryVFS(options?: VFSFactoryOptions)
 *
 * 应用初始化层选择对应的工厂函数，创建实例后
 * 通过依赖注入传递给各 Service / Engine。
 */
export type VFSFactory<T extends VFSFactoryOptions = VFSFactoryOptions> = (
    options: T
) => Promise<IVFSManager>;
