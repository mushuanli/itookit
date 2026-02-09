// tests/transaction.test.ts

import { describe, it, expect, beforeEach } from 'vitest';
import { FileSystem } from '../src/core/filesystem.js';
import { MemoryBackend } from '../src/backend/memory.js';
import { FileSystemError } from '../src/core/errors.js';

describe('Transactions', () => {
  let fs: FileSystem;

  beforeEach(async () => {
    const backend = new MemoryBackend();
    fs = new FileSystem(backend);
    await fs.init();
  });

  it('should commit all operations on success', async () => {
    await fs.transaction(async (tx) => {
      await tx.create('/a.txt', 'aaa');
      await tx.create('/b.txt', 'bbb');
      await tx.mkdir('/dir');
      await tx.create('/dir/c.txt', 'ccc');
    });

    expect(await fs.read('/a.txt')).toBe('aaa');
    expect(await fs.read('/b.txt')).toBe('bbb');
    expect(await fs.read('/dir/c.txt')).toBe('ccc');
  });

  it('should rollback all operations on failure', async () => {
    await fs.create('/existing.txt', 'original');

    try {
      await fs.transaction(async (tx) => {
        await tx.write('/existing.txt', 'modified');
        await tx.create('/new.txt', 'new');
        throw new Error('Simulated failure');
      });
    } catch (err: any) {
      expect(err.message).toBe('Simulated failure');
    }

    // 原有文件应保持不变
    expect(await fs.read('/existing.txt')).toBe('original');
    // 新文件不应存在
    expect(await fs.exists('/new.txt')).toBe(false);
  });

  it('should support read operations in transaction', async () => {
    await fs.create('/data.txt', 'hello');

    const result = await fs.transaction(async (tx) => {
      const content = await tx.read('/data.txt');
      return content;
    });

    expect(result).toBe('hello');
  });

  it('should see writes within same transaction', async () => {
    await fs.transaction(async (tx) => {
      await tx.create('/intra.txt', 'first');
      const content = await tx.read('/intra.txt');
      expect(content).toBe('first');

      await tx.write('/intra.txt', 'second');
      const updated = await tx.read('/intra.txt');
      expect(updated).toBe('second');
    });
  });

  it('should handle directory operations in transaction', async () => {
    await fs.transaction(async (tx) => {
      await tx.mkdir('/txdir', { recursive: true });
      await tx.create('/txdir/file.txt', 'content');
      const entries = await tx.readdir('/txdir');
      expect(entries).toHaveLength(1);
      expect(entries[0].name).toBe('file.txt');
    });

    expect(await fs.exists('/txdir/file.txt')).toBe(true);
  });

  it('should return value from transaction', async () => {
    const result = await fs.transaction(async (tx) => {
      await tx.create('/val.txt', 'value');
      return 42;
    });

    expect(result).toBe(42);
  });

  it('should return complex value from transaction', async () => {
    const result = await fs.transaction(async (tx) => {
      await tx.create('/a.txt', 'aaa');
      await tx.create('/b.txt', 'bbb');
      return { count: 2, files: ['/a.txt', '/b.txt'] };
    });

    expect(result.count).toBe(2);
    expect(result.files).toEqual(['/a.txt', '/b.txt']);
  });

  it('should rollback mkdir on failure', async () => {
    try {
      await fs.transaction(async (tx) => {
        await tx.mkdir('/txdir-fail');
        await tx.create('/txdir-fail/file.txt', 'data');
        throw new Error('fail');
      });
    } catch {
      // expected
    }

    expect(await fs.exists('/txdir-fail')).toBe(false);
  });

  it('should rollback file deletion on failure', async () => {
    await fs.create('/keep-me.txt', 'precious');

    try {
      await fs.transaction(async (tx) => {
        await tx.unlink('/keep-me.txt');
        throw new Error('oops');
      });
    } catch {
      // expected
    }

    expect(await fs.exists('/keep-me.txt')).toBe(true);
    expect(await fs.read('/keep-me.txt')).toBe('precious');
  });

  it('should handle stat in transaction', async () => {
    await fs.create('/stat-tx.txt', 'hello');

    const stat = await fs.transaction(async (tx) => {
      return await tx.stat('/stat-tx.txt');
    });

    expect(stat.isFile()).toBe(true);
    expect(stat.size).toBe(5);
  });

  it('should handle exists in transaction', async () => {
    await fs.create('/exists-tx.txt', 'data');

    const result = await fs.transaction(async (tx) => {
      return {
        exists: await tx.exists('/exists-tx.txt'),
        notExists: await tx.exists('/nope.txt'),
      };
    });

    expect(result.exists).toBe(true);
    expect(result.notExists).toBe(false);
  });

  it('should handle metadata operations in transaction', async () => {
    await fs.create('/meta-tx.txt', 'data');

    await fs.transaction(async (tx) => {
      await tx.setMetadata('/meta-tx.txt', { mimeType: 'text/plain' });
      const meta = await tx.getMetadata('/meta-tx.txt');
      expect(meta.mimeType).toBe('text/plain');
    });

    const meta = await fs.getMetadata('/meta-tx.txt');
    expect(meta.mimeType).toBe('text/plain');
  });

  it('should rollback metadata changes on failure', async () => {
    await fs.create('/meta-rollback.txt', 'data');
    await fs.setMetadata('/meta-rollback.txt', { mimeType: 'text/html' });

    try {
      await fs.transaction(async (tx) => {
        await tx.setMetadata('/meta-rollback.txt', { mimeType: 'application/json' });
        throw new Error('rollback');
      });
    } catch {
      // expected
    }

    const meta = await fs.getMetadata('/meta-rollback.txt');
    expect(meta.mimeType).toBe('text/html');
  });

  it('should handle append in transaction', async () => {
    await fs.create('/append-tx.txt', 'start');

    await fs.transaction(async (tx) => {
      await tx.append('/append-tx.txt', '-middle');
      await tx.append('/append-tx.txt', '-end');
    });

    expect(await fs.read('/append-tx.txt')).toBe('start-middle-end');
  });

  it('should rollback append on failure', async () => {
    await fs.create('/append-rollback.txt', 'original');

    try {
      await fs.transaction(async (tx) => {
        await tx.append('/append-rollback.txt', '-appended');
        throw new Error('fail');
      });
    } catch {
      // expected
    }

    expect(await fs.read('/append-rollback.txt')).toBe('original');
  });

  it('should handle rename in transaction', async () => {
    await fs.create('/rename-tx.txt', 'data');

    await fs.transaction(async (tx) => {
      await tx.rename('/rename-tx.txt', '/renamed-tx.txt');
    });

    expect(await fs.exists('/rename-tx.txt')).toBe(false);
    expect(await fs.read('/renamed-tx.txt')).toBe('data');
  });

  it('should rollback rename on failure', async () => {
    await fs.create('/rename-rollback.txt', 'data');

    try {
      await fs.transaction(async (tx) => {
        await tx.rename('/rename-rollback.txt', '/renamed-fail.txt');
        throw new Error('fail');
      });
    } catch {
      // expected
    }

    expect(await fs.exists('/rename-rollback.txt')).toBe(true);
    expect(await fs.exists('/renamed-fail.txt')).toBe(false);
  });

  it('should handle copy in transaction', async () => {
    await fs.create('/copy-src.txt', 'copy-data');

    await fs.transaction(async (tx) => {
      await tx.copy('/copy-src.txt', '/copy-dst.txt');
    });

    expect(await fs.read('/copy-src.txt')).toBe('copy-data');
    expect(await fs.read('/copy-dst.txt')).toBe('copy-data');
  });

  it('should handle multiple file creations and check isolation', async () => {
    await fs.create('/before.txt', 'before');

    try {
      await fs.transaction(async (tx) => {
        await tx.create('/tx1.txt', 'tx1');
        await tx.create('/tx2.txt', 'tx2');
        await tx.create('/tx3.txt', 'tx3');

        // 确保事务内可见
        expect(await tx.exists('/tx1.txt')).toBe(true);
        expect(await tx.exists('/tx2.txt')).toBe(true);
        expect(await tx.exists('/tx3.txt')).toBe(true);

        throw new Error('abort');
      });
    } catch {
      // expected
    }

    // 全部回滚
    expect(await fs.exists('/tx1.txt')).toBe(false);
    expect(await fs.exists('/tx2.txt')).toBe(false);
    expect(await fs.exists('/tx3.txt')).toBe(false);
    // 事务前的文件不受影响
    expect(await fs.read('/before.txt')).toBe('before');
  });

  it('should propagate error type from transaction', async () => {
    const customError = new FileSystemError('EINVAL', '/test', 'custom');

    try {
      await fs.transaction(async () => {
        throw customError;
      });
    } catch (err) {
      expect(err).toBeInstanceOf(FileSystemError);
      expect((err as FileSystemError).code).toBe('EINVAL');
    }
  });
});
