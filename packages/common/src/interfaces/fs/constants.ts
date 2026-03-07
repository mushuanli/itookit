/**
 * @file common/interfaces/fs/constants.ts
 */

/** 配置模块名 */
export const CONFIG_MODULE = '__config';

/** 设备模块名 */
export const DEV_MODULE = '__dev';

/**
 * 系统目录前缀
 *
 * 系统级目录结构：
 *   /__config/          → 全局配置
 *   /dev/               → 设备文件
 *   /module/<name>/     → 业务模块
 */
export const SYSTEM_DIRS = {
    CONFIG: '/__config',
    DEV: '/dev',
    MODULE: '/module',
} as const;

/** 保留模块名（不可被用户使用） */
export const RESERVED_MODULE_NAMES = new Set([
    CONFIG_MODULE,
    DEV_MODULE,
]);
