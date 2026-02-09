// core/helper/dir-ops.ts
import type {
  DirEntry,
  Inode,
  MkdirOptions,
  RmdirOptions,
  ReaddirOptions,
} from '../../interface/types';
import type { StorageBackend } from '../../interface/storage';
import { FileType } from '../../interface/types';
import { isRecordBackend } from '../../interface/storage';
import { FileSystemError } from '../errors';
import { PathUtils } from '../path';
import { createInode } from '../inode';
import { FallbackRecordOps } from './fallback-record';
import { AssetDirUtils } from './assetdir';
import type { FSContext } from './types';

export class DirOps {
  constructor(private readonly ctx: FSContext) {}

  async mkdir(path: string, options?: MkdirOptions): Promise<void> {
    const norm = PathUtils.normalize(path);

    if (options?.recursive) {
      await this.mkdirRecursive(norm);
      return;
    }

    const { backend, subPath } = this.ctx.resolveBackend(norm);
    const { parentInode, childName } =
      await this.ctx.pathResolver.resolveParent(subPath, backend);

    const entries = await backend.getDirEntries(parentInode.ino);
    if (entries.some((e) => e.name === childName)) {
      throw new FileSystemError('EEXIST', norm);
    }

    const ino = await backend.allocateIno();
    const inode = createInode(ino, FileType.DIRECTORY);

    await backend.putInode(inode);
    await backend.putDirEntry(parentInode.ino, { name: childName, ino });

    this.ctx.pathResolver.invalidate(PathUtils.dirname(norm));
    this.ctx.emitEvent('create', norm);
  }

  async rmdir(path: string, options?: RmdirOptions): Promise<void> {
    const norm = PathUtils.normalize(path);

    if (norm === '/') {
      throw new FileSystemError('EACCES', '/', 'Cannot remove root');
    }

    const { backend, subPath } = this.ctx.resolveBackend(norm);

    let resolved: { inode: Inode; parentIno: number; name: string };
    try {
      resolved = await this.ctx.pathResolver.resolve(subPath, backend);
    } catch (err) {
      if (err instanceof FileSystemError && err.code === 'ENOENT') {
        if (options?.force) return;
        throw err;
      }
      throw err;
    }

    const { inode, parentIno, name } = resolved;

    if (inode.type !== FileType.DIRECTORY) {
      throw new FileSystemError('ENOTDIR', norm);
    }

    const entries = await backend.getDirEntries(inode.ino);

    if (entries.length > 0) {
      if (options?.recursive) {
        await this.rmdirRecursive(norm, backend, inode, entries);
      } else {
        throw new FileSystemError('ENOTEMPTY', norm);
      }
    }

    await backend.deleteInode(inode.ino);
    await backend.deleteDirEntry(parentIno, name);

    this.ctx.pathResolver.invalidate(norm);
    this.ctx.emitEvent('delete', norm);
  }

  async readdir(path: string, options?: ReaddirOptions): Promise<DirEntry[]> {
    const norm = PathUtils.normalize(path);

    if (norm === '/dev') {
      return this.ctx.deviceManager.list().map((name) => ({
        name,
        ino: 0,
      }));
    }

    const { backend, subPath } = this.ctx.resolveBackend(norm);
    const { inode } = await this.ctx.pathResolver.resolve(subPath, backend);

    if (inode.type !== FileType.DIRECTORY) {
      throw new FileSystemError('ENOTDIR', norm);
    }

    const entries = await backend.getDirEntries(inode.ino);

    // ✅ 修复：默认隐藏 assetdir（includeAssetDirs 默认 false）
    if (options?.includeAssetDirs === true) {
      return entries;
    }

    return this.filterAssetDirs(backend, entries);
  }

  /**
   * @deprecated 使用 readdir() 即可，默认已过滤 assetdir
   * 保留此方法保持向后兼容
   */
  async readdirVisible(
    path: string,
    options?: ReaddirOptions,
  ): Promise<DirEntry[]> {
    return this.readdir(path, { ...options, includeAssetDirs: false });
  }

  // ---- 私有方法 ----

  private async mkdirRecursive(path: string): Promise<void> {
    const parts = PathUtils.split(path);
    let current = '/';

    for (const part of parts) {
      current = current === '/' ? `/${part}` : `${current}/${part}`;
      try {
        const { backend, subPath } = this.ctx.resolveBackend(current);
        await this.ctx.pathResolver.resolve(subPath, backend);
        // 存在，继续
      } catch (err) {
        if (err instanceof FileSystemError && err.code === 'ENOENT') {
          await this.mkdir(current);
        } else {
          throw err;
        }
      }
    }
  }

