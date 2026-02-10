// @vfs-driver/interface/device.ts

import type { FileContent } from './types';

/**
 * 设备驱动接口 —— 所有设备必须实现
 */
export interface DeviceDriver {
  readonly name: string;
  open?(): Promise<void>;
  close?(): Promise<void>;
  read?(size: number): Promise<FileContent>;
  write?(data: FileContent): Promise<number>;
  ioctl?(command: string | number, arg?: unknown): Promise<unknown>;
}

/**
 * 设备管理器接口
 */
export interface IDeviceManager {
  register(driver: DeviceDriver): void;
  unregister(name: string): void;
  has(name: string): boolean;
  get(name: string): DeviceDriver;
  list(): string[];
  read(name: string, size?: number): Promise<FileContent>;
  write(name: string, data: FileContent): Promise<number>;
  ioctl(name: string, command: string | number, arg?: unknown): Promise<unknown>;
}
