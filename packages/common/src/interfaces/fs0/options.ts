/**
 * @file common/interfaces/fs/options.ts
 * @desc 操作选项类型
 *
 * 重构要点：
 * - partialRead/partialWrite 分离命名
 * - WriteOptions 增加 expectedVersion（乐观锁）
 */

import type { FSNodeType } from './types';

export interface ReadOptions {
    /** 起始偏移（需要 capabilities.partialRead） */
    offset?: number;
    /** 读取长度（需要 capabilities.partialRead） */
    length?: number;
    /**
     * 编码提示
     * - 'utf-8': 返回 string
     * - 'binary': 返回 ArrayBuffer
     * - 'auto': 由实现根据扩展名决定（默认）
     */
    encoding?: 'utf-8' | 'binary' | 'auto';
    /** 设备会话 ID（仅设备文件有效） */
    deviceSessionId?: string;
}

export interface WriteOptions {
    /** 起始偏移（需要 capabilities.partialWrite） */
    offset?: number;
    /** 写入模式 @default 'overwrite' */
    mode?: 'overwrite' | 'append';
    /**
     * 乐观锁：期望的版本号
     * 不匹配时抛出 FSConflictError
     * 不传则不检查版本
     */
    expectedVersion?: number;
    /** 设备会话 ID（仅设备文件有效） */
    deviceSessionId?: string;
}

export interface CreateFileOptions {
    name: string;
    parentIdOrPath: string | null;
    content?: string | ArrayBuffer;
    metadata?: Record<string, unknown>;
    tags?: string[];
    icon?: string;
    /** @default 'file' */
    type?: FSNodeType;
}

export interface CreateDirectoryOptions {
    name: string;
    parentIdOrPath: string | null;
    metadata?: Record<string, unknown>;
    icon?: string;
}

export interface TreeWalkOptions {
    /** @default 'depth-first' */
    order?: 'breadth-first' | 'depth-first';
    /** 最大深度，-1 无限制 @default -1 */
    maxDepth?: number;
    /** 起始目录 @default 模块根目录 */
    rootIdOrPath?: string;
    typeFilter?: FSNodeType | FSNodeType[];
    limit?: number;
}

/**
 * 树遍历回调
 * @returns true/void 继续 | false 停止 | 'skip' 跳过子树
 */
export type TreeWalkCallback = (
    node: import('./types').FSNode,
    depth: number
) => boolean | void | 'skip';