  /**
   * ✅ 修复：递归删除时正确处理 assetdir
   *
   * 策略：
   * 1. 先收集所有 entry 并分为 assetdir 和普通文件/目录
   * 2. 先处理普通文件（触发 syncUnlink 自动删除关联的 assetdir）
   * 3. 再处理剩余的目录（可能是孤儿 assetdir 或普通目录）
   *
   * 这样避免了遍历顺序导致的重复删除/残留问题
   */
  private async rmdirRecursive(
    basePath: string,
    backend: StorageBackend,
    dirInode: Inode,
    entries: DirEntry[],
  ): Promise<void> {
    // 第一步：分类收集
    const files: Array<{ entry: DirEntry; inode: Inode; path: string }> = [];
    const dirs: Array<{ entry: DirEntry; inode: Inode; path: string }> = [];
    const assetDirInoSet = new Set<number>(); // 记录已知 assetdir 的 ino

    for (const entry of entries) {
      const childPath =
        basePath === '/' ? `/${entry.name}` : `${basePath}/${entry.name}`;
      const childInode = await backend.getInode(entry.ino);
      if (!childInode) continue;

      if (childInode.type === FileType.DIRECTORY) {
        if (childInode.metadata.isAssetDir) {
          assetDirInoSet.add(childInode.ino);
        }
        dirs.push({ entry, inode: childInode, path: childPath });
      } else {
        files.push({ entry, inode: childInode, path: childPath });
      }
    }

    // 第二步：先删除文件（会触发 syncUnlink 自动清理关联 assetdir）
    for (const { entry, inode, path } of files) {
      // ✅ 修复：同时支持 REGULAR 和 RECORD
      if (AssetDirUtils.isSupportedType(inode.type) && inode.metadata.assetDirIno) {
        try {
          await AssetDirUtils.syncUnlink(this.ctx.fs, path, 'remove');
        } catch {
          // best-effort，assetdir 可能已被删除
        }
      }

      // 清理文件数据
      if (inode.type === FileType.RECORD) {
        if (isRecordBackend(backend)) {
          await backend.clearRecordFields(inode.ino);
        } else {
          await new FallbackRecordOps(backend).clear(inode.ino);
        }
      } else if (inode.dataRef) {
        await backend.deleteData(inode.dataRef);
      }

      await backend.deleteInode(inode.ino);
      await backend.deleteDirEntry(dirInode.ino, entry.name);
      this.ctx.emitEvent('delete', path);
    }

    // 第三步：删除目录（包括可能残留的 assetdir 和普通子目录）
    // 重新读取目录项，因为 syncUnlink 可能已经删除了一些 assetdir
    const remainingEntries = await backend.getDirEntries(dirInode.ino);

    for (const entry of remainingEntries) {
      const childPath =
        basePath === '/' ? `/${entry.name}` : `${basePath}/${entry.name}`;
      const childInode = await backend.getInode(entry.ino);
      if (!childInode) {
        // inode 已被删除（如 syncUnlink 清理过），只清理 dir entry
        await backend.deleteDirEntry(dirInode.ino, entry.name);
        continue;
      }

      if (childInode.type === FileType.DIRECTORY) {
        const childEntries = await backend.getDirEntries(childInode.ino);
        if (childEntries.length > 0) {
          await this.rmdirRecursive(childPath, backend, childInode, childEntries);
        }
        await backend.deleteInode(childInode.ino);
        await backend.deleteDirEntry(dirInode.ino, entry.name);
        this.ctx.emitEvent('delete', childPath);
      }
    }
  }

  private async filterAssetDirs(
    backend: StorageBackend,
    entries: DirEntry[],
  ): Promise<DirEntry[]> {
    // 快速路径：如果没有以 . 开头的条目，全部返回（大多数场景）
    const maybeDotEntries = entries.filter((e) => e.name.startsWith('.'));
    if (maybeDotEntries.length === 0) return entries;

    // 只对 .开头 的条目查 inode
    const assetDirInos = new Set<number>();
    for (const entry of maybeDotEntries) {
      const childInode = await backend.getInode(entry.ino);
      if (childInode?.metadata.isAssetDir) {
        assetDirInos.add(entry.ino);
      }
    }

    if (assetDirInos.size === 0) return entries;

    return entries.filter((e) => !assetDirInos.has(e.ino));
  }
}
