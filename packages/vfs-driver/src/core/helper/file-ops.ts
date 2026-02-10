// core/helper/file-ops.ts
import type {
  FileContent,
  FileStat,
  Inode,
  DirEntry,
  CreateOptions,
  ReadOptions,
  WriteOptions,
  CopyOptions,
  RecordValue,
} from '../../interface/types';
import type { StorageBackend } from '../../interface/storage';
import { FileType } from '../../interface/types';
import { isHighLevelBackend, isRecordBackend } from '../../interface/storage';
import { FileSystemError } from '../errors';
import { PathUtils } from '../path';
import { createInode, inodeToStat } from '../inode';
import { contentToBuffer, bufferToContent } from './content';
import { FallbackRecordOps } from './fallback-record';
import { AssetDirUtils } from './assetdir';
import type { FSContext } from './types';

export class FileOps {
  constructor(private readonly ctx: FSContext) {}

  async create(
    path: string,
    content?: FileContent,
    options?: CreateOptions,
  ): Promise<FileStat> {
    const norm = PathUtils.normalize(path);
    //const deviceRouting = this.ctx.deviceManager;

    if (norm === '/dev' || norm.startsWith('/dev/')) {
      throw new FileSystemError('EACCES', norm, 'Cannot create device files directly');
    }

    const { backend, subPath } = this.ctx.resolveBackend(norm);

    // 递归创建父目录
    if (options?.recursive) {
      const parentDir = PathUtils.dirname(norm);
      if (parentDir !== '/') {
        const parentExists = await this.exists(parentDir);
        if (!parentExists) {
          // 由外部 DirOps 处理，通过 FSContext 回调
          const { DirOps } = await import('./dir-ops');
          const dirOps = new DirOps(this.ctx);
          await dirOps.mkdir(parentDir, { recursive: true });
        }
      }
    }

    const { parentInode, childName } =
      await this.ctx.pathResolver.resolveParent(subPath, backend);

    const existingEntries = await backend.getDirEntries(parentInode.ino);
    const existing = existingEntries.find((e: DirEntry) => e.name === childName);

    if (existing) {
      return this.overwriteExisting(
        norm, backend, existing, content, options,
      );
    }

    return this.createNew(
      norm, backend, parentInode.ino, childName, content, options,
    );
  }

  async read(path: string, options?: ReadOptions): Promise<FileContent> {
    const norm = PathUtils.normalize(path);

    // 设备路径
    if (norm.startsWith('/dev/')) {
      const name = norm.slice(5);
      if (name && !name.includes('/') && this.ctx.deviceManager.has(name)) {
        return this.ctx.deviceManager.read(name);
      }
    }

    const { backend, subPath } = this.ctx.resolveBackend(norm);

    if (isHighLevelBackend(backend) && backend.readByPath) {
      const result = await backend.readByPath(subPath);
      if (!result) throw new FileSystemError('ENOENT', norm);
      return bufferToContent(result.data, options?.encoding);
    }

    const { inode } = await this.ctx.pathResolver.resolve(subPath, backend);

    if (inode.type === FileType.DIRECTORY)
      throw new FileSystemError('EISDIR', norm);
    if (inode.type === FileType.RECORD)
      throw new FileSystemError('ENOTRECORD', norm, 'Use getField/getAllFields for record files');
    if (inode.type !== FileType.REGULAR)
      throw new FileSystemError('EINVAL', norm, 'Cannot read this file type');

    if (!inode.dataRef)
      return bufferToContent(new ArrayBuffer(0), options?.encoding);

    const data = await backend.getData(inode.dataRef);
    if (!data) throw new FileSystemError('EIO', norm, 'Data block missing');

    inode.accessedAt = Date.now();
    await backend.putInode(inode);

    return bufferToContent(data, options?.encoding);
  }

