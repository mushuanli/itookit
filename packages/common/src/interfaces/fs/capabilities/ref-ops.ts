/**
 * @file common/interfaces/fs/capabilities/ref-ops.ts
 * @desc 双向引用操作子接口
 *
 * 通过 IModuleFS.refs 访问（当 capabilities.references === true）。
 */

import type { RefType, Reference } from '../core/types';

export interface RefQueryOptions {
    refTypes?: RefType[];
    limit?: number;
    offset?: number;
}

export interface IRefOperations {
    /** 添加引用 */
    addRef(
        sourceIdOrPath: string,
        targetIdOrPath: string,
        refType: RefType,
        extra?: Record<string, unknown>,
    ): Promise<void>;

    /** 移除引用 */
    removeRef(
        sourceIdOrPath: string,
        targetIdOrPath: string,
        refType: RefType,
    ): Promise<void>;

    /** 查询正向引用 */
    getOutgoing(idOrPath: string, opts?: RefQueryOptions): Promise<Reference[]>;

    /** 查询反向引用（backlinks） */
    getIncoming(idOrPath: string, opts?: RefQueryOptions): Promise<Reference[]>;

    /** 检查引用是否存在 */
    hasRef(
        sourceIdOrPath: string,
        targetIdOrPath: string,
        refType: RefType,
    ): Promise<boolean>;

    /**
     * 全量同步正向引用
     * 替换 source 的所有出向引用为新列表。
     * 用于内容解析后批量更新。
     */
    syncOutgoing(
        sourceIdOrPath: string,
        refs: Array<{
            targetIdOrPath: string;
            refType: RefType;
            extra?: Record<string, unknown>;
        }>,
    ): Promise<void>;
}
