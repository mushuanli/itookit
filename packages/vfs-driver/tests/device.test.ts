// tests/device.test.ts

import { describe, it, expect, beforeEach } from 'vitest';
import { FileSystem } from '../src/core/filesystem.js';
import { MemoryBackend } from '../src/backend/memory.js';
import { FileSystemError } from '../src/core/errors.js';
import { DeviceManager } from '../src/device/manager.js';
import {
  nullDevice,
  zeroDevice,
  randomDevice,
  builtinDevices,
} from '../src/device/builtins.js';
import type { DeviceDriver, FileType } from '../src/interface';

describe('Device System', () => {
  let fs: FileSystem;

  beforeEach(async () => {
    const backend = new MemoryBackend();
    fs = new FileSystem(backend);
    await fs.init();
    fs.registerDevice(nullDevice);
    fs.registerDevice(zeroDevice);
    fs.registerDevice(randomDevice);
  });

  describe('builtin devices', () => {
    describe('/dev/null', () => {
      it('should return empty on read', async () => {
        const content = await fs.read('/dev/null', { encoding: null });
        expect(content).toBeInstanceOf(ArrayBuffer);
        expect((content as ArrayBuffer).byteLength).toBe(0);
      });

      it('should accept any write', async () => {
        await expect(fs.write('/dev/null', 'anything')).resolves.toBeUndefined();
      });

      it('should accept binary write', async () => {
        const buf = new Uint8Array([1, 2, 3]);
        await expect(fs.write('/dev/null', buf)).resolves.toBeUndefined();
      });

      it('should accept empty write', async () => {
        await expect(fs.write('/dev/null', '')).resolves.toBeUndefined();
      });
    });

    describe('/dev/zero', () => {
      it('should return zero-filled buffer', async () => {
        const content = await fs.read('/dev/zero', { encoding: null });
        const buf = new Uint8Array(content as ArrayBuffer);
        expect(buf.length).toBeGreaterThan(0);
        expect(buf.every((b) => b === 0)).toBe(true);
      });

      it('should accept writes silently', async () => {
        await expect(fs.write('/dev/zero', 'data')).resolves.toBeUndefined();
      });
    });

    describe('/dev/random', () => {
      it('should return non-zero data (probabilistic)', async () => {
        const content = await fs.read('/dev/random', { encoding: null });
        const buf = new Uint8Array(content as ArrayBuffer);
        expect(buf.length).toBeGreaterThan(0);
        // 极小概率全零，但几乎不可能
        const hasNonZero = buf.some((b) => b !== 0);
        expect(hasNonZero).toBe(true);
      });

      it('should return different data on successive reads (probabilistic)', async () => {
        const content1 = await fs.read('/dev/random', { encoding: null });
        const content2 = await fs.read('/dev/random', { encoding: null });
        const buf1 = new Uint8Array(content1 as ArrayBuffer);
        const buf2 = new Uint8Array(content2 as ArrayBuffer);

        // 极小概率相同，但几乎不可能
        let allSame = true;
        for (let i = 0; i < buf1.length && i < buf2.length; i++) {
          if (buf1[i] !== buf2[i]) {
            allSame = false;
            break;
          }
        }
        expect(allSame).toBe(false);
      });

      it('should accept writes silently', async () => {
        await expect(fs.write('/dev/random', 'data')).resolves.toBeUndefined();
      });
    });
  });

  describe('builtinDevices array', () => {
    it('should contain exactly 3 devices', () => {
      expect(builtinDevices).toHaveLength(3);
    });

    it('should contain null, zero, and random', () => {
      const names = builtinDevices.map((d) => d.name).sort();
      expect(names).toEqual(['null', 'random', 'zero']);
    });
  });

  describe('device registration', () => {
    it('should throw EEXIST when registering duplicate device', () => {
      expect(() => fs.registerDevice(nullDevice)).toThrow(FileSystemError);
    });

    it('should unregister device', async () => {
      fs.unregisterDevice('null');
      expect(await fs.exists('/dev/null')).toBe(false);
    });

    it('should list devices via readdir /dev', async () => {
      const entries = await fs.readdir('/dev');
      const names = entries.map((e) => e.name).sort();
      expect(names).toContain('null');
      expect(names).toContain('zero');
      expect(names).toContain('random');
    });

    it('should reflect registration changes in readdir', async () => {
      const before = await fs.readdir('/dev');
      fs.unregisterDevice('null');
      const after = await fs.readdir('/dev');
      expect(after.length).toBe(before.length - 1);
      expect(after.some((e) => e.name === 'null')).toBe(false);
    });

    it('should re-register after unregister', async () => {
      fs.unregisterDevice('null');
      expect(await fs.exists('/dev/null')).toBe(false);
      fs.registerDevice(nullDevice);
      expect(await fs.exists('/dev/null')).toBe(true);
    });
  });

  describe('custom device', () => {
    it('should register and use custom device', async () => {
      let storage = '';

      const customDevice: DeviceDriver = {
        name: 'buffer',
        async read() {
          return storage;
        },
        async write(data) {
          const text =
            typeof data === 'string'
              ? data
              : new TextDecoder().decode(
                  data instanceof ArrayBuffer ? data : data,
                );
          storage = text;
          return text.length;
        },
      };

      fs.registerDevice(customDevice);
      await fs.write('/dev/buffer', 'hello device');
      const content = await fs.read('/dev/buffer');
      expect(content).toBe('hello device');
    });

    it('should register read-only device', async () => {
      const readOnlyDevice: DeviceDriver = {
        name: 'readonly',
        async read() {
          return 'constant value';
        },
        // 没有 write
      };

      fs.registerDevice(readOnlyDevice);
      const content = await fs.read('/dev/readonly');
      expect(content).toBe('constant value');
    });

    it('should register write-only device', async () => {
      const writes: string[] = [];
      const writeOnlyDevice: DeviceDriver = {
        name: 'writeonly',
        async write(data) {
          const text = typeof data === 'string' ? data : new TextDecoder().decode(data instanceof ArrayBuffer ? data : data);
          writes.push(text);
          return text.length;
        },
        // 没有 read
      };

      fs.registerDevice(writeOnlyDevice);
      await fs.write('/dev/writeonly', 'log-entry');
      expect(writes).toEqual(['log-entry']);
    });
  });

  describe('ioctl', () => {
    it('should call ioctl on device', async () => {
      const ioctlDevice: DeviceDriver = {
        name: 'ioctltest',
        async ioctl(command, arg) {
          if (command === 'GET_STATUS') return { status: 'ok' };
          if (command === 'SET_VALUE') return arg;
          throw new Error('Unknown command');
        },
      };

      fs.registerDevice(ioctlDevice);

      const status = await fs.ioctl('/dev/ioctltest', 'GET_STATUS');
      expect(status).toEqual({ status: 'ok' });

      const value = await fs.ioctl('/dev/ioctltest', 'SET_VALUE', 42);
      expect(value).toBe(42);
    });

    it('should support numeric ioctl commands', async () => {
      const numDevice: DeviceDriver = {
        name: 'numioctl',
        async ioctl(command, arg) {
          if (command === 0x01) return 'cmd-1';
          if (command === 0x02) return arg;
          return null;
        },
      };

      fs.registerDevice(numDevice);
      expect(await fs.ioctl('/dev/numioctl', 0x01)).toBe('cmd-1');
      expect(await fs.ioctl('/dev/numioctl', 0x02, 'payload')).toBe('payload');
    });

    it('should throw ENOTTY for non-device path', async () => {
      await fs.create('/file.txt', 'data');
      await expect(fs.ioctl('/file.txt', 'CMD')).rejects.toThrow(FileSystemError);
    });

    it('should throw ENOTTY when device has no ioctl', async () => {
      const noIoctlDevice: DeviceDriver = {
        name: 'noioctl',
        async read() {
          return '';
        },
      };
      fs.registerDevice(noIoctlDevice);
      await expect(fs.ioctl('/dev/noioctl', 'CMD')).rejects.toThrow(FileSystemError);
    });

    it('should throw ENOTTY for root path', async () => {
      await expect(fs.ioctl('/', 'CMD')).rejects.toThrow(FileSystemError);
    });

    it('should throw ENOTTY for nonexistent device', async () => {
      await expect(fs.ioctl('/dev/nonexistent', 'CMD')).rejects.toThrow(FileSystemError);
    });

    it('should throw ENOTTY for nested device path', async () => {
      await expect(fs.ioctl('/dev/null/extra', 'CMD')).rejects.toThrow(FileSystemError);
    });
  });

  describe('stat on device', () => {
    it('should return device stat', async () => {
      const stat = await fs.stat('/dev/null');
      expect(stat.type).toBe('device');
      expect(stat.isDevice()).toBe(true);
      expect(stat.isFile()).toBe(false);
      expect(stat.isDirectory()).toBe(false);
      expect(stat.isSymlink()).toBe(false);
    });

    it('should show device exists', async () => {
      expect(await fs.exists('/dev/null')).toBe(true);
      expect(await fs.exists('/dev/zero')).toBe(true);
      expect(await fs.exists('/dev/random')).toBe(true);
      expect(await fs.exists('/dev/nonexistent')).toBe(false);
    });

    it('should have ino 0 for device stat', async () => {
      const stat = await fs.stat('/dev/null');
      expect(stat.ino).toBe(0);
    });

    it('should have size 0 for device stat', async () => {
      const stat = await fs.stat('/dev/null');
      expect(stat.size).toBe(0);
    });

    it('should have deviceName in metadata', async () => {
      const stat = await fs.stat('/dev/null');
      expect(stat.metadata.deviceName).toBe('null');
    });

    it('should throw ENOENT for stat on nonexistent device', async () => {
      await expect(fs.stat('/dev/nonexistent')).rejects.toThrow(FileSystemError);
    });
  });

  describe('device path edge cases', () => {
    it('should not treat /dev as device path for stat', async () => {
      // /dev 本身是 readdir 的特殊路径，不是设备
      const entries = await fs.readdir('/dev');
      expect(Array.isArray(entries)).toBe(true);
    });

    it('should not create files under /dev', async () => {
      await expect(fs.create('/dev/custom', 'data')).rejects.toThrow(FileSystemError);
    });

    it('should return false for nested device path', async () => {
      expect(await fs.exists('/dev/null/nested')).toBe(false);
    });
  });
});

