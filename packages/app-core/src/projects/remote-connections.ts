import { FSError, normalizeVirtualPath } from '@itookit/vfs-core';

export interface RemoteFileSystemConfig {
    id: string; name: string; endpoint: string; username: string; credentialRef: string;
}
export type RemoteFileSystemInput = Pick<RemoteFileSystemConfig, 'name' | 'endpoint' | 'username'>;

export function normalizeConnection(input: RemoteFileSystemInput): RemoteFileSystemInput {
    const name = input.name.trim(), username = input.username.trim();
    if (!name || !username || /[:\r\n]/.test(username)) throw new FSError('EINVAL', 'Invalid connection name or username');
    const endpoint = new URL(input.endpoint.includes('://') ? input.endpoint : `http://${input.endpoint}`);
    if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash)
        throw new FSError('EINVAL', 'Invalid remote endpoint');
    return { name, username, endpoint: endpoint.href.replace(/\/+$/, '') };
}

/** The first component names a server export, never a physical host directory. */
export function remoteProjectPath(path: string): { alias: string; root: string } {
    if (!path.startsWith('/') || /[\\\0]/.test(path) || path.split('/').includes('..')) throw new FSError('EINVAL', 'Invalid remote project path');
    const normalized = normalizeVirtualPath(path);
    const [alias, ...parts] = normalized.slice(1).split('/');
    if (!/^[a-zA-Z0-9_-]+$/.test(alias)) throw new FSError('EINVAL', 'Export alias required');
    return { alias, root: parts.length ? '/' + parts.join('/') : '/' };
}