  async write(
    path: string,
    content: FileContent,
    options?: WriteOptions,
  ): Promise<void> {
    const norm = PathUtils.normalize(path);

    // 设备路径
    if (norm.startsWith('/dev/')) {
      const name = norm.slice(5);
      if (name && !name.includes('/') && this.ctx.deviceManager.has(name)) {
        await this.ctx.deviceManager.write(name, content);
        return;
      }
    }

    const { backend, subPath } = this.ctx.resolveBackend(norm);
    const shouldCreate = options?.create ?? true;

    let resolved: { inode: Inode; parentIno: number; name: string };
    try {
      resolved = await this.ctx.pathResolver.resolve(subPath, backend);
    } catch (err) {
      if (
        err instanceof FileSystemError &&
        err.code === 'ENOENT' &&
        shouldCreate
      ) {
        await this.create(path, content, { metadata: options?.metadata });
        return;
      }
      throw err;
    }

    const { inode } = resolved;
    if (inode.type === FileType.DIRECTORY)
      throw new FileSystemError('EISDIR', norm);
    if (inode.type === FileType.RECORD)
      throw new FileSystemError('ENOTRECORD', norm, 'Use setField/setAllFields for record files');
    if (inode.type !== FileType.REGULAR)
      throw new FileSystemError('EINVAL', norm);

    const buf = contentToBuffer(content);
    if (!inode.dataRef) inode.dataRef = `data-${inode.ino}`;

    await backend.putData(inode.dataRef, buf);
    inode.size = buf.byteLength;
    inode.modifiedAt = Date.now();
    if (options?.metadata) Object.assign(inode.metadata, options.metadata);
    await backend.putInode(inode);

    this.ctx.emitEvent('modify', norm);
  }

  async append(path: string, content: FileContent): Promise<void> {
    const norm = PathUtils.normalize(path);
    const { backend, subPath } = this.ctx.resolveBackend(norm);

    let resolved: { inode: Inode; parentIno: number; name: string };
    try {
      resolved = await this.ctx.pathResolver.resolve(subPath, backend);
    } catch (err) {
      if (err instanceof FileSystemError && err.code === 'ENOENT') {
        await this.create(path, content);
        return;
      }
      throw err;
    }

    const { inode } = resolved;
    if (inode.type !== FileType.REGULAR)
      throw new FileSystemError('EISDIR', norm);

    const existingData = inode.dataRef
      ? await backend.getData(inode.dataRef)
      : null;
    const newData = contentToBuffer(content);

    const existingBytes = existingData
      ? new Uint8Array(existingData)
      : new Uint8Array(0);
    const newBytes = new Uint8Array(newData);
    const merged = new Uint8Array(existingBytes.length + newBytes.length);
    merged.set(existingBytes, 0);
    merged.set(newBytes, existingBytes.length);

    if (!inode.dataRef) inode.dataRef = `data-${inode.ino}`;
    await backend.putData(inode.dataRef, merged.buffer);
    inode.size = merged.byteLength;
    inode.modifiedAt = Date.now();
    await backend.putInode(inode);

    this.ctx.emitEvent('modify', norm);
  }

  async unlink(
    path: string,
    options?: { assetDirStrategy?: 'keep' | 'remove' | 'orphan' },
  ): Promise<void> {
    const norm = PathUtils.normalize(path);
    if (norm === '/') {
      throw new FileSystemError('EACCES', '/', 'Cannot delete root');
    }

    const { backend, subPath } = this.ctx.resolveBackend(norm);
    const { inode, parentIno, name } =
      await this.ctx.pathResolver.resolve(subPath, backend);

    if (inode.type === FileType.DIRECTORY)
      throw new FileSystemError('EISDIR', norm, 'Use rmdir for directories');

    // ✅ 修改：扩展支持 Record 文件的 assetdir 同步
    if (AssetDirUtils.isSupportedType(inode.type)) {
      const strategy = options?.assetDirStrategy ?? 'remove';
      try {
        await AssetDirUtils.syncUnlink(this.ctx.fs, norm, strategy);
      } catch (err) {
        console.warn(`[VFS] Failed to sync assetdir during unlink of '${norm}': ${err}`);
      }
    }

    inode.nlink--;
    if (inode.nlink <= 0) {
      await this.cleanupInodeData(backend, inode);
      await backend.deleteInode(inode.ino);
    } else {
      await backend.putInode(inode);
    }

    await backend.deleteDirEntry(parentIno, name);
    this.ctx.pathResolver.invalidate(norm);
    this.ctx.emitEvent('delete', norm);
  }

