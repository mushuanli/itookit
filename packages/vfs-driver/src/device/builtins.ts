// @vfs-driver/device/builtins.ts

import type { DeviceDriver } from '../interface/device';

function byteLength(data: string | ArrayBuffer | Uint8Array): number {
  if (typeof data === 'string') return new TextEncoder().encode(data).byteLength;
  if (data instanceof ArrayBuffer) return data.byteLength;
  return data.byteLength;
}

export const nullDevice: DeviceDriver = {
  name: 'null',
  async read(_size: number) {
    return new ArrayBuffer(0);
  },
  async write(data) {
    return byteLength(data);
  },
  async ioctl() {
    return null;
  },
};

export const zeroDevice: DeviceDriver = {
  name: 'zero',
  async read(size: number) {
    return new ArrayBuffer(size); // 默认全 0
  },
  async write(data) {
    return byteLength(data);
  },
};

export const randomDevice: DeviceDriver = {
  name: 'random',
  async read(size: number) {
    const buf = new Uint8Array(size);
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
      crypto.getRandomValues(buf);
    } else {
      for (let i = 0; i < size; i++) {
        buf[i] = Math.floor(Math.random() * 256);
      }
    }
    return buf.buffer;
  },
  async write(data) {
    return byteLength(data);
  },
};

export const builtinDevices: DeviceDriver[] = [nullDevice, zeroDevice, randomDevice];
