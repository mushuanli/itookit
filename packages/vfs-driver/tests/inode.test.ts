// tests/inode.test.ts

import { describe, it, expect } from 'vitest';
import { createInode, inodeToStat } from '../src/core/inode.js';
import { FileType } from '../src/interface';

describe('createInode', () => {
  it('should create regular file inode', () => {
    const inode = createInode(5, FileType.REGULAR);
    expect(inode.ino).toBe(5);
    expect(inode.type).toBe(FileType.REGULAR);
    expect(inode.dataRef).toBe('data-5');
    expect(inode.nlink).toBe(1);
    expect(inode.size).toBe(0);
    expect(inode.createdAt).toBeGreaterThan(0);
    expect(inode.modifiedAt).toBeGreaterThan(0);
    expect(inode.accessedAt).toBeGreaterThan(0);
  });

  it('should create directory inode', () => {
    const inode = createInode(10, FileType.DIRECTORY);
    expect(inode.type).toBe(FileType.DIRECTORY);
    expect(inode.dataRef).toBeNull();
    expect(inode.nlink).toBe(2); // . 和父引用
  });

  it('should create symlink inode', () => {
    const inode = createInode(15, FileType.SYMLINK);
    expect(inode.type).toBe(FileType.SYMLINK);
    expect(inode.dataRef).toBeNull();
    expect(inode.nlink).toBe(1);
  });

  it('should create device inode', () => {
    const inode = createInode(20, FileType.DEVICE);
    expect(inode.type).toBe(FileType.DEVICE);
    expect(inode.dataRef).toBeNull();
    expect(inode.nlink).toBe(1);
  });

  it('should apply metadata', () => {
    const inode = createInode(25, FileType.REGULAR, {
      mimeType: 'text/plain',
      tags: ['test'],
    });
    expect(inode.metadata.mimeType).toBe('text/plain');
    expect(inode.metadata.tags).toEqual(['test']);
  });

  it('should default metadata to empty object', () => {
    const inode = createInode(30, FileType.REGULAR);
    expect(inode.metadata).toBeDefined();
    expect(typeof inode.metadata).toBe('object');
  });

  it('should have consistent timestamps', () => {
    const before = Date.now();
    const inode = createInode(35, FileType.REGULAR);
    const after = Date.now();

    expect(inode.createdAt).toBeGreaterThanOrEqual(before);
    expect(inode.createdAt).toBeLessThanOrEqual(after);
    expect(inode.createdAt).toBe(inode.modifiedAt);
    expect(inode.createdAt).toBe(inode.accessedAt);
  });
});

describe('inodeToStat', () => {
  it('should convert regular file inode to stat', () => {
    const inode = createInode(5, FileType.REGULAR);
    inode.size = 100;
    const stat = inodeToStat(inode);

    expect(stat.ino).toBe(5);
    expect(stat.type).toBe(FileType.REGULAR);
    expect(stat.size).toBe(100);
    expect(stat.nlink).toBe(1);
    expect(stat.isFile()).toBe(true);
    expect(stat.isDirectory()).toBe(false);
    expect(stat.isSymlink()).toBe(false);
    expect(stat.isDevice()).toBe(false);
  });

  it('should convert directory inode to stat', () => {
    const inode = createInode(10, FileType.DIRECTORY);
    const stat = inodeToStat(inode);

    expect(stat.isFile()).toBe(false);
    expect(stat.isDirectory()).toBe(true);
    expect(stat.isSymlink()).toBe(false);
    expect(stat.isDevice()).toBe(false);
  });

  it('should convert symlink inode to stat', () => {
    const inode = createInode(15, FileType.SYMLINK);
    const stat = inodeToStat(inode);

    expect(stat.isSymlink()).toBe(true);
    expect(stat.isFile()).toBe(false);
  });

  it('should convert device inode to stat', () => {
    const inode = createInode(20, FileType.DEVICE);
    const stat = inodeToStat(inode);

    expect(stat.isDevice()).toBe(true);
    expect(stat.isFile()).toBe(false);
  });

  it('should copy metadata without reference', () => {
    const inode = createInode(5, FileType.REGULAR, { mimeType: 'text/plain' });
    const stat = inodeToStat(inode);

    // 修改 stat 的 metadata 不应影响原始 inode
    stat.metadata.mimeType = 'changed';
    expect(inode.metadata.mimeType).toBe('text/plain');
  });

  it('should preserve all timestamp fields', () => {
    const inode = createInode(5, FileType.REGULAR);
    inode.createdAt = 1000;
    inode.modifiedAt = 2000;
    inode.accessedAt = 3000;
    const stat = inodeToStat(inode);

    expect(stat.createdAt).toBe(1000);
    expect(stat.modifiedAt).toBe(2000);
    expect(stat.accessedAt).toBe(3000);
  });
});
