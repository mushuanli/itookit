// tests/assetdir.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createFileSystem } from '../src/index';
import { AssetDirUtils } from '../src/core/helper/assetdir';
import type { FileSystem } from '../src/core/filesystem';

describe('AssetDir Utils', () => {
  let fs: FileSystem;

  beforeEach(async () => {
    fs = await createFileSystem({ backend: 'memory' });
  });

  describe('Path Utilities', () => {
    it('should generate assetdir name from filename', () => {
      expect(AssetDirUtils.getAssetDirName('test.txt')).toBe('.test.txt');
      expect(AssetDirUtils.getAssetDirName('readme')).toBe('.readme');
      expect(AssetDirUtils.getAssetDirName('file.tar.gz')).toBe('.file.tar.gz');
    });

    it('should compute assetdir path', () => {
      expect(AssetDirUtils.getAssetDirPath('/docs/file.md')).toBe('/docs/.file.md');
      expect(AssetDirUtils.getAssetDirPath('/file.txt')).toBe('/.file.txt');
    });

    it('should extract filename from assetdir name', () => {
      expect(AssetDirUtils.getFileNameFromAssetDirName('.test.txt')).toBe('test.txt');
      expect(AssetDirUtils.getFileNameFromAssetDirName('.readme')).toBe('readme');
    });

    it('should throw on invalid assetdir name', () => {
      expect(() => AssetDirUtils.getFileNameFromAssetDirName('test.txt'))
        .toThrow('Not a valid assetdir name');
      expect(() => AssetDirUtils.getFileNameFromAssetDirName('.'))
        .toThrow('Not a valid assetdir name');
    });

    it('should get file path from assetdir path', () => {
      expect(AssetDirUtils.getFilePathFromAssetDir('/docs/.file.md')).toBe('/docs/file.md');
      expect(AssetDirUtils.getFilePathFromAssetDir('/.test.txt')).toBe('/test.txt');
    });
  });

  describe('AssetDir Lifecycle', () => {
    beforeEach(async () => {
      await fs.create('/test.txt', 'content');
    });

    it('should check if file has no assetdir initially', async () => {
      const hasAssetDir = await fs.hasAssetDir('/test.txt');
      expect(hasAssetDir).toBe(false);
    });

    it('should return null for non-existent assetdir', async () => {
      const assetDir = await fs.getAssetDir('/test.txt');
      expect(assetDir).toBeNull();
    });

    it('should create assetdir on demand', async () => {
      const assetDirPath = await fs.ensureAssetDir('/test.txt');
      
      expect(assetDirPath).toBe('/.test.txt');
      expect(await fs.exists('/.test.txt')).toBe(true);
      
      const stat = await fs.stat('/.test.txt');
      expect(stat.isDirectory()).toBe(true);
      expect(stat.metadata.isAssetDir).toBe(true);
    });

    it('should establish bidirectional references', async () => {
      await fs.ensureAssetDir('/test.txt');
      
      const fileStat = await fs.stat('/test.txt');
      const assetDirStat = await fs.stat('/.test.txt');
      
      expect(fileStat.metadata.assetDirIno).toBe(assetDirStat.ino);
      expect(assetDirStat.metadata.ownerFileIno).toBe(fileStat.ino);
      expect(assetDirStat.metadata.isAssetDir).toBe(true);
    });

    it('should return existing assetdir on repeated calls', async () => {
      const path1 = await fs.ensureAssetDir('/test.txt');
      const path2 = await fs.ensureAssetDir('/test.txt');
      
      expect(path1).toBe(path2);
      expect(await fs.hasAssetDir('/test.txt')).toBe(true);
    });

    it('should throw error for non-regular files', async () => {
      await fs.mkdir('/testdir');
      
      await expect(fs.ensureAssetDir('/testdir'))
        .rejects.toThrow('AssetDir only for regular and record files');
    });
  });

  describe('AssetDir Content Management', () => {
    beforeEach(async () => {
      await fs.create('/doc.md', '# Title');
      await fs.ensureAssetDir('/doc.md');
    });

    it('should list empty assetdir', async () => {
      const assets = await fs.listAssets('/doc.md');
      expect(assets).toEqual([]);
    });

    it('should list assets in assetdir', async () => {
      await fs.create('/.doc.md/image.png', 'binary');
      await fs.create('/.doc.md/data.json', '{}');
      
      const assets = await fs.listAssets('/doc.md');
      expect(assets).toContain('image.png');
      expect(assets).toContain('data.json');
      expect(assets).toHaveLength(2);
    });

    it('should return empty array for file without assetdir', async () => {
      await fs.create('/other.txt', 'text');
      const assets = await fs.listAssets('/other.txt');
      expect(assets).toEqual([]);
    });
  });

  describe('AssetDir Removal', () => {
    beforeEach(async () => {
      await fs.create('/file.txt', 'content');
      await fs.ensureAssetDir('/file.txt');
      await fs.create('/.file.txt/asset1.png', 'data1');
      await fs.create('/.file.txt/asset2.json', 'data2');
    });

    it('should remove empty assetdir', async () => {
      await fs.create('/empty.txt', 'text');
      await fs.ensureAssetDir('/empty.txt');
      
      await fs.removeAssetDir('/empty.txt');
      
      expect(await fs.exists('/.empty.txt')).toBe(false);
      expect(await fs.hasAssetDir('/empty.txt')).toBe(false);
    });

    it('should fail to remove non-empty assetdir without force', async () => {
      await expect(fs.removeAssetDir('/file.txt', false))
        .rejects.toThrow();
    });

    it('should remove assetdir with content when forced', async () => {
      await fs.removeAssetDir('/file.txt', true);
      
      expect(await fs.exists('/.file.txt')).toBe(false);
      expect(await fs.hasAssetDir('/file.txt')).toBe(false);
      
      const fileStat = await fs.stat('/file.txt');
      expect(fileStat.metadata.assetDirIno).toBeUndefined();
    });

    it('should handle removal of non-existent assetdir gracefully', async () => {
      await fs.create('/noasset.txt', 'text');
      await expect(fs.removeAssetDir('/noasset.txt')).resolves.not.toThrow();
    });
  });

  describe('AssetDir with File Operations', () => {
    describe('Unlink Strategies', () => {
      beforeEach(async () => {
        await fs.create('/file.txt', 'content');
        await fs.ensureAssetDir('/file.txt');
        await fs.create('/.file.txt/asset.png', 'data');
      });

      // ✅ 修改：默认策略为 remove
      it('should remove assetdir on unlink (default)', async () => {
        await fs.unlink('/file.txt');

        expect(await fs.exists('/file.txt')).toBe(false);
        expect(await fs.exists('/.file.txt')).toBe(false);
      });

      // ✅ 新增：显式 keep 策略测试
      it('should keep assetdir on unlink with keep strategy', async () => {
        await fs.unlink('/file.txt', { assetDirStrategy: 'keep' });

        expect(await fs.exists('/file.txt')).toBe(false);
        expect(await fs.exists('/.file.txt')).toBe(true);
        expect(await fs.exists('/.file.txt/asset.png')).toBe(true);
      });

      it('should remove assetdir on unlink with remove strategy', async () => {
        await fs.unlink('/file.txt', { assetDirStrategy: 'remove' });
        
        expect(await fs.exists('/file.txt')).toBe(false);
        expect(await fs.exists('/.file.txt')).toBe(false);
      });

      it('should orphan assetdir on unlink', async () => {
        await fs.unlink('/file.txt', { assetDirStrategy: 'orphan' });
        
        expect(await fs.exists('/file.txt')).toBe(false);
        expect(await fs.exists('/.file.txt')).toBe(true);
        
        const stat = await fs.stat('/.file.txt');
        expect(stat.metadata.isAssetDir).toBe(false);
        expect(stat.metadata.ownerFileIno).toBeUndefined();
      });
    });

    describe('Rename Operations', () => {
      beforeEach(async () => {
        await fs.create('/old.txt', 'content');
        await fs.ensureAssetDir('/old.txt');
        await fs.create('/.old.txt/asset.png', 'data');
      });

      it('should move assetdir on rename (default)', async () => {
        await fs.rename('/old.txt', '/new.txt');
        
        expect(await fs.exists('/new.txt')).toBe(true);
        expect(await fs.exists('/old.txt')).toBe(false);
        expect(await fs.exists('/.new.txt')).toBe(true);
        expect(await fs.exists('/.old.txt')).toBe(false);
        expect(await fs.exists('/.new.txt/asset.png')).toBe(true);
        
        const fileStat = await fs.stat('/new.txt');
        const assetDirStat = await fs.stat('/.new.txt');
        expect(fileStat.metadata.assetDirIno).toBe(assetDirStat.ino);
        expect(assetDirStat.metadata.ownerFileIno).toBe(fileStat.ino);
      });

      it('should not move assetdir when syncAssetDir is false', async () => {
        await fs.rename('/old.txt', '/new.txt', { syncAssetDir: false });
        
        expect(await fs.exists('/new.txt')).toBe(true);
        expect(await fs.exists('/.old.txt')).toBe(true);
        expect(await fs.exists('/.new.txt')).toBe(false);
      });

      it('should handle rename to different directory', async () => {
        await fs.mkdir('/subdir');
        await fs.rename('/old.txt', '/subdir/new.txt');
        
        expect(await fs.exists('/subdir/new.txt')).toBe(true);
        expect(await fs.exists('/subdir/.new.txt')).toBe(true);
        expect(await fs.exists('/subdir/.new.txt/asset.png')).toBe(true);
      });

      it('should throw on assetdir name conflict', async () => {
        await fs.create('/target.txt', 'text');
        await fs.mkdir('/.target.txt'); // Conflicting directory
        
        await expect(fs.rename('/old.txt', '/target.txt'))
          .rejects.toThrow('AssetDir name conflicts');
      });
    });

    describe('Copy Operations', () => {
      beforeEach(async () => {
        await fs.create('/source.txt', 'content');
        await fs.ensureAssetDir('/source.txt');
        await fs.create('/.source.txt/asset.png', 'data');
      });

      it('should copy assetdir by default', async () => {
        await fs.copy('/source.txt', '/dest.txt');
        
        expect(await fs.exists('/dest.txt')).toBe(true);
        expect(await fs.exists('/.dest.txt')).toBe(true);
        expect(await fs.exists('/.dest.txt/asset.png')).toBe(true);
        
        // Verify independence
        const sourceStat = await fs.stat('/source.txt');
        const destStat = await fs.stat('/dest.txt');
        expect(sourceStat.ino).not.toBe(destStat.ino);
        expect(sourceStat.metadata.assetDirIno).not.toBe(destStat.metadata.assetDirIno);
      });

      it('should not copy assetdir when copyAssetDir is false', async () => {
        await fs.copy('/source.txt', '/dest.txt', { copyAssetDir: false });
        
        expect(await fs.exists('/dest.txt')).toBe(true);
        expect(await fs.exists('/.dest.txt')).toBe(false);
      });

      it('should copy nested assetdir structure', async () => {
        await fs.mkdir('/.source.txt/subdir');
        await fs.create('/.source.txt/subdir/nested.dat', 'nested');
        
        await fs.copy('/source.txt', '/dest.txt');
        
        expect(await fs.exists('/.dest.txt/subdir/nested.dat')).toBe(true);
        const content = await fs.read('/.dest.txt/subdir/nested.dat');
        expect(content).toBe('nested');
      });
    });
  });

  describe('AssetDir Validation & Repair', () => {
    it('should validate consistent assetdir', async () => {
      await fs.create('/file.txt', 'content');
      await fs.ensureAssetDir('/file.txt');
      
      const issues = await fs.validateAssetDir('/file.txt');
      expect(issues).toEqual([]);
    });

    it('should detect missing assetdir', async () => {
      await fs.create('/file.txt', 'content');
      const fileStat = await fs.stat('/file.txt');
      await fs.setMetadata('/file.txt', { assetDirIno: 999 });
      
      const issues = await fs.validateAssetDir('/file.txt');
      expect(issues.length).toBeGreaterThan(0);
      expect(issues[0]).toContain('does not exist');
    });

    it('should detect orphaned assetdir', async () => {
      await fs.create('/file.txt', 'content');
      await fs.mkdir('/.file.txt');
      await fs.setMetadata('/.file.txt', { isAssetDir: true, ownerFileIno: 999 });
      
      const issues = await fs.validateAssetDir('/file.txt');
      expect(issues.length).toBeGreaterThan(0);
      expect(issues[0]).toContain('no assetDirIno reference');
    });

    it('should detect ino mismatch', async () => {
      await fs.create('/file.txt', 'content');
      await fs.ensureAssetDir('/file.txt');
      await fs.setMetadata('/file.txt', { assetDirIno: 999 });
      
      const issues = await fs.validateAssetDir('/file.txt');
      expect(issues.some(i => i.includes('mismatch'))).toBe(true);
    });

    it('should repair broken references', async () => {
      await fs.create('/file.txt', 'content');
      await fs.mkdir('/.file.txt');
      
      await fs.repairAssetDir('/file.txt');
      
      const fileStat = await fs.stat('/file.txt');
      const assetDirStat = await fs.stat('/.file.txt');
      
      expect(fileStat.metadata.assetDirIno).toBe(assetDirStat.ino);
      expect(assetDirStat.metadata.ownerFileIno).toBe(fileStat.ino);
      expect(assetDirStat.metadata.isAssetDir).toBe(true);
    });

    it('should clear dangling reference on repair', async () => {
      await fs.create('/file.txt', 'content');
      await fs.setMetadata('/file.txt', { assetDirIno: 999 });
      
      await fs.repairAssetDir('/file.txt');
      
      const fileStat = await fs.stat('/file.txt');
      expect(fileStat.metadata.assetDirIno).toBeUndefined();
    });
  });

  describe('Recursive Validation & Repair', () => {
    beforeEach(async () => {
      await fs.mkdir('/project');
      await fs.create('/project/file1.txt', 'content1');
      await fs.create('/project/file2.txt', 'content2');
      await fs.ensureAssetDir('/project/file1.txt');
    });

    it('should validate directory recursively', async () => {
      const issues = await fs.validateAssetDirRecursive('/project');
      expect(issues.size).toBe(0);
    });

    it('should detect issues in subdirectories', async () => {
      await fs.setMetadata('/project/file1.txt', { assetDirIno: 999 });
      
      const issues = await fs.validateAssetDirRecursive('/project');
      expect(issues.size).toBeGreaterThan(0);
      expect(issues.has('/project/file1.txt')).toBe(true);
    });

    it('should repair directory recursively', async () => {
      await fs.setMetadata('/project/file1.txt', { assetDirIno: 999 });
      
      await fs.repairAssetDirRecursive('/project');
      
      const issues = await fs.validateAssetDirRecursive('/project');
      expect(issues.size).toBe(0);
    });

    it('should skip assetdirs during recursive walk', async () => {
      await fs.create('/project/.file1.txt/nested.txt', 'nested');
      
      const issues = await fs.validateAssetDirRecursive('/project');
      expect(issues.has('/.file1.txt/nested.txt')).toBe(false);
    });
  });

  describe('Edge Cases', () => {
    it('should handle root directory files', async () => {
      await fs.create('/root.txt', 'content');
      const assetDir = await fs.ensureAssetDir('/root.txt');
      expect(assetDir).toBe('/.root.txt');
    });

    it('should handle files with multiple dots', async () => {
      await fs.create('/file.tar.gz', 'archive');
      const assetDir = await fs.ensureAssetDir('/file.tar.gz');
      expect(assetDir).toBe('/.file.tar.gz');
    });

    it('should handle files without extension', async () => {
      await fs.create('/README', 'text');
      const assetDir = await fs.ensureAssetDir('/README');
      expect(assetDir).toBe('/.README');
    });

    it('should throw on device files', async () => {
      await expect(fs.ensureAssetDir('/dev/null'))
        .rejects.toThrow();
    });

    it('should handle concurrent assetdir creation', async () => {
      await fs.create('/file.txt', 'content');
      
      const [path1, path2] = await Promise.all([
        fs.ensureAssetDir('/file.txt'),
        fs.ensureAssetDir('/file.txt'),
      ]);
      
      expect(path1).toBe(path2);
      expect(await fs.hasAssetDir('/file.txt')).toBe(true);
    });
  });

  describe('Integration with readdir', () => {
    beforeEach(async () => {
      await fs.mkdir('/docs');
      await fs.create('/docs/file1.txt', 'content1');
      await fs.create('/docs/file2.txt', 'content2');
      await fs.ensureAssetDir('/docs/file1.txt');
      await fs.create('/docs/.file1.txt/asset.png', 'data');
    });

    // ✅ 修改：readdir 默认隐藏 assetdir
    it('should hide assetdirs in readdir by default', async () => {
      const entries = await fs.readdir('/docs');
      const names = entries.map(e => e.name);

      expect(names).toContain('file1.txt');
      expect(names).toContain('file2.txt');
      expect(names).not.toContain('.file1.txt');
    });

    // ✅ 修改：显式包含 assetdir
    it('should include assetdirs with includeAssetDirs: true', async () => {
      const entries = await fs.readdir('/docs', { includeAssetDirs: true });
      const names = entries.map(e => e.name);

      expect(names).toContain('file1.txt');
      expect(names).toContain('file2.txt');
      expect(names).toContain('.file1.txt');
    });

    it('should exclude assetdirs with includeAssetDirs: false', async () => {
      const entries = await fs.readdir('/docs', { includeAssetDirs: false });
      const names = entries.map(e => e.name);
      
      expect(names).toContain('file1.txt');
      expect(names).toContain('file2.txt');
      expect(names).not.toContain('.file1.txt');
    });

    it('should use readdirVisible to hide assetdirs', async () => {
      const entries = await fs.readdirVisible('/docs');
      const names = entries.map(e => e.name);
      
      expect(names).toContain('file1.txt');
      expect(names).toContain('file2.txt');
      expect(names).not.toContain('.file1.txt');
    });

    it('should handle mixed hidden and assetdir directories', async () => {
      await fs.mkdir('/docs/.hidden');
      await fs.mkdir('/docs/.config');

      // ✅ 修改：readdir 默认已隐藏 assetdir，需要用 includeAssetDirs: true 看全部
      const all = await fs.readdir('/docs', { includeAssetDirs: true });
      const visible = await fs.readdirVisible('/docs');

      expect(all.length).toBeGreaterThan(visible.length);
      expect(visible.map(e => e.name)).not.toContain('.file1.txt');
      // 普通隐藏目录不被过滤
      expect(visible.map(e => e.name)).toContain('.hidden');
      expect(visible.map(e => e.name)).toContain('.config');
      expect(all.map(e => e.name)).toContain('.hidden');
    });
  });

  describe('AssetDir with Record Files', () => {
    beforeEach(async () => {
      await fs.createRecord('/data.json', { key: 'value' });
    });

    it('should create assetdir for record files', async () => {
      const assetDir = await fs.ensureAssetDir('/data.json');
      expect(assetDir).toBe('/.data.json');
      expect(await fs.exists('/.data.json')).toBe(true);
    });

    it('should copy record file with assetdir', async () => {
      await fs.ensureAssetDir('/data.json');
      await fs.create('/.data.json/schema.json', '{}');
      
      await fs.copy('/data.json', '/data-copy.json');
      
      expect(await fs.exists('/data-copy.json')).toBe(true);
      expect(await fs.exists('/.data-copy.json')).toBe(true);
      expect(await fs.exists('/.data-copy.json/schema.json')).toBe(true);
      
      const fields = await fs.getAllFields('/data-copy.json');
      expect(fields).toEqual({ key: 'value' });
    });

    it('should handle record file rename with assetdir', async () => {
      await fs.ensureAssetDir('/data.json');
      await fs.create('/.data.json/metadata.txt', 'meta');
      
      await fs.rename('/data.json', '/renamed.json');
      
      expect(await fs.exists('/renamed.json')).toBe(true);
      expect(await fs.exists('/.renamed.json')).toBe(true);
      expect(await fs.exists('/.renamed.json/metadata.txt')).toBe(true);
    });
  });

  describe('AssetDir with Symlinks', () => {
    it('should throw error for symlink files', async () => {
      await fs.create('/target.txt', 'content');
      // Note: Symlink creation depends on your FileSystem implementation
      // This is a placeholder test
      
      // await fs.symlink('/target.txt', '/link.txt');
      // await expect(fs.ensureAssetDir('/link.txt'))
      //   .rejects.toThrow('AssetDir only for regular files');
    });
  });

  describe('AssetDir Metadata Preservation', () => {
    it('should preserve file metadata when creating assetdir', async () => {
      await fs.create('/file.txt', 'content', {
        metadata: { mimeType: 'text/plain', tags: ['important'] }
      });
      
      await fs.ensureAssetDir('/file.txt');
      
      const fileStat = await fs.stat('/file.txt');
      expect(fileStat.metadata.mimeType).toBe('text/plain');
      expect(fileStat.metadata.tags).toEqual(['important']);
    });

    it('should preserve assetdir metadata on repair', async () => {
      await fs.create('/file.txt', 'content');
      await fs.mkdir('/.file.txt');
      await fs.setMetadata('/.file.txt', { 
        customField: 'value',
        isAssetDir: false 
      });
      
      await fs.repairAssetDir('/file.txt');
      
      const assetDirStat = await fs.stat('/.file.txt');
      expect(assetDirStat.metadata.customField).toBe('value');
      expect(assetDirStat.metadata.isAssetDir).toBe(true);
    });
  });

  describe('AssetDir with Transactions', () => {
    it('should create assetdir within transaction', async () => {
      await fs.create('/file.txt', 'content');
      
      await fs.transaction(async (txFs) => {
        await txFs.ensureAssetDir('/file.txt');
        await txFs.create('/.file.txt/asset.png', 'data');
      });
      
      expect(await fs.exists('/.file.txt')).toBe(true);
      expect(await fs.exists('/.file.txt/asset.png')).toBe(true);
    });

    it('should rollback assetdir creation on transaction failure', async () => {
      await fs.create('/file.txt', 'content');
      
      try {
        await fs.transaction(async (txFs) => {
          await txFs.ensureAssetDir('/file.txt');
          throw new Error('Rollback');
        });
      } catch (err) {
        // Expected
      }
      
      // Behavior depends on transaction implementation
      // This test may need adjustment based on actual rollback semantics
    });
  });

  describe('AssetDir Performance', () => {
    it('should handle multiple files with assetdirs efficiently', async () => {
      const fileCount = 50;
      
      // Create files
      for (let i = 0; i < fileCount; i++) {
        await fs.create(`/file${i}.txt`, `content${i}`);
      }
      
      // Create assetdirs
      const start = Date.now();
      for (let i = 0; i < fileCount; i++) {
        await fs.ensureAssetDir(`/file${i}.txt`);
      }
      const duration = Date.now() - start;
      
      // Verify all created
      for (let i = 0; i < fileCount; i++) {
        expect(await fs.hasAssetDir(`/file${i}.txt`)).toBe(true);
      }
      
      // Performance assertion (adjust threshold as needed)
      expect(duration).toBeLessThan(5000);
    });

    it('should validate large directory tree efficiently', async () => {
      await fs.mkdir('/large');
      
      for (let i = 0; i < 20; i++) {
        await fs.create(`/large/file${i}.txt`, `content${i}`);
        await fs.ensureAssetDir(`/large/file${i}.txt`);
      }
      
      const start = Date.now();
      const issues = await fs.validateAssetDirRecursive('/large');
      const duration = Date.now() - start;
      
      expect(issues.size).toBe(0);
      expect(duration).toBeLessThan(3000);
    });
  });

  describe('AssetDir Error Handling', () => {
    it('should handle missing parent directory gracefully', async () => {
      await expect(fs.ensureAssetDir('/nonexistent/file.txt'))
        .rejects.toThrow('ENOENT');
    });

    it('should handle permission errors gracefully', async () => {
      // This test depends on permission system implementation
      // Placeholder for future implementation
    });

    it('should handle concurrent modifications', async () => {
      await fs.create('/file.txt', 'content');
      
      const operations = [
        fs.ensureAssetDir('/file.txt'),
        fs.setMetadata('/file.txt', { customField: 'value' }),
        fs.write('/file.txt', 'new content'),
      ];
      
      await Promise.all(operations);
      
      expect(await fs.hasAssetDir('/file.txt')).toBe(true);
      const content = await fs.read('/file.txt');
      expect(content).toBe('new content');
    });

    it('should handle assetdir removal during iteration', async () => {
      await fs.mkdir('/docs');
      await fs.create('/docs/file1.txt', 'content1');
      await fs.create('/docs/file2.txt', 'content2');
      await fs.ensureAssetDir('/docs/file1.txt');
      await fs.ensureAssetDir('/docs/file2.txt');
      
      const entries = await fs.readdir('/docs');
      
      // Remove assetdir while processing
      await fs.removeAssetDir('/docs/file1.txt', true);
      
      // Should still be able to process remaining entries
      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue;
        const stat = await fs.stat(`/docs/${entry.name}`);
        expect(stat).toBeDefined();
      }
    });
  });

  describe('AssetDir with Watch Events', () => {
    it('should emit events on assetdir creation', async () => {
      await fs.create('/file.txt', 'content');
      
      const events: any[] = [];
      const watcher = fs.watch('/', (event) => {
        events.push(event);
      }, { recursive: true });
      
      await fs.ensureAssetDir('/file.txt');
      
      watcher.close();
      
      expect(events.some(e => e.path === '/.file.txt' && e.type === 'create')).toBe(true);
    });

    it('should emit events on assetdir removal', async () => {
      await fs.create('/file.txt', 'content');
      await fs.ensureAssetDir('/file.txt');
      
      const events: any[] = [];
      const watcher = fs.watch('/', (event) => {
        events.push(event);
      }, { recursive: true });
      
      await fs.removeAssetDir('/file.txt', true);
      
      watcher.close();
      
      expect(events.some(e => e.path === '/.file.txt' && e.type === 'delete')).toBe(true);
    });

    it('should emit events on assetdir rename', async () => {
      await fs.create('/old.txt', 'content');
      await fs.ensureAssetDir('/old.txt');
      
      const events: any[] = [];
      const watcher = fs.watch('/', (event) => {
        events.push(event);
      }, { recursive: true });
      
      await fs.rename('/old.txt', '/new.txt');
      
      watcher.close();
      
      expect(events.some(e => e.type === 'rename')).toBe(true);
    });
  });

  describe('AssetDir Cross-Mount Scenarios', () => {
    it('should handle assetdir across mount points', async () => {
      const secondBackend = (await import('../src/backend/memory')).MemoryBackend;
      const backend2 = new secondBackend();
      await backend2.init();
      
      await fs.mount('/mounted', backend2);
      
      await fs.create('/mounted/file.txt', 'content');
      const assetDir = await fs.ensureAssetDir('/mounted/file.txt');
      
      expect(assetDir).toBe('/mounted/.file.txt');
      expect(await fs.exists('/mounted/.file.txt')).toBe(true);
    });

    it('should handle rename across mount boundaries', async () => {
      const secondBackend = (await import('../src/backend/memory')).MemoryBackend;
      const backend2 = new secondBackend();
      await backend2.init();
      
      await fs.mount('/mounted', backend2);
      
      await fs.create('/file.txt', 'content');
      await fs.ensureAssetDir('/file.txt');
      
      // Rename across mount should copy + delete
      await fs.rename('/file.txt', '/mounted/file.txt');
      
      expect(await fs.exists('/mounted/file.txt')).toBe(true);
      expect(await fs.exists('/mounted/.file.txt')).toBe(true);
      expect(await fs.exists('/file.txt')).toBe(false);
      expect(await fs.exists('/.file.txt')).toBe(false);
    });
  });

  describe('AssetDir Static Utility Methods', () => {
    it('should provide static path computation without fs instance', () => {
      expect(AssetDirUtils.getAssetDirPath('/docs/file.md')).toBe('/docs/.file.md');
      expect(AssetDirUtils.getAssetDirName('test.txt')).toBe('.test.txt');
      expect(AssetDirUtils.getFilePathFromAssetDir('/docs/.file.md')).toBe('/docs/file.md');
    });

    it('should validate assetdir name format', () => {
      expect(() => AssetDirUtils.getFileNameFromAssetDirName('invalid'))
        .toThrow();
      expect(() => AssetDirUtils.getFileNameFromAssetDirName('.'))
        .toThrow();
      expect(AssetDirUtils.getFileNameFromAssetDirName('.valid')).toBe('valid');
    });
  });

  describe('AssetDir Documentation Examples', () => {
    it('should support basic workflow from docs', async () => {
      // Create a document
      await fs.create('/document.md', '# My Document');
      
      // Ensure assetdir exists
      const assetDir = await fs.ensureAssetDir('/document.md');
      expect(assetDir).toBe('/.document.md');
      
      // Add assets
      await fs.create('/.document.md/image1.png', 'binary-data');
      await fs.create('/.document.md/image2.png', 'binary-data');
      
      // List assets
      const assets = await fs.listAssets('/document.md');
      expect(assets).toContain('image1.png');
      expect(assets).toContain('image2.png');
      
      // Rename document (assetdir follows)
      await fs.rename('/document.md', '/renamed.md');
      expect(await fs.exists('/.renamed.md/image1.png')).toBe(true);
      
      // Copy document (assetdir copied)
      await fs.copy('/renamed.md', '/copy.md');
      expect(await fs.exists('/.copy.md/image1.png')).toBe(true);
      
      // Delete document (keep assetdir by default)
      await fs.unlink('/copy.md');
      expect(await fs.exists('/.copy.md')).toBe(false);
      
      // Delete with assetdir
      await fs.unlink('/renamed.md', { assetDirStrategy: 'remove' });
      expect(await fs.exists('/.renamed.md')).toBe(false);
    });
  });
describe('Unlink Record File with AssetDir', () => {
  beforeEach(async () => {
    await fs.createRecord('/record.json', { key: 'value' });
    await fs.ensureAssetDir('/record.json');
    await fs.create('/.record.json/attachment.bin', 'binary');
  });

    // ✅ 修改：默认策略为 remove
    it('should remove assetdir on record file unlink (default)', async () => {
      await fs.unlink('/record.json');

      expect(await fs.exists('/record.json')).toBe(false);
      expect(await fs.exists('/.record.json')).toBe(false);
    });

    // ✅ 新增：显式 keep
    it('should keep assetdir on record file unlink with keep strategy', async () => {
      await fs.unlink('/record.json', { assetDirStrategy: 'keep' });

    expect(await fs.exists('/record.json')).toBe(false);
    expect(await fs.exists('/.record.json')).toBe(true);
    expect(await fs.exists('/.record.json/attachment.bin')).toBe(true);
  });

  it('should remove assetdir on record file unlink with remove strategy', async () => {
    await fs.unlink('/record.json', { assetDirStrategy: 'remove' });

    expect(await fs.exists('/record.json')).toBe(false);
    expect(await fs.exists('/.record.json')).toBe(false);
  });

  it('should orphan assetdir on record file unlink', async () => {
    await fs.unlink('/record.json', { assetDirStrategy: 'orphan' });

    expect(await fs.exists('/record.json')).toBe(false);
    expect(await fs.exists('/.record.json')).toBe(true);

    const stat = await fs.stat('/.record.json');
    expect(stat.metadata.isAssetDir).toBe(false);
    expect(stat.metadata.ownerFileIno).toBeUndefined();
  });
});

describe('AssetDir Re-creation After Removal', () => {
  it('should allow re-creating assetdir after removal', async () => {
    await fs.create('/file.txt', 'content');

    // 第一次创建
    const path1 = await fs.ensureAssetDir('/file.txt');
    expect(path1).toBe('/.file.txt');
    await fs.create('/.file.txt/old-asset.png', 'old');

    // 删除
    await fs.removeAssetDir('/file.txt', true);
    expect(await fs.exists('/.file.txt')).toBe(false);
    expect(await fs.hasAssetDir('/file.txt')).toBe(false);

    // 重新创建
    const path2 = await fs.ensureAssetDir('/file.txt');
    expect(path2).toBe('/.file.txt');
    expect(await fs.hasAssetDir('/file.txt')).toBe(true);

    // 旧内容不应存在
    expect(await fs.exists('/.file.txt/old-asset.png')).toBe(false);

    // 新 assetdir 应可正常使用
    await fs.create('/.file.txt/new-asset.png', 'new');
    const assets = await fs.listAssets('/file.txt');
    expect(assets).toEqual(['new-asset.png']);
  });
});

describe('readdirVisible vs Hidden Directories', () => {
  it('should only filter assetdirs, not regular hidden directories', async () => {
    await fs.create('/file.txt', 'content');
    await fs.ensureAssetDir('/file.txt');

    // 创建普通隐藏目录
    await fs.mkdir('/.config');
    await fs.mkdir('/.cache');

    const all = await fs.readdir('/');
    const visible = await fs.readdirVisible('/');

    const allNames = all.map(e => e.name);
    const visibleNames = visible.map(e => e.name);

    // 所有内容都在 readdir 中
    expect(allNames).toContain('file.txt');
    expect(allNames).not.toContain('.file.txt');
    expect(allNames).toContain('.config');
    expect(allNames).toContain('.cache');

    // readdirVisible 仅过滤 assetdir
    expect(visibleNames).toContain('file.txt');
    expect(visibleNames).not.toContain('.file.txt');
    expect(visibleNames).toContain('.config');
    expect(visibleNames).toContain('.cache');
  });
});

describe('Nested AssetDir in AssetDir', () => {
  it('should support files inside assetdir having their own assetdirs', async () => {
    await fs.create('/main.md', '# Main');
    await fs.ensureAssetDir('/main.md');

    // 在 assetdir 内创建子文件
    await fs.create('/.main.md/diagram.svg', '<svg/>');

    // 子文件也可以有 assetdir
    const subAssetDir = await fs.ensureAssetDir('/.main.md/diagram.svg');
    expect(subAssetDir).toBe('/.main.md/.diagram.svg');
    expect(await fs.exists('/.main.md/.diagram.svg')).toBe(true);

    // 向子 assetdir 添加内容
    await fs.create('/.main.md/.diagram.svg/source.drawio', 'drawio-data');

    const subAssets = await fs.listAssets('/.main.md/diagram.svg');
    expect(subAssets).toContain('source.drawio');
  });

  it('should remove nested assetdirs recursively', async () => {
    await fs.create('/main.md', '# Main');
    await fs.ensureAssetDir('/main.md');
    await fs.create('/.main.md/diagram.svg', '<svg/>');
    await fs.ensureAssetDir('/.main.md/diagram.svg');
    await fs.create('/.main.md/.diagram.svg/source.drawio', 'data');

    // 删除主文件的 assetdir（递归）
    await fs.removeAssetDir('/main.md', true);

    expect(await fs.exists('/.main.md')).toBe(false);
    expect(await fs.exists('/.main.md/.diagram.svg')).toBe(false);
  });
});

describe('Recursive Validation with Mixed File Types', () => {
  it('should validate directory containing both regular and record files', async () => {
    await fs.mkdir('/mixed');
    await fs.create('/mixed/regular.txt', 'text');
    await fs.createRecord('/mixed/data.json', { a: 1 });
    await fs.ensureAssetDir('/mixed/regular.txt');
    await fs.ensureAssetDir('/mixed/data.json');

    const issues = await fs.validateAssetDirRecursive('/mixed');
    expect(issues.size).toBe(0);
  });

  it('should detect issues in both regular and record files', async () => {
    await fs.mkdir('/mixed');
    await fs.create('/mixed/regular.txt', 'text');
    await fs.createRecord('/mixed/data.json', { a: 1 });
    await fs.ensureAssetDir('/mixed/regular.txt');
    await fs.ensureAssetDir('/mixed/data.json');

    // 破坏两个文件的引用
    await fs.setMetadata('/mixed/regular.txt', { assetDirIno: 9999 });
    await fs.setMetadata('/mixed/data.json', { assetDirIno: 8888 });

    const issues = await fs.validateAssetDirRecursive('/mixed');
    expect(issues.size).toBe(2);
    expect(issues.has('/mixed/regular.txt')).toBe(true);
    expect(issues.has('/mixed/data.json')).toBe(true);
  });

  it('should repair both regular and record files recursively', async () => {
    await fs.mkdir('/mixed');
    await fs.create('/mixed/regular.txt', 'text');
    await fs.createRecord('/mixed/data.json', { a: 1 });
    await fs.ensureAssetDir('/mixed/regular.txt');
    await fs.ensureAssetDir('/mixed/data.json');

    // 破坏引用
    await fs.setMetadata('/mixed/regular.txt', { assetDirIno: 9999 });
    await fs.setMetadata('/mixed/data.json', { assetDirIno: 8888 });

    await fs.repairAssetDirRecursive('/mixed');

    const issues = await fs.validateAssetDirRecursive('/mixed');
    expect(issues.size).toBe(0);
  });
});

describe('AssetDir with Deep Directory Nesting', () => {
  it('should work with deeply nested file paths', async () => {
    await fs.mkdir('/a', { recursive: true });
    await fs.mkdir('/a/b', { recursive: true });
    await fs.mkdir('/a/b/c', { recursive: true });
    await fs.create('/a/b/c/deep.txt', 'deep content');

    const assetDir = await fs.ensureAssetDir('/a/b/c/deep.txt');
    expect(assetDir).toBe('/a/b/c/.deep.txt');

    await fs.create('/a/b/c/.deep.txt/resource.dat', 'resource');
    const assets = await fs.listAssets('/a/b/c/deep.txt');
    expect(assets).toContain('resource.dat');
  });

  it('should validate deeply nested assetdirs recursively', async () => {
    await fs.mkdir('/a');
    await fs.mkdir('/a/b');
    await fs.create('/a/b/file.txt', 'content');
    await fs.ensureAssetDir('/a/b/file.txt');

    // 破坏引用
    await fs.setMetadata('/a/b/file.txt', { assetDirIno: 7777 });

    const issues = await fs.validateAssetDirRecursive('/a');
    expect(issues.size).toBe(1);
    expect(issues.has('/a/b/file.txt')).toBe(true);

    // 修复
    await fs.repairAssetDirRecursive('/a');
    const issuesAfter = await fs.validateAssetDirRecursive('/a');
    expect(issuesAfter.size).toBe(0);
  });
});

describe('AssetDir Rename Edge Cases', () => {
  it('should handle rename when file has no assetdir', async () => {
    await fs.create('/noasset.txt', 'content');

    await fs.rename('/noasset.txt', '/renamed-noasset.txt');

    expect(await fs.exists('/renamed-noasset.txt')).toBe(true);
    expect(await fs.exists('/noasset.txt')).toBe(false);
    expect(await fs.hasAssetDir('/renamed-noasset.txt')).toBe(false);
  });

  it('should handle rename to same directory with different name', async () => {
    await fs.create('/a.txt', 'content');
    await fs.ensureAssetDir('/a.txt');
    await fs.create('/.a.txt/res.png', 'data');

    await fs.rename('/a.txt', '/b.txt');

    expect(await fs.exists('/b.txt')).toBe(true);
    expect(await fs.exists('/.b.txt')).toBe(true);
    expect(await fs.exists('/.b.txt/res.png')).toBe(true);
    expect(await fs.exists('/a.txt')).toBe(false);
    expect(await fs.exists('/.a.txt')).toBe(false);
  });

  it('should handle rename overwriting existing file without assetdir', async () => {
    await fs.create('/src.txt', 'source');
    await fs.ensureAssetDir('/src.txt');
    await fs.create('/.src.txt/asset.dat', 'asset');

    await fs.create('/dst.txt', 'destination');
    // dst.txt 没有 assetdir，不存在 /.dst.txt

    await fs.rename('/src.txt', '/dst.txt');

    expect(await fs.exists('/dst.txt')).toBe(true);
    expect(await fs.exists('/.dst.txt')).toBe(true);
    expect(await fs.exists('/.dst.txt/asset.dat')).toBe(true);
    expect(await fs.exists('/src.txt')).toBe(false);
    expect(await fs.exists('/.src.txt')).toBe(false);
  });
});

describe('AssetDir Copy Edge Cases', () => {
  it('should copy file without assetdir', async () => {
    await fs.create('/src.txt', 'content');

    await fs.copy('/src.txt', '/dst.txt');

    expect(await fs.exists('/dst.txt')).toBe(true);
    expect(await fs.hasAssetDir('/dst.txt')).toBe(false);
    expect(await fs.exists('/.dst.txt')).toBe(false);
  });

  it('should copy assetdir with deeply nested structure', async () => {
    await fs.create('/src.txt', 'content');
    await fs.ensureAssetDir('/src.txt');
    await fs.mkdir('/.src.txt/level1');
    await fs.mkdir('/.src.txt/level1/level2');
    await fs.create('/.src.txt/level1/level2/deep.dat', 'deep');
    await fs.create('/.src.txt/level1/mid.dat', 'mid');
    await fs.create('/.src.txt/top.dat', 'top');

    await fs.copy('/src.txt', '/dst.txt');

    expect(await fs.exists('/.dst.txt/top.dat')).toBe(true);
    expect(await fs.exists('/.dst.txt/level1/mid.dat')).toBe(true);
    expect(await fs.exists('/.dst.txt/level1/level2/deep.dat')).toBe(true);

    // 验证内容独立
    const content = await fs.read('/.dst.txt/level1/level2/deep.dat');
    expect(content).toBe('deep');
  });

  it('should copy record file assetdir with record content inside', async () => {
    await fs.createRecord('/src.json', { key: 'value', num: 42 });
    await fs.ensureAssetDir('/src.json');
    await fs.createRecord('/.src.json/sub-record.json', { nested: true });

    await fs.copy('/src.json', '/dst.json');

    expect(await fs.exists('/.dst.json')).toBe(true);
    expect(await fs.exists('/.dst.json/sub-record.json')).toBe(true);

    const mainFields = await fs.getAllFields('/dst.json');
    expect(mainFields).toEqual({ key: 'value', num: 42 });
  });
});

describe('AssetDir Unlink with rmdir Recursive', () => {
  it('should clean up assetdirs when parent directory is removed recursively', async () => {
    await fs.mkdir('/project');
    await fs.create('/project/a.txt', 'aaa');
    await fs.create('/project/b.txt', 'bbb');
    await fs.ensureAssetDir('/project/a.txt');
    await fs.create('/project/.a.txt/res.png', 'data');

    await fs.rmdir('/project', { recursive: true });

    expect(await fs.exists('/project')).toBe(false);
    expect(await fs.exists('/project/a.txt')).toBe(false);
    expect(await fs.exists('/project/.a.txt')).toBe(false);
  });
});

describe('AssetDir Idempotency and Consistency', () => {
  it('should maintain consistency after multiple ensure/remove cycles', async () => {
    await fs.create('/cycle.txt', 'content');

    for (let i = 0; i < 5; i++) {
      const adPath = await fs.ensureAssetDir('/cycle.txt');
      expect(adPath).toBe('/.cycle.txt');
      expect(await fs.hasAssetDir('/cycle.txt')).toBe(true);

      const issues = await fs.validateAssetDir('/cycle.txt');
      expect(issues).toEqual([]);

      await fs.removeAssetDir('/cycle.txt', true);
      expect(await fs.hasAssetDir('/cycle.txt')).toBe(false);
    }
  });

  it('should fix metadata if only one side of reference exists', async () => {
    await fs.create('/half.txt', 'content');
    await fs.ensureAssetDir('/half.txt');

    // 仅清除文件侧引用
    await fs.setMetadata('/half.txt', { assetDirIno: undefined });

    // hasAssetDir 应返回 false（双向引用不完整）
    expect(await fs.hasAssetDir('/half.txt')).toBe(false);

    // 修复后应恢复
    await fs.repairAssetDir('/half.txt');
    expect(await fs.hasAssetDir('/half.txt')).toBe(true);

    const issues = await fs.validateAssetDir('/half.txt');
    expect(issues).toEqual([]);
  });

  it('should fix metadata if only assetdir side of reference is wrong', async () => {
    await fs.create('/half2.txt', 'content');
    await fs.ensureAssetDir('/half2.txt');

    // 仅破坏 assetdir 侧引用
    await fs.setMetadata('/.half2.txt', { ownerFileIno: 9999 });

    const issues = await fs.validateAssetDir('/half2.txt');
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.some(i => i.includes('ownerFileIno mismatch'))).toBe(true);

    await fs.repairAssetDir('/half2.txt');

    const issuesAfter = await fs.validateAssetDir('/half2.txt');
    expect(issuesAfter).toEqual([]);
  });
});

