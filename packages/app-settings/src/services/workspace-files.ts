import type { IFileSystem } from '@itookit/vfs-core';

/** Host-selected sources for settings export and sync; names are UI labels, not filesystem roots. */
export interface WorkspaceFileSource {
    readonly name: string;
    readonly description?: string;
    readonly fs: IFileSystem;
    readonly syncEnabled: boolean;
    /**
     * Explicit override for callers that cannot mark the filesystem as external.
     * False excludes the source from tag recording/counting; defaults to true.
     */
    readonly internal?: boolean;
}
export function workspaceFiles(sources: readonly WorkspaceFileSource[], name: string): IFileSystem {
    const source = sources.find(source => source.name === name);
    if (!source) throw new Error(`Workspace source not configured: ${name}`);
    return source.fs;
}
export async function writeWorkspaceFile(fs: IFileSystem, path: string, content: import('@itookit/vfs-core').FileContent): Promise<void> {
    if (await fs.driver.exists(path)) await fs.driver.writeContent(path, content);
    else {
        const index = path.lastIndexOf('/');
        await fs.driver.createFile({ name: path.slice(index + 1), parentPath: path.slice(0, index) || '/', content: content instanceof Uint8Array ? new Uint8Array(content).buffer : content, recursive: true });
    }
}
