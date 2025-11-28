/**
 * @file vfs-ui/mappers/NodeMapper.ts
 * @desc Maps data structures from vfs-core to vfs-ui's internal view models.
 * This module acts as a dedicated transformation layer.
 */
import type { VFSNodeUI } from '../types/types.js';
import { parseFileInfo } from '../utils/parser.js';
import type { EngineNode } from '@itookit/common';

// [新增] 文件类型图标映射表
const ICON_MAP: Record<string, string> = {
    '.md': '📝',
    '.txt': '📄',
    '.js': '☕',
    '.ts': '📘',
    '.json': '📦',
    '.html': '🌐',
    '.css': '🎨',
    '.png': '🖼️',
    '.jpg': '🖼️',
    '.jpeg': '🖼️',
    '.gif': '🖼️',
    '.svg': '📐',
    'folder': '📁',
    'default': '📄'
};

/**
 * [新增] 判断是否为隐藏文件 (以 . 或 __ 开头)
 */
function isHiddenFile(name: string): boolean {
    return name.startsWith('.') || name.startsWith('__');
}

/**
 * [新增] 移除文件扩展名用于显示
 */
function stripExtension(name: string): string {
    const lastDotIndex = name.lastIndexOf('.');
    // 如果没有点，或者是隐藏文件（点在开头），则不移除
    if (lastDotIndex <= 0) return name;
    return name.substring(0, lastDotIndex);
}

/**
 * [新增] 根据文件名获取图标
 */
function getIconForExtension(filename: string): string {
    const ext = filename.includes('.') ? filename.substring(filename.lastIndexOf('.')).toLowerCase() : '';
    return ICON_MAP[ext] || ICON_MAP['default'];
}

/**
 * 将通用的 EngineNode 转换为 UI VFSNodeUI
 */
export function mapEngineNodeToUIItem(node: EngineNode): VFSNodeUI {
    const isDirectory = node.type === 'directory';

    const parsedInfo = isDirectory 
        ? { summary: '', searchableText: '', headings: [], metadata: {} } 
        : parseFileInfo(node.content as string);

    // [优化] 1. 计算显示标题：移除扩展名
    const displayTitle = isDirectory ? node.name : stripExtension(node.name);

    // [优化] 2. 决定图标：优先使用 Node 自带，否则根据扩展名或目录类型计算
    const displayIcon = node.icon || (isDirectory ? ICON_MAP['folder'] : getIconForExtension(node.name));

    // [优化] 3. 保存原始文件名和扩展名到 custom metadata，以便重命名时使用
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
            // [优化] 递归映射时应用过滤逻辑
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