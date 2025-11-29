/**
 * @file vfs-ui/mappers/NodeMapper.ts
 * @desc Maps data structures from vfs-core to vfs-ui's internal view models.
 */
import type { VFSNodeUI } from '../types/types.js';
import { parseFileInfo } from '../utils/parser.js';
import type { EngineNode } from '@itookit/common';
import type { IconResolver } from '../services/IFileTypeRegistry'; // 引入类型

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
    if (lastDotIndex <= 0) return name;
    return name.substring(0, lastDotIndex);
}

/**
 * 将通用的 EngineNode 转换为 UI VFSNodeUI
 * 
 * @param node 引擎节点
 * @param iconResolver 注入的图标解析器 (来自 FileTypeRegistry)
 */
export function mapEngineNodeToUIItem(node: EngineNode, iconResolver?: IconResolver): VFSNodeUI {
    const isDirectory = node.type === 'directory';

    const parsedInfo = isDirectory 
        ? { summary: '', searchableText: '', headings: [], metadata: {} } 
        : parseFileInfo(node.content as string);

    // 1. 计算显示标题
    const displayTitle = isDirectory ? node.name : stripExtension(node.name);

    // 2. 决定图标 (优先级逻辑)
    // 优先级 1: Node 自带 Metadata (node.icon)
    // 优先级 2: 通过 iconResolver 查注册表 (Registry -> Default)
    // 优先级 3: 如果没有 resolver，使用硬编码兜底 (Folder/File)
    let displayIcon = node.icon;
    
    if (!displayIcon) {
        if (iconResolver) {
            displayIcon = iconResolver(node.name, isDirectory);
        } else {
            // 极端的兜底，防止调用方没传 resolver
            displayIcon = isDirectory ? '📁' : '📄'; 
        }
    }

    // 3. 保存原始文件名和扩展名
    const customMetadata = {
        ...(node.metadata || {}),
        ...parsedInfo.metadata,
        _originalName: node.name,
        _extension: (!isDirectory && node.name.includes('.')) 
            ? node.name.substring(node.name.lastIndexOf('.')) 
            : ''
    };

    return {
        id: node.id,
        type: isDirectory ? 'directory' : 'file',
        version: "1.0",
        
        icon: displayIcon,

        metadata: {
            title: displayTitle,
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
            ? mapEngineTreeToUIItems(node.children, iconResolver) // 递归传递
            : undefined,
    };
}

export function mapEngineTreeToUIItems(nodes: EngineNode[], iconResolver?: IconResolver): VFSNodeUI[] {
    if (!nodes || nodes.length === 0) return [];

    const visibleNodes = nodes.filter(node => !isHiddenFile(node.name));

    return visibleNodes.map(node => mapEngineNodeToUIItem(node, iconResolver));
}