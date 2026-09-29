import { sha256HexSync } from '@itookit/common';
import { FSError } from '@itookit/vfs-core';
import type { ProjectRemoteMount } from '../remote-mounts';
import type { ExecutionCapabilities, ProjectExecutionBinding, ProjectExecutionTarget } from './contracts';

const identity = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
export function validateExecutionTarget(value: unknown): asserts value is ProjectExecutionTarget {
    const target = value as ProjectExecutionTarget | null;
    if (!target || !identity(target.connectionId) || !identity(target.serverId)
        || !['trusted-cooperative-host', 'sandbox'].includes(target.requiredIsolation))
        throw new FSError('EINVAL', 'Invalid project execution target');
}
export function decodeExecutionBinding(raw: string): ProjectExecutionBinding {
    let value: unknown;
    try { value = JSON.parse(raw); } catch { throw invalidBinding(); }
    validateExecutionTarget(value);
    const binding = value as ProjectExecutionBinding;
    if (binding.version !== 1 || binding.mode !== 'managed-copy' || typeof binding.authorizationRevision !== 'string'
        || !/^[a-f0-9]{64}$/.test(binding.authorizationRevision)) throw invalidBinding();
    return binding;
}

/** Freeze the grants, not display names; order must not depend on the host locale. */
export function executionGrantRevision(mounts: readonly ProjectRemoteMount[], connectionId: string): string {
    if (!mounts.length || !mounts.some(mount => mount.at === '/')) throw new FSError('ECAPABILITY', 'Remote execution requires a remote project root');
    if (mounts.some(mount => mount.connectionId !== connectionId)) throw new FSError('EXMOUNT', 'Execution mounts must use one connection');
    const ordered = [...mounts].sort((a, b) => a.at < b.at ? -1 : a.at > b.at ? 1 : 0);
    return sha256HexSync(JSON.stringify(ordered.map(mount =>
        [mount.mountId, mount.connectionId, mount.alias, mount.root, mount.at, mount.access, mount.endpoint, mount.username, mount.credentialRef])));
}
export function requireExecutionCapabilities(binding: ProjectExecutionBinding, caps: ExecutionCapabilities): void {
    if (!caps.serverId || caps.serverId !== binding.serverId) throw new FSError('ECONFLICT', 'Remote execution node identity changed');
    if (!caps.process.exec || !['trusted-cooperative-host', 'sandbox'].includes(caps.executionModel)
        || !['cooperative', 'isolated'].includes(caps.workspaceConsistency))
        throw new FSError('ECAPABILITY', 'Remote command execution is unavailable');
    if (binding.requiredIsolation === 'sandbox' && (caps.executionModel !== 'sandbox'
        || caps.workspaceConsistency !== 'isolated' || caps.readOnlyEnforcement !== 'kernel-enforced'))
        throw new FSError('ECAPABILITY', 'Remote node does not meet isolation requirements');
}
export function executionGrantChanged() { return new FSError('ECONFLICT', 'Project execution authorization changed'); }
function invalidBinding() { return new FSError('EINVAL', 'Invalid project execution binding'); }
