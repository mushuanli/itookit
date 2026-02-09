// @vfs-driver/core/path.ts

import { FileSystemError } from './errors';
import type { Inode } from '../interface/types';
import { FileType } from '../interface/types';
import type { StorageBackend } from '../interface/storage';

// ============================================================
// PathUtils — 纯函数，无副作用
// ============================================================

const MAX_PATH_LENGTH = 4096;
const MAX_NAME_LENGTH = 255;

export const PathUtils = {
  normalize(path: string): string {
    if (!path || path[0] !== '/') {
      throw new FileSystemError('EINVAL', path, 'Path must be absolute');
    }
    const parts = path.split('/');
    const normalized: string[] = [];
    for (const part of parts) {
      if (part === '' || part === '.') continue;
      if (part === '..') {
        normalized.pop();
      } else {
        normalized.push(part);
      }
    }
    return '/' + normalized.join('/');
  },

  join(...segments: string[]): string {
    return PathUtils.normalize(segments.join('/'));
  },

  dirname(path: string): string {
    const norm = PathUtils.normalize(path);
    if (norm === '/') return '/';
    const idx = norm.lastIndexOf('/');
    return idx === 0 ? '/' : norm.slice(0, idx);
  },

  basename(path: string, ext?: string): string {
    const norm = PathUtils.normalize(path);
    if (norm === '/') return '/';
    const name = norm.slice(norm.lastIndexOf('/') + 1);
    if (ext && name.endsWith(ext)) {
      return name.slice(0, -ext.length);
    }
    return name;
  },

  extname(path: string): string {
    const name = PathUtils.basename(path);
    const idx = name.lastIndexOf('.');
    return idx <= 0 ? '' : name.slice(idx);
  },

  isAbsolute(path: string): boolean {
    return path.length > 0 && path[0] === '/';
  },

  validate(path: string): void {
    if (!path || path[0] !== '/') {
      throw new FileSystemError('EINVAL', path, 'Path must be absolute');
    }
    if (path.length > MAX_PATH_LENGTH) {
      throw new FileSystemError('EINVAL', path, 'Path too long');
    }
    const parts = path.split('/').filter(Boolean);
    for (const part of parts) {
      if (part.length > MAX_NAME_LENGTH) {
        throw new FileSystemError('EINVAL', path, `Name too long: ${part}`);
      }
      if (part.includes('\0')) {
        throw new FileSystemError('EINVAL', path, 'Null byte in name');
      }
    }
  },

  split(path: string): string[] {
    return PathUtils.normalize(path).split('/').filter(Boolean);
  },
};

// ============================================================
// PathResolver — 从路径定位到 Inode
// ============================================================

const MAX_SYMLINK_DEPTH = 40;

export interface ResolveResult {
  inode: Inode;
  parentIno: number;
  name: string;
}

export class PathResolver {
  private cache = new Map<string, { ino: number; ts: number }>();
  //private readonly cacheTTL = 5000; // 5s

  clearCache(): void {
    this.cache.clear();
  }

  invalidate(path: string): void {
    // 失效该路径及所有子路径
    const prefix = path === '/' ? '/' : path + '/';
    for (const key of this.cache.keys()) {
      if (key === path || key.startsWith(prefix)) {
        this.cache.delete(key);
      }
    }
  }

  async resolve(
    path: string,
    backend: StorageBackend,
    symlinkDepth = 0,
  ): Promise<ResolveResult> {
    PathUtils.validate(path);
    const norm = PathUtils.normalize(path);

    if (norm === '/') {
      const rootInode = await backend.getInode(1);
      if (!rootInode) {
        throw new FileSystemError('EIO', '/', 'Root inode missing');
      }
      return { inode: rootInode, parentIno: 1, name: '' };
    }

    const parts = PathUtils.split(norm);
    let currentIno = 1; // 根目录 ino
    let parentIno = 1;

    for (let i = 0; i < parts.length; i++) {
      const partName = parts[i];
      //const isLast = i === parts.length - 1;

      const currentInode = await backend.getInode(currentIno);
      if (!currentInode) {
        throw new FileSystemError('ENOENT', norm);
      }

      // 处理符号链接
      if (currentInode.type === FileType.SYMLINK) {
        if (symlinkDepth >= MAX_SYMLINK_DEPTH) {
          throw new FileSystemError('ELOOP', norm);
        }
        const target = currentInode.symlinkTarget!;
        const resolvedTarget = PathUtils.isAbsolute(target)
          ? target
          : PathUtils.join(
              '/' + parts.slice(0, i).join('/'),
              '..',
              target,
            );
        const remaining = parts.slice(i).join('/');
        const fullPath = remaining
          ? PathUtils.join(resolvedTarget, remaining)
          : resolvedTarget;
        return this.resolve(fullPath, backend, symlinkDepth + 1);
      }

      if (currentInode.type !== FileType.DIRECTORY) {
        throw new FileSystemError('ENOTDIR', norm);
      }

      const entries = await backend.getDirEntries(currentIno);
      const entry = entries.find((e) => e.name === partName);
      if (!entry) {
        throw new FileSystemError('ENOENT', norm);
      }

      parentIno = currentIno;
      currentIno = entry.ino;
    }

    const targetInode = await backend.getInode(currentIno);
    if (!targetInode) {
      throw new FileSystemError('ENOENT', norm);
    }

    return {
      inode: targetInode,
      parentIno,
      name: parts[parts.length - 1],
    };
  }

  /**
   * 解析父目录，返回父 inode + 子名称
   * 用于 create / mkdir / unlink 等需要操作父目录的场景
   */
  async resolveParent(
    path: string,
    backend: StorageBackend,
  ): Promise<{ parentInode: Inode; childName: string }> {
    const norm = PathUtils.normalize(path);
    if (norm === '/') {
      throw new FileSystemError('EINVAL', '/', 'Cannot operate on root');
    }

    const parentPath = PathUtils.dirname(norm);
    const childName = PathUtils.basename(norm);
    const { inode: parentInode } = await this.resolve(parentPath, backend);

    if (parentInode.type !== FileType.DIRECTORY) {
      throw new FileSystemError('ENOTDIR', parentPath);
    }

    return { parentInode, childName };
  }
}
