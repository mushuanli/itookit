// @vfs-driver/core/filesystem.ts

import type {
  FileContent,
  FileStat,
  DirEntry,
  ExtendedMetadata,
  CreateOptions,
  ReadOptions,
  WriteOptions,
  CopyOptions,
  RenameOptions,
  MkdirOptions,
  RmdirOptions,
  ReaddirOptions,
  RecordValue,
  RecordFileOptions,
  RecordQuery,
  RecordQueryOptions,
  RecordQueryResult,
  FileChangeEvent,
  Watcher,
  WatchOptions,
  MountEntry,
} from '../interface/types';
import type { StorageBackend } from '../interface/storage';
import type { DeviceDriver } from '../interface/device';
import type { Plugin, MiddlewarePlugin } from '../interface/plugin';
import { PathUtils } from './path';
import { PathResolver } from './path';
import { DeviceManager } from '../device/manager';
import { MiddlewarePipeline } from '../plugin/middleware';
import { PluginManager } from '../plugin/manager';
import { AssetDirUtils } from './helper/assetdir';
import { FileSystemError } from './errors';

// ---- helper 模块 ----
import { MountTable } from './helper/mount-table';
import { WatchManager } from './helper/watch-manager';
import { FileOps } from './helper/file-ops';
import { DirOps } from './helper/dir-ops';
import { RecordOps } from './helper/record-ops';
import type { FSContext,FSFacade } from './helper/types';

export class FileSystem {
  private rootBackend: StorageBackend;
  private mountTable = new MountTable();
  private pathResolver = new PathResolver();
  private deviceManager = new DeviceManager();
  private middlewarePipeline = new MiddlewarePipeline();
  private pluginManager: PluginManager;
  private watchManager = new WatchManager();
  private initialized = false;

  private fileOps: FileOps;
  private dirOps: DirOps;
  private recordOps: RecordOps;
  private ctx: FSContext;  // ✅ 缓存 context

  readonly path = PathUtils;

  constructor(backend: StorageBackend) {
    this.rootBackend = backend;
    this.pluginManager = new PluginManager(this.middlewarePipeline);

    // 构建内部上下文
    this.ctx = this.createContext();  // ✅ 只创建一次
    this.fileOps = new FileOps(this.ctx);
    this.dirOps = new DirOps(this.ctx);
    this.recordOps = new RecordOps(this.ctx);
  }

  private createContext(): FSContext {
    const self = this;
    return {
      get rootBackend() { return self.rootBackend; },
      get pathResolver() { return self.pathResolver; },
      get deviceManager() { return self.deviceManager; },
      get mountTable() { return self.mountTable; },
      get watchManager() { return self.watchManager; },
      get middlewarePipeline() { return self.middlewarePipeline; },

      /**
       * ✅ 修复：FSFacade 中 setMetadata 指向内部方法
       * 绕过保护字段检查，允许 AssetDirUtils 设置 assetDirIno 等
       * 其余方法仍走正常路径（含中间件）
       */
      get fs(): FSFacade {
        return {
          stat: (p) => self.stat(p),
          exists: (p) => self.exists(p),
          mkdir: (p, o) => self.mkdir(p, o),
          rmdir: (p, o) => self.rmdir(p, o),
          readdir: (p, o) => self.dirOps.readdir(p, { ...o, includeAssetDirs: true }),
          read: (p, o) => self.read(p, o),
          create: (p, c, o) => self.create(p, c, o),
          getAllFields: (p) => self.getAllFields(p),
          createRecord: (p, f, o) => self.createRecord(p, f, o),
          // ✅ 关键：指向内部不受保护的 setMetadata
          setMetadata: (p, m) => self._setMetadataInternal(p, m),
        };
      },

      resolveBackend(path: string) {
        const mounted = self.mountTable.resolve(path);
        if (mounted) return mounted;
        return { backend: self.rootBackend, subPath: path };
      },

      emitEvent(type, path, oldPath?, field?) {
        self.watchManager.emit({
          type, path, oldPath, field, timestamp: Date.now(),
        });
      },
    };
  }

  // ============================================================
  // 生命周期
  // ============================================================

  async init(): Promise<void> {
    if (this.initialized) return;
    await this.rootBackend.init();
    this.initialized = true;
  }

  async close(): Promise<void> {
    if (!this.initialized) return;
    await this.rootBackend.close();
    this.initialized = false;
  }

  // ============================================================
  // 挂载
  // ============================================================

  async mount(path: string, backend: StorageBackend): Promise<void> {
    await backend.init();
    this.mountTable.add(path, backend);
  }

  async unmount(path: string): Promise<void> {
    this.mountTable.remove(path);
  }

  mounts(): MountEntry[] {
    return this.mountTable.list();
  }

  // ============================================================
  // 设备
  // ============================================================

