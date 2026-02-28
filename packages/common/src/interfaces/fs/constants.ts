// common/interfaces/fs/constants.ts
/**
 * @file common/interfaces/fs/constants.ts
 * @desc 文件系统常量定义
 */

/** 配置文件系统的保留模块名 */
export const CONFIG_MODULE = '__config' as const;

/** 系统元数据模块名 */
export const META_MODULE = '__vfs_meta__' as const;

/** 系统保留模块名列表（不可被用户创建或删除） */
export const SYSTEM_MODULES = [CONFIG_MODULE, META_MODULE] as const;
