// @vfs-driver/core/inode.ts

import { FileType } from '../interface/types';
import type { Inode, ExtendedMetadata, FileStat } from '../interface/types';

export function createInode(
  ino: number,
  type: FileType,
  metadata?: Partial<ExtendedMetadata>,
): Inode {
  const now = Date.now();
  return {
    ino,
    type,
    dataRef: type === FileType.REGULAR ? `data-${ino}` : null,
    nlink: type === FileType.DIRECTORY ? 2 : 1, // 目录有 . 和父级的引用
    size: 0,
    createdAt: now,
    modifiedAt: now,
    accessedAt: now,
    metadata: { ...metadata } as ExtendedMetadata,
  };
}

export function inodeToStat(inode: Inode): FileStat {
  return {
    ino: inode.ino,
    type: inode.type,
    size: inode.size,
    nlink: inode.nlink,
    createdAt: inode.createdAt,
    modifiedAt: inode.modifiedAt,
    accessedAt: inode.accessedAt,
    metadata: { ...inode.metadata },
    recordIndexes: inode.recordIndexes ? [...inode.recordIndexes] : undefined,
    isFile: () => inode.type === FileType.REGULAR,
    isDirectory: () => inode.type === FileType.DIRECTORY,
    isSymlink: () => inode.type === FileType.SYMLINK,
    isDevice: () => inode.type === FileType.DEVICE,
    isRecord: () => inode.type === FileType.RECORD,
  };
}