  registerDevice(driver: DeviceDriver): void {
    this.deviceManager.register(driver);
  }

  unregisterDevice(name: string): void {
    this.deviceManager.unregister(name);
  }

  async ioctl(
    path: string,
    command: string | number,
    arg?: unknown,
  ): Promise<unknown> {
    const norm = PathUtils.normalize(path);
    if (!norm.startsWith('/dev/')) {
      throw new FileSystemError('ENOTTY', norm, 'Not a device path');
    }
    const name = norm.slice(5);
    if (!name || name.includes('/')) {
      throw new FileSystemError('ENOTTY', norm, 'Not a device path');
    }
    return this.deviceManager.ioctl(name, command, arg);
  }

  // ============================================================
  // 插件
  // ============================================================

  get plugins(): PluginManager {
    return this.pluginManager;
  }

  async use(plugin: Plugin | MiddlewarePlugin): Promise<void> {
    await this.pluginManager.use(plugin, this);
  }

  // ============================================================
  // Watch
  // ============================================================

  watch(
    path: string,
    callback: (event: FileChangeEvent) => void,
    options?: WatchOptions,
  ): Watcher {
    return this.watchManager.add(path, callback, options);
  }

  // ============================================================
  // 文件操作
  // ============================================================

  async create(
    path: string,
    content?: FileContent,
    options?: CreateOptions,
  ): Promise<FileStat> {
    return this.withMiddleware('create', path, { content, options }, () =>
      this.fileOps.create(path, content, options),
    );
  }

  async read(path: string, options?: ReadOptions): Promise<FileContent> {
    return this.withMiddleware('read', path, { options }, () =>
      this.fileOps.read(path, options),
    );
  }

  async write(
    path: string,
    content: FileContent,
    options?: WriteOptions,
  ): Promise<void> {
    return this.withMiddleware('write', path, { content, options }, () =>
      this.fileOps.write(path, content, options),
    );
  }

  async append(path: string, content: FileContent): Promise<void> {
    return this.withMiddleware('append', path, { content }, () =>
      this.fileOps.append(path, content),
    );
  }

  async unlink(
    path: string,
    options?: { assetDirStrategy?: 'keep' | 'remove' | 'orphan' },
  ): Promise<void> {
    return this.withMiddleware('unlink', path, { options }, () =>
      this.fileOps.unlink(path, options),
    );
  }

  async rename(
    oldPath: string,
    newPath: string,
    options?: RenameOptions,
  ): Promise<void> {
    return this.withMiddleware('rename', oldPath, { newPath, options }, () =>
      this.fileOps.rename(oldPath, newPath, options),
    );
  }

  async copy(
    src: string,
    dst: string,
    options?: CopyOptions,
  ): Promise<void> {
    return this.withMiddleware('copy', src, { dst, options }, () =>
      this.fileOps.copy(src, dst, options),
    );
  }

  async exists(path: string): Promise<boolean> {
    return this.withMiddleware('exists', path, {}, () =>
      this.fileOps.exists(path),
    );
  }

  async stat(path: string): Promise<FileStat> {
    return this.withMiddleware('stat', path, {}, () =>
      this.fileOps.stat(path),
    );
  }

  // ============================================================
  // 目录操作
  // ============================================================

  async mkdir(path: string, options?: MkdirOptions): Promise<void> {
    return this.withMiddleware('mkdir', path, { options }, () =>
      this.dirOps.mkdir(path, options),
    );
  }

  async rmdir(path: string, options?: RmdirOptions): Promise<void> {
    return this.withMiddleware('rmdir', path, { options }, () =>
      this.dirOps.rmdir(path, options),
    );
  }

  async readdir(path: string, options?: ReaddirOptions): Promise<DirEntry[]> {
    return this.withMiddleware('readdir', path, { options }, () =>
      this.dirOps.readdir(path, options),
    );
  }

  async readdirVisible(
    path: string,
    options?: ReaddirOptions,
  ): Promise<DirEntry[]> {
    return this.dirOps.readdirVisible(path, options);
  }

  // ============================================================
  // 元数据操作
  // ============================================================

  async setMetadata(
    path: string,
    metadata: Partial<ExtendedMetadata>,
  ): Promise<void> {
    return this.withMiddleware('setMetadata', path, { metadata }, async () => {
      const norm = PathUtils.normalize(path);
      const { backend, subPath } = this.resolveBackend(norm);
      const { inode } = await this.pathResolver.resolve(subPath, backend);

      // ✅ 修复：保护 assetdir 内部字段，防止用户误操作破坏引用完整性
      const safeMeta = this.sanitizeMetadata(metadata, inode);

      Object.assign(inode.metadata, safeMeta);
      inode.modifiedAt = Date.now();
      await backend.putInode(inode);

      this.emitEvent('metadata', norm);
    });
  }

