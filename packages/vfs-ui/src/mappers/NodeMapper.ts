/**
 * @file vfs-ui/mappers/NodeMapper.ts
 * @desc Maps data structures from vfs-core to vfs-ui's internal view models.
 * This module acts as a dedicated transformation layer.
 */
import type { VFSNodeUI } from '../types/types.js';
import { parseFileInfo } from '../utils/parser.js';
import type { EngineNode } from '@itookit/common';

/**
 * 将通用的 EngineNode 转换为 UI VFSNodeUI
 */
export function mapEngineNodeToUIItem(node: EngineNode): VFSNodeUI {
    const isDirectory = node.type === 'directory';

    const parsedInfo = isDirectory 
        ? { summary: '', searchableText: '', headings: [], metadata: {} } 
        : parseFileInfo(node.content as string);

    return {
        id: node.id,
        type: isDirectory ? 'directory' : 'file',
        version: "1.0",
        
        // [新增] 映射图标
        icon: node.icon,

        metadata: {
            title: node.name,
            tags: node.tags || [],
            createdAt: new Date(node.createdAt).toISOString(),
            lastModified: new Date(node.modifiedAt).toISOString(),
            parentId: node.parentId,
            path: node.path,
            moduleId: node.moduleId,
            custom: {
                ...(node.metadata || {}),
                ...parsedInfo.metadata,
            },
        },

        content: isDirectory ? undefined : {
            format: (node.metadata?.contentType as string) || 'text/markdown',
            summary: parsedInfo.summary,
            searchableText: parsedInfo.searchableText,
            data: node.content, 
        },
        
        headings: parsedInfo.headings || [],

        children: (isDirectory && node.children)
            ? node.children.map(child => mapEngineNodeToUIItem(child))
            : undefined,
    };
}

export function mapEngineTreeToUIItems(nodes: EngineNode[]): VFSNodeUI[] {
    if (!nodes || nodes.length === 0) return [];
    return nodes.map(node => mapEngineNodeToUIItem(node));
}
