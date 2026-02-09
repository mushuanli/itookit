// @vfs-driver/device/manager.ts

import type { DeviceDriver, IDeviceManager } from '../interface/device';
import type { FileContent } from '../interface/types';
import { FileSystemError } from '../core/errors';

export class DeviceManager implements IDeviceManager {
  private drivers = new Map<string, DeviceDriver>();

  register(driver: DeviceDriver): void {
    if (this.drivers.has(driver.name)) {
      throw new FileSystemError(
        'EEXIST',
        `/dev/${driver.name}`,
        'Device already registered',
      );
    }
    this.drivers.set(driver.name, driver);
  }

  unregister(name: string): void {
    this.drivers.delete(name);
  }

  has(name: string): boolean {
    return this.drivers.has(name);
  }

  get(name: string): DeviceDriver {
    const driver = this.drivers.get(name);
    if (!driver) {
      throw new FileSystemError('ENOENT', `/dev/${name}`, 'Device not found');
    }
    return driver;
  }

  list(): string[] {
    return Array.from(this.drivers.keys());
  }

  async read(name: string, size: number = 4096): Promise<FileContent> {
    const driver = this.get(name);
    if (!driver.read) {
      throw new FileSystemError('EACCES', `/dev/${name}`, 'Device not readable');
    }
    return driver.read(size);
  }

  async write(name: string, data: FileContent): Promise<number> {
    const driver = this.get(name);
    if (!driver.write) {
      throw new FileSystemError('EACCES', `/dev/${name}`, 'Device not writable');
    }
    return driver.write(data);
  }

  async ioctl(name: string, command: string | number, arg?: unknown): Promise<unknown> {
    const driver = this.get(name);
    if (!driver.ioctl) {
      throw new FileSystemError('ENOTTY', `/dev/${name}`, 'ioctl not supported');
    }
    return driver.ioctl(command, arg);
  }
}