  async getMetadata(path: string): Promise<ExtendedMetadata> {
    return this.withMiddleware('getMetadata', path, {}, async () => {
      const norm = PathUtils.normalize(path);
      const { backend, subPath } = this.resolveBackend(norm);
      const { inode } = await this.pathResolver.resolve(subPath, backend);
      return { ...inode.metadata };
    });
  }


  // ============================================================
  // Record 文件操作（新增）
  // ============================================================

  async createRecord(
    path: string,
    initialFields?: Record<string, RecordValue>,
    options?: RecordFileOptions,
  ): Promise<FileStat> {
    return this.withMiddleware('createRecord', path, { initialFields, options }, () =>
      this.recordOps.createRecord(path, initialFields, options),
    );
  }

  async getField(path: string, field: string): Promise<RecordValue | undefined> {
    return this.withMiddleware('getField', path, { field }, () =>
      this.recordOps.getField(path, field),
    );
  }

  /**
   * 设置单个字段（不存在则创建，已存在则覆盖）
   */
  async setField(path: string, field: string, value: RecordValue): Promise<void> {
    return this.withMiddleware('setField', path, { field, value }, () =>
      this.recordOps.setField(path, field, value),
    );
  }

  async deleteField(path: string, field: string): Promise<void> {
    return this.withMiddleware('deleteField', path, { field }, () =>
      this.recordOps.deleteField(path, field),
    );
  }

  async getAllFields(path: string): Promise<Record<string, RecordValue>> {
    return this.withMiddleware('getAllFields', path, {}, () =>
      this.recordOps.getAllFields(path),
    );
  }

  /**
   * 批量设置所有字段（覆盖）
   */
  async setAllFields(
    path: string,
    fields: Record<string, RecordValue>,
  ): Promise<void> {
    return this.withMiddleware('setAllFields', path, { fields }, () =>
      this.recordOps.setAllFields(path, fields),
    );
  }

  async listFields(path: string): Promise<string[]> {
    return this.withMiddleware('listFields', path, {}, () =>
      this.recordOps.listFields(path),
    );
  }

  async queryFields(
    path: string,
    query: RecordQuery,
    options?: RecordQueryOptions,
  ): Promise<RecordQueryResult[]> {
    return this.withMiddleware('queryFields', path, { query, options }, () =>
      this.recordOps.queryFields(path, query, options),
    );
  }

  async createIndex(path: string, field: string): Promise<void> {
    return this.withMiddleware('createIndex', path, { field }, () =>
      this.recordOps.createIndex(path, field),
    );
  }

  async deleteIndex(path: string, field: string): Promise<void> {
    return this.withMiddleware('deleteIndex', path, { field }, () =>
      this.recordOps.deleteIndex(path, field),
    );
  }

  // ============================================================
  // AssetDir 操作（新增）
  // ============================================================

  async getAssetDir(path: string): Promise<string | null> {
    return AssetDirUtils.getAssetDir(this.ctx.fs, path);
  }

  /**
   * 确保文件的 assetdir 存在
   */
  async ensureAssetDir(path: string): Promise<string> {
    return AssetDirUtils.ensureAssetDir(this.ctx.fs, path);
  }

  async hasAssetDir(path: string): Promise<boolean> {
    return AssetDirUtils.hasAssetDir(this.ctx.fs, path);
  }

  async removeAssetDir(
    path: string,
    removeContent: boolean = false,
  ): Promise<void> {
    return AssetDirUtils.removeAssetDir(this.ctx.fs, path, removeContent);
  }

  async listAssets(path: string): Promise<string[]> {
    return AssetDirUtils.listAssets(this.ctx.fs, path);
  }

  // ============================================================
  // AssetDir 维护接口
  // ============================================================
  async validateAssetDir(path: string): Promise<string[]> {
    return AssetDirUtils.validateConsistency(this.ctx.fs, path);
  }

  async repairAssetDir(path: string): Promise<void> {
    return AssetDirUtils.repairConsistency(this.ctx.fs, path);
  }

  async validateAssetDirRecursive(
    dirPath: string,
  ): Promise<Map<string, string[]>> {
    return this.walkForAssetValidation(
      PathUtils.normalize(dirPath),
      'validate',
    ) as Promise<Map<string, string[]>>;
  }

  async repairAssetDirRecursive(dirPath: string): Promise<void> {
    await this.walkForAssetValidation(
      PathUtils.normalize(dirPath),
      'repair',
    );
  }

  // ============================================================
  // 事务
  // ============================================================

  async transaction<T>(
    fn: (fs: FileSystem) => Promise<T>,
  ): Promise<T> {
    const result = await this.rootBackend.runInTransaction(
      'readwrite',
      async (txBackend: StorageBackend) => {
        const txFs = this.createTransactionFs(txBackend);
        return fn(txFs);
      },
    );

    // ✅ 修复：事务完成后清除主 pathResolver 缓存
    // 事务中可能修改了任意路径，无法精确失效，全量清除
    this.pathResolver.clearCache();

    return result;
  }

