/**
 * @file common/interfaces/fs/capabilities/tag-ops.ts
 * @desc 标签操作子接口
 *
 * 通过 IModuleFS.tags 访问（当 capabilities.tags === true）。
 */

export interface TagDefinition {
    name: string;
    color?: string;
}

export interface ITagOperations {
    /** 获取本模块所有标签定义 */
    getAllTags(): Promise<TagDefinition[]>;

    /** 设置节点标签（全量替换，空数组清除） */
    setTags(idOrPath: string, tags: string[]): Promise<void>;

    /** 添加标签（增量） */
    addTag(idOrPath: string, tag: string): Promise<void>;

    /** 移除标签 */
    removeTag(idOrPath: string, tag: string): Promise<void>;

    /** 按标签查找节点 ID */
    findByTag(tag: string): Promise<string[]>;

    /** 更新标签定义（如颜色），不影响节点关联 */
    updateTagDefinition?(
        tagName: string,
        updates: Partial<Omit<TagDefinition, 'name'>>,
    ): Promise<void>;
}
