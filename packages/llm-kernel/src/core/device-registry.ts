// @file: llm-kernel/core/device-registry.ts
//
// 全局 IDeviceManager 持有者。
// 由应用层（main.ts）在 VFS 初始化完成后注入，
// AgentExecutor 通过 getKernelDeviceManager() 获取设备管理器。

import type { IDeviceManager } from '@itookit/common';

let _deviceManager: IDeviceManager | null = null;

/**
 * 注入设备管理器。应在应用启动时调用一次。
 *
 * @example
 * // apps/web-app/src/main.ts
 * setKernelDeviceManager(vfsCore.devices);
 */
export function setKernelDeviceManager(dm: IDeviceManager): void {
    _deviceManager = dm;
}

/**
 * 获取已注入的设备管理器。未注入时返回 null。
 * AgentExecutor 用此函数判断是否走设备驱动路径。
 */
export function getKernelDeviceManager(): IDeviceManager | null {
    return _deviceManager;
}
