/**
 * @file vfs-ui/services/NodeMapper.ts
 * @desc Maps EngineNode → VFSNodeUI. Pure functions, no side effects.
 */
import type { EngineNode } from '@itookit/common';
import type { VFSNodeUI, ParseResult } from '../contracts/types';
import type { IconResolver, ContentParserResolver } from './FileTypeRegistry';
import { parseFileInfo } from '../utils/parser';
import { shouldFilterNode, stripExtension, getExtension } from '../utils/helpers';

export const mapEngineNodeToUIItem = (
  node: EngineNode,
  iconResolver?: IconResolver,
  parserResolver?: ContentParserResolver,
  showFileExtensions = false,
): VFSNodeUI => {
  const isDir = node.type === 'directory';

  let parsed: ParseResult = {
    summary: '', searchableText: '', headings: [], metadata: {},
  };

  if (!isDir && node.content) {
    const contentStr = typeof node.content === 'string' ? node.content : '';
    const customParser = parserResolver?.(node.name);
    parsed = customParser
      ? { ...parseFileInfo(contentStr), ...customParser(contentStr, getExtension(node.name)) }
      : parseFileInfo(contentStr);
  }

  // showFileExtensions: use full filename (e.g. "notes.md") for external FS mounts;
  // default: strip extension for display (e.g. "notes") for internal modules.
  const displayTitle =
    (node.metadata?.title as string) ||
    (isDir ? node.name : (showFileExtensions ? node.name : stripExtension(node.name)));
  const displayIcon =
    node.icon || iconResolver?.(node.name, isDir) || (isDir ? '📁' : '📄');

  return {
    id: node.id,
    type: isDir ? 'directory' : 'file',
    version: '1.0',
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
        _extension: !isDir && node.name.includes('.') ? getExtension(node.name) : '',
      },
    },
    content: isDir
      ? undefined
      : {
          format: (node.metadata?.contentType as string) || 'text/markdown',
          summary: parsed.summary,
          searchableText: parsed.searchableText,
          data: node.content,
        },
    headings: parsed.headings,
    children:
      isDir && node.children
        ? mapEngineTreeToUIItems(node.children, iconResolver, parserResolver)
        : undefined,
  };
};

export const mapEngineTreeToUIItems = (
  nodes: EngineNode[],
  iconResolver?: IconResolver,
  parserResolver?: ContentParserResolver,
  showFileExtensions = false,
): VFSNodeUI[] =>
  nodes
    ?.filter(n => !shouldFilterNode(n))
    .map(n => mapEngineNodeToUIItem(n, iconResolver, parserResolver, showFileExtensions)) || [];
