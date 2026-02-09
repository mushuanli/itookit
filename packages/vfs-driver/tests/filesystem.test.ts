// tests/filesystem.test.ts

import { describe, it, expect, beforeEach } from 'vitest';
import { FileSystem } from '../src/core/filesystem.js';
import { MemoryBackend } from '../src/backend/memory.js';
import { FileSystemError } from '../src/core/errors.js';
import { FileType } from '../src/interface';

describe('FileSystem', () => {
  let fs: FileSystem;

  beforeEach(async () => {
    const backend = new MemoryBackend();
    fs = new FileSystem(backend);
    await fs.init();
  });

  // ============================================================
  // 生命周期
  // ============================================================

  describe('lifecycle', () => {
    it('should not fail on double init', async () => {
      await expect(fs.init()).resolves.toBeUndefined();
    });

    it('should close cleanly', async () => {
      await expect(fs.close()).resolves.toBeUndefined();
    });

    it('should not fail on double close', async () => {
      await fs.close();
      await expect(fs.close()).resolves.toBeUndefined();
    });
  });

  // ============================================================
  // 文件操作
  // ============================================================

  describe('create / read / write', () => {
    it('should create and read a file', async () => {
      await fs.create('/hello.txt', 'Hello World');
      const content = await fs.read('/hello.txt');
      expect(content).toBe('Hello World');
    });

    it('should create empty file when no content', async () => {
      await fs.create('/empty.txt');
      const content = await fs.read('/empty.txt');
      expect(content).toBe('');
    });

    it('should throw EEXIST when file exists without overwrite', async () => {
      await fs.create('/a.txt', 'first');
      await expect(fs.create('/a.txt', 'second')).rejects.toThrow(
        FileSystemError,
      );
    });

    it('should overwrite when option set', async () => {
      await fs.create('/a.txt', 'first');
      await fs.create('/a.txt', 'second', { overwrite: true });
      const content = await fs.read('/a.txt');
      expect(content).toBe('second');
    });

    it('should write to existing file', async () => {
      await fs.create('/a.txt', 'first');
      await fs.write('/a.txt', 'updated');
      const content = await fs.read('/a.txt');
      expect(content).toBe('updated');
    });

    it('should auto-create file on write when create option is true', async () => {
      await fs.write('/new.txt', 'auto-created');
      const content = await fs.read('/new.txt');
      expect(content).toBe('auto-created');
    });

    it('should throw ENOENT on write with create=false', async () => {
      await expect(
        fs.write('/nonexistent.txt', 'data', { create: false }),
      ).rejects.toThrow(FileSystemError);
    });

    it('should read binary content', async () => {
      const buf = new Uint8Array([1, 2, 3, 4]).buffer;
      await fs.create('/bin.dat', buf);
      const result = await fs.read('/bin.dat', { encoding: null });
      expect(result).toBeInstanceOf(ArrayBuffer);
      expect(new Uint8Array(result as ArrayBuffer)).toEqual(
        new Uint8Array([1, 2, 3, 4]),
      );
    });

    it('should write Uint8Array content', async () => {
      const data = new Uint8Array([10, 20, 30]);
      await fs.create('/uint8.dat', data);
      const result = await fs.read('/uint8.dat', { encoding: null });
      expect(new Uint8Array(result as ArrayBuffer)).toEqual(
        new Uint8Array([10, 20, 30]),
      );
    });

    it('should throw ENOENT when reading nonexistent file', async () => {
      await expect(fs.read('/nope.txt')).rejects.toThrow(FileSystemError);
    });

    it('should throw EISDIR when reading a directory', async () => {
      await fs.mkdir('/mydir');
      await expect(fs.read('/mydir')).rejects.toThrow(FileSystemError);
    });

    it('should throw EISDIR when writing to a directory', async () => {
      await fs.mkdir('/mydir');
      await expect(fs.write('/mydir', 'data', { create: false })).rejects.toThrow(FileSystemError);
    });

    it('should throw ENOENT when parent does not exist on create', async () => {
      await expect(fs.create('/no/parent/file.txt', 'data')).rejects.toThrow(FileSystemError);
    });

    it('should throw EACCES when creating on device path', async () => {
      await expect(fs.create('/dev/test', 'data')).rejects.toThrow(FileSystemError);
    });

    it('should update file size after write', async () => {
      await fs.create('/sized.txt', 'hello');
      const stat1 = await fs.stat('/sized.txt');
      expect(stat1.size).toBe(5);

      await fs.write('/sized.txt', 'hi');
      const stat2 = await fs.stat('/sized.txt');
      expect(stat2.size).toBe(2);
    });

    it('should update modifiedAt after write', async () => {
      await fs.create('/ts.txt', 'initial');
      const stat1 = await fs.stat('/ts.txt');

      // 确保时间差
      await new Promise((r) => setTimeout(r, 10));

      await fs.write('/ts.txt', 'updated');
      const stat2 = await fs.stat('/ts.txt');
      expect(stat2.modifiedAt).toBeGreaterThanOrEqual(stat1.modifiedAt);
    });

    it('should preserve metadata on overwrite with metadata option', async () => {
      await fs.create('/meta-ow.txt', 'v1', { metadata: { mimeType: 'text/plain' } });
      await fs.create('/meta-ow.txt', 'v2', {
        overwrite: true,
        metadata: { tags: ['updated'] },
      });
      const meta = await fs.getMetadata('/meta-ow.txt');
      expect(meta.mimeType).toBe('text/plain');
      expect(meta.tags).toEqual(['updated']);
    });

    it('should handle write with metadata option on new file', async () => {
      await fs.write('/write-meta.txt', 'data', { metadata: { mimeType: 'text/csv' } });
      const meta = await fs.getMetadata('/write-meta.txt');
      expect(meta.mimeType).toBe('text/csv');
    });

    it('should handle writing empty string', async () => {
      await fs.create('/empty-write.txt', 'not empty');
      await fs.write('/empty-write.txt', '');
      const content = await fs.read('/empty-write.txt');
      expect(content).toBe('');
      const stat = await fs.stat('/empty-write.txt');
      expect(stat.size).toBe(0);
    });

    it('should handle unicode content', async () => {
      const unicode = '你好世界 🌍 مرحبا';
      await fs.create('/unicode.txt', unicode);
      const content = await fs.read('/unicode.txt');
      expect(content).toBe(unicode);
    });

    it('should handle large file content', async () => {
      const large = 'x'.repeat(100_000);
      await fs.create('/large.txt', large);
      const content = await fs.read('/large.txt');
      expect(content).toBe(large);
    });
  });

  describe('append', () => {
    it('should append to existing file', async () => {
      await fs.create('/log.txt', 'line1\n');
      await fs.append('/log.txt', 'line2\n');
      const content = await fs.read('/log.txt');
      expect(content).toBe('line1\nline2\n');
    });

    it('should create file if not exists', async () => {
      await fs.append('/new.txt', 'hello');
      const content = await fs.read('/new.txt');
      expect(content).toBe('hello');
    });

    it('should append multiple times', async () => {
      await fs.create('/multi.txt', 'a');
      await fs.append('/multi.txt', 'b');
      await fs.append('/multi.txt', 'c');
      const content = await fs.read('/multi.txt');
      expect(content).toBe('abc');
    });

    it('should update file size after append', async () => {
      await fs.create('/append-size.txt', 'aaa');
      await fs.append('/append-size.txt', 'bbb');
      const stat = await fs.stat('/append-size.txt');
      expect(stat.size).toBe(6);
    });

    it('should throw EISDIR when appending to directory', async () => {
      await fs.mkdir('/dir');
      await expect(fs.append('/dir', 'data')).rejects.toThrow(FileSystemError);
    });

    it('should handle binary append', async () => {
      const buf1 = new Uint8Array([1, 2, 3]);
      const buf2 = new Uint8Array([4, 5, 6]);
      await fs.create('/bin-append.dat', buf1);
      await fs.append('/bin-append.dat', buf2);
      const result = await fs.read('/bin-append.dat', { encoding: null });
      expect(new Uint8Array(result as ArrayBuffer)).toEqual(
        new Uint8Array([1, 2, 3, 4, 5, 6]),
      );
    });
  });

  describe('unlink', () => {
    it('should delete a file', async () => {
      await fs.create('/del.txt', 'bye');
      await fs.unlink('/del.txt');
      expect(await fs.exists('/del.txt')).toBe(false);
    });

    it('should throw ENOENT for nonexistent file', async () => {
      await expect(fs.unlink('/nope.txt')).rejects.toThrow(FileSystemError);
    });

    it('should throw EISDIR for directory', async () => {
      await fs.mkdir('/dir');
      await expect(fs.unlink('/dir')).rejects.toThrow(FileSystemError);
    });

    it('should not affect other files', async () => {
      await fs.create('/a.txt', 'a');
      await fs.create('/b.txt', 'b');
      await fs.unlink('/a.txt');
      expect(await fs.exists('/a.txt')).toBe(false);
      expect(await fs.read('/b.txt')).toBe('b');
    });

    it('should throw EACCES when deleting root', async () => {
      await expect(fs.unlink('/')).rejects.toThrow(FileSystemError);
    });

    it('should remove file from parent readdir', async () => {
      await fs.create('/visible.txt', 'data');
      const before = await fs.readdir('/');
      expect(before.some((e) => e.name === 'visible.txt')).toBe(true);

      await fs.unlink('/visible.txt');
      const after = await fs.readdir('/');
      expect(after.some((e) => e.name === 'visible.txt')).toBe(false);
    });

    it('should delete file in subdirectory', async () => {
      await fs.mkdir('/sub');
      await fs.create('/sub/deep.txt', 'deep');
      await fs.unlink('/sub/deep.txt');
      expect(await fs.exists('/sub/deep.txt')).toBe(false);
      expect(await fs.exists('/sub')).toBe(true);
    });
  });

  describe('exists', () => {
    it('should return true for existing file', async () => {
      await fs.create('/e.txt', 'hi');
      expect(await fs.exists('/e.txt')).toBe(true);
    });

    it('should return false for nonexistent file', async () => {
      expect(await fs.exists('/nope.txt')).toBe(false);
    });

    it('should return true for root', async () => {
      expect(await fs.exists('/')).toBe(true);
    });

    it('should return true for existing directory', async () => {
      await fs.mkdir('/dir');
      expect(await fs.exists('/dir')).toBe(true);
    });

    it('should return false for nonexistent deep path', async () => {
      expect(await fs.exists('/a/b/c/d')).toBe(false);
    });

    it('should return false after deletion', async () => {
      await fs.create('/gone.txt', 'data');
      await fs.unlink('/gone.txt');
      expect(await fs.exists('/gone.txt')).toBe(false);
    });
  });

  describe('stat', () => {
    it('should return stat for file', async () => {
      await fs.create('/s.txt', 'hello');
      const stat = await fs.stat('/s.txt');
      expect(stat.type).toBe(FileType.REGULAR);
      expect(stat.size).toBe(5);
      expect(stat.isFile()).toBe(true);
      expect(stat.isDirectory()).toBe(false);
      expect(stat.isSymlink()).toBe(false);
      expect(stat.isDevice()).toBe(false);
      expect(stat.nlink).toBe(1);
      expect(stat.createdAt).toBeGreaterThan(0);
      expect(stat.modifiedAt).toBeGreaterThan(0);
      expect(stat.accessedAt).toBeGreaterThan(0);
    });

    it('should return stat for directory', async () => {
      await fs.mkdir('/statdir');
      const stat = await fs.stat('/statdir');
      expect(stat.type).toBe(FileType.DIRECTORY);
      expect(stat.isDirectory()).toBe(true);
      expect(stat.isFile()).toBe(false);
      expect(stat.nlink).toBe(2); // 目录有 . 和父引用
    });

    it('should return stat for root', async () => {
      const stat = await fs.stat('/');
      expect(stat.type).toBe(FileType.DIRECTORY);
      expect(stat.ino).toBe(1);
    });

    it('should throw ENOENT for nonexistent path', async () => {
      await expect(fs.stat('/nope')).rejects.toThrow(FileSystemError);
    });

    it('should have unique ino per file', async () => {
      await fs.create('/f1.txt', '1');
      await fs.create('/f2.txt', '2');
      const stat1 = await fs.stat('/f1.txt');
      const stat2 = await fs.stat('/f2.txt');
      expect(stat1.ino).not.toBe(stat2.ino);
    });

    it('should return stat with ino matching readdir', async () => {
      await fs.create('/ino-check.txt', 'data');
      const stat = await fs.stat('/ino-check.txt');
      const entries = await fs.readdir('/');
      const entry = entries.find((e) => e.name === 'ino-check.txt');
      expect(entry).toBeDefined();
      expect(entry!.ino).toBe(stat.ino);
    });
  });

  describe('rename', () => {
    it('should rename a file', async () => {
      await fs.create('/old.txt', 'data');
      await fs.rename('/old.txt', '/new.txt');
      expect(await fs.exists('/old.txt')).toBe(false);
      expect(await fs.read('/new.txt')).toBe('data');
    });

    it('should move file between directories', async () => {
      await fs.mkdir('/src');
      await fs.mkdir('/dst');
      await fs.create('/src/file.txt', 'content');
      await fs.rename('/src/file.txt', '/dst/file.txt');
      expect(await fs.exists('/src/file.txt')).toBe(false);
      expect(await fs.read('/dst/file.txt')).toBe('content');
    });

    it('should overwrite existing target', async () => {
      await fs.create('/a.txt', 'a');
      await fs.create('/b.txt', 'b');
      await fs.rename('/a.txt', '/b.txt');
      expect(await fs.exists('/a.txt')).toBe(false);
      expect(await fs.read('/b.txt')).toBe('a');
    });

    it('should be no-op when renaming to same path', async () => {
      await fs.create('/same.txt', 'data');
      await fs.rename('/same.txt', '/same.txt');
      expect(await fs.read('/same.txt')).toBe('data');
    });

    it('should throw ENOENT for nonexistent source', async () => {
      await expect(fs.rename('/nope.txt', '/new.txt')).rejects.toThrow(FileSystemError);
    });

    it('should throw EINVAL when renaming root', async () => {
      await expect(fs.rename('/', '/other')).rejects.toThrow(FileSystemError);
    });

    it('should throw EINVAL when renaming to root', async () => {
      await fs.create('/file.txt', 'data');
      await expect(fs.rename('/file.txt', '/')).rejects.toThrow(FileSystemError);
    });

    it('should rename directory', async () => {
      await fs.mkdir('/olddir');
      await fs.create('/olddir/child.txt', 'child');
      await fs.rename('/olddir', '/newdir');
      expect(await fs.exists('/olddir')).toBe(false);
      expect(await fs.exists('/newdir')).toBe(true);
      expect(await fs.read('/newdir/child.txt')).toBe('child');
    });

    it('should throw ENOTEMPTY when target is non-empty directory', async () => {
      await fs.create('/source.txt', 'data');
      await fs.mkdir('/target');
      await fs.create('/target/existing.txt', 'existing');
      await expect(fs.rename('/source.txt', '/target')).rejects.toThrow(FileSystemError);
    });

    it('should preserve ino after rename', async () => {
      await fs.create('/before.txt', 'data');
      const statBefore = await fs.stat('/before.txt');
      await fs.rename('/before.txt', '/after.txt');
      const statAfter = await fs.stat('/after.txt');
      expect(statAfter.ino).toBe(statBefore.ino);
    });
  });

  describe('copy', () => {
    it('should copy a file', async () => {
      await fs.create('/orig.txt', 'original');
      await fs.copy('/orig.txt', '/copied.txt');
      expect(await fs.read('/orig.txt')).toBe('original');
      expect(await fs.read('/copied.txt')).toBe('original');
    });

    it('should copy metadata', async () => {
      await fs.create('/m.txt', 'data', {
        metadata: { mimeType: 'text/plain', tags: ['test'] },
      });
      await fs.copy('/m.txt', '/m2.txt');
      const meta = await fs.getMetadata('/m2.txt');
      expect(meta.mimeType).toBe('text/plain');
      expect(meta.tags).toEqual(['test']);
    });

    it('should throw EISDIR when copying directory', async () => {
      await fs.mkdir('/dir');
      await expect(fs.copy('/dir', '/dir2')).rejects.toThrow(FileSystemError);
    });

    it('should create independent copy', async () => {
      await fs.create('/orig.txt', 'original');
      await fs.copy('/orig.txt', '/copied.txt');
      await fs.write('/orig.txt', 'modified');
      expect(await fs.read('/copied.txt')).toBe('original');
    });

    it('should have different ino for copy', async () => {
      await fs.create('/a.txt', 'data');
      await fs.copy('/a.txt', '/b.txt');
      const statA = await fs.stat('/a.txt');
      const statB = await fs.stat('/b.txt');
      expect(statA.ino).not.toBe(statB.ino);
    });

    it('should throw EEXIST when target exists without overwrite', async () => {
      await fs.create('/src.txt', 'src');
      await fs.create('/dst.txt', 'dst');
      await expect(fs.copy('/src.txt', '/dst.txt')).rejects.toThrow(FileSystemError);
    });

    it('should overwrite target with overwrite option', async () => {
      await fs.create('/src.txt', 'src');
      await fs.create('/dst.txt', 'dst');
      await fs.copy('/src.txt', '/dst.txt', { overwrite: true });
      expect(await fs.read('/dst.txt')).toBe('src');
    });

    it('should copy binary file', async () => {
      const buf = new Uint8Array([255, 0, 128, 64]);
      await fs.create('/bin.dat', buf);
      await fs.copy('/bin.dat', '/bin-copy.dat');
      const result = await fs.read('/bin-copy.dat', { encoding: null });
      expect(new Uint8Array(result as ArrayBuffer)).toEqual(buf);
    });

    it('should throw ENOENT when source does not exist', async () => {
      await expect(fs.copy('/nope.txt', '/dst.txt')).rejects.toThrow(FileSystemError);
    });
  });

  // ============================================================
  // 目录操作
  // ============================================================

  describe('mkdir', () => {
    it('should create a directory', async () => {
      await fs.mkdir('/newdir');
      const stat = await fs.stat('/newdir');
      expect(stat.isDirectory()).toBe(true);
    });

    it('should throw EEXIST when already exists', async () => {
      await fs.mkdir('/dup');
      await expect(fs.mkdir('/dup')).rejects.toThrow(FileSystemError);
    });

    it('should throw ENOENT for missing parent', async () => {
      await expect(fs.mkdir('/a/b/c')).rejects.toThrow(FileSystemError);
    });

    it('should create recursive directories', async () => {
      await fs.mkdir('/a/b/c', { recursive: true });
      expect(await fs.exists('/a')).toBe(true);
      expect(await fs.exists('/a/b')).toBe(true);
      expect(await fs.exists('/a/b/c')).toBe(true);
    });

    it('recursive should not fail if partially exists', async () => {
      await fs.mkdir('/a');
      await fs.mkdir('/a/b/c', { recursive: true });
      expect(await fs.exists('/a/b/c')).toBe(true);
    });

    it('should appear in parent readdir', async () => {
      await fs.mkdir('/visible');
      const entries = await fs.readdir('/');
      expect(entries.some((e) => e.name === 'visible')).toBe(true);
    });

    it('should throw EINVAL for root path', async () => {
      // resolveParent 对 '/' 会抛出 EINVAL
      await expect(fs.mkdir('/')).rejects.toThrow(FileSystemError);
    });
  });

  describe('rmdir', () => {
    it('should remove empty directory', async () => {
      await fs.mkdir('/empty');
      await fs.rmdir('/empty');
      expect(await fs.exists('/empty')).toBe(false);
    });

    it('should throw ENOTEMPTY for non-empty directory', async () => {
      await fs.mkdir('/notempty');
      await fs.create('/notempty/file.txt', 'hi');
      await expect(fs.rmdir('/notempty')).rejects.toThrow(FileSystemError);
    });

    it('should remove recursively when option set', async () => {
      await fs.mkdir('/deep/nested/dir', { recursive: true });
      await fs.create('/deep/nested/dir/file.txt', 'data');
      await fs.create('/deep/nested/other.txt', 'data');
      await fs.rmdir('/deep', { recursive: true });
      expect(await fs.exists('/deep')).toBe(false);
    });

    it('should throw ENOTDIR for file', async () => {
      await fs.create('/file.txt', 'hi');
      await expect(fs.rmdir('/file.txt')).rejects.toThrow(FileSystemError);
    });

    it('force should not throw for nonexistent directory', async () => {
      await expect(
        fs.rmdir('/nope', { force: true }),
      ).resolves.toBeUndefined();
    });

    it('should throw EACCES when trying to remove root', async () => {
      await expect(fs.rmdir('/')).rejects.toThrow(FileSystemError);
    });

    it('should remove directory from parent listing', async () => {
      await fs.mkdir('/toremove');
      await fs.rmdir('/toremove');
      const entries = await fs.readdir('/');
      expect(entries.some((e) => e.name === 'toremove')).toBe(false);
    });

    it('should recursively remove deeply nested structures', async () => {
      await fs.mkdir('/a/b/c/d/e', { recursive: true });
      await fs.create('/a/b/file1.txt', 'f1');
      await fs.create('/a/b/c/file2.txt', 'f2');
      await fs.create('/a/b/c/d/file3.txt', 'f3');
      await fs.create('/a/b/c/d/e/file4.txt', 'f4');

      await fs.rmdir('/a', { recursive: true });

      expect(await fs.exists('/a')).toBe(false);
      expect(await fs.exists('/a/b')).toBe(false);
    });

    it('should throw ENOENT for nonexistent directory without force', async () => {
      await expect(fs.rmdir('/nonexistent')).rejects.toThrow(FileSystemError);
    });
  });

  describe('readdir', () => {
    it('should list directory contents', async () => {
      await fs.create('/a.txt', 'a');
      await fs.create('/b.txt', 'b');
      await fs.mkdir('/subdir');
      const entries = await fs.readdir('/');
      const names = entries.map((e) => e.name).sort();
      expect(names).toEqual(['a.txt', 'b.txt', 'subdir']);
    });

    it('should return empty array for empty directory', async () => {
      await fs.mkdir('/empty');
      const entries = await fs.readdir('/empty');
      expect(entries).toEqual([]);
    });

    it('should throw ENOTDIR for file', async () => {
      await fs.create('/file.txt', 'hi');
      await expect(fs.readdir('/file.txt')).rejects.toThrow(FileSystemError);
    });

    it('should throw ENOENT for nonexistent directory', async () => {
      await expect(fs.readdir('/nope')).rejects.toThrow(FileSystemError);
    });

    it('entries should have ino field', async () => {
      await fs.create('/with-ino.txt', 'data');
      const entries = await fs.readdir('/');
      const entry = entries.find((e) => e.name === 'with-ino.txt');
      expect(entry).toBeDefined();
      expect(entry!.ino).toBeGreaterThan(0);
    });

    it('should list subdirectory contents', async () => {
      await fs.mkdir('/parent');
      await fs.create('/parent/child1.txt', 'c1');
      await fs.create('/parent/child2.txt', 'c2');
      const entries = await fs.readdir('/parent');
      const names = entries.map((e) => e.name).sort();
      expect(names).toEqual(['child1.txt', 'child2.txt']);
    });
  });

  // ============================================================
  // 深层嵌套操作
  // ============================================================

  describe('nested paths', () => {
    it('should create files in subdirectories', async () => {
      await fs.mkdir('/a/b/c', { recursive: true });
      await fs.create('/a/b/c/file.txt', 'deep');
      const content = await fs.read('/a/b/c/file.txt');
      expect(content).toBe('deep');
    });

    it('should list only direct children', async () => {
      await fs.mkdir('/parent');
      await fs.create('/parent/child1.txt', 'c1');
      await fs.create('/parent/child2.txt', 'c2');
      await fs.mkdir('/parent/subdir');
      const entries = await fs.readdir('/parent');
      expect(entries).toHaveLength(3);
    });

    it('should handle path normalization', async () => {
      await fs.mkdir('/norm');
      await fs.create('/norm/file.txt', 'data');
      const content = await fs.read('/norm/../norm/./file.txt');
      expect(content).toBe('data');
    });

    it('should handle multiple levels of ..', async () => {
      await fs.mkdir('/a/b/c', { recursive: true });
      await fs.create('/a/target.txt', 'found');
      const content = await fs.read('/a/b/c/../../target.txt');
      expect(content).toBe('found');
    });
  });

  // ============================================================
  // 元数据
  // ============================================================

  describe('metadata', () => {
    it('should set and get metadata', async () => {
      await fs.create('/meta.txt', 'data');
      await fs.setMetadata('/meta.txt', {
        mimeType: 'text/plain',
        tags: ['important', 'test'],
      });
      const meta = await fs.getMetadata('/meta.txt');
      expect(meta.mimeType).toBe('text/plain');
      expect(meta.tags).toEqual(['important', 'test']);
    });

    it('should set metadata on create', async () => {
      await fs.create('/m.txt', 'data', {
        metadata: { mimeType: 'application/json' },
      });
      const meta = await fs.getMetadata('/m.txt');
      expect(meta.mimeType).toBe('application/json');
    });

    it('should merge metadata on update', async () => {
      await fs.create('/m.txt', 'data', {
        metadata: { mimeType: 'text/plain', tags: ['a'] },
      });
      await fs.setMetadata('/m.txt', { tags: ['b'] });
      const meta = await fs.getMetadata('/m.txt');
      expect(meta.mimeType).toBe('text/plain'); // 保留
      expect(meta.tags).toEqual(['b']); // 覆盖
    });

    it('should support custom keys', async () => {
      await fs.create('/custom.txt', 'data');
      await fs.setMetadata('/custom.txt', {
        author: 'test',
        version: 2,
        published: true,
      } as any);
      const meta = await fs.getMetadata('/custom.txt');
      expect(meta['author']).toBe('test');
      expect(meta['version']).toBe(2);
      expect(meta['published']).toBe(true);
    });

    it('should throw ENOENT for metadata on nonexistent file', async () => {
      await expect(fs.getMetadata('/nope.txt')).rejects.toThrow(FileSystemError);
      await expect(
        fs.setMetadata('/nope.txt', { mimeType: 'text/plain' }),
      ).rejects.toThrow(FileSystemError);
    });

    it('should return empty metadata by default', async () => {
      await fs.create('/no-meta.txt', 'data');
      const meta = await fs.getMetadata('/no-meta.txt');
      expect(meta).toBeDefined();
      expect(typeof meta).toBe('object');
    });

    it('should update modifiedAt when setting metadata', async () => {
      await fs.create('/meta-ts.txt', 'data');
      const stat1 = await fs.stat('/meta-ts.txt');

      await new Promise((r) => setTimeout(r, 10));

      await fs.setMetadata('/meta-ts.txt', { mimeType: 'text/plain' });
      const stat2 = await fs.stat('/meta-ts.txt');
      expect(stat2.modifiedAt).toBeGreaterThanOrEqual(stat1.modifiedAt);
    });

    it('should set metadata on directories', async () => {
      await fs.mkdir('/meta-dir');
      await fs.setMetadata('/meta-dir', { description: 'a directory' } as any);
      const meta = await fs.getMetadata('/meta-dir');
      expect(meta['description']).toBe('a directory');
    });
  });

  // ============================================================
  // 挂载
  // ============================================================

  describe('mount / unmount', () => {
    it('should mount a backend and access files through it', async () => {
      const mountedBackend = new MemoryBackend();
      await fs.mount('/mnt', mountedBackend);

      await fs.create('/mnt/file.txt', 'mounted content');
      const content = await fs.read('/mnt/file.txt');
      expect(content).toBe('mounted content');
    });

    it('should list mounts', async () => {
      const backend1 = new MemoryBackend();
      const backend2 = new MemoryBackend();
      await fs.mount('/mnt/a', backend1);
      await fs.mount('/mnt/b', backend2);

      const mounts = fs.mounts();
      expect(mounts).toHaveLength(2);
      const paths = mounts.map((m) => m.path).sort();
      expect(paths).toEqual(['/mnt/a', '/mnt/b']);
    });

    it('should unmount and fall back to root backend', async () => {
      const mountedBackend = new MemoryBackend();
      await fs.mount('/mnt', mountedBackend);
      await fs.create('/mnt/file.txt', 'data');

      await fs.unmount('/mnt');

      // /mnt no longer has the mounted backend
      expect(await fs.exists('/mnt/file.txt')).toBe(false);
    });

    it('should throw EEXIST on duplicate mount', async () => {
      const backend1 = new MemoryBackend();
      const backend2 = new MemoryBackend();
      await fs.mount('/mnt', backend1);
      await expect(fs.mount('/mnt', backend2)).rejects.toThrow(FileSystemError);
    });

    it('should isolate files between mount points', async () => {
      const backendA = new MemoryBackend();
      const backendB = new MemoryBackend();
      await fs.mount('/a', backendA);
      await fs.mount('/b', backendB);

      await fs.create('/a/file.txt', 'from-a');
      await fs.create('/b/file.txt', 'from-b');

      expect(await fs.read('/a/file.txt')).toBe('from-a');
      expect(await fs.read('/b/file.txt')).toBe('from-b');
    });

    it('should resolve longest prefix mount', async () => {
      const outerBackend = new MemoryBackend();
      const innerBackend = new MemoryBackend();
      await fs.mount('/mnt', outerBackend);
      await fs.mount('/mnt/inner', innerBackend);

      await fs.create('/mnt/outer.txt', 'outer');
      await fs.create('/mnt/inner/deep.txt', 'inner');

      expect(await fs.read('/mnt/outer.txt')).toBe('outer');
      expect(await fs.read('/mnt/inner/deep.txt')).toBe('inner');

      // inner 文件不在 outer backend
      const outerEntries = await outerBackend.getDirEntries(1);
      expect(outerEntries.some((e) => e.name === 'outer.txt')).toBe(true);
    });
  });

  // ============================================================
  // 边界 / 特殊情况
  // ============================================================

  describe('edge cases', () => {
    it('should handle path with trailing slash', async () => {
      await fs.mkdir('/trailing');
      await fs.create('/trailing/file.txt', 'data');
      // 尾部斜线会被 normalize 去掉
      const content = await fs.read('/trailing/file.txt');
      expect(content).toBe('data');
    });

    it('should handle path with multiple slashes', async () => {
      await fs.mkdir('/multi');
      await fs.create('/multi/file.txt', 'data');
      const content = await fs.read('///multi///file.txt');
      expect(content).toBe('data');
    });

    it('should handle path with dot segments', async () => {
      await fs.create('/dotfile.txt', 'dotdata');
      const content = await fs.read('/./dotfile.txt');
      expect(content).toBe('dotdata');
    });

    it('should throw on relative path', async () => {
      await expect(fs.create('relative.txt', 'data')).rejects.toThrow(FileSystemError);
    });

    it('should throw on empty path', async () => {
      await expect(fs.create('', 'data')).rejects.toThrow(FileSystemError);
    });
  });
});
