// tests/record.test.ts

import { describe, it, expect, beforeEach } from 'vitest';
import { FileSystem } from '../src/core/filesystem.js';
import { MemoryBackend } from '../src/backend/memory.js';
import { FileSystemError } from '../src/core/errors.js';
import { FileType } from '../src/interface';
import type { RecordValue, FileChangeEvent } from '../src/interface';

describe('Record Files', () => {
  let fs: FileSystem;

  beforeEach(async () => {
    const backend = new MemoryBackend();
    fs = new FileSystem(backend);
    await fs.init();
  });

  // ============================================================
  // 创建
  // ============================================================

  describe('createRecord', () => {
    it('should create an empty record file', async () => {
      const stat = await fs.createRecord('/config.rec');
      expect(stat.type).toBe(FileType.RECORD);
      expect(stat.isRecord()).toBe(true);
      expect(stat.isFile()).toBe(false);
      expect(stat.isDirectory()).toBe(false);
      expect(stat.size).toBe(0);
    });

    it('should create with initial fields', async () => {
      const stat = await fs.createRecord('/settings.rec', {
        theme: 'dark',
        fontSize: 14,
        autoSave: true,
      });
      expect(stat.size).toBe(3);
    });

    it('should create with indexes', async () => {
      const stat = await fs.createRecord(
        '/users.rec',
        { user1: { name: 'Alice', age: 30 } },
        { indexes: ['name', 'age'] },
      );
      expect(stat.recordIndexes).toEqual(['name', 'age']);
    });

    it('should create with metadata', async () => {
      await fs.createRecord('/meta.rec', {}, {
        metadata: { mimeType: 'application/x-record' },
      });
      const meta = await fs.getMetadata('/meta.rec');
      expect(meta.mimeType).toBe('application/x-record');
    });

    it('should throw EEXIST when already exists', async () => {
      await fs.createRecord('/dup.rec');
      await expect(fs.createRecord('/dup.rec')).rejects.toThrow(FileSystemError);
    });

    it('should throw ENOENT when parent missing', async () => {
      await expect(fs.createRecord('/no/parent/file.rec')).rejects.toThrow(FileSystemError);
    });

    it('should appear in readdir', async () => {
      await fs.createRecord('/listed.rec');
      const entries = await fs.readdir('/');
      expect(entries.some((e) => e.name === 'listed.rec')).toBe(true);
    });

    it('should create in subdirectory', async () => {
      await fs.mkdir('/data');
      await fs.createRecord('/data/records.rec', { key1: 'value1' });
      const fields = await fs.getAllFields('/data/records.rec');
      expect(fields.key1).toBe('value1');
    });
  });

  // ============================================================
  // 单字段操作
  // ============================================================

  describe('getField / setField', () => {
    it('should set and get a string field', async () => {
      await fs.createRecord('/kv.rec');
      await fs.setField('/kv.rec', 'name', 'Alice');
      const val = await fs.getField('/kv.rec', 'name');
      expect(val).toBe('Alice');
    });

    it('should set and get a number field', async () => {
      await fs.createRecord('/kv.rec');
      await fs.setField('/kv.rec', 'count', 42);
      expect(await fs.getField('/kv.rec', 'count')).toBe(42);
    });

    it('should set and get a boolean field', async () => {
      await fs.createRecord('/kv.rec');
      await fs.setField('/kv.rec', 'active', true);
      expect(await fs.getField('/kv.rec', 'active')).toBe(true);
    });

    it('should set and get null field', async () => {
      await fs.createRecord('/kv.rec');
      await fs.setField('/kv.rec', 'empty', null);
      expect(await fs.getField('/kv.rec', 'empty')).toBeNull();
    });

    it('should set and get object field', async () => {
      await fs.createRecord('/kv.rec');
      const obj = { host: 'localhost', port: 3000, ssl: false };
      await fs.setField('/kv.rec', 'server', obj);
      expect(await fs.getField('/kv.rec', 'server')).toEqual(obj);
    });

    it('should set and get array field', async () => {
      await fs.createRecord('/kv.rec');
      await fs.setField('/kv.rec', 'tags', ['a', 'b', 'c']);
      expect(await fs.getField('/kv.rec', 'tags')).toEqual(['a', 'b', 'c']);
    });

    it('should set and get deeply nested object', async () => {
      await fs.createRecord('/kv.rec');
      const deep = {
        level1: { level2: { level3: { value: 'deep' } } },
      };
      await fs.setField('/kv.rec', 'nested', deep);
      expect(await fs.getField('/kv.rec', 'nested')).toEqual(deep);
    });

    it('should overwrite existing field', async () => {
      await fs.createRecord('/kv.rec', { key: 'old' });
      await fs.setField('/kv.rec', 'key', 'new');
      expect(await fs.getField('/kv.rec', 'key')).toBe('new');
    });

    it('should return undefined for nonexistent field', async () => {
      await fs.createRecord('/kv.rec');
      expect(await fs.getField('/kv.rec', 'nope')).toBeUndefined();
    });

    it('should throw ENOTRECORD on regular file', async () => {
      await fs.create('/regular.txt', 'data');
      await expect(fs.getField('/regular.txt', 'key')).rejects.toThrow(FileSystemError);
      await expect(fs.setField('/regular.txt', 'key', 'val')).rejects.toThrow(FileSystemError);
    });

    it('should throw ENOTRECORD on directory', async () => {
      await fs.mkdir('/dir');
      await expect(fs.getField('/dir', 'key')).rejects.toThrow(FileSystemError);
    });

    it('should throw ENOENT on nonexistent path', async () => {
      await expect(fs.getField('/nope.rec', 'key')).rejects.toThrow(FileSystemError);
    });

    it('should update inode size when setting fields', async () => {
      await fs.createRecord('/sized.rec');
      await fs.setField('/sized.rec', 'a', 1);
      await fs.setField('/sized.rec', 'b', 2);
      const stat = await fs.stat('/sized.rec');
      expect(stat.size).toBe(2);
    });

    it('should update modifiedAt on setField', async () => {
      await fs.createRecord('/ts.rec');
      const stat1 = await fs.stat('/ts.rec');

      await new Promise((r) => setTimeout(r, 10));
      await fs.setField('/ts.rec', 'key', 'value');

      const stat2 = await fs.stat('/ts.rec');
      expect(stat2.modifiedAt).toBeGreaterThanOrEqual(stat1.modifiedAt);
    });

    it('should not mutate stored value via external reference', async () => {
      await fs.createRecord('/immutable.rec');
      const obj = { count: 1 };
      await fs.setField('/immutable.rec', 'data', obj);

      obj.count = 999;
      const retrieved = await fs.getField('/immutable.rec', 'data');
      expect((retrieved as any).count).toBe(1);
    });
  });

  // ============================================================
  // 删除字段
  // ============================================================

  describe('deleteField', () => {
    it('should delete a field', async () => {
      await fs.createRecord('/del.rec', { a: 1, b: 2, c: 3 });
      await fs.deleteField('/del.rec', 'b');
      expect(await fs.getField('/del.rec', 'b')).toBeUndefined();
      expect(await fs.getField('/del.rec', 'a')).toBe(1);
      expect(await fs.getField('/del.rec', 'c')).toBe(3);
    });

    it('should update size after delete', async () => {
      await fs.createRecord('/del-size.rec', { a: 1, b: 2 });
      await fs.deleteField('/del-size.rec', 'a');
      const stat = await fs.stat('/del-size.rec');
      expect(stat.size).toBe(1);
    });

    it('should be safe to delete nonexistent field', async () => {
      await fs.createRecord('/del-safe.rec');
      await expect(fs.deleteField('/del-safe.rec', 'nope')).resolves.toBeUndefined();
    });

    it('should throw ENOTRECORD on regular file', async () => {
      await fs.create('/file.txt', 'data');
      await expect(fs.deleteField('/file.txt', 'key')).rejects.toThrow(FileSystemError);
    });
  });

  // ============================================================
  // 批量操作
  // ============================================================

  describe('getAllFields / setAllFields', () => {
    it('should get all fields', async () => {
      await fs.createRecord('/all.rec', {
        name: 'Alice',
        age: 30,
        active: true,
      });
      const fields = await fs.getAllFields('/all.rec');
      expect(fields).toEqual({
        name: 'Alice',
        age: 30,
        active: true,
      });
    });

    it('should return empty object for empty record', async () => {
      await fs.createRecord('/empty.rec');
      const fields = await fs.getAllFields('/empty.rec');
      expect(fields).toEqual({});
    });

    it('should set all fields (overwrite)', async () => {
      await fs.createRecord('/overwrite.rec', { old: 'data' });
      await fs.setAllFields('/overwrite.rec', { new1: 'a', new2: 'b' });

      const fields = await fs.getAllFields('/overwrite.rec');
      expect(fields).toEqual({ new1: 'a', new2: 'b' });
      expect(fields['old']).toBeUndefined();
    });

    it('should update size on setAllFields', async () => {
      await fs.createRecord('/size-all.rec');
      await fs.setAllFields('/size-all.rec', { a: 1, b: 2, c: 3, d: 4 });
      const stat = await fs.stat('/size-all.rec');
      expect(stat.size).toBe(4);
    });
  });

  // ============================================================
  // 列出字段
  // ============================================================

  describe('listFields', () => {
    it('should list field names', async () => {
      await fs.createRecord('/list.rec', { x: 1, y: 2, z: 3 });
      const fields = await fs.listFields('/list.rec');
      expect(fields.sort()).toEqual(['x', 'y', 'z']);
    });

    it('should return empty array for empty record', async () => {
      await fs.createRecord('/empty-list.rec');
      expect(await fs.listFields('/empty-list.rec')).toEqual([]);
    });

    it('should reflect additions and deletions', async () => {
      await fs.createRecord('/dynamic.rec');
      await fs.setField('/dynamic.rec', 'a', 1);
      await fs.setField('/dynamic.rec', 'b', 2);
      expect((await fs.listFields('/dynamic.rec')).sort()).toEqual(['a', 'b']);

      await fs.deleteField('/dynamic.rec', 'a');
      expect(await fs.listFields('/dynamic.rec')).toEqual(['b']);
    });
  });

  // ============================================================
  // 查询
  // ============================================================

  describe('queryFields', () => {
    beforeEach(async () => {
      await fs.createRecord('/users.rec', {
        user1: { name: 'Alice', age: 30, role: 'admin' },
        user2: { name: 'Bob', age: 25, role: 'user' },
        user3: { name: 'Charlie', age: 35, role: 'user' },
        user4: { name: 'Diana', age: 28, role: 'admin' },
        user5: { name: 'Eve', age: 30, role: 'user' },
      });
    });

    describe('operator: =', () => {
      it('should find exact match on nested field', async () => {
        const results = await fs.queryFields('/users.rec', {
          field: 'role',
          operator: '=',
          value: 'admin',
        });
        const names = results.map((r) => (r.value as any).name).sort();
        expect(names).toEqual(['Alice', 'Diana']);
      });

      it('should find exact match on number', async () => {
        const results = await fs.queryFields('/users.rec', {
          field: 'age',
          operator: '=',
          value: 30,
        });
        const names = results.map((r) => (r.value as any).name).sort();
        expect(names).toEqual(['Alice', 'Eve']);
      });

      it('should return empty for no match', async () => {
        const results = await fs.queryFields('/users.rec', {
          field: 'role',
          operator: '=',
          value: 'superadmin',
        });
        expect(results).toEqual([]);
      });
    });

    describe('operator: !=', () => {
      it('should exclude matching records', async () => {
        const results = await fs.queryFields('/users.rec', {
          field: 'role',
          operator: '!=',
          value: 'admin',
        });
        const names = results.map((r) => (r.value as any).name).sort();
        expect(names).toEqual(['Bob', 'Charlie', 'Eve']);
      });
    });

    describe('operator: <', () => {
      it('should find records less than value', async () => {
        const results = await fs.queryFields('/users.rec', {
          field: 'age',
          operator: '<',
          value: 29,
        });
        const names = results.map((r) => (r.value as any).name).sort();
        expect(names).toEqual(['Bob', 'Diana']);
      });
    });

    describe('operator: <=', () => {
      it('should find records less than or equal', async () => {
        const results = await fs.queryFields('/users.rec', {
          field: 'age',
          operator: '<=',
          value: 28,
        });
        const names = results.map((r) => (r.value as any).name).sort();
        expect(names).toEqual(['Bob', 'Diana']);
      });
    });

    describe('operator: >', () => {
      it('should find records greater than value', async () => {
        const results = await fs.queryFields('/users.rec', {
          field: 'age',
          operator: '>',
          value: 30,
        });
        expect(results).toHaveLength(1);
        expect((results[0].value as any).name).toBe('Charlie');
      });
    });

    describe('operator: >=', () => {
      it('should find records greater than or equal', async () => {
        const results = await fs.queryFields('/users.rec', {
          field: 'age',
          operator: '>=',
          value: 30,
        });
        const names = results.map((r) => (r.value as any).name).sort();
        expect(names).toEqual(['Alice', 'Charlie', 'Eve']);
      });
    });

    describe('operator: in', () => {
      it('should find records matching any value in array', async () => {
        const results = await fs.queryFields('/users.rec', {
          field: 'name',
          operator: 'in',
          value: ['Alice', 'Charlie', 'Zara'],
        });
        const names = results.map((r) => (r.value as any).name).sort();
        expect(names).toEqual(['Alice', 'Charlie']);
      });

      it('should return empty for empty in-array', async () => {
        const results = await fs.queryFields('/users.rec', {
          field: 'name',
          operator: 'in',
          value: [],
        });
        expect(results).toEqual([]);
      });
    });

    describe('operator: contains', () => {
      it('should find records where array contains value', async () => {
        await fs.createRecord('/tags.rec', {
          post1: { title: 'Hello', tags: ['js', 'ts'] },
          post2: { title: 'World', tags: ['rust', 'go'] },
          post3: { title: 'Foo', tags: ['ts', 'go'] },
        });
        const results = await fs.queryFields('/tags.rec', {
          field: 'tags',
          operator: 'contains',
          value: 'ts',
        });
        const titles = results.map((r) => (r.value as any).title).sort();
        expect(titles).toEqual(['Foo', 'Hello']);
      });
    });

    describe('pagination', () => {
      it('should respect limit', async () => {
        const results = await fs.queryFields(
          '/users.rec',
          { field: 'role', operator: '=', value: 'user' },
          { limit: 2 },
        );
        expect(results).toHaveLength(2);
      });

      it('should respect offset', async () => {
        const all = await fs.queryFields(
          '/users.rec',
          { field: 'role', operator: '=', value: 'user' },
        );
        const paged = await fs.queryFields(
          '/users.rec',
          { field: 'role', operator: '=', value: 'user' },
          { offset: 1, limit: 1 },
        );
        expect(paged).toHaveLength(1);
        expect(paged[0].field).toBe(all[1].field);
      });

      it('should return empty when offset exceeds results', async () => {
        const results = await fs.queryFields(
          '/users.rec',
          { field: 'role', operator: '=', value: 'admin' },
          { offset: 100 },
        );
        expect(results).toEqual([]);
      });
    });

    describe('dot-notation nested field access', () => {
      it('should query nested fields with dot notation', async () => {
        await fs.createRecord('/nested.rec', {
          item1: { meta: { priority: 1, status: 'open' } },
          item2: { meta: { priority: 3, status: 'closed' } },
          item3: { meta: { priority: 1, status: 'closed' } },
        });
        const results = await fs.queryFields('/nested.rec', {
          field: 'meta.priority',
          operator: '=',
          value: 1,
        });
        expect(results).toHaveLength(2);
      });

      it('should handle missing nested path gracefully', async () => {
        await fs.createRecord('/sparse.rec', {
          a: { x: { y: 1 } },
          b: { x: null },
          c: 'plain string',
        });
        const results = await fs.queryFields('/sparse.rec', {
          field: 'x.y',
          operator: '=',
          value: 1,
        });
        expect(results).toHaveLength(1);
        expect(results[0].field).toBe('a');
      });
    });

    describe('error cases', () => {
      it('should throw ENOTRECORD on regular file', async () => {
        await fs.create('/file.txt', 'data');
        await expect(
          fs.queryFields('/file.txt', { field: 'x', operator: '=', value: 1 }),
        ).rejects.toThrow(FileSystemError);
      });

      it('should throw ENOENT on missing path', async () => {
        await expect(
          fs.queryFields('/nope.rec', { field: 'x', operator: '=', value: 1 }),
        ).rejects.toThrow(FileSystemError);
      });
    });
  });

  // ============================================================
  // 索引管理
  // ============================================================

  describe('createIndex / deleteIndex', () => {
    it('should create an index and record it in inode', async () => {
      await fs.createRecord('/indexed.rec');
      await fs.createIndex('/indexed.rec', 'name');
      const stat = await fs.stat('/indexed.rec');
      expect(stat.recordIndexes).toContain('name');
    });
    it('should create an index and record it in inode', async () => {
      await fs.createRecord('/indexed.rec');
      await fs.createIndex('/indexed.rec', 'name');
      const stat = await fs.stat('/indexed.rec');
      expect(stat.recordIndexes).toContain('name');
    });

    it('should be idempotent on duplicate index creation', async () => {
      await fs.createRecord('/idx-dup.rec');
      await fs.createIndex('/idx-dup.rec', 'name');
      await fs.createIndex('/idx-dup.rec', 'name');
      const stat = await fs.stat('/idx-dup.rec');
      const nameCount = stat.recordIndexes!.filter((i) => i === 'name').length;
      expect(nameCount).toBe(1);
    });

    it('should create multiple indexes', async () => {
      await fs.createRecord('/multi-idx.rec');
      await fs.createIndex('/multi-idx.rec', 'name');
      await fs.createIndex('/multi-idx.rec', 'age');
      await fs.createIndex('/multi-idx.rec', 'role');
      const stat = await fs.stat('/multi-idx.rec');
      expect(stat.recordIndexes!.sort()).toEqual(['age', 'name', 'role']);
    });

    it('should delete an index', async () => {
      await fs.createRecord('/idx-del.rec', {}, { indexes: ['name', 'age'] });
      await fs.deleteIndex('/idx-del.rec', 'name');
      const stat = await fs.stat('/idx-del.rec');
      expect(stat.recordIndexes).toEqual(['age']);
    });

    it('should be safe to delete nonexistent index', async () => {
      await fs.createRecord('/idx-safe.rec');
      await expect(fs.deleteIndex('/idx-safe.rec', 'nope')).resolves.toBeUndefined();
    });

    it('should throw ENOTRECORD when creating index on regular file', async () => {
      await fs.create('/file.txt', 'data');
      await expect(fs.createIndex('/file.txt', 'name')).rejects.toThrow(FileSystemError);
    });

    it('should throw ENOTRECORD when deleting index on directory', async () => {
      await fs.mkdir('/dir');
      await expect(fs.deleteIndex('/dir', 'name')).rejects.toThrow(FileSystemError);
    });

    it('should build index on existing data', async () => {
      await fs.createRecord('/late-idx.rec', {
        user1: { name: 'Alice', score: 100 },
        user2: { name: 'Bob', score: 85 },
        user3: { name: 'Charlie', score: 100 },
      });

      // 后创建索引
      await fs.createIndex('/late-idx.rec', 'score');

      // 索引应该能加速查询（功能上与无索引一致）
      const results = await fs.queryFields('/late-idx.rec', {
        field: 'score',
        operator: '=',
        value: 100,
      });
      const names = results.map((r) => (r.value as any).name).sort();
      expect(names).toEqual(['Alice', 'Charlie']);
    });

    it('should update index when fields change', async () => {
      await fs.createRecord('/idx-update.rec', {
        item1: { category: 'A', value: 10 },
        item2: { category: 'B', value: 20 },
      }, { indexes: ['category'] });

      // 修改 item1 的 category
      await fs.setField('/idx-update.rec', 'item1', { category: 'B', value: 10 });

      // 查询应反映最新值
      const resultsA = await fs.queryFields('/idx-update.rec', {
        field: 'category',
        operator: '=',
        value: 'A',
      });
      expect(resultsA).toHaveLength(0);

      const resultsB = await fs.queryFields('/idx-update.rec', {
        field: 'category',
        operator: '=',
        value: 'B',
      });
      expect(resultsB).toHaveLength(2);
    });

    it('should remove index entries when field is deleted', async () => {
      await fs.createRecord('/idx-remove.rec', {
        a: { status: 'active' },
        b: { status: 'inactive' },
      }, { indexes: ['status'] });

      await fs.deleteField('/idx-remove.rec', 'a');

      const results = await fs.queryFields('/idx-remove.rec', {
        field: 'status',
        operator: '=',
        value: 'active',
      });
      expect(results).toHaveLength(0);
    });

    it('should rebuild indexes on setAllFields', async () => {
      await fs.createRecord('/idx-rebuild.rec', {
        x: { type: 'old' },
      }, { indexes: ['type'] });

      await fs.setAllFields('/idx-rebuild.rec', {
        y: { type: 'new' },
        z: { type: 'new' },
      });

      const oldResults = await fs.queryFields('/idx-rebuild.rec', {
        field: 'type',
        operator: '=',
        value: 'old',
      });
      expect(oldResults).toHaveLength(0);

      const newResults = await fs.queryFields('/idx-rebuild.rec', {
        field: 'type',
        operator: '=',
        value: 'new',
      });
      expect(newResults).toHaveLength(2);
    });
  });

  // ============================================================
  // 与常规操作的交互
  // ============================================================

  describe('interaction with regular file operations', () => {
    it('should throw ENOTRECORD when read() on record file', async () => {
      await fs.createRecord('/no-read.rec', { key: 'value' });
      await expect(fs.read('/no-read.rec')).rejects.toThrow(FileSystemError);
    });

    it('should throw ENOTRECORD when write() on record file', async () => {
      await fs.createRecord('/no-write.rec');
      await expect(fs.write('/no-write.rec', 'data', { create: false })).rejects.toThrow(FileSystemError);
    });

    it('should delete record file with unlink', async () => {
      await fs.createRecord('/unlinkable.rec', { a: 1, b: 2 });
      await fs.unlink('/unlinkable.rec');
      expect(await fs.exists('/unlinkable.rec')).toBe(false);
    });

    it('should delete record data when unlinking', async () => {
      await fs.createRecord('/clean-unlink.rec', { data: 'important' });
      const stat = await fs.stat('/clean-unlink.rec');
      const ino = stat.ino;

      await fs.unlink('/clean-unlink.rec');

      // 重新创建不应残留旧数据
      await fs.createRecord('/clean-unlink.rec');
      const fields = await fs.getAllFields('/clean-unlink.rec');
      expect(fields).toEqual({});
    });

    it('should stat record file correctly', async () => {
      await fs.createRecord('/stat-rec.rec', { a: 1, b: 2, c: 3 });
      const stat = await fs.stat('/stat-rec.rec');
      expect(stat.type).toBe(FileType.RECORD);
      expect(stat.isRecord()).toBe(true);
      expect(stat.isFile()).toBe(false);
      expect(stat.size).toBe(3);
    });

    it('should set and get metadata on record file', async () => {
      await fs.createRecord('/meta-rec.rec');
      await fs.setMetadata('/meta-rec.rec', { description: 'a record file' } as any);
      const meta = await fs.getMetadata('/meta-rec.rec');
      expect(meta['description']).toBe('a record file');
    });

    it('should rename record file', async () => {
      await fs.createRecord('/old-name.rec', { key: 'value' });
      await fs.rename('/old-name.rec', '/new-name.rec');
      expect(await fs.exists('/old-name.rec')).toBe(false);
      expect(await fs.exists('/new-name.rec')).toBe(true);
      const val = await fs.getField('/new-name.rec', 'key');
      expect(val).toBe('value');
    });

    it('should copy record file', async () => {
      await fs.createRecord('/orig.rec', { x: 1, y: 2 }, { indexes: ['x'] });
      await fs.copy('/orig.rec', '/copy.rec');

      const origFields = await fs.getAllFields('/orig.rec');
      const copyFields = await fs.getAllFields('/copy.rec');
      expect(copyFields).toEqual(origFields);

      const copyStat = await fs.stat('/copy.rec');
      expect(copyStat.type).toBe(FileType.RECORD);
      expect(copyStat.recordIndexes).toEqual(['x']);
    });

    it('should copy create independent record', async () => {
      await fs.createRecord('/src.rec', { shared: 'original' });
      await fs.copy('/src.rec', '/dst.rec');

      await fs.setField('/src.rec', 'shared', 'modified');
      expect(await fs.getField('/dst.rec', 'shared')).toBe('original');
    });

    it('should rmdir recursive with record files', async () => {
      await fs.mkdir('/records');
      await fs.createRecord('/records/a.rec', { key: 'a' });
      await fs.createRecord('/records/b.rec', { key: 'b' });
      await fs.create('/records/normal.txt', 'text');

      await fs.rmdir('/records', { recursive: true });
      expect(await fs.exists('/records')).toBe(false);
    });

    it('should exists() work with record file', async () => {
      await fs.createRecord('/exists-rec.rec');
      expect(await fs.exists('/exists-rec.rec')).toBe(true);
      await fs.unlink('/exists-rec.rec');
      expect(await fs.exists('/exists-rec.rec')).toBe(false);
    });
  });

  // ============================================================
  // Watch 集成
  // ============================================================

  describe('watch integration', () => {
    it('should emit create event for createRecord', async () => {
      const events: FileChangeEvent[] = [];
      fs.watch('/', (e) => events.push(e));

      await fs.createRecord('/watched.rec');
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('create');
      expect(events[0].path).toBe('/watched.rec');
    });

    it('should emit modify event on setField', async () => {
      await fs.createRecord('/watched.rec');

      const events: FileChangeEvent[] = [];
      fs.watch('/', (e) => events.push(e));

      await fs.setField('/watched.rec', 'key', 'value');
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('modify');
      expect(events[0].field).toBe('key');
    });

    it('should emit modify event on deleteField', async () => {
      await fs.createRecord('/watched.rec', { key: 'value' });

      const events: FileChangeEvent[] = [];
      fs.watch('/', (e) => events.push(e));

      await fs.deleteField('/watched.rec', 'key');
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('modify');
      expect(events[0].field).toBe('key');
    });

    it('should emit modify event on setAllFields', async () => {
      await fs.createRecord('/watched.rec');

      const events: FileChangeEvent[] = [];
      fs.watch('/', (e) => events.push(e));

      await fs.setAllFields('/watched.rec', { a: 1, b: 2 });
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('modify');
    });

    it('should emit delete event on unlink', async () => {
      await fs.createRecord('/watched.rec');

      const events: FileChangeEvent[] = [];
      fs.watch('/', (e) => events.push(e));

      await fs.unlink('/watched.rec');
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('delete');
    });
  });

  // ============================================================
  // 中间件集成
  // ============================================================

  describe('middleware integration', () => {
    it('should pass through middleware for record operations', async () => {
      const ops: string[] = [];

      await fs.use({
        name: 'record-spy',
        version: '1.0.0',
        type: 'middleware',
        middleware() {
          return async (ctx, next) => {
            ops.push(ctx.operation);
            await next();
          };
        },
      });

      await fs.createRecord('/mw.rec', { a: 1 });
      await fs.getField('/mw.rec', 'a');
      await fs.setField('/mw.rec', 'b', 2);
      await fs.deleteField('/mw.rec', 'a');
      await fs.getAllFields('/mw.rec');
      await fs.setAllFields('/mw.rec', { c: 3 });
      await fs.listFields('/mw.rec');
      await fs.queryFields('/mw.rec', { field: 'c', operator: '=', value: 3 });
      await fs.createIndex('/mw.rec', 'c');
      await fs.deleteIndex('/mw.rec', 'c');

      expect(ops).toContain('createRecord');
      expect(ops).toContain('getField');
      expect(ops).toContain('setField');
      expect(ops).toContain('deleteField');
      expect(ops).toContain('getAllFields');
      expect(ops).toContain('setAllFields');
      expect(ops).toContain('listFields');
      expect(ops).toContain('queryFields');
      expect(ops).toContain('createIndex');
      expect(ops).toContain('deleteIndex');
    });

    it('should allow middleware to block record writes', async () => {
      await fs.use({
        name: 'record-readonly',
        version: '1.0.0',
        type: 'middleware',
        middleware() {
          return async (ctx, next) => {
            if (ctx.operation === 'setField' && ctx.path.startsWith('/protected/')) {
              throw new FileSystemError('EACCES', ctx.path, 'Read-only record');
            }
            await next();
          };
        },
      });

      await fs.mkdir('/protected');
      await fs.createRecord('/protected/locked.rec', { key: 'value' });

      await expect(
        fs.setField('/protected/locked.rec', 'key', 'new'),
      ).rejects.toThrow(FileSystemError);

      // 读取仍然可以
      expect(await fs.getField('/protected/locked.rec', 'key')).toBe('value');
    });
  });

  // ============================================================
  // 事务集成
  // ============================================================

  describe('transaction integration', () => {
    it('should commit record operations in transaction', async () => {
      await fs.transaction(async (tx) => {
        await tx.createRecord('/tx.rec', { key: 'initial' });
        await tx.setField('/tx.rec', 'added', 'in-tx');
      });

      expect(await fs.getField('/tx.rec', 'key')).toBe('initial');
      expect(await fs.getField('/tx.rec', 'added')).toBe('in-tx');
    });

    it('should rollback record operations on failure', async () => {
      await fs.createRecord('/existing.rec', { original: 'data' });

      try {
        await fs.transaction(async (tx) => {
          await tx.setField('/existing.rec', 'original', 'modified');
          await tx.setField('/existing.rec', 'newfield', 'value');
          throw new Error('rollback');
        });
      } catch {
        // expected
      }

      expect(await fs.getField('/existing.rec', 'original')).toBe('data');
      expect(await fs.getField('/existing.rec', 'newfield')).toBeUndefined();
    });

    it('should rollback createRecord on failure', async () => {
      try {
        await fs.transaction(async (tx) => {
          await tx.createRecord('/rollback.rec', { a: 1 });
          throw new Error('fail');
        });
      } catch {
        // expected
      }

      expect(await fs.exists('/rollback.rec')).toBe(false);
    });

    it('should see own record writes within transaction', async () => {
      await fs.transaction(async (tx) => {
        await tx.createRecord('/intra.rec');
        await tx.setField('/intra.rec', 'x', 42);
        const val = await tx.getField('/intra.rec', 'x');
        expect(val).toBe(42);

        await tx.setField('/intra.rec', 'y', 99);
        const all = await tx.getAllFields('/intra.rec');
        expect(all).toEqual({ x: 42, y: 99 });
      });
    });

    it('should handle deleteField in transaction rollback', async () => {
      await fs.createRecord('/del-tx.rec', { keep: 'me', remove: 'gone' });

      try {
        await fs.transaction(async (tx) => {
          await tx.deleteField('/del-tx.rec', 'remove');
          expect(await tx.getField('/del-tx.rec', 'remove')).toBeUndefined();
          throw new Error('abort');
        });
      } catch {
        // expected
      }

      // 应恢复
      expect(await fs.getField('/del-tx.rec', 'remove')).toBe('gone');
    });
  });

  // ============================================================
  // 边界场景
  // ============================================================

  describe('edge cases', () => {
    it('should handle empty string as field name', async () => {
      await fs.createRecord('/edge.rec');
      await fs.setField('/edge.rec', '', 'empty-key');
      expect(await fs.getField('/edge.rec', '')).toBe('empty-key');
    });

    it('should handle very long field names', async () => {
      await fs.createRecord('/long.rec');
      const longKey = 'k'.repeat(1000);
      await fs.setField('/long.rec', longKey, 'value');
      expect(await fs.getField('/long.rec', longKey)).toBe('value');
    });

    it('should handle special characters in field names', async () => {
      await fs.createRecord('/special.rec');
      const specialKeys = ['key.with.dots', 'key/with/slashes', 'key with spaces', '日本語キー'];
      for (const key of specialKeys) {
        await fs.setField('/special.rec', key, `value-for-${key}`);
      }
      for (const key of specialKeys) {
        expect(await fs.getField('/special.rec', key)).toBe(`value-for-${key}`);
      }
    });

    it('should handle large number of fields', async () => {
      await fs.createRecord('/large.rec');
      const fields: Record<string, RecordValue> = {};
      for (let i = 0; i < 500; i++) {
        fields[`field-${i}`] = { index: i, data: `value-${i}` };
      }
      await fs.setAllFields('/large.rec', fields);

      const stat = await fs.stat('/large.rec');
      expect(stat.size).toBe(500);

      const retrieved = await fs.getAllFields('/large.rec');
      expect(Object.keys(retrieved)).toHaveLength(500);
      expect((retrieved['field-0'] as any).index).toBe(0);
      expect((retrieved['field-499'] as any).index).toBe(499);
    });

    it('should handle field value type changes', async () => {
      await fs.createRecord('/typechange.rec');
      await fs.setField('/typechange.rec', 'flexible', 'string');
      expect(await fs.getField('/typechange.rec', 'flexible')).toBe('string');

      await fs.setField('/typechange.rec', 'flexible', 42);
      expect(await fs.getField('/typechange.rec', 'flexible')).toBe(42);

      await fs.setField('/typechange.rec', 'flexible', { nested: true });
      expect(await fs.getField('/typechange.rec', 'flexible')).toEqual({ nested: true });

      await fs.setField('/typechange.rec', 'flexible', null);
      expect(await fs.getField('/typechange.rec', 'flexible')).toBeNull();
    });

    it('should handle concurrent field updates without corruption', async () => {
      await fs.createRecord('/concurrent.rec');

      // 并行设置多个不同字段
      await Promise.all([
        fs.setField('/concurrent.rec', 'a', 1),
        fs.setField('/concurrent.rec', 'b', 2),
        fs.setField('/concurrent.rec', 'c', 3),
        fs.setField('/concurrent.rec', 'd', 4),
        fs.setField('/concurrent.rec', 'e', 5),
      ]);

      const fields = await fs.getAllFields('/concurrent.rec');
      expect(Object.keys(fields).sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
    });

    it('should handle path normalization for record operations', async () => {
      await fs.mkdir('/norm');
      await fs.createRecord('/norm/rec.rec', { key: 'value' });
      const val = await fs.getField('/norm/../norm/./rec.rec', 'key');
      expect(val).toBe('value');
    });

    it('should handle mixed file types in same directory', async () => {
      // 需要先创建目录
      await fs.mkdir('/mix');
      await fs.create('/mix/regular.txt', 'text');
      await fs.createRecord('/mix/record.rec', { a: 1 });
      await fs.mkdir('/mix/subdir');

      const entries = await fs.readdir('/mix');
      expect(entries).toHaveLength(3);

      // 每种类型独立工作
      expect(await fs.read('/mix/regular.txt')).toBe('text');
      expect(await fs.getField('/mix/record.rec', 'a')).toBe(1);
      expect((await fs.stat('/mix/subdir')).isDirectory()).toBe(true);
    });

    it('should produce correct stat for record file with indexes', async () => {
      await fs.createRecord('/stat-full.rec', { x: 1, y: 2 }, { indexes: ['x'] });
      const stat = await fs.stat('/stat-full.rec');
      expect(stat.type).toBe(FileType.RECORD);
      expect(stat.isRecord()).toBe(true);
      expect(stat.size).toBe(2);
      expect(stat.recordIndexes).toEqual(['x']);
      expect(stat.nlink).toBe(1);
      expect(stat.ino).toBeGreaterThan(0);
    });
  });
});
    