  async rename(
    oldPath: string,
    newPath: string,
    options?: { syncAssetDir?: boolean },
  ): Promise<void> {
    const normOld = PathUtils.normalize(oldPath);
    const normNew = PathUtils.normalize(newPath);

    if (normOld === normNew) return;
    if (normOld === '/' || normNew === '/')
      throw new FileSystemError('EINVAL', normOld, 'Cannot rename root');

    const oldResolved = this.ctx.resolveBackend(normOld);
    const newResolved = this.ctx.resolveBackend(normNew);

    // 跨后端 rename = copy + unlink
    if (oldResolved.backend !== newResolved.backend) {
      await this.copy(normOld, normNew, {
        copyAssetDir: options?.syncAssetDir ?? true,
      });
      await this.unlink(normOld, { assetDirStrategy: 'remove' });
      return;
    }

    const backend = oldResolved.backend;
    const { inode, parentIno: oldParentIno, name: oldName } =
      await this.ctx.pathResolver.resolve(oldResolved.subPath, backend);

    // 收集 assetdir 信息
    const assetDirInfo = await this.collectAssetDirInfo(
      normOld, backend, inode, options,
    );

    // 执行主文件 rename
    const { parentInode: newParentInode, childName: newName } =
      await this.ctx.pathResolver.resolveParent(newResolved.subPath, backend);

    await this.replaceTargetIfExists(normNew, backend, newParentInode.ino, newName);

    await backend.deleteDirEntry(oldParentIno, oldName);
    await backend.putDirEntry(newParentInode.ino, {
      name: newName, ino: inode.ino,
    });
    inode.modifiedAt = Date.now();
    await backend.putInode(inode);

    // 同步移动 assetdir
    if (assetDirInfo) {
      await this.moveAssetDir(
        normNew, backend, newParentInode.ino, inode, assetDirInfo,
      );
    }

    this.ctx.pathResolver.invalidate(normOld);
    this.ctx.pathResolver.invalidate(normNew);
    this.ctx.emitEvent('rename', normNew, normOld);
  }

  async copy(
    src: string,
    dst: string,
    options?: CopyOptions,
  ): Promise<void> {
    const normSrc = PathUtils.normalize(src);
    const normDst = PathUtils.normalize(dst);
    const { backend: srcBackend, subPath: srcSubPath } =
      this.ctx.resolveBackend(normSrc);
    const { inode: srcInode } =
      await this.ctx.pathResolver.resolve(srcSubPath, srcBackend);

    if (srcInode.type === FileType.DIRECTORY)
      throw new FileSystemError('EISDIR', normSrc, 'Cannot copy directories');

    if (srcInode.type === FileType.RECORD) {
      await this.copyRecord(normSrc, normDst, srcBackend, srcInode, options);
      return;
    }

    if (srcInode.type !== FileType.REGULAR)
      throw new FileSystemError('EINVAL', normSrc, 'Can only copy regular files');

    const data = srcInode.dataRef
      ? await srcBackend.getData(srcInode.dataRef)
      : null;

    // ✅ 修复：清理 assetdir 相关元数据，避免脏引用
    const cleanMeta = AssetDirUtils.cleanMetadataForCopy(srcInode.metadata);

    await this.create(dst, data ?? new ArrayBuffer(0), {
      overwrite: options?.overwrite ?? false,
      metadata: { ...cleanMeta, ...options?.metadata },
      recursive: options?.recursive,
    });

    if (options?.copyAssetDir !== false) {
    try {
      await AssetDirUtils.syncCopy(this.ctx.fs, normSrc, normDst);
    } catch (err) {
      console.warn(`[VFS] Failed to copy assetdir: ${err}`);
    }
    }
  }

