import { FileIgnoreFilter, createVFSFileDiscoverySource, type IFileSystem, type FSNode } from '@itookit/vfs-core';

/** Presentation only: no built-in exclusions, no changes to raw VFS or tool access. */
export function createGitignoreVisibility(fs: IFileSystem, signal?: AbortSignal, boundary?: string) {
    const source = createVFSFileDiscoverySource(fs, { signal });
    const rootFor = source.rootFor;
    if (boundary) source.rootFor = path => {
        const mountRoot = rootFor(path);
        return mountRoot.length > boundary.length ? mountRoot : boundary;
    };
    const filter = new FileIgnoreFilter(source, signal, { files: ['.gitignore'], defaults: [] });
    return (node: FSNode) => filter.accepts(node.path, node.type === 'directory');
}
export async function filterGitignoredFiles(fs: IFileSystem, nodes: FSNode[], signal?: AbortSignal, boundary?: string): Promise<FSNode[]> {
    const accepts = createGitignoreVisibility(fs, signal, boundary);
    const flags = await Promise.all(nodes.map(accepts));
    return nodes.filter((_, index) => flags[index]);
}
