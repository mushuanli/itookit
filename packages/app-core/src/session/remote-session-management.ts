import { FSError, type OperationOptions } from '@itookit/vfs-core';
import type { ProjectService } from '../projects/project-service';
import type { HarnessConversationSnapshot } from '@itookit/piagent-driver';

export type NativeSessionCommand = {kind: 'rename'; name: string} | {kind: 'archive' | 'unarchive'};
/** Management uses the same persistent mutation journal as the opened conversation. */
export async function manageRemoteSession(projects: ProjectService, folder: string, profile: string, session: string, command: NativeSessionCommand, options?: OperationOptions): Promise<HarnessConversationSnapshot> {
    const project = await projects.forFolder(folder);
    if (!project || project.path !== folder || !projects.remoteMounts) throw new FSError('ENOENT', 'Native project unavailable');
    const mount = projects.remoteMounts.list(project.project.id).find(item => item.at === '/');
    const grant = JSON.stringify(mount);
    const identity = mount && {kind: 'remote-session' as const, connectionId: mount.connectionId, serverId: mount.serverId, serverProjectId: mount.serverProjectId, profileId: profile, sessionId: session};
    const controls = await projects.remoteMounts.projectConversation(project.project.id, profile, session, options);
    try {
        const snapshot = await controls.read();
        if (snapshot.pending) throw new FSError('EBUSY', 'Reconcile the previous native operation first');
        const result = await applyCommand(controls, command);
        if (identity?.connectionId && identity.serverId && identity.serverProjectId) {
            const current = projects.remoteMounts.list(project.project.id).find(item => item.at === '/');
            if (JSON.stringify(current) !== grant) throw new FSError('ECONFLICT', 'Native operation committed, but the project binding changed');
            try { await projects.favorites?.updateNativeSession(project.project.id, {...identity, connectionId: identity.connectionId, serverId: identity.serverId, serverProjectId: identity.serverProjectId}, result.title, result.archived); }
            catch { throw new FSError('EIO', 'Native operation committed, but updating the local favorite failed'); }
        }
        return result;
    } finally { await controls.close(); }
}

async function applyCommand(controls: import('@itookit/piagent-driver').HarnessConversationPort, command: NativeSessionCommand): Promise<HarnessConversationSnapshot> {
    if (command.kind === 'rename') {
        if (!controls.rename) throw new FSError('ECAPABILITY', 'Native rename unavailable');
        return controls.rename(command.name);
    }
    if (!controls.archive) throw new FSError('ECAPABILITY', 'Native archive unavailable');
    return controls.archive(command.kind === 'archive');
}
