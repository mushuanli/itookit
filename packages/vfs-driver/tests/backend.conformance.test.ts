// tests/backend.conformance.test.ts
//
// 后端一致性测试：所有后端必须通过同一套测试
// 新增后端时只需在 backends 数组中添加即可

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { StorageBackend } from '../src/interface';
import { isRecordBackend } from '../src/interface';  // ← 添加此行
import { MemoryBackend } from '../src/backend/memory';
import { FileType } from '../src/interface/types';
import { createInode } from '../src/core/inode';

// ---- 注册所有要测试的后端 ----
const backends: Array<{ name: string; create: () => StorageBackend }> = [
  { name: 'MemoryBackend', create: () => new MemoryBackend() },
  // IndexedDB 和 NodeFS 需要各自环境，CI 中可条件启用
  // { name: 'IndexedDBBackend', create: () => new IndexedDBBackend({ dbName: 'test' }) },
  // { name: 'NodeFSBackend', create: () => new NodeFSBackend({ rootPath: '/tmp/vfs-test' }) },
];

for (const { name, create } of backends) {
  describe(`Backend Conformance: ${name}`, () => {
    let backend: StorageBackend;

    beforeEach(async () => {
      backend = create();
      await backend.init();
    });

    afterEach(async () => {
      await backend.close();
    });

    // ---- Inode 操作 ----

    describe('Inode CRUD', () => {
      it('should have root inode after init', async () => {
        const root = await backend.getInode(1);
        expect(root).not.toBeNull();
        expect(root!.ino).toBe(1);
        expect(root!.type).toBe(FileType.DIRECTORY);
      });

      it('should allocate unique ino', async () => {
        const ino1 = await backend.allocateIno();
        const ino2 = await backend.allocateIno();
        expect(ino1).not.toBe(ino2);
        expect(ino1).toBeGreaterThanOrEqual(2);
        expect(ino2).toBeGreaterThan(ino1);
      });

      it('should put and get inode', async () => {
        const ino = await backend.allocateIno();
        const inode = createInode(ino, FileType.REGULAR);
        inode.size = 42;

        await backend.putInode(inode);
        const retrieved = await backend.getInode(ino);

        expect(retrieved).not.toBeNull();
        expect(retrieved!.ino).toBe(ino);
        expect(retrieved!.type).toBe(FileType.REGULAR);
        expect(retrieved!.size).toBe(42);
      });

      it('should return null for nonexistent inode', async () => {
        const result = await backend.getInode(99999);
        expect(result).toBeNull();
      });

      it('should delete inode', async () => {
        const ino = await backend.allocateIno();
        const inode = createInode(ino, FileType.REGULAR);
        await backend.putInode(inode);

        await backend.deleteInode(ino);
        const result = await backend.getInode(ino);
        expect(result).toBeNull();
      });

      it('should update inode on re-put', async () => {
        const ino = await backend.allocateIno();
        const inode = createInode(ino, FileType.REGULAR);
        inode.size = 10;
        await backend.putInode(inode);

        inode.size = 20;
        await backend.putInode(inode);

        const retrieved = await backend.getInode(ino);
        expect(retrieved!.size).toBe(20);
      });

      it('should not mutate stored inode via external reference', async () => {
        const ino = await backend.allocateIno();
        const inode = createInode(ino, FileType.REGULAR);
        inode.size = 10;
        await backend.putInode(inode);

        // 修改原始对象不应影响存储
        inode.size = 999;
        const retrieved = await backend.getInode(ino);
        expect(retrieved!.size).toBe(10);
      });

      it('should not mutate stored inode via retrieved reference', async () => {
        const ino = await backend.allocateIno();
        const inode = createInode(ino, FileType.REGULAR);
        inode.size = 10;
        await backend.putInode(inode);

        const retrieved = await backend.getInode(ino);
        retrieved!.size = 888;

        const fresh = await backend.getInode(ino);
        expect(fresh!.size).toBe(10);
      });

      it('should delete nonexistent inode without error', async () => {
        await expect(backend.deleteInode(99999)).resolves.toBeUndefined();
      });

      it('should preserve inode metadata', async () => {
        const ino = await backend.allocateIno();
        const inode = createInode(ino, FileType.REGULAR, {
          mimeType: 'text/plain',
          tags: ['test'],
        });
        await backend.putInode(inode);

        const retrieved = await backend.getInode(ino);
        expect(retrieved!.metadata.mimeType).toBe('text/plain');
        expect(retrieved!.metadata.tags).toEqual(['test']);
      });

      it('should preserve inode timestamps', async () => {
        const ino = await backend.allocateIno();
        const inode = createInode(ino, FileType.REGULAR);
        await backend.putInode(inode);

        const retrieved = await backend.getInode(ino);
        expect(retrieved!.createdAt).toBe(inode.createdAt);
        expect(retrieved!.modifiedAt).toBe(inode.modifiedAt);
        expect(retrieved!.accessedAt).toBe(inode.accessedAt);
      });

      it('should allocate many inos sequentially', async () => {
        const inos: number[] = [];
        for (let i = 0; i < 100; i++) {
          inos.push(await backend.allocateIno());
        }
        const uniqueSet = new Set(inos);
        expect(uniqueSet.size).toBe(100);
      });
    });

    // ---- Data 操作 ----

    describe('Data CRUD', () => {
      it('should put and get data', async () => {
        const ref = 'data-test';
        const data = new TextEncoder().encode('hello world').buffer;

        await backend.putData(ref, data);
        const retrieved = await backend.getData(ref);

        expect(retrieved).not.toBeNull();
        const text = new TextDecoder().decode(retrieved!);
        expect(text).toBe('hello world');
      });

      it('should return null for nonexistent data', async () => {
        const result = await backend.getData('nonexistent');
        expect(result).toBeNull();
      });

      it('should delete data', async () => {
        const ref = 'data-del';
        await backend.putData(ref, new ArrayBuffer(10));
        await backend.deleteData(ref);
        const result = await backend.getData(ref);
        expect(result).toBeNull();
      });

      it('should overwrite data on re-put', async () => {
        const ref = 'data-overwrite';
        await backend.putData(ref, new TextEncoder().encode('first').buffer);
        await backend.putData(ref, new TextEncoder().encode('second').buffer);

        const retrieved = await backend.getData(ref);
        const text = new TextDecoder().decode(retrieved!);
        expect(text).toBe('second');
      });

      it('should handle empty ArrayBuffer', async () => {
        const ref = 'data-empty';
        await backend.putData(ref, new ArrayBuffer(0));
        const retrieved = await backend.getData(ref);
        expect(retrieved).not.toBeNull();
        expect(retrieved!.byteLength).toBe(0);
      });

      it('should handle large data', async () => {
        const ref = 'data-large';
        const size = 1024 * 64; // 64KB
        const data = new Uint8Array(size);
        for (let i = 0; i < size; i++) data[i] = i % 256;
        await backend.putData(ref, data.buffer);

        const retrieved = await backend.getData(ref);
        expect(retrieved!.byteLength).toBe(size);
        const view = new Uint8Array(retrieved!);
        expect(view[0]).toBe(0);
        expect(view[255]).toBe(255);
        expect(view[256]).toBe(0);
      });

      it('should not mutate stored data via external reference', async () => {
        const ref = 'data-immutable';
        const buf = new Uint8Array([1, 2, 3]);
        await backend.putData(ref, buf.buffer);

        // 修改原始 buffer
        buf[0] = 99;
        const retrieved = new Uint8Array((await backend.getData(ref))!);
        expect(retrieved[0]).toBe(1);
      });

      it('should delete nonexistent data without error', async () => {
        await expect(backend.deleteData('nonexistent')).resolves.toBeUndefined();
      });

      it('should handle binary data with all byte values', async () => {
        const ref = 'data-binary';
        const buf = new Uint8Array(256);
        for (let i = 0; i < 256; i++) buf[i] = i;
        await backend.putData(ref, buf.buffer);

        const retrieved = new Uint8Array((await backend.getData(ref))!);
        for (let i = 0; i < 256; i++) {
          expect(retrieved[i]).toBe(i);
        }
      });
    });

    // ---- DirEntry 操作 ----

    describe('DirEntry CRUD', () => {
      it('should have empty root dir entries after init', async () => {
        const entries = await backend.getDirEntries(1);
        expect(entries).toEqual([]);
      });

      it('should put and get dir entry', async () => {
        await backend.putDirEntry(1, { name: 'file.txt', ino: 2 });
        const entries = await backend.getDirEntries(1);
        expect(entries).toHaveLength(1);
        expect(entries[0].name).toBe('file.txt');
        expect(entries[0].ino).toBe(2);
      });

      it('should add multiple entries', async () => {
        await backend.putDirEntry(1, { name: 'a.txt', ino: 2 });
        await backend.putDirEntry(1, { name: 'b.txt', ino: 3 });
        await backend.putDirEntry(1, { name: 'c.txt', ino: 4 });

        const entries = await backend.getDirEntries(1);
        expect(entries).toHaveLength(3);
        const names = entries.map((e) => e.name).sort();
        expect(names).toEqual(['a.txt', 'b.txt', 'c.txt']);
      });

      it('should update entry with same name', async () => {
        await backend.putDirEntry(1, { name: 'file.txt', ino: 2 });
        await backend.putDirEntry(1, { name: 'file.txt', ino: 5 });

        const entries = await backend.getDirEntries(1);
        expect(entries).toHaveLength(1);
        expect(entries[0].ino).toBe(5);
      });

      it('should delete dir entry', async () => {
        await backend.putDirEntry(1, { name: 'a.txt', ino: 2 });
        await backend.putDirEntry(1, { name: 'b.txt', ino: 3 });

        await backend.deleteDirEntry(1, 'a.txt');

        const entries = await backend.getDirEntries(1);
        expect(entries).toHaveLength(1);
        expect(entries[0].name).toBe('b.txt');
      });

      it('should return empty array for nonexistent parent', async () => {
        const entries = await backend.getDirEntries(99999);
        expect(entries).toEqual([]);
      });

      it('should delete nonexistent entry without error', async () => {
        await expect(
          backend.deleteDirEntry(1, 'nonexistent'),
        ).resolves.toBeUndefined();
      });

      it('should isolate entries between different parents', async () => {
        const parentIno1 = await backend.allocateIno();
        const parentIno2 = await backend.allocateIno();

        await backend.putDirEntry(parentIno1, { name: 'file.txt', ino: 10 });
        await backend.putDirEntry(parentIno2, { name: 'other.txt', ino: 11 });

        const entries1 = await backend.getDirEntries(parentIno1);
        const entries2 = await backend.getDirEntries(parentIno2);

        expect(entries1).toHaveLength(1);
        expect(entries1[0].name).toBe('file.txt');
        expect(entries2).toHaveLength(1);
        expect(entries2[0].name).toBe('other.txt');
      });

      it('should handle dir entry names with special characters', async () => {
        const specialNames = ['file with spaces.txt', 'hello-world', 'test_123', 'a.b.c.d'];
        for (let i = 0; i < specialNames.length; i++) {
          await backend.putDirEntry(1, { name: specialNames[i], ino: i + 10 });
        }
        const entries = await backend.getDirEntries(1);
        expect(entries).toHaveLength(specialNames.length);
        const names = entries.map((e) => e.name).sort();
        expect(names).toEqual([...specialNames].sort());
      });
    });

    // ---- 事务 ----

    describe('Transactions', () => {
      it('should commit readwrite transaction on success', async () => {
        await backend.runInTransaction('readwrite', async (tx) => {
          const ino = await tx.allocateIno();
          const inode = createInode(ino, FileType.REGULAR);
          await tx.putInode(inode);
          await tx.putDirEntry(1, { name: 'txfile.txt', ino });
          await tx.putData(`data-${ino}`, new TextEncoder().encode('tx-data').buffer);
        });

        const entries = await backend.getDirEntries(1);
        expect(entries.some((e) => e.name === 'txfile.txt')).toBe(true);
      });

      it('should rollback readwrite transaction on error', async () => {
        const entriesBefore = await backend.getDirEntries(1);

        try {
          await backend.runInTransaction('readwrite', async (tx) => {
            const ino = await tx.allocateIno();
            const inode = createInode(ino, FileType.REGULAR);
            await tx.putInode(inode);
            await tx.putDirEntry(1, { name: 'should-not-exist.txt', ino });
            throw new Error('rollback test');
          });
        } catch (err: any) {
          expect(err.message).toBe('rollback test');
        }

        const entriesAfter = await backend.getDirEntries(1);
        expect(entriesAfter).toEqual(entriesBefore);
        expect(entriesAfter.some((e) => e.name === 'should-not-exist.txt')).toBe(false);
      });

      it('should not modify data in readonly transaction', async () => {
        const ino = await backend.allocateIno();
        const inode = createInode(ino, FileType.REGULAR);
        inode.size = 100;
        await backend.putInode(inode);

        await backend.runInTransaction('readonly', async (tx) => {
          const retrieved = await tx.getInode(ino);
          expect(retrieved!.size).toBe(100);

          // 即使在 readonly 事务中修改，也不应影响原始数据
          retrieved!.size = 999;
          await tx.putInode(retrieved!);
        });

        const afterTx = await backend.getInode(ino);
        expect(afterTx!.size).toBe(100);
      });

      it('should return result from transaction', async () => {
        const result = await backend.runInTransaction('readonly', async (tx) => {
          const root = await tx.getInode(1);
          return root!.type;
        });
        expect(result).toBe(FileType.DIRECTORY);
      });

      it('should see own writes within transaction', async () => {
        await backend.runInTransaction('readwrite', async (tx) => {
          const ino = await tx.allocateIno();
          const inode = createInode(ino, FileType.REGULAR);
          await tx.putInode(inode);

          const retrieved = await tx.getInode(ino);
          expect(retrieved).not.toBeNull();
          expect(retrieved!.ino).toBe(ino);
        });
      });

      it('should handle multiple operations in single transaction', async () => {
        await backend.runInTransaction('readwrite', async (tx) => {
          for (let i = 0; i < 10; i++) {
            const ino = await tx.allocateIno();
            const inode = createInode(ino, FileType.REGULAR);
            await tx.putInode(inode);
            await tx.putDirEntry(1, { name: `file-${i}.txt`, ino });
            await tx.putData(`data-${ino}`, new TextEncoder().encode(`content-${i}`).buffer);
          }
        });

        const entries = await backend.getDirEntries(1);
        expect(entries).toHaveLength(10);
      });
    });

    // ---- 重复初始化 ----

    describe('Lifecycle', () => {
      it('should be idempotent on double init', async () => {
        await backend.init();
        const root = await backend.getInode(1);
        expect(root).not.toBeNull();
      });

      it('should preserve data across double init', async () => {
        const ino = await backend.allocateIno();
        const inode = createInode(ino, FileType.REGULAR);
        await backend.putInode(inode);
        await backend.putDirEntry(1, { name: 'persist.txt', ino });

        await backend.init();

        const entries = await backend.getDirEntries(1);
        expect(entries.some((e) => e.name === 'persist.txt')).toBe(true);
      });
    });

// 在 backends loop 的 describe 块末尾追加以下内容

    // ---- Record 操作 ----

    describe('Record CRUD', () => {
      let recordIno: number;

      beforeEach(async () => {
        recordIno = await backend.allocateIno();
        const inode = createInode(recordIno, FileType.RECORD);
        inode.dataRef = `record-${recordIno}`;
        inode.recordIndexes = [];
        await backend.putInode(inode);
      });

      it('should implement RecordBackend interface', () => {
        expect(isRecordBackend(backend)).toBe(true);
      });

      it('should set and get record field', async () => {
        const rb = backend as any;
        await rb.setRecordField(recordIno, 'name', 'Alice');
        const val = await rb.getRecordField(recordIno, 'name');
        expect(val).toBe('Alice');
      });

      it('should return undefined for nonexistent field', async () => {
        const rb = backend as any;
        const val = await rb.getRecordField(recordIno, 'nonexistent');
        expect(val).toBeUndefined();
      });

      it('should overwrite existing field', async () => {
        const rb = backend as any;
        await rb.setRecordField(recordIno, 'version', 1);
        await rb.setRecordField(recordIno, 'version', 2);
        expect(await rb.getRecordField(recordIno, 'version')).toBe(2);
      });

      it('should delete field', async () => {
        const rb = backend as any;
        await rb.setRecordField(recordIno, 'temp', 'value');
        await rb.deleteRecordField(recordIno, 'temp');
        expect(await rb.getRecordField(recordIno, 'temp')).toBeUndefined();
      });

      it('should get all fields', async () => {
        const rb = backend as any;
        await rb.setRecordField(recordIno, 'a', 1);
        await rb.setRecordField(recordIno, 'b', 'two');
        await rb.setRecordField(recordIno, 'c', true);

        const all = await rb.getAllRecordFields(recordIno);
        expect(all).toEqual({ a: 1, b: 'two', c: true });
      });

      it('should set all fields (bulk replace)', async () => {
        const rb = backend as any;
        await rb.setRecordField(recordIno, 'old', 'data');
        await rb.setAllRecordFields(recordIno, { new1: 'x', new2: 'y' });

        const all = await rb.getAllRecordFields(recordIno);
        expect(all).toEqual({ new1: 'x', new2: 'y' });
        expect(all).not.toHaveProperty('old');
      });

      it('should clear all fields', async () => {
        const rb = backend as any;
        await rb.setRecordField(recordIno, 'a', 1);
        await rb.setRecordField(recordIno, 'b', 2);
        await rb.clearRecordFields(recordIno);

        const all = await rb.getAllRecordFields(recordIno);
        expect(all).toEqual({});
      });

      it('should list field names', async () => {
        const rb = backend as any;
        await rb.setRecordField(recordIno, 'x', 1);
        await rb.setRecordField(recordIno, 'y', 2);
        await rb.setRecordField(recordIno, 'z', 3);

        const fields = await rb.listRecordFields(recordIno);
        expect(fields.sort()).toEqual(['x', 'y', 'z']);
      });

      it('should handle object values', async () => {
        const rb = backend as any;
        const obj = { nested: { deep: true }, arr: [1, 2, 3] };
        await rb.setRecordField(recordIno, 'complex', obj);

        const val = await rb.getRecordField(recordIno, 'complex');
        expect(val).toEqual(obj);
      });

      it('should isolate fields from external mutation', async () => {
        const rb = backend as any;
        const arr = [1, 2, 3];
        await rb.setRecordField(recordIno, 'arr', arr);
        arr.push(4);

        const val = await rb.getRecordField(recordIno, 'arr');
        expect(val).toEqual([1, 2, 3]);
      });

      it('should create and use index', async () => {
        const rb = backend as any;
        await rb.setRecordField(recordIno, 'u1', { role: 'admin', name: 'Alice' });
        await rb.setRecordField(recordIno, 'u2', { role: 'user', name: 'Bob' });
        await rb.setRecordField(recordIno, 'u3', { role: 'admin', name: 'Charlie' });

        await rb.createRecordIndex(recordIno, 'role');

        const results = await rb.queryRecordFields(recordIno, {
          field: 'role',
          operator: '=',
          value: 'admin',
        });
        expect(results).toHaveLength(2);
      });

      it('should query with comparison operators', async () => {
        const rb = backend as any;
        await rb.setRecordField(recordIno, 'a', { score: 10 });
        await rb.setRecordField(recordIno, 'b', { score: 20 });
        await rb.setRecordField(recordIno, 'c', { score: 30 });

        const gt15 = await rb.queryRecordFields(recordIno, {
          field: 'score',
          operator: '>',
          value: 15,
        });
        expect(gt15).toHaveLength(2);
      });

      it('should support query pagination', async () => {
        const rb = backend as any;
        for (let i = 0; i < 10; i++) {
          await rb.setRecordField(recordIno, `item${i}`, { val: i });
        }

        const page = await rb.queryRecordFields(
          recordIno,
          { field: 'val', operator: '>=', value: 0 },
          { offset: 2, limit: 3 },
        );
        expect(page).toHaveLength(3);
      });

      it('should clean up records when inode is deleted', async () => {
        const rb = backend as any;
        await rb.setRecordField(recordIno, 'key', 'value');
        await backend.deleteInode(recordIno);

        // 记录数据应被清理
        const all = await rb.getAllRecordFields(recordIno);
        expect(all).toEqual({});
      });
    });
  });
}
