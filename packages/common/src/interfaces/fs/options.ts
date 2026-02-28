// common/interfaces/fs/options.ts
/**
 * @file common/interfaces/fs/options.ts
 * @desc 文件系统操作的选项类型
 *
 * 设计原则:
 * - 超过2个参数时使用 options 对象
 * - 所有字段均可选，提供合理默认值
 * - 为未来扩展预留空间而不破坏签名
 */

import type { FSNode, FSNodeType } from './types';

// ═══════════════════════════════════════════════════════════════
// 读写选项
// ═══════════════════════════════════════════════════════════════

/**
 * 文件读取选项
 */
export interface ReadOptions {
    /**
     * 起始字节偏移量
     * 需要 capabilities.partialRead === true
     * @default 0
     */
    offset?: number;

    /**
     * 读取长度（字节数）
     * 需要 capabilities.partialRead === true
     * @default 到文件末尾
     */
    length?: number;

    /**
     * 编码提示
     * - 'utf-8': 返回 string
     * - 'binary': 返回 ArrayBuffer
     * - 'auto': 由实现根据文件扩展名决定（默认）
     */
    encoding?: 'utf-8' | 'binary' | 'auto';
}

/**
 * 文件写入选项
 */
export interface WriteOptions {
    /**
     * 起始字节偏移量（用于部分写入）
     * 需要 capabilities.partialRead === true（复用同一能力标志）
     */
    offset?: number;

    /**
     * 写入模式
     * - 'overwrite': 覆盖整个文件（默认）
     * - 'append': 追加到文件末尾
     */
    mode?: 'overwrite' | 'append';
}

// ═══════════════════════════════════════════════════════════════
// 创建选项
// ═══════════════════════════════════════════════════════════════

/**
 * 创建文件选项
 */
export interface CreateFileOptions {
    /** 文件名（含扩展名，如 'hello.md'） */
    name: string;

    /** 父目录 ID 或路径，null 表示模块根目录 */
    parentIdOrPath: string | null;

    /** 初始内容 */
    content?: string | ArrayBuffer;

    /** 初始元数据 */
    metadata?: Record<string, unknown>;

    /** 初始标签 */
    tags?: string[];

    /** 自定义图标 (Emoji 或 URL) */
    icon?: string;

    /**
     * 节点类型
     * @default 'file'
     * 允许创建 'seqfile' 等扩展类型
     */
    type?: FSNodeType;
}

/**
 * 创建目录选项
 */
export interface CreateDirectoryOptions {
    /** 目录名称 */
    name: string;

    /** 父目录 ID 或路径，null 表示模块根目录 */
    parentIdOrPath: string | null;

    /** 初始元数据 */
    metadata?: Record<string, unknown>;

    /** 自定义图标 */
    icon?: string;
}

// ═══════════════════════════════════════════════════════════════
// 树遍历选项
// ═══════════════════════════════════════════════════════════════

/**
 * 树遍历选项
 */
export interface TreeWalkOptions {
    /**
     * 遍历策略
     * @default 'depth-first'
     */
    order?: 'breadth-first' | 'depth-first';

    /**
     * 最大遍历深度
     * - 0: 仅起始目录的直接子节点
     * - -1: 无限制（默认）
     */
    maxDepth?: number;

    /**
     * 起始目录的 ID 或路径
     * @default 模块根目录
     */
    rootIdOrPath?: string;

    /** 节点类型过滤 */
    typeFilter?: FSNodeType | FSNodeType[];

    /** 最大返回节点数 */
    limit?: number;
}

/**
 * 树遍历回调
 *
 * @param node - 当前节点
 * @param depth - 当前深度（起始目录的直接子节点 = 0）
 * @returns
 *   - true / void: 继续遍历
 *   - false: 停止整个遍历
 *   - 'skip': 跳过此节点的子树（仅深度优先有效）
 */
export type TreeWalkCallback = (
    node: FSNode,
    depth: number
) => boolean | void | 'skip';
