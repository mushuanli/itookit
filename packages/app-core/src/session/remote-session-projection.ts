import { ENTITY_ICONS, t } from '@itookit/common';
import { FSError, type FSNode } from '@itookit/vfs-core';
import type { SessionFolder } from '@itookit/llm-session/contracts';
import type { HarnessSession } from '@itookit/piagent-driver';
import type { ProjectService } from '../projects/project-service';
import { reportRemoteFailure } from '../projects/remote-diagnostics';
import { remoteSessionPath, type BrowserTarget } from './browser-routes';
type Target = Extract<BrowserTarget, {kind: 'remote'}>;
export class RemoteSessionProjection {
    constructor(private readonly projects?: ProjectService) {}
    private node(path: string, title: string, directory: boolean, times?: Pick<HarnessSession, 'createdAt' | 'updatedAt'>): FSNode {
        const index = path.lastIndexOf('/');
        const base = {path, name: path.slice(index + 1), parentPath: path.slice(0, index), createdAt: times?.createdAt ?? 0, modifiedAt: times?.updatedAt ?? 0,
            version: 1, tags: [], icon: ENTITY_ICONS.remoteSession, metadata: {title, _fileDetails: false, _readOnly: true, _showAll: true, remoteHarness: true}};
        return directory ? {...base, type: 'directory'} : {...base, type: 'file', size: 0};
    }
    private sessionNode(path: string, session: HarnessSession): FSNode {
        return this.node(path, session.title.trim() || t('harness.untitledSession'), false, session);
    }
    async root(folder: string, known?: SessionFolder | null): Promise<FSNode[]> {
        const project = known === undefined ? await this.projects?.forFolder(folder) : known;
        const root = project?.project && project.path === folder && this.projects?.remoteMounts?.list(project.project.id).find(m => m.at === '/' && m.connectionId && m.serverProjectId);
        return root ? [this.node(remoteSessionPath(folder), t('harness.remoteSessions'), true)] : [];
    }
    async list(path: string, target: Target): Promise<FSNode[]> {
        const project = await this.projects?.forFolder(target.folder), remote = this.projects?.remoteMounts;
        if (!remote || !project || project.path !== target.folder) throw new FSError('ENOENT', 'Remote project unavailable');
        if (target.nativeSessionId || target.draft) return [];
        let client: import('@itookit/piagent-driver').HarnessClient | undefined;
        try {
            client = await remote.projectHarness(project.project.id, {timeoutMs: 3000});
            const profiles = (await client.profiles({timeoutMs: 3000})).profiles.filter(p => p.projectRuntime && (p.capabilities.history || p.capabilities.create));
            if (!target.profileId) return profiles.map(p => this.node(remoteSessionPath(target.folder, p.id), `${p.kind} · ${p.id}`, true));
            const profile = profiles.find(p => p.id === target.profileId);
            if (!profile) throw new FSError('ENOENT', 'Remote profile unavailable');
            const page = profile.capabilities.history ? await client.list(profile.id, {cursor: target.cursor}, {timeoutMs: 3000}) : {sessions: [], nextCursor: null};
            return [ ...(profile.capabilities.create && !target.cursor ? [this.node(path + '/@new', t('harness.create'), false)] : []),
                ...page.sessions.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0) || a.id.localeCompare(b.id))
                    .map(s => this.sessionNode(path + '/' + encodeURIComponent(s.id), s)),
                ...(page.nextCursor ? [this.node(path + '/@page:' + encodeURIComponent(page.nextCursor), t('harness.more'), true)] : []) ];
        } catch (error) {
            reportRemoteFailure(error, {stage: 'session-list', projectId: project.project.id, profileId: target.profileId});
            const node = this.node(path + '/unavailable', t('harness.disconnected'), false);
            return [{...node, metadata: {...node.metadata, _disabled: true}}];
        } finally { await client?.close(); }
    }
    async stat(path: string, target: Target): Promise<FSNode | null> {
        if (!target.profileId) return (await this.root(target.folder))[0] ?? null;
        if (!target.nativeSessionId) return this.node(path, target.draft ? t('harness.create') : target.cursor ? t('harness.more') : target.profileId, !target.draft);
        const project = await this.projects?.forFolder(target.folder), remote = this.projects?.remoteMounts;
        if (!remote || !project || project.path !== target.folder) return null;
        const client = await remote.projectHarness(project.project.id, {timeoutMs: 3000});
        try { const history = await (client.inspect ? client.inspect(target.profileId, target.nativeSessionId, {timeoutMs: 3000}) : client.read(target.profileId, target.nativeSessionId, {timeoutMs: 3000}));
            return this.sessionNode(path, history.session);
        } finally { await client.close(); }
    }
}
