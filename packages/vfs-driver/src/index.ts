// @vfs-driver/index.ts

// ---- 类型导出 ----
export type {
  Inode,
  DirEntry,
  ExtendedMetadata,
  JsonSerializable,
  FileContent,
  FileStat,
  CreateOptions,
  UnlinkOptions,
  RenameOptions,
  CopyOptions,
  ReadOptions,
  WriteOptions,
  MkdirOptions,
  RmdirOptions,
  ReaddirOptions,
  WatchOptions,
  FileChangeEvent,
  Watcher,
  MountEntry,
  ErrorCode,
  // Record 类型
  RecordValue,
  RecordFileOptions,
  RecordField,
  QueryOperator,
  RecordQuery,
  RecordQueryOptions,
  RecordQueryResult,
} from './interface/types';
export type {  FileSystemOptions,
} from './interface/options';
export type {
  Plugin,
  MiddlewarePlugin,
  MiddlewareHandler,
  OperationContext,
  PluginInfo,
} from './interface/plugin';
export type {
  DeviceDriver,
} from './interface/device';
export { FileType } from './interface/types';

// ---- 核心导出 ----
export { FileSystem } from './core/filesystem';
export { FileSystemError } from './core/errors';
export { PathUtils } from './core/path';
export { createInode, inodeToStat } from './core/inode';
export { AssetDirUtils } from './core/helper/assetdir';

// ---- 后端导出 ----
export type { StorageBackend, HighLevelBackend, RecordBackend } from './interface/storage';
export { isHighLevelBackend, isRecordBackend } from './interface/storage';
export { MemoryBackend } from './backend/memory';
export { IndexedDBBackend } from './backend/indexeddb';
// NodeFSBackend 需要 node 环境，条件导出
export { NodeFSBackend } from './backend/node-fs';

// ---- 设备导出 ----
export { DeviceManager } from './device/manager';
export {
  nullDevice,
  zeroDevice,
  randomDevice,
  builtinDevices,
} from './device/builtins';

// ---- 插件导出 ----
export { PluginManager } from './plugin/manager';
export { MiddlewarePipeline } from './plugin/middleware';
export { loggerPlugin } from './plugin/builtins.js';

// ============================================================
// 工厂函数 —— KISS 入口
// ============================================================
import type { Plugin, MiddlewarePlugin } from './interface/plugin';
import type { DeviceDriver } from './interface/device';

import { FileSystem } from './core/filesystem';
import { MemoryBackend } from './backend/memory';
import { IndexedDBBackend } from './backend/indexeddb';
import { builtinDevices } from './device/builtins';
import {StorageBackend,FileSystemOptions} from './interface';

function detectEnvironment(): 'indexeddb' | 'node-fs' | 'memory' {
  if (typeof indexedDB !== 'undefined') return 'indexeddb';
  if (typeof process !== 'undefined' && process.versions?.node) return 'node-fs';
  return 'memory';
}

async function createBackend(
  type: string,
  config?: Record<string, unknown>,
): Promise<StorageBackend> {
  switch (type) {
    case 'indexeddb':
      return new IndexedDBBackend(config as any);
    case 'node-fs': {
      // 动态导入避免浏览器环境加载 node 模块
      const { NodeFSBackend } = await import('./backend/node-fs.js');
      if (!config?.rootPath) {
        throw new Error('NodeFSBackend requires rootPath in backendConfig');
      }
      return new NodeFSBackend(config as any);
    }
    case 'memory':
    default:
      return new MemoryBackend();
  }
}

export async function createFileSystem(
  options?: FileSystemOptions,
): Promise<FileSystem> {
  const backendType = options?.backend ?? detectEnvironment();
  const backend = await createBackend(backendType, options?.backendConfig);

  const fs = new FileSystem(backend);
  await fs.init();

  // 注册内置设备
  if (options?.builtinDevices !== false) {
    for (const device of builtinDevices) {
      fs.registerDevice(device);
    }
  }

  // 注册用户设备
  if (options?.devices) {
    for (const device of options.devices as DeviceDriver[]) {
      fs.registerDevice(device);
    }
  }

  // 注册用户插件
  if (options?.plugins) {
    for (const plugin of options.plugins as (Plugin | MiddlewarePlugin)[]) {
      await fs.use(plugin);
    }
  }

  return fs;
}

