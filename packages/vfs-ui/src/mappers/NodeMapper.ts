/**
 * @file vfs-ui/mappers/NodeMapper.ts
 * @desc Maps data structures from vfs-core to vfs-ui's internal view models.
 */
import type { EngineNode } from '@itookit/common';
import type { VFSNodeUI, ParseResult } from '../types/types';
import type { IconResolver, ContentParserResolver } from '../services/IFileTypeRegistry';
import { parseFileInfo } from '../utils/parser';
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
  const isDir = node.type === 'directory';

  // Parse content
  let parsed: ParseResult = { summary: '', searchableText: '', headings: [], metadata: {} };
  if (!isDir && node.content) {
    const contentStr = typeof node.content === 'string' ? node.content : '';
    const customParser = parserResolver?.(node.name);
    parsed = customParser
      ? { ...parseFileInfo(contentStr), ...customParser(contentStr, getExtension(node.name)) }
      : parseFileInfo(contentStr);
  }

  const displayTitle = (node.metadata?.title as string) || (isDir ? node.name : stripExtension(node.name));
  const displayIcon = node.icon || iconResolver?.(node.name, isDir) || (isDir ? '📁' : '📄');

  return {
    id: node.id,
    type: isDir ? 'directory' : 'file',
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
      custom: {
        ...(node.metadata || {}),
        ...parsed.metadata,
        _originalName: node.name,
        _extension: (!isDir && node.name.includes('.')) ? getExtension(node.name) : ''
      },
    },
    content: isDir ? undefined : {
      format: (node.metadata?.contentType as string) || 'text/markdown',
      summary: parsed.summary,
      searchableText: parsed.searchableText,
      data: node.content,
    },
    headings: parsed.headings,
    children: isDir && node.children
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
