/**
 * @file common/interfaces/fs/constants.ts
 * @desc 全局常量
 */

/** __config 模块名（始终自动挂载） */
export const CONFIG_MODULE = '__config';

/** 系统保留目录 */
export const SYSTEM_DIRS = ['etc', 'dev', 'module'] as const;

/** AssetDir 名称前缀 */
export const ASSET_DIR_PREFIX = '_';

/** 隐藏文件前缀 */
export const HIDDEN_FILE_PREFIX = '.';

/** Symlink 解析最大深度 */
export const DEFAULT_MAX_SYMLINK_DEPTH = 40;

/** 默认文件名校验正则（禁止 . 和 _ 开头） */
export const DEFAULT_FILENAME_PATTERN = /^[^._/\\][^/\\]*$/;

/** 默认搜索返回数量 */
export const DEFAULT_SEARCH_LIMIT = 50;
