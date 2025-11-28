/**
 * @file vfs-ui/mappers/NodeMapper.ts
 * @desc Maps data structures from vfs-core to vfs-ui's internal view models.
 * This module acts as a dedicated transformation layer.
 */
import type { VFSNodeUI } from '../types/types.js';
import { parseFileInfo } from '../utils/parser.js';
import type { EngineNode } from '@itookit/common';

/**
 * 判断是否为隐藏文件 (以 . 或 __ 开头)
 */
function isHiddenFile(name: string): boolean {
    return name.startsWith('.') || name.startsWith('__');
}

/**
 * 移除文件扩展名用于显示
 */
function stripExtension(name: string): string {
    const lastDotIndex = name.lastIndexOf('.');
    // 如果没有点，或者是隐藏文件（点在开头），则不移除
    if (lastDotIndex <= 0) return name;
    return name.substring(0, lastDotIndex);
}

/**
 * 将通用的 EngineNode 转换为 UI VFSNodeUI
 */
export function mapEngineNodeToUIItem(node: EngineNode): VFSNodeUI {
    const isDirectory = node.type === 'directory';

    const parsedInfo = isDirectory 
        ? { summary: '', searchableText: '', headings: [], metadata: {} } 
        : parseFileInfo(node.content as string);

    // [优化] 处理显示标题：移除扩展名
    const displayTitle = isDirectory ? node.name : stripExtension(node.name);

    // 我们将原始带扩展名的全名保存在 custom metadata 中，以便重命名时恢复
    const customMetadata = {
        ...(node.metadata || {}),
        ...parsedInfo.metadata,
        _originalName: node.name, // 保存原始文件名
        _extension: node.name.includes('.') ? node.name.substring(node.name.lastIndexOf('.')) : ''
    };

    return {
        id: node.id,
        type: isDirectory ? 'directory' : 'file',
        version: "1.0",
        
        // [新增] 映射图标
        icon: node.icon,

        metadata: {
            title: displayTitle, // UI 显示无扩展名的标题
            tags: node.tags || [],
            createdAt: new Date(node.createdAt).toISOString(),
            lastModified: new Date(node.modifiedAt).toISOString(),
            parentId: node.parentId,
            path: node.path,
            moduleId: node.moduleId,
            custom: customMetadata,
        },

        content: isDirectory ? undefined : {
            format: (node.metadata?.contentType as string) || 'text/markdown',
            summary: parsedInfo.summary,
            searchableText: parsedInfo.searchableText,
            data: node.content, 
        },
        
        headings: parsedInfo.headings || [],

        children: (isDirectory && node.children)
            // [优化] 递归映射时也应用过滤
            ? mapEngineTreeToUIItems(node.children)
            : undefined,
    };
}

export function mapEngineTreeToUIItems(nodes: EngineNode[]): VFSNodeUI[] {
    if (!nodes || nodes.length === 0) return [];
    
    // [优化] 过滤掉隐藏文件/目录
    const visibleNodes = nodes.filter(node => !isHiddenFile(node.name));
    
    return visibleNodes.map(node => mapEngineNodeToUIItem(node));
}
