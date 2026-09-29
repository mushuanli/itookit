import { filterGitignoredFiles } from '../utils/gitignore-visibility';
import { normalizeVirtualPath, type FSNode, type IFileSystem } from '@itookit/vfs-core';
import type { BrowserNode, BrowserSource } from '../contracts/source';

export interface VFSDataOptions { hideGitignored?: boolean; root?: string; include?: (node: FSNode) => boolean }
export function fromVFS(fs: IFileSystem, options: VFSDataOptions = {}): BrowserSource {
  const root = normalizeVirtualPath(options.root ?? '/');
  const within = (path: string) => root === '/' || path === root || path.startsWith(root + '/');
  const map = (node: FSNode): BrowserNode => ({ id: node.path,
    parentId: node.parentPath === root ? null : node.parentPath,
    kind: node.type === 'directory' ? 'directory' : 'file', label: node.name,
    size: node.type === 'file' ? node.size : undefined, fileDetails: true,
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
      const raw = await fs.driver.getChildren(path); signal?.throwIfAborted();
      const nodes = options.hideGitignored === false ? raw : await filterGitignoredFiles(fs, raw, signal, root);
      return nodes.filter(node => options.include?.(node) ?? true).map(map);
    },
    subscribe(listener) {
      const notify = (paths: string[]) => {
        const parents = new Set<string | null>();
        if (paths.some(path => within(path) && path.split('/').pop() === '.gitignore')) { listener({}); return; }
        for (const path of paths) {
          if (!within(path)) continue;
          if (path === root) { listener({}); return; }
          const parent = path.slice(0, path.lastIndexOf('/')) || '/';
          parents.add(parent === root ? null : parent);
        }
        if (parents.size) listener({ parentIds: [...parents] });
      };
      const offs = [
        fs.on('node:created', event => notify(event.payload.nodes.map(node => node.path))),
        fs.on('node:updated', event => notify(event.payload.nodes.map(node => node.path))),
        fs.on('node:deleted', event => notify(event.payload.allDeletedPaths)),
        fs.on('node:moved', event => notify(event.payload.nodes.flatMap(node => [node.oldPath, node.newPath]))),
        fs.on('node:renamed', event => notify(event.payload.nodes.flatMap(node => [node.oldPath, node.newPath]))),
      ];
      return () => offs.forEach(off => off());
    },
  };
}
