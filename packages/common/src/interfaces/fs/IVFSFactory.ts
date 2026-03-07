/**
 * @file common/interfaces/fs/IVFSFactory.ts
 * @desc VFS 工厂
 *
 * 重构要点：
 * - 移除 enableTags/enableAssets 等布尔开关
 *   （由各后端实现自行决定 capabilities，工厂不应越权）
 * - 新增 configServiceFactory 允许注入自定义配置服务实现
 */

import type { IVFSManager, ModuleMountOptions } from './IVFSManager';
import type { IConfigService } from './IConfigService';

export interface VFSFactoryOptions {
    dbName?: string;
    dbVersion?: number;

    /**
     * 初始化时挂载的模块列表
     * __config 模块始终自动挂载
     */
    modules?: Array<{
        name: string;
        options?: ModuleMountOptions;
    }>;

    /**
     * 初始配置（仅首次创建时写入，已有数据不覆盖）
     */
    initialConfigs?: Record<string, Record<string, string>>;

    /** 支持同步的模块名列表 */
    syncableModules?: string[];
}

export interface BrowserVFSOptions extends VFSFactoryOptions {
    /** @default 'indexeddb' */
    storageAdapter?: 'indexeddb' | 'opfs';
}

export interface ElectronVFSOptions extends VFSFactoryOptions {
    rootDir: string;
    enableWatch?: boolean;
}

/**
 * 工厂返回值：VFSManager + ConfigService
 *
 * 分离返回，消费方按需注入 DI 容器。
 */
export interface VFSInstance {
    manager: IVFSManager;
    config: IConfigService;
}

/**
 * 工厂函数签名
 */
export type VFSFactory<T extends VFSFactoryOptions = VFSFactoryOptions> = (
    options: T
) => Promise<VFSInstance>;
