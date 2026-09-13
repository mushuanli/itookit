import type { ToolVFSContext } from '@itookit/common';
import { normalizeVirtualPath, pathUtils, type FileSystemContext } from '@itookit/vfs-core';

/** One exact-path adapter per authorized view. Never resolves a basename globally. */
export function createVFSToolContext(context: FileSystemContext): ToolVFSContext {
    const resolve = (path: string) => {
        if (/[\\\0]/.test(path) || /^[a-z][a-z0-9+.-]*:/i.test(path) || path.split('/').includes('..')) {
            throw new Error('Invalid virtual file path');
        }
        return normalizeVirtualPath(path.startsWith('/') ? path : `${context.cwd}/${path}`);
    };
    return {
        async readFile(path) {
            const content = await context.fs.driver.readContent(resolve(path), { encoding: 'utf-8' });
            return content;
        },
        async writeFile(path, content) {
            const target = resolve(path);
            if (await context.fs.driver.exists(target)) await context.fs.driver.writeContent(target, content);
            else await context.fs.driver.createFile({ name: pathUtils.basename(target), parentPath: pathUtils.dirname(target), content, recursive: true });
        },
        async listFiles(path) {
            const root = resolve(path ?? context.cwd);
            const files: string[] = [];
            const queue = [root];
            let visited = 0;
            while (queue.length) {
                if (++visited > 10000) throw new Error('Directory traversal limit exceeded');
                for (const node of await context.fs.driver.getChildren(queue.shift()!)) {
                    if (node.type === 'directory') queue.push(node.path);
                    else if (node.type === 'file' || node.type === 'seqfile') files.push(node.path);
                    if (files.length > 10000) throw new Error('File listing limit exceeded');
                }
            }
            return files;
        },
        async stat(path) {
            const node = await context.fs.driver.getNode(resolve(path));
            return node?.type ?? null;
        },
    };
}
