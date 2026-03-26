/**
 * @file common/interfaces/fs/constants.ts
 * @desc 全局常量
 */

/** 配置模块名（始终自动挂载，存储所有系统级配置） */
export const CONFIG_MODULE = 'etc';

/** 系统保留目录 */
export const SYSTEM_DIRS = ['etc', 'dev', 'module'] as const;

/** AssetDir 名称前缀（单下划线，如 _note.md/） */
export const ASSET_DIR_PREFIX = '_';

/** 模块内部配置目录前缀（双下划线，如 __meta/）*/
export const INTERNAL_DIR_PREFIX = '__';

/** 隐藏文件前缀 */
export const HIDDEN_FILE_PREFIX = '.';

/** Symlink 解析最大深度 */
export const DEFAULT_MAX_SYMLINK_DEPTH = 40;

/**
 * 默认文件名校验正则
 * - 单 `_` 前缀（assetdir）：禁止用户创建，由系统代码直接写入 inode
 * - 双 `__` 前缀（模块内部配置目录 __config/）：允许，但默认不列出
 * - `.` 前缀（隐藏文件）：由 AccessController 检查权限，此处不拦截
 */
export const DEFAULT_FILENAME_PATTERN = /^(?!_(?!_))[^/\\][^/\\]*$/;

/** 默认搜索返回数量 */
export const DEFAULT_SEARCH_LIMIT = 50;
