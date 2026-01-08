/**
 * @file vfs-ui/mappers/NodeMapper.ts
 * @desc Maps data structures from vfs-core to vfs-ui's internal view models.
 */
import type { VFSNodeUI } from '../types/types.js';
import type { EngineNode } from '@itookit/common';
import type { IconResolver, ContentParserResolver, ParseResult } from '../services/IFileTypeRegistry';
import { parseFileInfo } from '../utils/parser.js';
import { isHiddenFile, stripExtension, getExtension } from '../utils/helpers';

/**
 * 将通用的 EngineNode 转换为 UI VFSNodeUI
 * 
 * @param node 引擎节点
 * @param iconResolver 注入的图标解析器 (来自 FileTypeRegistry)
 */
export const mapEngineNodeToUIItem = (
    node: EngineNode,
    iconResolver?: IconResolver,
    parserResolver?: ContentParserResolver
): VFSNodeUI => {
    const isDirectory = node.type === 'directory';

    // Parse content
    let parsedInfo: ParseResult = { summary: '', searchableText: '', headings: [], metadata: {} };
    if (!isDirectory && node.content) {
        const contentStr = typeof node.content === 'string' ? node.content : '';
        const customParser = parserResolver?.(node.name);
        
        if (customParser) {
            const ext = getExtension(node.name);
            parsedInfo = { ...parseFileInfo(contentStr), ...customParser(contentStr, ext) };
        } else {
            parsedInfo = parseFileInfo(contentStr);
        }
    }

    // Display title
    const displayTitle = (node.metadata?.title as string) || (isDirectory ? node.name : stripExtension(node.name));

    // Icon
    const displayIcon = node.icon || (iconResolver?.(node.name, isDirectory) ?? (isDirectory ? '📁' : '📄'));

    // Custom metadata
    const customMetadata = {
        ...(node.metadata || {}),
        ...parsedInfo.metadata,
        _originalName: node.name,
        _extension: (!isDirectory && node.name.includes('.')) ? getExtension(node.name) : ''
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
        children: isDirectory && node.children
            ? mapEngineTreeToUIItems(node.children, iconResolver, parserResolver)
            : undefined,
    };
};

export const mapEngineTreeToUIItems = (
    nodes: EngineNode[],
    iconResolver?: IconResolver,
    parserResolver?: ContentParserResolver
): VFSNodeUI[] => 
    nodes?.filter(n => !isHiddenFile(n.name)).map(n => mapEngineNodeToUIItem(n, iconResolver, parserResolver)) || [];
