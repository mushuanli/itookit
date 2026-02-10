// core/helper/device-routing.ts
import type { DeviceManager } from '../../device/manager';

/**
 * 设备路径工具 —— 判断和提取 /dev/xxx 路径
 */
export class DeviceRouting {
  constructor(private readonly deviceManager: DeviceManager) {}

  isDevicePath(path: string): boolean {
    return path === '/dev' || path.startsWith('/dev/');
  }

  extractDeviceName(path: string): string | null {
    if (!path.startsWith('/dev/')) return null;
    const name = path.slice(5);
    if (!name || name.includes('/')) return null;
    if (this.deviceManager.has(name)) return name;
    return null;
  }
}
