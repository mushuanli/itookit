/**
 * @file vfs-ui/services/NodeMapper.ts
 * @desc Maps FSNode → VFSNodeUI. Pure functions, no side effects.
 */
import type { FSNode } from '@itookit/common';
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

  // Debug: detect system paths leaking into UI tree
  if (node.path?.startsWith('/module/') || node.parentPath?.startsWith('/module/')) {
    console.warn('[NodeMapper] SYSTEM PATH LEAK', {
      path: node.path,
      parentPath: node.parentPath,
      name: node.name,
      type: node.type,
      moduleId: node.moduleId,
      stack: new Error().stack?.split('\n').slice(1, 6).join('\n'),
    });
  }

  const displayTitle =
    (node.metadata?.title as string) ||
    (isDir ? node.name : (showFileExtensions ? node.name : stripExtension(node.name)));
  const displayIcon =
    node.icon || iconResolver?.(node.name, isDir) || (isDir ? '📁' : '📄');

  return {
    id: node.path,
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
      moduleId: node.moduleId,
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

// ── Backward-compat aliases ───────────────────────────────────────────────────
/** @deprecated Use mapFSNodeToUIItem */
export const mapEngineNodeToUIItem = mapFSNodeToUIItem as any;
/** @deprecated Use mapFSNodesToUIItems */
export const mapEngineTreeToUIItems = mapFSNodesToUIItems as any;
