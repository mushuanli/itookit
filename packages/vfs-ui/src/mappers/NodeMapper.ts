/**
 * @file vfs-ui/mappers/NodeMapper.ts
 * @desc Maps data structures from vfs-core to vfs-ui's internal view models.
 * This module acts as a dedicated transformation layer.
 */

// --- 核心依赖类型 ---
// 从 vfs-core 导入源数据类型
import type { VNode } from '@itookit/vfs-core';
// VNodeType 是一个 enum 或常量对象，需要作为值导入
import { VNodeType } from '@itookit/vfs-core'; 

// --- UI 内部类型 ---
// 从 vfs-ui 导入目标数据类型
import type { VFSNodeUI, FileMetadata } from '../types/types.js';

// --- 工具函数 ---
// 导入内容解析工具
import { parseFileInfo } from '../utils/parser.js';

// [修正] 定义一个临时的、扩展了 VNode 的类型，用于映射
// 这个类型代表了在 VFSUIManager._loadModuleData 中被动态增强后的 VNode
interface VNodeWithContentAndChildren extends VNode {
    content?: string | ArrayBuffer;
    children?: VNode[];
}

/**
 * 将单个 vfs-core VNode 转换为 UI 使用的 VFSNodeUI 格式。
 *
 * @param vnode - The source VNode object from vfs-core, pre-loaded with content and children.
 * @param parentId - The ID of the parent node.
 * @returns A VFSNodeUI object ready for use in the UI store and components.
 */
export function mapVNodeToUIItem(vnode: VNodeWithContentAndChildren, parentId: string | null): VFSNodeUI {
    const isDirectory = vnode.type === VNodeType.DIRECTORY;

    const parsedInfo = isDirectory 
        ? { summary: '', searchableText: '', headings: [], metadata: {} as FileMetadata } 
        : parseFileInfo(vnode.content as string);

    return {
        id: vnode.nodeId,
        type: isDirectory ? 'directory' : 'file',
        version: "1.0",

        metadata: {
            title: vnode.name,
            tags: vnode.tags || [],
            createdAt: new Date(vnode.createdAt).toISOString(),
            lastModified: new Date(vnode.modifiedAt).toISOString(),
            parentId: parentId,
            path: vnode.path,
            // [新增] 映射模块ID，有助于UI在多模块搜索中显示上下文
            moduleId: vnode.moduleId || undefined,
            custom: {
                ...(vnode.metadata || {}),
                ...parsedInfo.metadata,
            },
        },

        content: isDirectory ? undefined : {
            // [修正] contentType 不在 VNode 顶层，尝试从 metadata 获取或提供默认值
            format: (vnode.metadata?.contentType as string) || 'text/markdown',
            summary: parsedInfo.summary,
            searchableText: parsedInfo.searchableText,
            // [修正] 安全访问 content
            data: vnode.content, 
        },
        
        headings: parsedInfo.headings || [],

        // [修正] 递归映射子节点
        children: (isDirectory && vnode.children)
            ? vnode.children.map(child => mapVNodeToUIItem(child, vnode.nodeId))
            : undefined,
    };
}

/**
 * 将一个 VNode 树（通常来自 vfsCore.getTree()）完整地转换为 VFSNodeUI 树。
 *
 * @param vnodeTree - An array of root VNode objects.
 * @returns An array of root VFSNodeUI objects, forming a complete tree.
 */
export function mapVNodeTreeToUIItems(vnodeTree: VNode[]): VFSNodeUI[] {
    if (!vnodeTree || vnodeTree.length === 0) {
        return [];
    }
    // 顶级节点的 parentId 为 null
    return vnodeTree.map(rootNode => mapVNodeToUIItem(rootNode, null));
}
