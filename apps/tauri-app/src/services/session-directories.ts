import { invoke } from '@tauri-apps/api/core';
import { createFileSystemSource, type FileSystemSourceOwner, type IFileSystem } from '@itookit/vfs-core';
import { openLocalFSBackend, type IFsOps, type StatResult, type DirEntry } from '@itookit/vfsdriver-localfs';
import { TauriFsOps } from '../fs/tauri-fs-ops';
import { TauriSqlSidecarDb } from '../db/tauri-sql-sidecar';

interface Scope { id: string; root: string; }
class ScopedFsOps implements IFsOps {
    constructor(private readonly scopes: Scope[]) {}
    private target(path: string) {
        const normalized = path.replace(/\\/g, '/');
        const scope = this.scopes.find(s => normalized === s.root || (s.root === '/' ? normalized.startsWith('/') : normalized.startsWith(s.root + '/')));
        if (!scope) throw new Error('Path outside directory source');
        return { id: scope.id, path: normalized.slice(scope.root.length).replace(/^\//, '') };
    }
    private io<T>(operation: string, path: string, extra: object = {}): Promise<T> { return invoke('directory_io', { ...this.target(path), operation, ...extra }); }
    stat(path: string) { return this.io<StatResult | null>('stat', path); }
    exists(path: string) { return this.io<boolean>('exists', path); }
    mkdir(path: string) { return this.io<void>('mkdir', path); }
    readDir(path: string) { return this.io<DirEntry[]>('list', path); }
    async readFile(path: string): Promise<ArrayBuffer | null> { const bytes = await this.io<number[] | null>('read', path); return bytes ? new Uint8Array(bytes).buffer : null; }
    writeFile(path: string, data: ArrayBuffer) { return this.io<void>('write', path, { data: Array.from(new Uint8Array(data)) }); }
    appendFile(path: string, data: ArrayBuffer) { return this.io<void>('append', path, { data: Array.from(new Uint8Array(data)) }); }
    rename(from: string, to: string) { const a = this.target(from), b = this.target(to); if (a.id !== b.id) throw new Error('Cross-source rename forbidden'); return this.io<void>('rename', from, { to: b.path }); }
    unlink(path: string) { return this.io<void>('unlink', path); }
    rmdir(path: string) { return this.io<void>('rmdir', path); }
}

/** Sources for Session grants. Choosing one does not create a global workspace. */
export class TauriSessionDirectories {
    private readonly sources = new Map<string, Promise<{ owner: FileSystemSourceOwner; scopes: Scope[] }>>();
    private readonly canonical = new Map<string, Promise<{ owner: FileSystemSourceOwner; scopes: Scope[] }>>();
    constructor(private readonly rootDir: string) {}
    async selectDirectory(): Promise<string | null> {
        const { open } = await import('@tauri-apps/plugin-dialog');
        const result = await open({ directory: true, multiple: false });
        return typeof result === 'string' ? 'host:' + result : null;
    }
    async openDirectory(path: string): Promise<IFileSystem> {
        if (!this.sources.has(path)) this.sources.set(path, this.open(path));
        try { return (await this.sources.get(path)!).owner.fs; }
        catch (error) { this.sources.delete(path); throw error; }
    }
    private async open(path: string) {
        const data = await invoke<Scope>('directory_open', { path });
        data.root = data.root.replace(/\\/g, '/').replace(/\/$/, '') || '/';
        const existing = this.canonical.get(data.root);
        if (existing) { await invoke('directory_close', { id: data.id }); return existing; }
        const pending = this.openScope(data);
        this.canonical.set(data.root, pending);
        try { return await pending; }
        catch (error) { this.canonical.delete(data.root); throw error; }
    }
    private async openScope(data: Scope) {
        const scopes: Scope[] = [data];
        try {
            const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data.root)));
            const key = Array.from(digest).map(n => n.toString(16).padStart(2, '0')).join('');
            const sidecarPath = `${this.rootDir}/meta/session-sources/${key}`;
            await new TauriFsOps().mkdir(sidecarPath);
            const metadata = await invoke<Scope>('directory_open', { path: sidecarPath }); scopes.unshift(metadata);
            metadata.root = metadata.root.replace(/\\/g, '/').replace(/\/$/, '') || '/';
            const backend = await openLocalFSBackend({ rootDir: data.root, sidecarDir: metadata.root,
                createFs: () => new ScopedFsOps(scopes), createDb: p => TauriSqlSidecarDb.open(p) });
            try { return { owner: await createFileSystemSource({ backend, viewId: `host-directory:${key}` }), scopes }; }
            catch (error) { await backend.close(); throw error; }
        } catch (error) { await Promise.allSettled(scopes.map(s => invoke('directory_close', { id: s.id }))); throw error; }
    }
    async dispose(): Promise<void> {
        for (const result of await Promise.allSettled(this.canonical.values())) if (result.status === 'fulfilled') {
            await result.value.owner.dispose();
            await Promise.all(result.value.scopes.map(s => invoke('directory_close', { id: s.id })));
        }
        this.sources.clear(); this.canonical.clear();
    }
}
