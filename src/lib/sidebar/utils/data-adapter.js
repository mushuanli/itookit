// #sidebar/utils/data-adapter.js

import { parseSessionInfo } from './session-parser.js';

/**
 * @file 数据适配器
 * @description 负责在 ConfigManager/ModuleRepository 的数据结构 (ModuleFSTreeNode) 
 *              和 Sidebar UI 的内部视图模型 (WorkspaceItem) 之间进行转换。
 */
export const dataAdapter = {

    /**
     * 将 ModuleRepository 返回的单个节点转换为 Sidebar UI 可以渲染的 WorkspaceItem。
     * @param {import('../../config/shared/types.js').ModuleFSTreeNode} node - 来自 ModuleRepository 的节点。
     * @returns {import('../types/types.js')._WorkspaceItem}
     */
    nodeToItem(node) {
        const isFolder = node.type === 'directory';
        const title = node.path.split('/').pop() || (node.path === '/' ? '根目录' : '未知项');
        const content = node.content || '';

        let parsedInfo = { summary: '', searchableText: '', headings: [], metadata: {} };
        if (!isFolder) {
            parsedInfo = parseSessionInfo(content);
        }

        return {
            id: node.meta.id, // [V2] 使用稳定ID作为唯一标识符
            type: isFolder ? 'folder' : 'item',
            version: "1.0",
            metadata: {
                title: title,
                tags: node.meta.tags || [],
                createdAt: node.meta.ctime,
                lastModified: node.meta.mtime,
                // parentId 暂时不直接从node获取，由treeToItems的递归过程赋予
                parentId: null, 
                custom: parsedInfo.metadata
            },
            content: isFolder ? undefined : {
                format: 'markdown',
                summary: parsedInfo.summary,
                searchableText: parsedInfo.searchableText,
                data: content
            },
            headings: parsedInfo.headings,
            children: isFolder ? (node.children || []).map(child => this.nodeToItem(child)) : undefined,
        };
    },

    /**
     * 将整个 ModuleFSTree 递归转换为 WorkspaceItem 数组，并正确设置 parentId。
     * @param {import('../../config/shared/types.js').ModuleFSTree} tree - 模块文件系统树的根节点。
     * @returns {import('../types/types.js')._WorkspaceItem[]}
     */
    treeToItems(tree) {
        if (!tree || !tree.children) return [];
        const processChildren = (children, parentId) => {
            return children.map(node => {
                const item = this.nodeToItem(node);
                item.metadata.parentId = parentId;
                if (item.children) {
                    item.children = processChildren(item.children, item.id);
                }
                return item;
            });
        };
        return processChildren(tree.children, tree.meta.id);
    },

    buildTagsMap(items) {
        const tagsMap = new Map();
        const traverse = (itemList) => {
            for (const item of itemList) {
                const itemTags = item.metadata.tags || [];
                for (const tagName of itemTags) {
                    if (!tagsMap.has(tagName)) {
                        tagsMap.set(tagName, { name: tagName, color: null, itemIds: new Set() });
                    }
                    tagsMap.get(tagName).itemIds.add(item.id);
                }
                if (item.children) {
                    traverse(item.children);
                }
            }
        };
        traverse(items);
        return tagsMap;
    }
};