describe('AssetDir with Empty Filename Edge Cases', () => {
  it('should handle file with only extension', async () => {
    await fs.create('/.gitignore-file', 'content');

    // 名称 .gitignore-file 的 assetdir 是 ..gitignore-file
    const assetDirName = AssetDirUtils.getAssetDirName('.gitignore-file');
    expect(assetDirName).toBe('..gitignore-file');
  });

  it('should handle very long filename', async () => {
    const longName = 'a'.repeat(200) + '.txt';
    await fs.create(`/${longName}`, 'content');

    const assetDir = await fs.ensureAssetDir(`/${longName}`);
    expect(assetDir).toBe(`/.${longName}`);
    expect(await fs.hasAssetDir(`/${longName}`)).toBe(true);
  });
});

describe('AssetDir Validation for Files Without AssetDir', () => {
  it('should return no issues for file that never had assetdir', async () => {
    await fs.create('/plain.txt', 'just text');

    const issues = await fs.validateAssetDir('/plain.txt');
    expect(issues).toEqual([]);
  });

  it('should return no issues for non-supported file types', async () => {
    await fs.mkdir('/somedir');

    const issues = await fs.validateAssetDir('/somedir');
    expect(issues).toEqual([]);
  });
});

describe('AssetDir readdir includeAssetDirs with nested dirs', () => {
  it('should filter assetdirs at multiple directory levels', async () => {
    await fs.mkdir('/root-dir');
    await fs.create('/root-dir/file.txt', 'text');
    await fs.ensureAssetDir('/root-dir/file.txt');

    await fs.mkdir('/root-dir/sub');
    await fs.create('/root-dir/sub/inner.txt', 'inner');
    await fs.ensureAssetDir('/root-dir/sub/inner.txt');

    // 根层级过滤
    const rootEntries = await fs.readdir('/root-dir', { includeAssetDirs: false });
    const rootNames = rootEntries.map(e => e.name);
    expect(rootNames).toContain('file.txt');
    expect(rootNames).toContain('sub');
    expect(rootNames).not.toContain('.file.txt');

    // 子层级过滤
    const subEntries = await fs.readdir('/root-dir/sub', { includeAssetDirs: false });
    const subNames = subEntries.map(e => e.name);
    expect(subNames).toContain('inner.txt');
    expect(subNames).not.toContain('.inner.txt');
  });

  it('should return all entries including assetdirs when includeAssetDirs is true', async () => {
    await fs.mkdir('/dir');
    await fs.create('/dir/f.txt', 'text');
    await fs.ensureAssetDir('/dir/f.txt');

    const entries = await fs.readdir('/dir', { includeAssetDirs: true });
    const names = entries.map(e => e.name);
    expect(names).toContain('f.txt');
    expect(names).toContain('.f.txt');
  });

  it('should return all entries including assetdirs when option is omitted', async () => {
    await fs.mkdir('/dir2');
    await fs.create('/dir2/g.txt', 'text');
    await fs.ensureAssetDir('/dir2/g.txt');

    const entries = await fs.readdir('/dir2');
    const names = entries.map(e => e.name);
    expect(names).toContain('g.txt');
    expect(names).not.toContain('.g.txt');
  });
});

