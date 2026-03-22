/**
 * @file common/interfaces/fs/IAssetOperations.ts
 * @desc 资产目录操作子接口
 *
 * 通过 IModuleFS.assets 访问（当 capabilities.assets === true）。
 * 资产目录约定：文件 filename.ext 的资产目录为同级 .filename.ext/
 */

import type { FSNode } from './types';

export interface IAssetOperations {
    /**
     * 创建资产文件
     *
     * 仅适用于文件类节点（file / seqfile）。
     * 对目录节点调用抛出 FSError('NOT_A_FILE')。
     *
     * 资产目录命名约定：同级 . + 文件全名
     *   /notes/hello.md → /notes/.hello.md/
     *
     * @param ownerIdOrPath - 归属的文件节点（必须是 file 或 seqfile）
     * @param filename - 资产文件名
     * @param content - 内容
     * @throws FSError('NOT_A_FILE') - owner 不是文件类节点
     */
    createAsset(
        ownerIdOrPath: string,
        filename: string,
        content: string | ArrayBuffer
    ): Promise<FSNode>;

    /**
     * 获取文件的资产目录 ID
     * @param ownerIdOrPath - 文件节点
     * @returns 目录不存在返回 null
     */
    getAssetDirectoryId(ownerIdOrPath: string): Promise<string | null>;
}