  async exists(path: string): Promise<boolean> {
    const norm = PathUtils.normalize(path);

    if (norm.startsWith('/dev/')) {
      const name = norm.slice(5);
      if (name && !name.includes('/')) return this.ctx.deviceManager.has(name);
    }

    const { backend, subPath } = this.ctx.resolveBackend(norm);
    try {
      await this.ctx.pathResolver.resolve(subPath, backend);
      return true;
    } catch (err) {
      if (err instanceof FileSystemError && err.code === 'ENOENT') return false;
      throw err;
    }
  }

  async stat(path: string): Promise<FileStat> {
    const norm = PathUtils.normalize(path);

    if (norm.startsWith('/dev/')) {
      const name = norm.slice(5);
      if (name && !name.includes('/') && this.ctx.deviceManager.has(name)) {
        this.ctx.deviceManager.get(name); // 确保存在
        const now = Date.now();
        const pseudoInode: Inode = {
          ino: 0,
          type: FileType.DEVICE,
          dataRef: null,
          nlink: 1,
          size: 0,
          createdAt: now,
          modifiedAt: now,
          accessedAt: now,
          deviceName: name,
          metadata: { deviceName: name },
        };
        return inodeToStat(pseudoInode);
      }
    }

    const { backend, subPath } = this.ctx.resolveBackend(norm);
    const { inode } = await this.ctx.pathResolver.resolve(subPath, backend);
    return inodeToStat(inode);
  }

  // ---- 私有辅助方法 ----

  private async overwriteExisting(
    norm: string,
    backend: StorageBackend,
    existing: DirEntry,
    content?: FileContent,
    options?: CreateOptions,
  ): Promise<FileStat> {
    if (!options?.overwrite) {
      throw new FileSystemError('EEXIST', norm);
    }

    const existingInode = await backend.getInode(existing.ino);
    if (!existingInode) throw new FileSystemError('EIO', norm);
    if (existingInode.type !== FileType.REGULAR)
      throw new FileSystemError('EISDIR', norm);

    const buf = content != null ? contentToBuffer(content) : new ArrayBuffer(0);
    await backend.putData(existingInode.dataRef!, buf);

    existingInode.size = buf.byteLength;
    existingInode.modifiedAt = Date.now();
    if (options?.metadata) Object.assign(existingInode.metadata, options.metadata);
    await backend.putInode(existingInode);

    this.ctx.pathResolver.invalidate(norm);
    this.ctx.emitEvent('modify', norm);
    return inodeToStat(existingInode);
  }

  private async createNew(
    norm: string,
    backend: StorageBackend,
    parentIno: number,
    childName: string,
    content?: FileContent,
    options?: CreateOptions,
  ): Promise<FileStat> {
    const ino = await backend.allocateIno();
    const inode = createInode(ino, FileType.REGULAR, options?.metadata);

    const buf = content != null ? contentToBuffer(content) : new ArrayBuffer(0);
    inode.size = buf.byteLength;
    inode.dataRef = `data-${ino}`;

    await backend.putInode(inode);
    await backend.putData(inode.dataRef, buf);
    await backend.putDirEntry(parentIno, { name: childName, ino });

    this.ctx.pathResolver.invalidate(PathUtils.dirname(norm));
    this.ctx.emitEvent('create', norm);
    return inodeToStat(inode);
  }

  private async cleanupInodeData(
    backend: StorageBackend,
    inode: Inode,
  ): Promise<void> {
    if (inode.type === FileType.RECORD) {
      if (isRecordBackend(backend)) {
        await backend.clearRecordFields(inode.ino);
      } else {
        const fallback = new FallbackRecordOps(backend);
        await fallback.clear(inode.ino);
      }
    } else if (inode.dataRef) {
      await backend.deleteData(inode.dataRef);
    }
  }

