import { randomUUID } from '@itookit/common';
import { checkOperation, createFileSystemView, FSError, normalizeVirtualPath,
    type FileSystemSourceOwner, type FileSystemMount, type IFileSystem, type OperationOptions } from '@itookit/vfs-core';
import { createUnavailableDirectory } from '../vfs/unavailable-directory';
import { normalizeConnection, remoteProjectPath, type RemoteFileSystemConfig, type RemoteFileSystemInput } from './remote-connections';

export interface RemoteFileConnection { endpoint: string; alias: string; credentialRef: string; username?: string; }
export interface RemoteFileSourceProvider {
    setCredential(reference: string, secret: string): void | (() => void);
    open(connection: RemoteFileConnection, options?: OperationOptions): Promise<FileSystemSourceOwner>;
    check?(connection: Omit<RemoteFileConnection, 'alias'>, options?: OperationOptions): Promise<void>;
    dispose(): Promise<void>;
}
export interface ProjectRemoteMount extends RemoteFileConnection {
    mountId: string; at: string; root: string; access: 'ro' | 'rw'; connectionId?: string;
}
interface Catalog { version: 1; revision: number; projects: Record<string, ProjectRemoteMount[]>; connections?: RemoteFileSystemConfig[]; }
export type RemoteConnectionStatus = 'unknown' | 'checking' | 'online' | 'offline';
const catalogPath = '/etc/project-remote-mounts.seq';

