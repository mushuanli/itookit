// core/helper/types.ts
import type { StorageBackend } from '../../interface/storage';
import type { FileChangeEvent } from '../../interface/types';
import type { PathResolver } from '../path';
import type { DeviceManager } from '../../device/manager';
import type { MiddlewarePipeline } from '../../plugin/middleware';
import type { WatchManager } from './watch-manager';
import type { MountTable } from './mount-table';

/**
 * FileSystem 的最小子集 —— 供 helper 中需要完整 FS 操作的场景使用
 * （如 AssetDirUtils 需要调用 stat/mkdir/rmdir 等）
 */
export interface FSFacade {
  stat(path: string): Promise<import('../../interface/types').FileStat>;
  exists(path: string): Promise<boolean>;
  mkdir(path: string, options?: import('../../interface/types').MkdirOptions): Promise<void>;
  rmdir(path: string, options?: import('../../interface/types').RmdirOptions): Promise<void>;
  readdir(path: string, options?: import('../../interface/types').ReaddirOptions): Promise<import('../../interface/types').DirEntry[]>;
  read(path: string, options?: import('../../interface/types').ReadOptions): Promise<import('../../interface/types').FileContent>;
  create(path: string, content?: import('../../interface/types').FileContent, options?: import('../../interface/types').CreateOptions): Promise<import('../../interface/types').FileStat>;
  getAllFields(path: string): Promise<Record<string, import('../../interface/types').RecordValue>>;
  createRecord(path: string, initialFields?: Record<string, import('../../interface/types').RecordValue>, options?: import('../../interface/types').RecordFileOptions): Promise<import('../../interface/types').FileStat>;

  /**
   * ✅ 新增：内部元数据设置，不经过保护字段检查
   * AssetDirUtils 需要设置 assetDirIno / ownerFileIno / isAssetDir
   */
  setMetadata(path: string, metadata: Partial<import('../../interface/types').ExtendedMetadata>): Promise<void>;
}

/**
 * FileSystem 内部上下文 —— helper 模块通过此接口访问共享状态
 * 避免 helper 直接依赖 FileSystem 类（打破循环依赖）
 */
export interface FSContext {
  readonly rootBackend: StorageBackend;
  readonly pathResolver: PathResolver;
  readonly deviceManager: DeviceManager;
  readonly mountTable: MountTable;
  readonly watchManager: WatchManager;
  readonly middlewarePipeline: MiddlewarePipeline;

  /** 完整的文件系统门面，供需要高层操作的 helper 使用（如 AssetDirUtils） */
  readonly fs: FSFacade;

  /** 根据路径解析后端 */
  resolveBackend(path: string): { backend: StorageBackend; subPath: string };

  /** 发送文件变更事件 */
  emitEvent(
    type: FileChangeEvent['type'],
    path: string,
    oldPath?: string,
    field?: string,
  ): void;
}
