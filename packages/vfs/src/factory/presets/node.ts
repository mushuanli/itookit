// @file packages/vfs/src/presets/node.ts

import { VFSInstance, createVFS } from '../VFSFactory';
import { IPlugin } from '../../core';
import { MiddlewarePlugin } from '../../middleware';
import { TagsPlugin } from '../../tags';
import { AssetsPlugin } from '../../assets';
import { ModulesPlugin } from '../../modules';
import { VFS } from '../VFS';

/**
 * Node.js 预设配置
 */
export interface NodePresetOptions {
  /** SQLite 文件路径 */
  dbPath?: string;
  /** SQLite 驱动 */
  sqliteDriver?: unknown;
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
 * 创建 Node.js 环境 VFS
 * 需要安装 @vfs/storage-sqlite 包
 */
export async function createNodeVFS(
  options: NodePresetOptions = {}
): Promise<VFSInstance> {
  const {
    dbPath = './vfs.db',
    sqliteDriver,
    defaultModule = 'default',
    enableTags = true,
    enableAssets = true,
    extraPlugins = []
  } = options;

  // 动态导入 SQLite 插件
  let SQLiteStoragePlugin: any;
  try {
    const sqliteModule = await import('../../storage-sqlite');
    SQLiteStoragePlugin = sqliteModule.SQLiteStoragePlugin;
  } catch {
    throw new Error(
      'SQLite storage plugin not found. Please install @vfs/storage-sqlite'
    );
  }

  // 构建插件列表 - 明确声明类型为 IPlugin[]
  const plugins: IPlugin[] = [
    new SQLiteStoragePlugin({ driver: sqliteDriver }),
    new MiddlewarePlugin(),
    new ModulesPlugin()
  ];

  if (enableTags) {
    plugins.push(new TagsPlugin());
  }

  if (enableAssets) {
    plugins.push(new AssetsPlugin());
  }

  if (extraPlugins.length > 0) {
    plugins.push(...extraPlugins);
  }

  const vfs = await createVFS({
    storage: {
      type: 'sqlite',
      config: { path: dbPath, driver: sqliteDriver }
    },
    plugins,
    defaultModule
  });

  const modulesPlugin = vfs.getPlugin<ModulesPlugin>('vfs-modules');
  if (modulesPlugin) {
    await modulesPlugin.getModuleManager().ensureDefaultModule(defaultModule);
  }

  return vfs;
}

/**
 * 创建 Node.js 环境 VFS 并包装为高层 API
 */
export async function createNodeVFSWithAPI(
  options: NodePresetOptions = {}
): Promise<VFS> {
  const instance = await createNodeVFS(options);
  return new VFS(instance);
}

export default createNodeVFS;
