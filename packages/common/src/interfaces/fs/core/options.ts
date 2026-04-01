/**
 * @file common/interfaces/fs/core/options.ts
 * @desc 操作选项
 *
 * 每个操作使用独立选项接口（ISP），
 * 默认值由实现方定义（CoC），此处通过 JSDoc 标注。
 */

import type { FSNodeType, FSNodeMetadata } from './types';

export interface ReadOptions {
    /** 起始偏移（需要 capabilities.partialRead） */
    offset?: number;
    /** 读取长度（需要 capabilities.partialRead） */
    length?: number;
    /**
     * 编码提示
     * - 'utf-8': 返回 string
     * - 'binary': 返回 ArrayBuffer
     * - 'auto': 由实现根据 mimeType/扩展名决定
     * @default 'auto'
     */
    encoding?: 'utf-8' | 'binary' | 'auto';
    /** 设备会话 ID（仅设备文件有效） */
    deviceSessionId?: string;
}

export interface WriteOptions {
    /** 起始偏移（需要 capabilities.partialWrite） */
    offset?: number;
    /**
     * 写入模式
     * @default 'overwrite'
     */
    mode?: 'overwrite' | 'append';
    /**
     * 乐观锁：期望的版本号
     * 不匹配时抛出 FSConflictError
     * 不传则不检查版本
     */
    expectedVersion?: number;
    /** 设备会话 ID（仅设备文件有效） */
    deviceSessionId?: string;
    /** 同时更新元数据 */
    metadata?: Partial<FSNodeMetadata>;
}

export interface CreateFileOptions {
    name: string;
    parentIdOrPath: string | null;
    content?: string | ArrayBuffer;
    metadata?: FSNodeMetadata;
    tags?: string[];
    icon?: string;
    /** @default 'file' */
    type?: FSNodeType;
    /**
     * 是否递归创建中间目录
     * @default false
     */
    recursive?: boolean;
    /**
     * 已存在时是否覆盖
     * @default false
     */
    overwrite?: boolean;
}

export interface CreateDirectoryOptions {
    name: string;
    parentIdOrPath: string | null;
    metadata?: FSNodeMetadata;
    icon?: string;
    /**
     * 是否递归创建中间目录
     * @default false
     */
    recursive?: boolean;
}

export interface DeleteOptions {
    /**
     * AssetDir 处理策略
     * - 'remove': 同时删除 assetdir 及其全部内容（默认）
     * - 'orphan': 保留目录但降级为普通目录
     * - 'keep':   完全不处理 assetdir
     * @default 'remove'
     */
    assetDirStrategy?: 'remove' | 'orphan' | 'keep';
    /**
     * 删除目录时是否递归
     * @default false
     */
    recursive?: boolean;
    /**
     * 是否强制删除（忽略不存在等错误）
     * @default false
     */
    force?: boolean;
    /**
     * 引用处理策略
     * - 'clean': 清除所有关联的双向引用（默认）
     * - 'deny':  存在入向引用时拒绝删除
     * - 'ignore': 不处理引用（留下悬空引用）
     * @default 'clean'
     */
    referencePolicy?: 'clean' | 'deny' | 'ignore';
}

export interface RenameOptions {
    /**
     * 是否同步重命名 assetdir
     * @default true
     */
    syncAssetDir?: boolean;
}

export interface MoveOptions {
    /**
     * 是否同步移动 assetdir
     * @default true
     */
    syncAssetDir?: boolean;
}

export interface CopyOptions {
    /**
     * 已存在时是否覆盖
     * @default false
     */
    overwrite?: boolean;
    /**
     * 是否同时复制 assetdir
     * @default true
     */
    copyAssetDir?: boolean;
    /**
     * 是否递归创建中间目录
     * @default false
     */
    recursive?: boolean;
}

export interface ListOptions {
    /**
     * 包含隐藏文件（. 开头）
     * @default false
     */
    includeHidden?: boolean;
    /**
     * 包含 assetdir（单下划线前缀，如 _note.md/）
     * @default false
     */
    includeAssetDirs?: boolean;
    /**
     * 包含模块内部配置目录（双下划线前缀，如 __meta/）
     * @default false
     */
    includeInternalDirs?: boolean;
    /**
     * 返回字段控制
     *
     * - 'full': 返回完整 FSNode（默认）
     * - 'entry': 仅返回 DirEntry（轻量）
     *
     * @default 'full'
     */
    fields?: 'full' | 'entry';
}

export interface TreeWalkOptions {
    /**
     * 遍历顺序
     * @default 'depth-first'
     */
    order?: 'breadth-first' | 'depth-first';
    /**
     * 最大深度，-1 无限制
     * @default -1
     */
    maxDepth?: number;
    /** 起始目录 @default 模块根目录 */
    rootIdOrPath?: string;
    /** 类型过滤 */
    typeFilter?: FSNodeType | FSNodeType[];
    /** 最大返回数量 */
    limit?: number;
    /**
     * 包含隐藏文件
     * @default false
     */
    includeHidden?: boolean;
    /**
     * 包含 asset 目录（单 _ 前缀）
     * @default false
     */
    includeAssetDirs?: boolean;
    /**
     * 包含模块内部配置目录（双 __ 前缀）
     * @default false
     */
    includeInternalDirs?: boolean;
}

/**
 * 树遍历回调
 * @returns true/void 继续 | false 停止 | 'skip' 跳过子树
 */
export type TreeWalkCallback = (
    node: import('./types').FSNode,
    depth: number,
) => boolean | void | 'skip' | Promise<boolean | void | 'skip'>;
