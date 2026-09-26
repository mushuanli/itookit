/**
 * @file vfs-ui/services/NodeMapper.ts
 * @desc Maps FSNode → VFSNodeUI. Pure functions, no side effects.
 */
import type { FSNode } from '@itookit/vfs-core';
import type { VFSNodeUI } from '../contracts/types';
import type { IconResolver, ContentParserResolver } from './FileTypeRegistry';
import { shouldFilterNode, stripExtension, getExtension } from '../utils/helpers';

export const mapFSNodeToUIItem = (
  node: FSNode,
  iconResolver?: IconResolver,
  _parserResolver?: ContentParserResolver,
  showFileExtensions = false,
): VFSNodeUI => {
  const isDir = node.type === 'directory';

  const displayTitle =
    (node.metadata?.title as string) ||
    (isDir ? node.name : (showFileExtensions ? node.name : stripExtension(node.name)));
  const displayIcon =
    node.icon || iconResolver?.(node.name, isDir) || (isDir ? '📁' : '📄');

  return {
    id: node.path, resource: { viewId: node.viewId ?? '', path: node.path }, kind: isDir ? 'directory' : 'file', parentId: node.parentPath,
    type: isDir ? 'directory' : 'file',
    version: '1.0',
    icon: displayIcon,
    metadata: {
      title: displayTitle,
      tags: node.tags ? [...node.tags] : [],
      createdAt: new Date(node.createdAt).toISOString(),
      lastModified: new Date(node.modifiedAt).toISOString(),
      parentPath: node.parentPath,
      path: node.path,
      viewId: node.viewId,
      custom: {
        ...(node.metadata || {}),
        _originalName: node.name,
        _extension: !isDir && node.name.includes('.') ? getExtension(node.name) : '',
      },
    },
    content: isDir ? undefined : {
      format: (node.metadata?.contentType as string) || 'text/markdown',
      summary: '',
      searchableText: '',
      data: undefined,
    },
    headings: [],
    children: isDir ? undefined : undefined,
  };
};

export const mapFSNodesToUIItems = (
  nodes: FSNode[],
  iconResolver?: IconResolver,
  parserResolver?: ContentParserResolver,
  showFileExtensions = false,
): VFSNodeUI[] =>
  nodes
    ?.filter(n => !shouldFilterNode(n))
    .map(n => mapFSNodeToUIItem(n, iconResolver, parserResolver, showFileExtensions)) || [];