  private async collectAssetDirInfo(
    normOld: string,
    backend: StorageBackend,
    inode: Inode,
    options?: { syncAssetDir?: boolean },
  ): Promise<{ ino: number; parentIno: number; name: string } | null> {
    const syncAssetDir = options?.syncAssetDir !== false;
    // ✅ 修改：使用 isSupportedType 替代硬编码 FileType.REGULAR
    if (!syncAssetDir || !AssetDirUtils.isSupportedType(inode.type) || !inode.metadata.assetDirIno) {
      return null;
    }

    const oldAssetDirPath = AssetDirUtils.getAssetDirPath(normOld);
    try {
      const assetResolved = await this.ctx.pathResolver.resolve(
        this.ctx.resolveBackend(oldAssetDirPath).subPath,
        backend,
      );
      return {
        ino: assetResolved.inode.ino,
        parentIno: assetResolved.parentIno,
        name: assetResolved.name,
      };
    } catch {
      return null;
    }
  }

  private async replaceTargetIfExists(
    normNew: string,
    backend: StorageBackend,
    newParentIno: number,
    newName: string,
  ): Promise<void> {
    const newEntries = await backend.getDirEntries(newParentIno);
    const existingEntry = newEntries.find((e) => e.name === newName);
    if (!existingEntry) return;

    const existingInode = await backend.getInode(existingEntry.ino);
    if (existingInode) {
      if (existingInode.type === FileType.DIRECTORY) {
        const dirEntries = await backend.getDirEntries(existingInode.ino);
        if (dirEntries.length > 0) {
          throw new FileSystemError('ENOTEMPTY', normNew);
        }
      }
      if (existingInode.dataRef) await backend.deleteData(existingInode.dataRef);
      await backend.deleteInode(existingInode.ino);
    }
    await backend.deleteDirEntry(newParentIno, newName);
  }

  private async moveAssetDir(
    normNew: string,
    backend: StorageBackend,
    newParentIno: number,
    fileInode: Inode,
    info: { ino: number; parentIno: number; name: string },
  ): Promise<void> {
    const newAssetDirName = AssetDirUtils.getAssetDirName(
      PathUtils.basename(normNew),
    );

    const existingEntries = await backend.getDirEntries(newParentIno);
    if (existingEntries.some((e) => e.name === newAssetDirName)) {
      throw new FileSystemError(
        'EEXIST',
        PathUtils.join(PathUtils.dirname(normNew), newAssetDirName),
        'AssetDir name conflicts at destination',
      );
    }

    await backend.deleteDirEntry(info.parentIno, info.name);
    await backend.putDirEntry(newParentIno, {
      name: newAssetDirName,
      ino: info.ino,
    });

    const assetDirInode = await backend.getInode(info.ino);
    if (assetDirInode) {
      assetDirInode.metadata.ownerFileIno = fileInode.ino;
      assetDirInode.modifiedAt = Date.now();
      await backend.putInode(assetDirInode);
    }
  }

  private async copyRecord(
    src: string,
    dst: string,
    srcBackend: StorageBackend,
    srcInode: Inode,
    options?: CreateOptions & { copyAssetDir?: boolean },
  ): Promise<void> {
    let fields: Record<string, RecordValue>;
    if (isRecordBackend(srcBackend)) {
      fields = await srcBackend.getAllRecordFields(srcInode.ino);
    } else {
      const fallback = new FallbackRecordOps(srcBackend);
      fields = await fallback.load(srcInode.ino);
    }

    const { RecordOps } = await import('./record-ops');
    const recordOps = new RecordOps(this.ctx);
    await recordOps.createRecord(dst, fields, {
      indexes: srcInode.recordIndexes,
      metadata: { ...srcInode.metadata, ...options?.metadata },
    });

    if (options?.copyAssetDir !== false) {
      try {
        await AssetDirUtils.syncCopy(this.ctx.fs, src, dst);
      } catch (err) {
        console.warn(`Failed to copy assetdir: ${err}`);
      }
    }
  }
}
