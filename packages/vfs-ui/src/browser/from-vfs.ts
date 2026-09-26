import { normalizeVirtualPath, type FSNode, type IFileSystem } from '@itookit/vfs-core';
import type { BrowserNode, BrowserSource } from '../contracts/source';

export interface VFSDataOptions { root?: string; include?: (node: FSNode) => boolean }
export function fromVFS(fs: IFileSystem, options: VFSDataOptions = {}): BrowserSource {
  const root = normalizeVirtualPath(options.root ?? '/');
  const within = (path: string) => root === '/' || path === root || path.startsWith(root + '/');
  const map = (node: FSNode): BrowserNode => ({ id: node.path,
    parentId: node.parentPath === root ? null : node.parentPath,
    kind: node.type === 'directory' ? 'directory' : 'file', label: node.metadata?.title as string || node.name,
    resource: { viewId: fs.viewId, path: node.path }, expandable: node.type === 'directory',
    icon: node.icon, tags: node.tags, createdAt: node.createdAt, modifiedAt: node.modifiedAt,
    readOnly: node.metadata?._readOnly === true || fs.capabilities.readonly });
  return {
    async get(id, signal) {
      signal?.throwIfAborted(); id = normalizeVirtualPath(id); if (!within(id)) return undefined;
      const node = await fs.driver.getNode(id); signal?.throwIfAborted();
      return node && (options.include?.(node) ?? true) ? map(node) : undefined;
    },
    async children(parent, signal) {
      signal?.throwIfAborted(); const path = normalizeVirtualPath(parent ?? root);
      if (!within(path)) return [];
      const nodes = await fs.driver.getChildren(path); signal?.throwIfAborted();
      return nodes.filter(node => options.include?.(node) ?? true).map(map);
    },
    subscribe(listener) {
      const offs = ['node:created', 'node:updated', 'node:deleted', 'node:moved', 'node:renamed'].map(event => fs.on(event as 'node:created', () => listener({})));
      return () => offs.forEach(off => off());
    },
  };
}
