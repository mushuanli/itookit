import { t } from '@itookit/common';
import { REMOTE_EXECUTION_ISOLATION, type ProjectService } from '@itookit/app-core';
import type { MenuItem } from '@itookit/vfs-ui';

/** UI adapter only; the execution service owns authorization and isolation policy. */
export function projectExecutionMenu(projects: Pick<ProjectService, 'execution' | 'remoteMounts'> | undefined,
    projectId: string, changed: () => Promise<void>): MenuItem[] {
    const connectionId = projects?.remoteMounts?.list(projectId).find(mount => mount.at === '/')?.connectionId;
    if (!projects?.execution || !projects.remoteMounts || !connectionId) return [];
    const { execution, remoteMounts } = projects;
    const bind = async () => {
        const caps = await remoteMounts.executionCapabilities(connectionId);
        if (!caps.serverId || !caps.process.exec) throw new Error(t('remote.executionUnavailable'));
        await execution.bind(projectId, { connectionId, serverId: caps.serverId, requiredIsolation: REMOTE_EXECUTION_ISOLATION });
    };
    const run = (operation: () => Promise<void>) => async () => { await operation(); await changed(); };
    return [
        { id: 'enable-remote-execution', label: t('remote.enableExecution'), onClick: run(bind) },
        { id: 'disable-remote-execution', label: t('remote.disableExecution'), onClick: run(() => execution.clear(projectId)) },
    ];
}
