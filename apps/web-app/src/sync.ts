import { prepareProjectSync, type ProjectService, type ProjectSyncProvider, type ProjectSyncSession } from '@itookit/app-core';
import { showProjectSyncSetup } from '@itookit/app-shell';
import { t } from '@itookit/common';
import { OperationManager, randomId, scopedStore, SyncError, assertSync, validId, type CoordinationGuard, type SyncState, type Coordinator } from '@itookit/vfs-sync';
import { normalizeVirtualPath } from '@itookit/vfs-core';
import type { HttpSourceProvider } from '@itookit/vfsdriver-agent';
import type { IndexedDBBackend } from '@itookit/vfsdriver-indexeddb';
import { HttpSyncClient, IndexedDBSyncStore, IndexedDBSyncCoordinator, createIndexedDBSyncSession, browserSyncStorageStatus } from '@itookit/sync-adapters';

/** Web composition reuses the remote server catalog and its credential resolver. */
export class WebProjectSync implements ProjectSyncProvider {
    readonly coordinator: Coordinator;
    private readonly clients = new Map<string, HttpSyncClient>();
    projects?: ProjectService;
    constructor(private readonly backend: IndexedDBBackend, private readonly http: HttpSourceProvider, coordinator?: Coordinator) {
        this.coordinator = coordinator ?? new IndexedDBSyncCoordinator(backend.storageAccess());
    }
    async open(localProjectId: string): Promise<ProjectSyncSession> {
        const state = await this.binding(localProjectId); assertSync(state, 'BINDING_NOT_FOUND');
        const remote = this.client(state.binding.connectionId!, state.binding.historyEpoch);
        const session = createIndexedDBSyncSession(this.backend, state.binding.bindingId, remote, { coordinator: this.coordinator, scope: { includes: [''], excludes: ['.mindos'], propagateDeletes: false } });
        const guarded = <T>(action: () => Promise<T>) => async () => { await this.validate(state, remote); return action(); };
        return { store: session.store, preview: guarded(() => session.preview()), execute: id => guarded(() => session.execute(id))(),
            resolve: (id, decisions) => guarded(() => session.resolve(id, decisions))(),
            mergeText: (id, paths) => guarded(() => session.mergeText(id, paths))(), recover: guarded(() => session.recover()),
            reconcileExpired: guarded(() => session.reconcileExpired()), cancel: () => session.cancel() };
    }
    async setup(localProjectId: string, signal: AbortSignal): Promise<void> {
        const project = await this.local(localProjectId), prior = await this.binding(localProjectId);
        await showProjectSyncSetup({ connections: () => this.projects!.remoteMounts?.connections() ?? [],
            inspect: id => this.inspect(id), bind: async (id, cloud, create) => {
                assertSync(!signal.aborted, 'SYNC_STOPPED'); await this.bind(localProjectId, id, cloud, create);
            } }, prior?.setupPending ? prior.binding.projectId : project.name.replace(/[^a-zA-Z0-9_-]/g, '-').replace(/^-+|-+$/g, '') || project.project.id, signal);
    }
    async dispose(): Promise<void> { for (const client of this.clients.values()) client.close(); this.clients.clear(); }
    private async binding(id: string): Promise<SyncState | undefined> {
        const states = (await IndexedDBSyncStore.list(this.backend.storageAccess())).filter(s => s.binding.localProjectId === id);
        const active = states.filter(s => s.binding.state !== 'detached'); assertSync(active.length <= 1, 'SYNC_BINDING_AMBIGUOUS');
        return active[0] ?? states.at(-1);
    }
    private client(id: string, epoch = ''): HttpSyncClient {
        assertSync(this.projects?.remoteMounts && id, 'SYNC_CONNECTION_MISSING');
        const connection = this.projects.remoteMounts.connection(id), key = JSON.stringify([connection, epoch]);
        let client = this.clients.get(key);
        if (!client) { client = new HttpSyncClient(this.http.transport(connection), epoch); this.clients.set(key, client); }
        return client;
    }
    async inspect(id: string): Promise<{ projectId: string }[]> {
        const caps = await this.capabilities(this.client(id));
        return (await this.client(id, caps.historyEpoch).projects()).projects.filter(p => p.state === 'active');
    }
    private async capabilities(client: HttpSyncClient) {
        try {
            const caps = await client.capabilities(); assertSync(caps.healthy && caps.filesManifest && caps.readPins, 'SYNC_SERVER_UNAVAILABLE'); return caps;
        } catch (error) {
            if ((error as { status?: number }).status === 404) throw new Error(t('project.sync.serverDisabled'));
            throw error;
        }
    }
    private async local(id: string) {
        assertSync(this.projects, 'SYNC_STOPPED'); const project = await this.projects.get(id), path = project.project.directory;
        assertSync(project.project.source?.kind !== 'remote', 'SYNC_SOURCE_UNSUPPORTED');
        await this.projects.assertIndependent(project);
        const mounts = this.projects.remoteMounts?.list(id) ?? [];
        if (mounts.length) throw sourceError('SYNC_REMOTE_SOURCE_UNSUPPORTED',
            t(mounts.some(m => m.at === '/') ? 'project.sync.remoteProjectSourceUnsupported' : 'project.sync.remoteMountSourceUnsupported',
                { path, remote: mounts.map(m => `/${m.alias}${m.root === '/' ? '' : m.root} → ${m.at}`).join(', ') }));
        const root = normalizeVirtualPath(path === '~' ? '/home/admin' : path.startsWith('~/') ? '/home/admin/' + path.slice(2) : path);
        if (root !== '/home/admin' && !root.startsWith('/home/admin/'))
            throw sourceError('SYNC_SOURCE_UNSUPPORTED', t('project.sync.managedSourceUnsupported', { path }));
        if ((await this.backend.statType(root))?.type !== 'directory')
            throw sourceError('SYNC_ROOT_UNAVAILABLE', t('project.sync.localSourceUnavailable', { path: root }));
        return { ...project, project: { ...project.project, directory: root } };
    }
    private async validate(state: SyncState, client: HttpSyncClient): Promise<void> {
        const project = await this.local(state.binding.localProjectId), caps = await this.capabilities(client), b = state.binding;
        assertSync(project.project.directory === b.root && b.sourceId === this.backend.storageAccess().identity, 'SYNC_SOURCE_CHANGED');
        assertSync(caps.authorityId === b.authorityId && caps.namespaceId === b.namespaceId && caps.historyEpoch === b.historyEpoch, 'SYNC_IDENTITY_CHANGED');
    }
    async bind(local: string, connection: string, cloud: string, create: boolean): Promise<void> {
        validId(cloud);
        await this.coordinator.exclusive('setup:' + local, async setupGuard => {
            const project = await this.local(local), prior = await this.binding(local), probe = this.client(connection);
            const caps = await this.capabilities(probe);
            assertSync(!prior || prior.binding.state === 'detached' || prior.setupPending, 'BINDING_EXISTS');
            const remote = this.client(connection, caps.historyEpoch);
            const state = prior?.setupPending ? prior : await this.initial(local, project.project.directory, connection, cloud, remote, caps, create, setupGuard);
            assertSync(state.binding.connectionId === connection && state.binding.projectId === cloud, 'SYNC_SETUP_TARGET_CHANGED');
            await this.validate(state, remote);
            await this.coordinator.exclusive(state.binding.bindingId, async bindingGuard => {
                const base = new IndexedDBSyncStore(this.backend.storageAccess(), state.binding.bindingId);
                const store = scopedStore(scopedStore(base, setupGuard), bindingGuard);
                await new OperationManager(store, remote, this.coordinator, randomId).recover();
                await prepareProjectSync(store, remote, this.coordinator, randomId, create);
                await store.update(s => ({ ...s, setupPending: false }));
            });
            await browserSyncStorageStatus(true);
        });
    }
    private async initial(local: string, root: string, connection: string, projectId: string, remote: HttpSyncClient,
        caps: Awaited<ReturnType<HttpSyncClient['capabilities']>>, create: boolean, guard?: CoordinationGuard): Promise<SyncState> {
        const datasets: { datasetId: string; kind: string; state: string }[] = [];
        const project = (await remote.projects()).projects.find(p => p.projectId === projectId);
        assertSync(create ? !project : project?.state === 'active', create ? 'PROJECT_EXISTS' : 'PROJECT_NOT_FOUND');
        if (project) {
            let cursor: string | undefined;
            do { const page = await remote.catalog(projectId, cursor); datasets.push(...page.datasets); cursor = page.nextCursor ?? undefined; } while (cursor);
        }
        const files = datasets.filter(d => d.kind === 'files' && d.state === 'active'); assertSync(files.length <= 1, 'SYNC_DATASET_AMBIGUOUS');
        const state: SyncState = { schemaVersion: 1, setupPending: true, nextSeq: '1', baseline: [], history: [], binding: {
            bindingId: randomId(), replicaId: randomId(), localProjectId: local, projectId, connectionId: connection,
            sourceId: this.backend.storageAccess().identity, root,
            datasetId: files[0]?.datasetId ?? (datasets.some(d => d.datasetId === 'files') ? randomId() : 'files'), direction: 'both', state: 'active',
            authorityId: caps.authorityId, namespaceId: caps.namespaceId, historyEpoch: caps.historyEpoch,
            bindingRevision: '1', locatorRevision: '1', scopeRevision: '1', policyRevision: '1' } };
        const store = new IndexedDBSyncStore(this.backend.storageAccess(), state.binding.bindingId);
        await (guard ? store.scoped(guard) : store).initialize(state); return state;
    }
}
function sourceError(code: string, message: string): SyncError {
    const error = new SyncError(code); error.message = message; return error;
}
