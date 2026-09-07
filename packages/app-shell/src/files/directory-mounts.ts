import { normalizeVirtualPath, type IFileSystem } from '@itookit/vfs-core';
import type { SessionFilesService, SessionMountRecord } from './session-files';

export interface DirectorySourceProvider {
    selectDirectory(): Promise<string | null>;
    /** Returns a source rooted at exactly the selected directory. Owned by the provider. */
    openDirectory(path: string): Promise<IFileSystem>;
    dispose(): Promise<void>;
}
interface DirectoryRef { sourceId: string; root: string; label: string; }
interface Preferences { version: 1; home?: DirectoryRef; external: Record<string, string>; }
const preferencesPath = '/var/lib/kernel/local-sources/session-directories.json';

/** User commands and UI share this host-only service. It is never an Agent tool. */
export class DirectoryMountService {
    private preferences: Preferences = { version: 1, external: {} };
    private closed = false;
    private tail: Promise<unknown> = Promise.resolve();
    private readonly connected = new Set<string>();
    constructor(private readonly root: IFileSystem, private readonly files: SessionFilesService,
        private readonly provider?: DirectorySourceProvider,
        private readonly beforeChange: (sessionId: string) => Promise<void> = async () => {},
        private readonly afterChange: (sessionId: string) => Promise<void> = async () => {}) {}
    async init(): Promise<void> {
        if (await this.root.driver.exists(preferencesPath)) {
            const saved = JSON.parse(await this.root.driver.readContent(preferencesPath, { encoding: 'utf-8' }));
            if (saved.version !== 1 || !saved.external || typeof saved.external !== 'object') throw new Error('Incompatible directory preferences');
            this.preferences = saved;
        }
        for (const [id, path] of Object.entries(this.preferences.external)) {
            try { await this.connect(id, path); } catch { /* Kept for explicit reconnection. Never substitute another source. */ }
        }
    }
    async dispose(): Promise<void> { this.closed = true; await this.tail.catch(() => {}); }
    async listDirectories(path = '/home/admin'): Promise<string[]> {
        const normalized = normalizeVirtualPath(path);
        if (normalized !== '/home/admin' && !normalized.startsWith('/home/admin/')) throw new Error('请选择用户目录');
        return (await this.root.driver.getChildren(normalized)).filter(node => node.type === 'directory').map(node => node.path);
    }
    describe(mount: SessionMountRecord): string {
        return mount.sourceId === 'admin-home' ? '/home/admin' + (mount.root === '/' ? '' : mount.root ?? '') : this.preferences.external[mount.sourceId] ?? mount.sourceId;
    }
    get canSelectHost(): boolean { return this.provider !== undefined; }
    getHome(): string | undefined { return this.preferences.home?.label; }
    async chooseDirectory(): Promise<string | null> { return this.provider?.selectDirectory() ?? null; }
    setHome(directory: string): Promise<string> {
        return this.serial(async () => {
            const source = await this.resolve(directory);
            const previous = this.preferences.home;
            this.preferences.home = source;
            try { await this.persist(); } catch (error) { this.preferences.home = previous; throw error; }
            return `默认目录：${source.label}。使用“挂载默认目录”接入当前会话的 /workspace。`;
        });
    }
    mountHome(sessionId: string): Promise<string> {
        return this.serial(async () => {
            const home = this.preferences.home;
            if (!home) throw new Error('请先使用 /set-home <dir> 设置默认目录');
            const path = this.preferences.external[home.sourceId];
            if (path) await this.connect(home.sourceId, path);
            return this.mount(sessionId, home, 'rw', '/workspace', true);
        });
    }
    addDirectory(sessionId: string, directory: string, access: 'ro' | 'rw' = 'rw', at?: string, asCwd = false): Promise<string> {
        return this.serial(async () => this.mount(sessionId, await this.resolve(directory), access, at, asCwd));
    }
    remove(sessionId: string, mountId: string): Promise<void> {
        return this.serial(async () => {
            await this.beforeChange(sessionId);
            const record = await this.files.inspect(sessionId); if (!record) return;
            const removed = record.mounts.find(m => m.mountId === mountId);
            const cwd = removed && (record.cwd === removed.at || record.cwd.startsWith(removed.at + '/')) ? '/' : record.cwd;
            await this.files.configure(sessionId, { mounts: record.mounts.filter(m => m.mountId !== mountId), cwd }, record.revision);
            await this.afterChange(sessionId);
        });
    }
    reconnect(sessionId: string, mountId: string): Promise<void> {
        return this.serial(async () => {
            await this.beforeChange(sessionId);
            const record = await this.files.inspect(sessionId);
            const mount = record?.mounts.find(m => m.mountId === mountId);
            if (!record || !mount) throw new Error('挂载不存在');
            const path = this.preferences.external[mount.sourceId];
            if (path) await this.connect(mount.sourceId, path);
            await this.files.configure(sessionId, { mounts: record.mounts, cwd: record.cwd }, record.revision);
            await this.afterChange(sessionId);
        });
    }
    update(sessionId: string, mountId: string, access: 'ro' | 'rw', asCwd: boolean): Promise<void> {
        return this.serial(async () => {
            await this.beforeChange(sessionId);
            const record = await this.files.inspect(sessionId);
            const mount = record?.mounts.find(m => m.mountId === mountId);
            if (!record || !mount) throw new Error('挂载不存在');
            await this.files.configure(sessionId, { mounts: record.mounts.map(m => m.mountId === mountId ? { ...m, access } : m), cwd: asCwd ? mount.at : record.cwd }, record.revision);
            await this.afterChange(sessionId);
        });
    }
    private async mount(sessionId: string, source: DirectoryRef, access: 'ro' | 'rw', requestedAt?: string, asCwd = false): Promise<string> {
        await this.beforeChange(sessionId);
        const record = await this.files.inspect(sessionId);
        const mounts = record?.mounts ?? [];
        const same = mounts.find(m => m.sourceId === source.sourceId && (m.root ?? '/') === source.root);
        const name = source.label.split(/[\\/]/).filter(Boolean).pop()?.replace(/[^a-zA-Z0-9_-]/g, '-') || 'directory';
        const at = normalizeVirtualPath(requestedAt ?? same?.at ?? '/' + name);
        if (mounts.some(m => m.at === at && m.mountId !== same?.mountId)) throw new Error(`挂载点已存在：${at}，请在挂载界面选择其他名称`);
        const mount: SessionMountRecord = { mountId: same?.mountId ?? crypto.randomUUID(), at, sourceId: source.sourceId, root: source.root, access };
        await this.files.configure(sessionId, { mounts: [...mounts.filter(m => m.mountId !== same?.mountId), mount], cwd: asCwd ? at : record?.cwd ?? '/' }, record?.revision ?? 0);
        await this.afterChange(sessionId);
        return `已挂载 ${source.label} → ${at}（${access === 'ro' ? '只读' : '可读写'}）`;
    }
    private async resolve(raw: string): Promise<DirectoryRef> {
        const path = raw.trim(); if (!path) throw new Error('请选择目录');
        const internal = path === '~' ? '/home/admin' : path.startsWith('~/') ? '/home/admin/' + path.slice(2) : path;
        if (internal === '/home/admin' || internal.startsWith('/home/admin/')) {
            const normalized = normalizeVirtualPath(internal);
            if (normalized !== '/home/admin' && !normalized.startsWith('/home/admin/')) throw new Error('目录超出用户范围');
            if ((await this.root.driver.getNode(normalized))?.type !== 'directory') throw new Error('目录不存在');
            return { sourceId: 'admin-home', root: normalized.slice('/home/admin'.length) || '/', label: normalized };
        }
        if (!this.provider) throw new Error('此平台未提供宿主目录挂载；应用内目录请使用 /home/admin/...');
        const hostPath = path.startsWith('host:') ? path.slice(5) : path;
        let id = Object.entries(this.preferences.external).find(([, p]) => p === hostPath)?.[0];
        if (!id) {
            id = `directory-${crypto.randomUUID()}`;
            await this.connect(id, hostPath);
            this.preferences.external[id] = hostPath;
            try { await this.persist(); } catch (error) { delete this.preferences.external[id]; throw error; }
        } else await this.connect(id, hostPath);
        return { sourceId: id, root: '/', label: hostPath };
    }
    private async connect(id: string, path: string): Promise<void> {
        if (this.connected.has(id)) return;
        if (!this.provider) throw new Error('目录来源不可用');
        this.files.registerSource(id, await this.provider.openDirectory(path)); this.connected.add(id);
    }
    private async persist(): Promise<void> {
        const content = JSON.stringify(this.preferences);
        if (await this.root.driver.exists(preferencesPath)) await this.root.driver.writeContent(preferencesPath, content);
        else await this.root.driver.createFile({ parentPath: '/var/lib/kernel/local-sources', name: 'session-directories.json', content, recursive: true });
    }
    private serial<T>(fn: () => Promise<T>): Promise<T> { if (this.closed) return Promise.reject(new Error('Directory mount service closed')); const next = this.tail.catch(() => {}).then(fn); this.tail = next; return next; }
}
