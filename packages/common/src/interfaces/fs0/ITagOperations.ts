/**
 * @file common/interfaces/fs/ITagOperations.ts
 * @desc 标签操作子接口
 *
 * 通过 IModuleFS.tags 访问（当 capabilities.tags === true）。
 */

export interface ITagOperations {
    /**
     * 获取本模块所有标签定义
     */
    getAllTags(): Promise<Array<{ name: string; color?: string }>>;

    /**
     * 设置节点标签（全量替换）
     * 空数组清除所有标签。
     *
     * @emits node:updated { changedFields: ['tags'] }
     */
    setTags(idOrPath: string, tags: string[]): Promise<void>;

    /**
     * 更新标签定义（如颜色）
     * 不影响节点关联关系。
     */
    updateTagDefinition?(
        tagName: string,
        updates: { color?: string }
    ): Promise<void>;
}
