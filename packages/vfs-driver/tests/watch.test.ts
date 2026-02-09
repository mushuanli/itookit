// tests/watch.test.ts

import { describe, it, expect, beforeEach } from 'vitest';
import { FileSystem } from '../src/core/filesystem.js';
import { MemoryBackend } from '../src/backend/memory.js';
import type { FileChangeEvent } from '../src/interface';

describe('Watch System', () => {
  let fs: FileSystem;

  beforeEach(async () => {
    const backend = new MemoryBackend();
    fs = new FileSystem(backend);
    await fs.init();
  });

  it('should emit create event', async () => {
    const events: FileChangeEvent[] = [];
    fs.watch('/', (e) => events.push(e));

    await fs.create('/file.txt', 'hello');

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('create');
    expect(events[0].path).toBe('/file.txt');
    expect(events[0].timestamp).toBeGreaterThan(0);
  });

  it('should emit modify event on write', async () => {
    await fs.create('/file.txt', 'hello');

    const events: FileChangeEvent[] = [];
    fs.watch('/', (e) => events.push(e));

    await fs.write('/file.txt', 'updated');

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('modify');
  });

  it('should emit modify event on append', async () => {
    await fs.create('/file.txt', 'hello');

    const events: FileChangeEvent[] = [];
    fs.watch('/', (e) => events.push(e));

    await fs.append('/file.txt', ' world');

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('modify');
  });

  it('should emit delete event', async () => {
    await fs.create('/file.txt', 'hello');

    const events: FileChangeEvent[] = [];
    fs.watch('/', (e) => events.push(e));

    await fs.unlink('/file.txt');

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('delete');
    expect(events[0].path).toBe('/file.txt');
  });

  it('should emit rename event', async () => {
    await fs.create('/old.txt', 'data');

    const events: FileChangeEvent[] = [];
    fs.watch('/', (e) => events.push(e));

    await fs.rename('/old.txt', '/new.txt');

    const renameEvent = events.find((e) => e.type === 'rename');
    expect(renameEvent).toBeDefined();
    expect(renameEvent!.path).toBe('/new.txt');
    expect(renameEvent!.oldPath).toBe('/old.txt');
  });

  it('should emit metadata event', async () => {
    await fs.create('/meta.txt', 'data');

    const events: FileChangeEvent[] = [];
    fs.watch('/', (e) => events.push(e));

    await fs.setMetadata('/meta.txt', { mimeType: 'text/plain' });

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('metadata');
  });

  it('should emit create event for mkdir', async () => {
    const events: FileChangeEvent[] = [];
    fs.watch('/', (e) => events.push(e));

    await fs.mkdir('/newdir');

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('create');
    expect(events[0].path).toBe('/newdir');
  });

  it('should emit delete event for rmdir', async () => {
    await fs.mkdir('/toremove');

    const events: FileChangeEvent[] = [];
    fs.watch('/', (e) => events.push(e));

    await fs.rmdir('/toremove');

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('delete');
    expect(events[0].path).toBe('/toremove');
  });

  it('should emit modify event on overwrite create', async () => {
    await fs.create('/ow.txt', 'v1');

    const events: FileChangeEvent[] = [];
    fs.watch('/', (e) => events.push(e));

    await fs.create('/ow.txt', 'v2', { overwrite: true });

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('modify');
  });

  it('should watch exact path match', async () => {
    const events: FileChangeEvent[] = [];
    fs.watch('/target.txt', (e) => events.push(e));

    await fs.create('/target.txt', 'data');
    await fs.create('/other.txt', 'data');

    // 精确匹配只捕获 /target.txt 的事件
    // 注意：create 事件的 path 是 /target.txt，精确匹配成功
    expect(events).toHaveLength(1);
    expect(events[0].path).toBe('/target.txt');
  });

  describe('recursive watching', () => {
    it('should watch subdirectories when recursive', async () => {
      await fs.mkdir('/parent/child', { recursive: true });

      const events: FileChangeEvent[] = [];
      fs.watch('/parent', (e) => events.push(e), { recursive: true });

      await fs.create('/parent/child/deep.txt', 'deep');

      expect(events).toHaveLength(1);
      expect(events[0].path).toBe('/parent/child/deep.txt');
    });

    it('should not watch subdirectories when not recursive', async () => {
      await fs.mkdir('/parent/child', { recursive: true });

      const events: FileChangeEvent[] = [];
      fs.watch('/parent', (e) => events.push(e), { recursive: false });

      await fs.create('/parent/child/deep.txt', 'deep');

      expect(events).toHaveLength(0);
    });

    it('should watch direct children when not recursive', async () => {
      await fs.mkdir('/parent');

      const events: FileChangeEvent[] = [];
      fs.watch('/parent', (e) => events.push(e), { recursive: false });

      await fs.create('/parent/direct.txt', 'direct');

      expect(events).toHaveLength(1);
      expect(events[0].path).toBe('/parent/direct.txt');
    });

    it('should watch root direct children without recursive', async () => {
      const events: FileChangeEvent[] = [];
      fs.watch('/', (e) => events.push(e), { recursive: false });

      await fs.create('/root-file.txt', 'data');

      expect(events).toHaveLength(1);
      expect(events[0].path).toBe('/root-file.txt');
    });

    it('should not watch root grandchildren without recursive', async () => {
      await fs.mkdir('/sub');

      const events: FileChangeEvent[] = [];
      fs.watch('/', (e) => events.push(e), { recursive: false });

      await fs.create('/sub/grandchild.txt', 'data');

      // /sub/grandchild.txt 是 / 的孙节点，不应匹配
      expect(events).toHaveLength(0);
    });

    it('should emit multiple events for recursive rmdir', async () => {
      await fs.mkdir('/deep/child', { recursive: true });
      await fs.create('/deep/child/file.txt', 'data');

      const events: FileChangeEvent[] = [];
      fs.watch('/deep', (e) => events.push(e), { recursive: true });

      await fs.rmdir('/deep', { recursive: true });

      // 至少有 child/file.txt 和 /deep 的删除事件
      expect(events.length).toBeGreaterThanOrEqual(2);
      expect(events.every((e) => e.type === 'delete')).toBe(true);
    });
  });

  describe('watcher lifecycle', () => {
    it('should stop receiving events after close', async () => {
      const events: FileChangeEvent[] = [];
      const watcher = fs.watch('/', (e) => events.push(e));

      await fs.create('/a.txt', 'a');
      expect(events).toHaveLength(1);

      watcher.close();

      await fs.create('/b.txt', 'b');
      // 关闭后不再接收
      expect(events).toHaveLength(1);
    });

    it('should support multiple watchers on same path', async () => {
      const events1: FileChangeEvent[] = [];
      const events2: FileChangeEvent[] = [];

      fs.watch('/', (e) => events1.push(e));
      fs.watch('/', (e) => events2.push(e));

      await fs.create('/file.txt', 'data');

      expect(events1).toHaveLength(1);
      expect(events2).toHaveLength(1);
    });

    it('should support watchers on different paths', async () => {
      await fs.mkdir('/dirA');
      await fs.mkdir('/dirB');

      const eventsA: FileChangeEvent[] = [];
      const eventsB: FileChangeEvent[] = [];

      fs.watch('/dirA', (e) => eventsA.push(e));
      fs.watch('/dirB', (e) => eventsB.push(e));

      await fs.create('/dirA/a.txt', 'a');
      await fs.create('/dirB/b.txt', 'b');

      expect(eventsA).toHaveLength(1);
      expect(eventsA[0].path).toBe('/dirA/a.txt');
      expect(eventsB).toHaveLength(1);
      expect(eventsB[0].path).toBe('/dirB/b.txt');
    });

    it('should not crash if watcher callback throws', async () => {
      fs.watch('/', () => {
        throw new Error('Watcher crash');
      });

      // 不应影响文件操作
      await expect(fs.create('/safe.txt', 'data')).resolves.toBeDefined();
      expect(await fs.read('/safe.txt')).toBe('data');
    });

    it('should close only the specific watcher', async () => {
      const events1: FileChangeEvent[] = [];
      const events2: FileChangeEvent[] = [];

      const w1 = fs.watch('/', (e) => events1.push(e));
      fs.watch('/', (e) => events2.push(e));

      w1.close();

      await fs.create('/test.txt', 'data');

      expect(events1).toHaveLength(0);
      expect(events2).toHaveLength(1);
    });

    it('should be safe to close watcher multiple times', () => {
      const watcher = fs.watch('/', () => {});
      watcher.close();
      expect(() => watcher.close()).not.toThrow();
    });
  });
});
