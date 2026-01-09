// @file packages/vfs/src/presets/browser.ts

import { VFSInstance, createVFS } from '../VFSFactory';
import { IPlugin } from '../../core';
import { IndexedDBStoragePlugin } from '../../storage-indexeddb';
import { MiddlewarePlugin } from '../../middleware';
import { TagsPlugin } from '../../tags';
import { AssetsPlugin } from '../../assets';
import { ModulesPlugin } from '../../modules';
import { VFS } from '../VFS';

/**
 * 浏览器预设配置
 */
export interface BrowserPresetOptions {
  /** 数据库名称 */
  dbName?: string;
  /** 数据库版本 */
  dbVersion?: number;
  /** 默认模块 */
  defaultModule?: string;
  /** 是否启用标签 */
  enableTags?: boolean;
  /** 是否启用资产管理 */
  enableAssets?: boolean;
  /** 额外插件 */
  extraPlugins?: IPlugin[];
}

/**
 * 创建浏览器环境 VFS
 */
export async function createBrowserVFS(
  options: BrowserPresetOptions = {}
): Promise<VFSInstance> {
  const {
    dbName = 'vfs_database',
    dbVersion = 1,
    defaultModule = 'default',
    enableTags = true,
    enableAssets = true,
    extraPlugins = []
  } = options;

  // 注册 IndexedDB 适配器
  const indexedDBPlugin = new IndexedDBStoragePlugin();

  // 构建插件列表 - 明确声明类型为 IPlugin[]
  const plugins: IPlugin[] = [
    indexedDBPlugin,
    new MiddlewarePlugin(),
    new ModulesPlugin()
  ];

  if (enableTags) {
    plugins.push(new TagsPlugin());
  }

  if (enableAssets) {
    plugins.push(new AssetsPlugin());
  }

  // 添加额外插件
  if (extraPlugins.length > 0) {
    plugins.push(...extraPlugins);
  }

  const vfs = await createVFS({
    storage: {
      type: 'indexeddb',
      config: { dbName, version: dbVersion }
    },
    plugins,
    defaultModule
  });

  // ✅ 关键：先初始化模块管理器（加载已有注册表）
  const modulesPlugin = vfs.getPlugin<ModulesPlugin>('vfs-modules');
  if (modulesPlugin) {
    await modulesPlugin.getModuleManager().ensureDefaultModule(defaultModule);
  }

  return vfs;
}

/**
 * 创建浏览器环境 VFS 并包装为高层 API
 */
export async function createBrowserVFSWithAPI(
  options: BrowserPresetOptions = {}
): Promise<VFS> {
  const instance = await createBrowserVFS(options);
  return new VFS(instance);
}

export default createBrowserVFS;
