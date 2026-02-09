// tests/path.test.ts

import { describe, it, expect, beforeEach } from 'vitest';
import { PathUtils, PathResolver } from '../src/core/path.js';
import { FileSystemError } from '../src/core/errors.js';
import { MemoryBackend } from '../src/backend/memory.js';
import { createInode } from '../src/core/inode.js';
import { FileType } from '../src/interface';

describe('PathUtils', () => {
  describe('normalize', () => {
    it('should keep root as /', () => {
      expect(PathUtils.normalize('/')).toBe('/');
    });

    it('should remove trailing slashes', () => {
      expect(PathUtils.normalize('/a/b/')).toBe('/a/b');
    });

    it('should resolve . and ..', () => {
      expect(PathUtils.normalize('/a/b/../c')).toBe('/a/c');
      expect(PathUtils.normalize('/a/./b/./c')).toBe('/a/b/c');
      expect(PathUtils.normalize('/a/b/../../c')).toBe('/c');
    });

    it('should collapse multiple slashes', () => {
      expect(PathUtils.normalize('/a//b///c')).toBe('/a/b/c');
    });

    it('should not go above root', () => {
      expect(PathUtils.normalize('/a/../../b')).toBe('/b');
    });

    it('should throw on relative paths', () => {
      expect(() => PathUtils.normalize('a/b')).toThrow(FileSystemError);
      expect(() => PathUtils.normalize('')).toThrow(FileSystemError);
    });

    it('should handle root with dots', () => {
      expect(PathUtils.normalize('/.')).toBe('/');
      expect(PathUtils.normalize('/..')).toBe('/');
      expect(PathUtils.normalize('/./.')).toBe('/');
    });

    it('should handle deep .. chains', () => {
      expect(PathUtils.normalize('/a/b/c/d/../../../../e')).toBe('/e');
    });

    it('should handle single file at root', () => {
      expect(PathUtils.normalize('/file.txt')).toBe('/file.txt');
    });
  });

  describe('join', () => {
    it('should join path segments', () => {
      expect(PathUtils.join('/a', 'b', 'c')).toBe('/a/b/c');
    });

    it('should normalize the result', () => {
      expect(PathUtils.join('/a', '../b')).toBe('/b');
    });

    it('should handle root join', () => {
      expect(PathUtils.join('/', 'a')).toBe('/a');
    });

    it('should handle multiple joins', () => {
      expect(PathUtils.join('/a', 'b', 'c', 'd')).toBe('/a/b/c/d');
    });
  });

  describe('dirname', () => {
    it('should return parent directory', () => {
      expect(PathUtils.dirname('/a/b/c')).toBe('/a/b');
      expect(PathUtils.dirname('/a')).toBe('/');
      expect(PathUtils.dirname('/')).toBe('/');
    });

    it('should handle deep paths', () => {
      expect(PathUtils.dirname('/a/b/c/d/e')).toBe('/a/b/c/d');
    });

    it('should handle paths with ..', () => {
      expect(PathUtils.dirname('/a/b/../c')).toBe('/a');
    });
  });

  describe('basename', () => {
    it('should return file name', () => {
      expect(PathUtils.basename('/a/b/c.txt')).toBe('c.txt');
      expect(PathUtils.basename('/a')).toBe('a');
    });

    it('should strip extension when provided', () => {
      expect(PathUtils.basename('/a/b/c.txt', '.txt')).toBe('c');
    });

    it('should return / for root', () => {
      expect(PathUtils.basename('/')).toBe('/');
    });

    it('should not strip if extension does not match', () => {
      expect(PathUtils.basename('/a/b/c.txt', '.md')).toBe('c.txt');
    });

    it('should handle name without extension', () => {
      expect(PathUtils.basename('/a/b/Makefile')).toBe('Makefile');
    });
  });

  describe('extname', () => {
    it('should return extension', () => {
      expect(PathUtils.extname('/a/b/c.txt')).toBe('.txt');
      expect(PathUtils.extname('/a/b/c.tar.gz')).toBe('.gz');
    });

    it('should return empty for no extension', () => {
      expect(PathUtils.extname('/a/b/c')).toBe('');
    });

    it('should return empty for dotfiles', () => {
      expect(PathUtils.extname('/a/.gitignore')).toBe('');
    });

    it('should handle multiple dots', () => {
      expect(PathUtils.extname('/a/b/file.test.js')).toBe('.js');
    });

    it('should handle trailing dot', () => {
      expect(PathUtils.extname('/a/b/file.')).toBe('.');
    });
  });

  describe('split', () => {
    it('should split path into parts', () => {
      expect(PathUtils.split('/a/b/c')).toEqual(['a', 'b', 'c']);
      expect(PathUtils.split('/')).toEqual([]);
    });

    it('should handle single component', () => {
      expect(PathUtils.split('/a')).toEqual(['a']);
    });

    it('should normalize before splitting', () => {
      expect(PathUtils.split('/a/./b/../c')).toEqual(['a', 'c']);
    });
  });

  describe('isAbsolute', () => {
    it('should detect absolute paths', () => {
      expect(PathUtils.isAbsolute('/a')).toBe(true);
      expect(PathUtils.isAbsolute('/')).toBe(true);
      expect(PathUtils.isAbsolute('a')).toBe(false);
      expect(PathUtils.isAbsolute('')).toBe(false);
    });
  });

  describe('validate', () => {
    it('should reject relative paths', () => {
      expect(() => PathUtils.validate('a/b')).toThrow(FileSystemError);
    });

    it('should reject empty path', () => {
      expect(() => PathUtils.validate('')).toThrow(FileSystemError);
    });

    it('should reject null bytes', () => {
      expect(() => PathUtils.validate('/a/b\0c')).toThrow(FileSystemError);
    });

    it('should accept valid paths', () => {
      expect(() => PathUtils.validate('/a/b/c')).not.toThrow();
      expect(() => PathUtils.validate('/')).not.toThrow();
    });

    it('should reject very long paths', () => {
      const longPath = '/' + 'a'.repeat(4096);
      expect(() => PathUtils.validate(longPath)).toThrow(FileSystemError);
    });

    it('should reject very long name segments', () => {
      const longName = 'a'.repeat(256);
      expect(() => PathUtils.validate(`/${longName}`)).toThrow(FileSystemError);
    });

    it('should accept maximum length names', () => {
      const maxName = 'a'.repeat(255);
      expect(() => PathUtils.validate(`/${maxName}`)).not.toThrow();
    });
  });
});