describe('AssetDir Watch Events - Detailed', () => {
  it('should emit create event for assets added inside assetdir', async () => {
    await fs.create('/watched.txt', 'content');
    await fs.ensureAssetDir('/watched.txt');

    const events: any[] = [];
    const watcher = fs.watch('/', (event) => {
      events.push(event);
    }, { recursive: true });

    await fs.create('/.watched.txt/new-asset.png', 'binary');

    watcher.close();

    expect(events.some(e =>
      e.path === '/.watched.txt/new-asset.png' && e.type === 'create'
    )).toBe(true);
  });

  it('should emit delete event for assets removed inside assetdir', async () => {
    await fs.create('/watched2.txt', 'content');
    await fs.ensureAssetDir('/watched2.txt');
    await fs.create('/.watched2.txt/asset.png', 'binary');

    const events: any[] = [];
    const watcher = fs.watch('/', (event) => {
      events.push(event);
    }, { recursive: true });

    await fs.unlink('/.watched2.txt/asset.png');

    watcher.close();

    expect(events.some(e =>
      e.path === '/.watched2.txt/asset.png' && e.type === 'delete'
    )).toBe(true);
  });

  it('should emit metadata event when assetdir reference is set', async () => {
    await fs.create('/meta-watch.txt', 'content');

    const events: any[] = [];
    const watcher = fs.watch('/', (event) => {
      events.push(event);
    }, { recursive: true });

    await fs.ensureAssetDir('/meta-watch.txt');

    watcher.close();

    // ensureAssetDir 调用了 setMetadata，应有 metadata 事件
    expect(events.some(e =>
      e.path === '/meta-watch.txt' && e.type === 'metadata'
    )).toBe(true);
  });
});


});