describe('DeviceManager (unit)', () => {
  let manager: DeviceManager;

  beforeEach(() => {
    manager = new DeviceManager();
  });

  it('should register and retrieve device', () => {
    manager.register(nullDevice);
    expect(manager.has('null')).toBe(true);
    const device = manager.get('null');
    expect(device.name).toBe('null');
  });

  it('should throw EEXIST on duplicate register', () => {
    manager.register(nullDevice);
    expect(() => manager.register(nullDevice)).toThrow(FileSystemError);
  });

  it('should throw ENOENT when getting nonexistent device', () => {
    expect(() => manager.get('nonexistent')).toThrow(FileSystemError);
  });

  it('should unregister device', () => {
    manager.register(nullDevice);
    manager.unregister('null');
    expect(manager.has('null')).toBe(false);
  });

  it('should not throw when unregistering nonexistent device', () => {
    expect(() => manager.unregister('nonexistent')).not.toThrow();
  });

  it('should list registered devices', () => {
    manager.register(nullDevice);
    manager.register(zeroDevice);
    manager.register(randomDevice);
    const list = manager.list().sort();
    expect(list).toEqual(['null', 'random', 'zero']);
  });

  it('should list empty when no devices', () => {
    expect(manager.list()).toEqual([]);
  });

  it('should read from device', async () => {
    manager.register(zeroDevice);
    const data = await manager.read('zero', 10);
    expect(data).toBeInstanceOf(ArrayBuffer);
    expect((data as ArrayBuffer).byteLength).toBe(10);
  });

  it('should write to device', async () => {
    manager.register(nullDevice);
    const written = await manager.write('null', 'test data');
    expect(written).toBeGreaterThan(0);
  });

  it('should throw EACCES when reading non-readable device', async () => {
    const writeOnly: DeviceDriver = {
      name: 'wo',
      async write(data) { return 0; },
    };
    manager.register(writeOnly);
    await expect(manager.read('wo')).rejects.toThrow(FileSystemError);
  });

  it('should throw EACCES when writing non-writable device', async () => {
    const readOnly: DeviceDriver = {
      name: 'ro',
      async read() { return new ArrayBuffer(0); },
    };
    manager.register(readOnly);
    await expect(manager.write('ro', 'data')).rejects.toThrow(FileSystemError);
  });

  it('should throw ENOTTY when ioctl not supported', async () => {
    manager.register(nullDevice);
    // nullDevice has ioctl, but let's test one without
    const noIoctl: DeviceDriver = { name: 'noioc' };
    manager.register(noIoctl);
    await expect(manager.ioctl('noioc', 'CMD')).rejects.toThrow(FileSystemError);
  });

  it('should call ioctl on device', async () => {
    manager.register(nullDevice);
    const result = await manager.ioctl('null', 'ANY');
    expect(result).toBeNull();
  });

  it('should use default read size', async () => {
    manager.register(zeroDevice);
    const data = await manager.read('zero');
    expect((data as ArrayBuffer).byteLength).toBe(4096);
  });
});
