/**
 * @file vfs-ui/mappers/NodeMapper.ts
 * @desc Maps data structures from vfs-core to vfs-ui's internal view models.
 */
import type { VFSNodeUI } from '../types/types.js';
import { parseFileInfo } from '../utils/parser.js';
import type { EngineNode } from '@itookit/common';
// ✨ [Fix] 导入 ParseResult 接口
import type { IconResolver, ContentParserResolver, ParseResult } from '../services/IFileTypeRegistry';

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
export function mapEngineNodeToUIItem(
    node: EngineNode, 
    iconResolver?: IconResolver,
    parserResolver?: ContentParserResolver
): VFSNodeUI {
    const isDirectory = node.type === 'directory';

    // ✨ [Fix 2322] 显式指定类型为 ParseResult
    // 否则 headings: [] 会被推断为 headings: never[]，导致后续赋值报错
    let parsedInfo: ParseResult = { 
        summary: '', 
        searchableText: '', 
        headings: [], 
        metadata: {} 
    };

    if (!isDirectory && node.content) {
        const contentStr = typeof node.content === 'string' ? node.content : '';
        
        // 1. 尝试获取自定义解析器
        const customParser = parserResolver ? parserResolver(node.name) : undefined;
        
        if (customParser) {
            // [高亮] 使用自定义逻辑
            // 获取扩展名用于传递给 parser (可选)
            const ext = node.name.includes('.') ? node.name.substring(node.name.lastIndexOf('.')) : '';
            const customResult = customParser(contentStr, ext);
            
            // 合并默认值，防止自定义解析器返回不完整数据
            parsedInfo = {
                ...parseFileInfo(contentStr), // 基础解析作为兜底 (如 searchableText)
                ...customResult // 自定义结果覆盖
            };
        } else {
            // 2. 使用默认逻辑
            parsedInfo = parseFileInfo(contentStr);
        }
    }

    // --- 2. 计算显示标题 (修复 displayTitle 未定义错误) ---
    // ✨ [Fix 2304] 确保 displayTitle 在此处定义
    let displayTitle = '';
    if (node.metadata && typeof node.metadata.title === 'string' && node.metadata.title) {
        displayTitle = node.metadata.title;
    } else {
        displayTitle = isDirectory ? node.name : stripExtension(node.name);
    }

    // --- 3. 决定图标 (修复 displayIcon 未定义错误) ---
    // ✨ [Fix 2304] 确保 displayIcon 在此处定义
    let displayIcon = node.icon;
    
    if (!displayIcon) {
        if (iconResolver) {
            displayIcon = iconResolver(node.name, isDirectory);
        } else {
            // 兜底
            displayIcon = isDirectory ? '📁' : '📄'; 
        }
    }

    // --- 4. 构建元数据 ---
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
            ? mapEngineTreeToUIItems(node.children, iconResolver, parserResolver) // 递归传递
            : undefined,
    };
}

export function mapEngineTreeToUIItems(
    nodes: EngineNode[], 
    iconResolver?: IconResolver,
    parserResolver?: ContentParserResolver
): VFSNodeUI[] {
    if (!nodes || nodes.length === 0) return [];

    const visibleNodes = nodes.filter(node => !isHiddenFile(node.name));

    return visibleNodes.map(node => mapEngineNodeToUIItem(node, iconResolver, parserResolver));
}