/** Project-owned grants; credentials stay in the injected host provider. */
export class ProjectRemoteMountService {
    private catalog: Catalog = { version: 1, revision: 0, projects: {} };
    private readonly views = new Map<string, Set<FileSystemSourceOwner>>();
    private readonly sources = new Map<string, Promise<FileSystemSourceOwner>>();
    private readonly missing = new Map<string, Promise<FileSystemSourceOwner>>();
    private tail: Promise<unknown> = Promise.resolve();
    private closed = false;
    private persisted: string | null = null;
    private readonly states = new Map<string, RemoteConnectionStatus>();
    private readonly listeners = new Set<() => void>();
    private readonly probes = new Map<string, Promise<void>>();
    readonly diagnostics = new Map<string, string[]>();
    constructor(private readonly store: IFileSystem, private readonly provider: RemoteFileSourceProvider,
        private readonly beforeChange: (projectId: string) => Promise<void>,
        private readonly afterChange: (projectId: string) => Promise<void>) {}
    async init(): Promise<void> {
        if (!await this.store.driver.exists(catalogPath)) return;
        const raw = await this.store.meta.seq!.getEntry(catalogPath, 'catalog');
        if (raw === null || raw === undefined) return;
        const saved: Catalog = JSON.parse(raw);
        this.persisted = raw;
        if (saved.version !== 1 || (!Number.isSafeInteger(saved.revision) || saved.revision < 0) || !saved.projects || typeof saved.projects !== 'object') throw new FSError('EINVAL', 'Invalid remote mount catalog');
        for (const mounts of Object.values(saved.projects)) {
            if (!Array.isArray(mounts)) throw new FSError('EINVAL', 'Invalid remote mounts');
            mounts.forEach(validateMount);
        }
        if (saved.connections !== undefined && !Array.isArray(saved.connections)) throw new FSError('EINVAL', 'Invalid remote connections');
        for (const connection of saved.connections ?? []) {
            normalizeConnection(connection);
            if (!connection.id || !connection.credentialRef) throw new FSError('EINVAL', 'Invalid connection reference');
        }
        for (const mounts of Object.values(saved.projects)) for (const mount of mounts) {
            if (mount.connectionId && !saved.connections?.some(item => item.id === mount.connectionId)) throw new FSError('EINVAL', 'Missing remote connection');
        }
        this.catalog = saved;
    }
    list(projectId: string): ProjectRemoteMount[] {
        return structuredClone((this.catalog.projects[projectId] ?? []).map(mount => {
            const connection = mount.connectionId && this.connections().find(item => item.id === mount.connectionId);
            return connection ? { ...mount, endpoint: connection.endpoint, username: connection.username, credentialRef: connection.credentialRef } : mount;
        }));
    }
    connections(): RemoteFileSystemConfig[] { return structuredClone(this.catalog.connections ?? []); }
    connection(id: string): RemoteFileSystemConfig {
        const connection = this.connections().find(item => item.id === id);
        if (!connection) throw new FSError('ENOENT', 'Remote file system not found');
        return connection;
    }
    async checkConnection(id: string, options?: OperationOptions): Promise<void> {
        const connection = this.connection(id), projects = this.connectionProjects(id);
        this.setStatus(id, 'checking');
        try {
            if (this.provider.check) await this.provider.check(connection, options);
            else if (!projects.length) throw new FSError('ECAPABILITY', 'Connection checks unavailable');
            await Promise.all(projects.map(projectId => this.checkConnections(projectId, options)));
            this.setStatus(id, projects.some(projectId => this.projectOffline(projectId)) ? 'offline' : 'online');
        } catch {
            this.setStatus(id, 'offline');
            if (!options?.signal?.aborted) await Promise.all(projects.map(projectId => this.checkConnections(projectId, options)));
        }
    }
    saveConnection(input: RemoteFileSystemInput, password: string, id?: string): Promise<string> {
        return this.serial(async () => {
            const value = normalizeConnection(input), existing = id ? this.connection(id) : undefined;
            if (!existing && !password) throw new FSError('EINVAL', 'Password required');
            const connections = this.connections();
            if (connections.some(item => item.id !== id && (item.name === value.name || (item.endpoint === value.endpoint && item.username === value.username))))
                throw new FSError('EEXIST', 'Remote file system already configured');
            const affected = this.connectionProjects(id);
            if (affected.length && existing?.endpoint !== value.endpoint) throw new FSError('EBUSY', 'Referenced endpoint cannot change');
            for (const projectId of affected) await this.beforeChange(projectId);
            const next = { ...value, id: id ?? randomUUID(), credentialRef: existing?.credentialRef ?? randomUUID() };
            const restore = password ? this.provider.setCredential(next.credentialRef, password) : undefined;
            try { await this.persist({ ...this.catalog, connections: [...connections.filter(item => item.id !== id), next] }); }
            catch (error) { restore?.(); throw error; }
            for (const projectId of affected) {
                await this.changed(projectId);
                for (const mount of this.list(projectId).filter(item => item.connectionId === id)) await this.releaseSource(mount.mountId);
                await this.checkConnections(projectId, { timeoutMs: 3000 });
            }
            for (const listener of this.listeners) listener();
            return next.id;
        });
    }
    removeConnection(id: string): Promise<void> {
        return this.serial(async () => {
            if (this.connectionProjects(id).length) throw new FSError('EBUSY', 'Remote file system is referenced by projects');
            await this.persist({ ...this.catalog, connections: this.connections().filter(item => item.id !== id) });
            for (const listener of this.listeners) listener();
        });
    }
    forgetProject(projectId: string): Promise<void> {
        return this.serial(async () => {
            const mounts = this.list(projectId);
            if (!mounts.length) return;
            await this.beforeChange(projectId);
            const projects = { ...this.catalog.projects }; delete projects[projectId];
            await this.persist({ ...this.catalog, projects });
            await this.changed(projectId);
            for (const mount of mounts) await this.releaseSource(mount.mountId);
        });
    }
    private connectionProjects(id?: string): string[] {
        return id ? Object.keys(this.catalog.projects).filter(project => this.list(project).some(mount => mount.connectionId === id)) : [];
    }
    private async releaseSource(id: string): Promise<void> {
        const source = this.sources.get(id); this.sources.delete(id); this.states.delete(id);
        await (await source?.catch(() => undefined))?.dispose();
    }
    findRemoteProject(connectionId: string, path: string): string | undefined {
        const connection = this.connection(connectionId), { alias, root } = remoteProjectPath(path);
        return Object.keys(this.catalog.projects).find(id => this.list(id).some(mount => mount.at === '/'
            && mount.endpoint === connection.endpoint && mount.alias === alias && mount.root === root));
    }
    bindProject(projectId: string, connectionId: string, path: string, access: 'ro' | 'rw', options?: OperationOptions): Promise<void> {
        return this.serial(async () => {
            if (this.findRemoteProject(connectionId, path)) throw new FSError('EEXIST', 'Remote path already belongs to a project');
            await this.beforeChange(projectId); checkOperation(options);
            const connection = this.connection(connectionId);
            const mount: ProjectRemoteMount = { endpoint: connection.endpoint, username: connection.username, credentialRef: connection.credentialRef,
                connectionId, ...remoteProjectPath(path), access, at: '/', mountId: randomUUID() };
            const owner = await this.provider.open(mount, options);
            try {
                if ((await owner.fs.driver.getNode(mount.root, options))?.type !== 'directory') throw new FSError('ENOTDIR', 'Remote project path must be a directory');
                if (access === 'rw' && (await owner.fs.capabilitiesAt(mount.root, options)).readonly) throw new FSError('EROFS', 'Source is read-only');
                checkOperation(options); await this.save(projectId, [mount]);
            } catch (error) { await owner.dispose(); throw error; }
            this.sources.set(mount.mountId, Promise.resolve(owner)); this.setStatus(mount.mountId, 'online');
            await this.changed(projectId);
        });
    }
    projectOffline(projectId: string): boolean { return this.list(projectId).some(mount => this.status(mount.mountId) === 'offline'); }
    status(mountId: string): RemoteConnectionStatus { return this.states.get(mountId) ?? 'unknown'; }
    onChange(listener: () => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
    async checkConnections(projectId: string, options?: OperationOptions): Promise<void> {
        if (this.closed) return;
        await Promise.all(this.list(projectId).map(mount => this.probe(mount, options)));
    }
    private probe(mount: ProjectRemoteMount, options?: OperationOptions): Promise<void> {
        const pending = this.probes.get(mount.mountId); if (pending) return pending;
        const previous = this.status(mount.mountId);
        if (previous === 'unknown') this.setStatus(mount.mountId, 'checking');
        const work = (async () => {
            try {
                checkOperation(options);
                const source = await this.resolve(mount, options);
                if ((await source.fs.driver.getNode(mount.root, options))?.type !== 'directory') throw new FSError('ENOTDIR', 'Remote root unavailable');
                this.setStatus(mount.mountId, 'online');
            } catch {
                this.setStatus(mount.mountId, options?.signal?.aborted ? previous : 'offline');
            } finally { this.probes.delete(mount.mountId); }
        })();
        this.probes.set(mount.mountId, work); return work;
    }
    private setStatus(id: string, status: RemoteConnectionStatus) {
        if (this.status(id) === status || this.closed) return;
        this.states.set(id, status); for (const listener of this.listeners) listener();
    }
    add(projectId: string, input: Omit<ProjectRemoteMount, 'mountId' | 'credentialRef' | 'access'> & { access?: 'ro' | 'rw' },
        secret: string, base: IFileSystem, options?: OperationOptions): Promise<void> {
        return this.serial(async () => {
            checkOperation(options); await this.beforeChange(projectId);
            const id = randomUUID(), mount: ProjectRemoteMount = { ...input, mountId: id, credentialRef: id, access: input.access ?? 'ro' };
            validateMount(mount);
            if (this.list(projectId).some(item => item.at.toLowerCase() === mount.at.toLowerCase()) || await base.driver.exists(mount.at, options)) throw new FSError('EEXIST', 'MOUNT_POINT_CONFLICT');
            const restore = this.provider.setCredential(id, secret);
            let owner: FileSystemSourceOwner;
            try { owner = await this.provider.open(mount, options); }
            catch (error) { restore?.(); throw error; }
            try {
                if (mount.access === 'rw' && (await owner.fs.capabilitiesAt(mount.root, options)).readonly) throw new FSError('EROFS', 'Source is read-only');
                if ((await owner.fs.driver.getNode(mount.root, options))?.type !== 'directory') throw new FSError('ENOTDIR', 'Remote mount root must be a directory');
                checkOperation(options);
                await this.save(projectId, [...this.list(projectId), mount]);
                this.sources.set(id, Promise.resolve(owner));
                this.setStatus(id, 'online');
            } catch (error) { restore?.(); await owner.dispose(); throw error; }
            await this.changed(projectId);
        });
    }
    remove(projectId: string, mountId: string): Promise<void> {
        return this.serial(async () => {
            await this.beforeChange(projectId);
            await this.save(projectId, this.list(projectId).filter(item => item.mountId !== mountId));
            await this.changed(projectId);
            const owner = this.sources.get(mountId); this.sources.delete(mountId);
            this.states.delete(mountId);
            await (await owner)?.dispose();
        });
    }
    reconnect(projectId: string, mountId: string, secret: string, options?: OperationOptions): Promise<void> {
        return this.serial(async () => {
            await this.beforeChange(projectId);
            const mount = this.list(projectId).find(item => item.mountId === mountId);
            if (!mount) throw new FSError('ENOENT', 'Remote mount not found');
            const restore = this.provider.setCredential(mount.credentialRef, secret);
            let next: FileSystemSourceOwner;
            try { next = await this.provider.open(mount, options); }
            catch (error) { restore?.(); throw error; }
            const old = this.sources.get(mountId);
            try {
                if ((await next.fs.driver.getNode(mount.root, options))?.type !== 'directory') throw new FSError('ENOTDIR', 'Remote mount root unavailable');
                checkOperation(options);
            } catch (error) { restore?.(); await next.dispose(); throw error; }
            this.sources.set(mountId, Promise.resolve(next));
            this.setStatus(mountId, 'online');
            await this.changed(projectId); await (await old)?.dispose();
        });
    }
    async compose(projectId: string, base: FileSystemSourceOwner): Promise<FileSystemSourceOwner> {
        const revision = this.catalog.revision;
        const definitions = this.list(projectId); if (!definitions.length) return base;
        const mounts: FileSystemMount[] = definitions.some(mount => mount.at === '/') ? [] : [{ mountId: 'primary', at: '/', fs: base.fs, access: 'rw' }];
        const diagnostics: string[] = [];
        try {
            for (const mount of definitions) {
                if (mount.at !== '/' && await base.fs.driver.exists(mount.at)) diagnostics.push(`MOUNT_SHADOW_CONFLICT:${mount.at}`);
                const source = await (this.status(mount.mountId) === 'offline' ? Promise.reject(new FSError('EIO', 'Source unavailable')) : this.resolve(mount))
                    .catch(() => { this.setStatus(mount.mountId, 'offline'); diagnostics.push(`SOURCE_UNAVAILABLE:${mount.at}`); return this.unavailable(mount.mountId); });
                mounts.push({ ...mount, fs: this.statusView(mount, source.fs), root: mount.root });
            }
            if (this.closed || revision !== this.catalog.revision) throw new FSError('EBUSY', 'Project mounts changed while opening');
            this.diagnostics.set(projectId, diagnostics);
            const fs = createFileSystemView({ viewId: `project:${projectId}`, revision: this.catalog.revision, mounts });
            let closing: Promise<void> | undefined;
            const owner = { fs, dispose: () => closing ??= (async () => {
                this.views.get(projectId)?.delete(owner); await fs.dispose(); await base.dispose();
            })() };
            if (!this.views.has(projectId)) this.views.set(projectId, new Set());
            this.views.get(projectId)!.add(owner); return owner;
        } catch (error) { await base.dispose(); throw error; }
    }
    async dispose(): Promise<void> {
        this.closed = true; await this.tail.catch(() => {});
        await Promise.allSettled(this.probes.values());
        await Promise.all([...this.views.values()].flatMap(views => [...views].map(owner => owner.dispose())));
        await Promise.all([...this.sources.values(), ...this.missing.values()].map(async value => (await value.catch(() => undefined))?.dispose()));
        this.sources.clear(); this.missing.clear(); this.listeners.clear(); await this.provider.dispose();
    }
    private async changed(projectId: string) {
        await Promise.all([...(this.views.get(projectId) ?? [])].map(owner => owner.dispose()));
        await this.afterChange(projectId);
        for (const listener of this.listeners) listener();
    }
    private statusView(mount: ProjectRemoteMount, fallback: IFileSystem): IFileSystem {
        const current = async () => (await this.sources.get(mount.mountId))?.fs ?? fallback;
        const driver = new Proxy(fallback.driver, { get: (_target, key) => {
            if (typeof key !== 'string' || typeof (fallback.driver as any)[key] !== 'function') return (fallback.driver as any)[key];
            if (key === 'on' || key === 'onAny') return (fallback.driver as any)[key].bind(fallback.driver);
            return async (...args: any[]) => {
                if (this.status(mount.mountId) === 'offline') {
                    const path = typeof args[0] === 'string' ? normalizeVirtualPath(args[0]) : '';
                    const ancestor = path === '/' || path === mount.root || mount.root.startsWith(path + '/');
                    if (ancestor && ['getNode', 'getNodeType', 'exists'].includes(key)) {
                        if (key === 'exists') return true;
                        return { type: 'directory', path, parentPath: path === '/' ? null : path.slice(0, path.lastIndexOf('/')) || '/',
                            name: path.split('/').pop() ?? '', version: 0, createdAt: 0, modifiedAt: 0, tags: [], metadata: { unavailable: true } };
                    }
                    throw new FSError('EIO', 'Remote source unavailable');
                }
                try { const fs = await current(); return await (fs.driver as any)[key](...args); }
                catch (error) {
                    let cause = error;
                    for (let depth = 0; depth < 16 && cause instanceof FSError; depth++, cause = cause.cause) {
                        if (cause.operation === 'connect') { this.setStatus(mount.mountId, 'offline'); break; }
                    }
                    throw error;
                }
            };
        } });
        return new Proxy(fallback, { get: (target, key) => {
            if (key === 'driver') return driver;
            if (key === 'capabilitiesAt') return async (path: string, options?: OperationOptions) => {
                const caps = await (await current()).capabilitiesAt(path, options);
                return { ...caps, readonly: this.status(mount.mountId) === 'offline' || caps.readonly };
            };
            const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
        } });
    }
    private resolve(mount: ProjectRemoteMount, options?: OperationOptions) {
        let owner = this.sources.get(mount.mountId);
        if (!owner) {
            owner = this.provider.open(mount, options); this.sources.set(mount.mountId, owner);
            void owner.catch(() => { if (this.sources.get(mount.mountId) === owner) this.sources.delete(mount.mountId); });
        }
        return owner;
    }
    private unavailable(id: string) {
        if (!this.missing.has(id)) this.missing.set(id, createUnavailableDirectory(id));
        return this.missing.get(id)!;
    }
    private async save(projectId: string, mounts: ProjectRemoteMount[]) {
        await this.persist({ ...this.catalog, projects: { ...this.catalog.projects, [projectId]: mounts } });
    }
    private async persist(catalog: Catalog) {
        const next = { ...catalog, revision: this.catalog.revision + 1 };
        const content = JSON.stringify(next);
        if (!this.store.meta.seq?.transaction) throw new FSError('ECAPABILITY', 'Remote grants require transactional records');
        if (!await this.store.driver.exists(catalogPath)) {
            try { await this.store.driver.createFile({ parentPath: '/etc', name: 'project-remote-mounts.seq', type: 'seqfile', recursive: true }); }
            catch (error) { if (!(error instanceof FSError) || error.code !== 'EEXIST') throw error; }
        }
        await this.store.meta.seq.transaction(async tx => {
            if (!await tx.compareAndSet(catalogPath, 'catalog', { expected: this.persisted, value: content })) throw new FSError('ECONFLICT', 'Remote grants changed; reload the project');
        });
        this.persisted = content; this.catalog = next;
    }
    private serial<T>(action: () => Promise<T>): Promise<T> {
        if (this.closed) return Promise.reject(new FSError('EACCES', 'Remote mounts closed'));
        const pending = this.tail.catch(() => {}).then(() => { if (this.closed) throw new FSError('EACCES', 'Remote mounts closed'); return action(); });
        this.tail = pending; return pending;
    }
}

function validateMount(mount: ProjectRemoteMount): void {
    if (!mount || !['ro', 'rw'].includes(mount.access) || typeof mount.mountId !== 'string' || typeof mount.credentialRef !== 'string'
        || !(mount.at === '/' && mount.connectionId || /^\/[a-zA-Z0-9_-]+$/.test(mount.at)) || ['attachments', 'etc', 'var', 'dev', 'run', 'history', 'session'].includes(mount.at.slice(1))) throw new FSError('EINVAL', 'Invalid remote mount');
    normalizeVirtualPath(mount.root);
    const url = new URL(mount.endpoint);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash
        || !/^[a-zA-Z0-9_-]+$/.test(mount.alias)) throw new FSError('EINVAL', 'Invalid remote connection');
}