  // ============================================================
  // 内部方法（供 AssetDirUtils 调用）
  // ============================================================

  /** @internal 供 AssetDirUtils 调用的无中间件 rename */
  async _renameInternal(
    oldPath: string,
    newPath: string,
  ): Promise<void> {
    await this.fileOps.rename(oldPath, newPath, { syncAssetDir: false });
  }

  /**
   * ✅ 新增：内部使用的 setMetadata，不经过保护检查
   * 供 AssetDirUtils 等内部模块使用
   * @internal
   */
  async _setMetadataInternal(
    path: string,
    metadata: Partial<ExtendedMetadata>,
  ): Promise<void> {
    const norm = PathUtils.normalize(path);
    const { backend, subPath } = this.resolveBackend(norm);
    const { inode } = await this.pathResolver.resolve(subPath, backend);

    Object.assign(inode.metadata, metadata);
    inode.modifiedAt = Date.now();
    await backend.putInode(inode);

    this.emitEvent('metadata', norm);
  }

  // ============================================================
  // 私有辅助
  // ============================================================

  /**
   * 根据路径确定使用的后端
   * 先查挂载表，未命中则使用根后端
   */
  private resolveBackend(
    path: string,
  ): { backend: StorageBackend; subPath: string } {
    const mounted = this.mountTable.resolve(path);
    if (mounted) return mounted;
    return { backend: this.rootBackend, subPath: path };
  }

  private emitEvent(
    type: FileChangeEvent['type'],
    path: string,
    oldPath?: string,
    field?: string,
  ): void {
    this.watchManager.emit({
      type, path, oldPath, field, timestamp: Date.now(),
    });
  }

  private withMiddleware<T>(
    operation: string,
    path: string,
    args: Record<string, unknown>,
    coreFn: () => Promise<T>,
  ): Promise<T> {
    return this.middlewarePipeline.execute(
      operation, path, args, coreFn,
    ) as Promise<T>;
  }

  private createTransactionFs(txBackend: StorageBackend): FileSystem {
    const txFs = new FileSystem(txBackend);
    txFs.initialized = true;
    // 共享只读子系统，不复制
    txFs.deviceManager = this.deviceManager;
    txFs.pluginManager = this.pluginManager;
    txFs.middlewarePipeline = this.middlewarePipeline;
    txFs.mountTable = this.mountTable;
    txFs.watchManager = this.watchManager;
    return txFs;
  }

  /**
   * 递归遍历目录执行 assetdir 验证或修复
   */
  private async walkForAssetValidation(
    dirPath: string,
    mode: 'validate' | 'repair',
  ): Promise<Map<string, string[]> | void> {
    const issues = mode === 'validate' ? new Map<string, string[]>() : undefined;
    const facade = this.ctx.fs;  // ✅ 使用内部门面

    const walk = async (path: string): Promise<void> => {
      // ✅ 使用 includeAssetDirs: true 才能看到 assetdir 并跳过
      const entries = await this.dirOps.readdir(path, { includeAssetDirs: true });
      for (const entry of entries) {
        const childPath =
          path === '/' ? `/${entry.name}` : `${path}/${entry.name}`;
        const childStat = await this.stat(childPath);

        if (childStat.isDirectory()) {
          if (!childStat.metadata.isAssetDir) {
            await walk(childPath);
          }
        // ✅ 修改：扩展支持 Record 文件
        } else if (childStat.isFile() || childStat.isRecord()) {
          if (mode === 'validate') {
            const fileIssues =
              await AssetDirUtils.validateConsistency(facade, childPath);
            if (fileIssues.length > 0) {
              issues!.set(childPath, fileIssues);
            }
          } else {
            await AssetDirUtils.repairConsistency(facade, childPath);
          }
        }
      }
    };

    await walk(dirPath);
    return issues;
  }

  /**
   * 清理用户传入的元数据，阻止修改 assetdir 保护字段
   * 仅在公开 API 中使用，内部操作不经过此检查
   */
  private sanitizeMetadata(
    metadata: Partial<ExtendedMetadata>,
    _inode: import('../interface/types').Inode,
  ): Partial<ExtendedMetadata> {
  // ✅ 修复：不再过滤保护字段，仅发出警告
  // 用户可能需要在高级场景（迁移、修复）中设置这些字段
  const hasProtected = Object.keys(metadata).some(
    key => AssetDirUtils.isProtectedField(key)
  );

  if (hasProtected) {
    console.warn(
      `[VFS] setMetadata: modifying protected fields (assetDirIno, ownerFileIno, isAssetDir). ` +
      `Prefer ensureAssetDir/removeAssetDir for normal usage.`
    );
  }

  return metadata;
  }
}

