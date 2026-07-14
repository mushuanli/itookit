// @file: llm-engine/core/device-registry.ts
//
// 全局 IDeviceManager 持有者（S8 迁移至 llm-engine）。
// 由应用层（main.ts）在 VFS 初始化完成后注入。

import type { IDeviceManager } from '@itookit/common';

let _deviceManager: IDeviceManager | null = null;

/**
 * 注入设备管理器。应在应用启动时调用一次。
 */
export function setKernelDeviceManager(dm: IDeviceManager): void {
    _deviceManager = dm;
}

/**
 * 获取已注入的设备管理器。未注入时返回 null。
 */
export function getKernelDeviceManager(): IDeviceManager | null {
    return _deviceManager;
}