describe('PathResolver', () => {
  let backend: MemoryBackend;
  let resolver: PathResolver;

  beforeEach(async () => {
    backend = new MemoryBackend();
    await backend.init();
    resolver = new PathResolver();
  });

  // 需要导入 beforeEach
  it('should resolve root', async () => {
    const result = await resolver.resolve('/', backend);
    expect(result.inode.ino).toBe(1);
    expect(result.inode.type).toBe(FileType.DIRECTORY);
  });

  it('should resolve file in root', async () => {
    const ino = await backend.allocateIno();
    const inode = createInode(ino, FileType.REGULAR);
    await backend.putInode(inode);
    await backend.putDirEntry(1, { name: 'test.txt', ino });

    const result = await resolver.resolve('/test.txt', backend);
    expect(result.inode.ino).toBe(ino);
    expect(result.parentIno).toBe(1);
    expect(result.name).toBe('test.txt');
  });

  it('should resolve nested path', async () => {
    // 创建 /a/b/c.txt 结构
    const dirAIno = await backend.allocateIno();
    const dirA = createInode(dirAIno, FileType.DIRECTORY);
    await backend.putInode(dirA);
    await backend.putDirEntry(1, { name: 'a', ino: dirAIno });

    const dirBIno = await backend.allocateIno();
    const dirB = createInode(dirBIno, FileType.DIRECTORY);
    await backend.putInode(dirB);
    await backend.putDirEntry(dirAIno, { name: 'b', ino: dirBIno });

    const fileIno = await backend.allocateIno();
    const file = createInode(fileIno, FileType.REGULAR);
    await backend.putInode(file);
    await backend.putDirEntry(dirBIno, { name: 'c.txt', ino: fileIno });

    const result = await resolver.resolve('/a/b/c.txt', backend);
    expect(result.inode.ino).toBe(fileIno);
    expect(result.parentIno).toBe(dirBIno);
    expect(result.name).toBe('c.txt');
  });

  it('should throw ENOENT for missing file', async () => {
    await expect(resolver.resolve('/nonexistent', backend)).rejects.toThrow(FileSystemError);
  });

  it('should throw ENOTDIR when path component is not directory', async () => {
    const fileIno = await backend.allocateIno();
    const file = createInode(fileIno, FileType.REGULAR);
    await backend.putInode(file);
    await backend.putDirEntry(1, { name: 'file', ino: fileIno });

    await expect(resolver.resolve('/file/child', backend)).rejects.toThrow(FileSystemError);
  });

  it('should resolve parent correctly', async () => {
    const dirIno = await backend.allocateIno();
    const dir = createInode(dirIno, FileType.DIRECTORY);
    await backend.putInode(dir);
    await backend.putDirEntry(1, { name: 'parent', ino: dirIno });

    const result = await resolver.resolveParent('/parent/newfile.txt', backend);
    expect(result.parentInode.ino).toBe(dirIno);
    expect(result.childName).toBe('newfile.txt');
  });

  it('should throw EINVAL when resolveParent called with root', async () => {
    await expect(resolver.resolveParent('/', backend)).rejects.toThrow(FileSystemError);
  });

  it('should throw ENOTDIR when resolveParent parent is not dir', async () => {
    const fileIno = await backend.allocateIno();
    const file = createInode(fileIno, FileType.REGULAR);
    await backend.putInode(file);
    await backend.putDirEntry(1, { name: 'file', ino: fileIno });

    await expect(resolver.resolveParent('/file/child.txt', backend)).rejects.toThrow(FileSystemError);
  });

  it('should invalidate cache correctly', async () => {
    resolver.invalidate('/a/b');
    // 不应抛出
    const root = await resolver.resolve('/', backend);
    expect(root.inode.ino).toBe(1);
  });

  it('should clear all cache', () => {
    resolver.clearCache();
    // 不应抛出
  });
});
