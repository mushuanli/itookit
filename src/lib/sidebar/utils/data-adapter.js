// #sidebar/utils/data-adapter.js

import { parseSessionInfo } from './session-parser.js';

/**
 * @file 数据适配器
 * @description 负责在 ConfigManager/ModuleRepository 的数据结构 (ModuleFSTreeNode) 
 *              和 Sidebar UI 的内部视图模型 (WorkspaceItem) 之间进行转换。
 */
export const dataAdapter = {

    /**
     * [SIMPLIFIED] 将 ModuleRepository 返回的单个节点转换为 Sidebar UI 可以渲染的 WorkspaceItem。
     * 此版本假定输入的 `node` 严格遵守 V2 格式，不提供任何回退。
     * @param {import('../../config/shared/types.js').ModuleFSTreeNode} node - 来自 ModuleRepository 的节点。
     * @returns {import('../types/types.js')._WorkspaceItem}
     */
    nodeToItem(node) {
        // 严格检查输入是否有效
        if (!node || !node.meta?.id) {
            console.error('[data-adapter] 节点无效或缺少必需的 meta.id 字段', node);
            return null;
        }
        
        const isFolder = node.type === 'directory';
        // 直接从 path 获取标题，不再有备用方案
        const title = node.path === '/' ? '根目录' : node.path.split('/').pop();
        const content = node.content || '';
        
        const parsedInfo = isFolder 
            ? { summary: '', searchableText: '', headings: [], metadata: {} } 
            : parseSessionInfo(content);

        return {
            id: node.meta.id,
            type: isFolder ? 'folder' : 'item',
            version: "1.0",
            metadata: {
                // 直接从 V2 结构的唯一来源读取，不再有 "||" 回退
                title: title,
                tags: node.meta.tags || [],
                createdAt: node.meta.ctime,
                lastModified: node.meta.mtime,
                parentId: null, // parentId 在 treeToItems 的递归中设置
                custom: parsedInfo.metadata
            },
            content: isFolder ? undefined : {
                format: 'markdown',
                summary: parsedInfo.summary,
                searchableText: parsedInfo.searchableText,
                data: content
            },
            headings: parsedInfo.headings,
            // [核心修复] 不再递归处理 children。
            // 仅保留 children 属性（如果存在），以便 treeToItems 处理。
            children: node.children ? [] : undefined
        };
    },

    /**
     * 将整个 ModuleFSTree 递归转换为 WorkspaceItem 数组，并正确设置 parentId。
     * @param {import('../../config/shared/types.js').ModuleFSTree} tree - 模块文件系统树的根节点。
     * @returns {import('../types/types.js')._WorkspaceItem[]}
     */
    treeToItems(tree) {
        if (!tree || !tree.children) return [];

        const processNode = (node, parentId) => {
            const item = this.nodeToItem(node);
            if (!item) return null;

            item.metadata.parentId = parentId;

            if (node.children && item.type === 'folder') {
                item.children = node.children
                    .map(childNode => processNode(childNode, item.id))
                    .filter(Boolean);
            }
            return item;
        };

        return tree.children
            .map(childNode => processNode(childNode, tree.meta.id))
            .filter(Boolean);
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
