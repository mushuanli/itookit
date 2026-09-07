import { createFileSystemSource, FSError, normalizeVirtualPath, type FSNode, type IStorageBackend } from '@itookit/vfs-core';
import type { ISessionRepository } from '@itookit/llm-session';
import type { Kernel, TaskRecord } from '@itookit/durable-kernel';
import type { SessionFilesService } from './session-files';

export type BrowserTarget =
    | { kind: 'session'; sessionId: string }
    | { kind: 'tasks'; sessionId: string }
    | { kind: 'task'; sessionId: string; taskId: string }
    | { kind: 'files'; sessionId: string; path: string };
export function resolveBrowserTarget(path: string): BrowserTarget {
    const [sessionId, area, ...rest] = normalizeVirtualPath(path).slice(1).split('/');
    if (!/^[a-zA-Z0-9_-]+$/.test(sessionId)) throw new FSError('EINVAL', 'Invalid Session browser path');
    if (!area) return { kind: 'session', sessionId };
    if (area === 'files') {
        const filePath = '/' + rest.join('/');
        return { kind: 'files', sessionId, path: filePath };
    }
    if (area === 'tasks' && !rest.length) return { kind: 'tasks', sessionId };
    if (area === 'tasks' && rest.length === 1 && /^[a-zA-Z0-9_-]+$/.test(rest[0])) return { kind: 'task', sessionId, taskId: rest[0] };
    throw new FSError('ENOENT', 'Session browser entry not found');
}
export function taskSummary(task: TaskRecord) {
    return { id: task.id, sessionId: task.sessionId, parentTaskId: task.parentTaskId, program: task.program,
        status: task.status, version: task.version, createdAt: task.createdAt, updatedAt: task.updatedAt,
        input: task.input, output: task.output, error: task.lastError };
}
export interface SessionBrowserDependencies { repository: ISessionRepository; files: SessionFilesService; kernel: Kernel; }
class BrowserBackend implements IStorageBackend {
    readonly name = 'session-browser';
    constructor(private readonly deps: SessionBrowserDependencies) {}
    async init() {} async close() {}
    private node(path: string, title: string, directory: boolean, updatedAt = 0): FSNode {
        const base = { path, name: path.split('/').pop() || '', parentPath: path === '/' ? null : path.slice(0, path.lastIndexOf('/')) || '/',
            createdAt: updatedAt, modifiedAt: updatedAt, version: 1, tags: [], metadata: { title, _showAll: true }, icon: directory ? '📁' : '📋' };
        return directory ? { ...base, type: 'directory' } : { ...base, type: 'file', size: 0 };
    }
    private async withFiles<T>(id: string, fn: (fs: import('@itookit/vfs-core').IFileSystem) => Promise<T>): Promise<T> {
        const owner = await this.deps.files.acquireFiles(id, '/');
        try { return await fn(owner.context.fs); } finally { await owner.release(); }
    }
    private mapped(id: string, node: FSNode): FSNode {
        const prefix = `/${id}/files`;
        return { ...node, ...(node.type === 'file' && node.assetDirPath ? { assetDirPath: prefix + node.assetDirPath } : {}), path: prefix + (node.path === '/' ? '' : node.path), parentPath: node.path === '/' ? `/${id}` : prefix + (node.parentPath === '/' ? '' : node.parentPath ?? ''), metadata: { ...node.metadata, _showAll: true } };
    }
    async stat(path: string): Promise<FSNode | null> {
        if (path === '/') return this.node('/', 'Sessions', true);
        const target = resolveBrowserTarget(path);
        const manifest = await this.deps.repository.getManifest(target.sessionId);
        if (target.kind === 'session') return { ...this.node(path, manifest.title, true, manifest.updatedAt), icon: '💬' };
        if (target.kind === 'tasks') return this.node(path, 'tasks', true);
        if (target.kind === 'task') {
            const task = await this.deps.kernel.task(target.sessionId, target.taskId);
            return this.node(path, `${task.program.kind} · ${task.status} · ${task.id}`, false, task.updatedAt);
        }
        return this.withFiles(target.sessionId, async fs => {
            if (target.path === '/') return this.node(path, 'files', true);
            const node = await fs.driver.getNode(target.path); return node ? this.mapped(target.sessionId, node) : null;
        });
    }
    async list(path: string): Promise<FSNode[]> {
        if (path === '/') return (await this.deps.repository.list()).map(s => ({ ...this.node(`/${s.id}`, s.title, true, s.updatedAt), icon: '💬' }));
        const target = resolveBrowserTarget(path);
        await this.deps.repository.getManifest(target.sessionId);
        if (target.kind === 'session') return [this.node(path + '/tasks', 'tasks', true), this.node(path + '/files', 'files', true)];
        if (target.kind === 'tasks') {
            // A new conversation has no Kernel session until its first execution.
            let exists = false;
            for await (const session of this.deps.kernel.listSessions()) if (session.id === target.sessionId) { exists = true; break; }
            if (!exists) return [];
            return (await this.deps.kernel.listSessionTasks(target.sessionId)).map(t => this.node(`${path}/${t.id}`, `${t.program.kind} · ${t.status} · ${t.id}`, false, t.updatedAt));
        }
        if (target.kind === 'files') return this.withFiles(target.sessionId, async fs => (await fs.driver.getChildren(target.path)).map(n => this.mapped(target.sessionId, n)));
        throw new FSError('ENOTDIR', 'Task is a history entry');
    }
    async read(path: string): Promise<Uint8Array> {
        const target = resolveBrowserTarget(path);
        await this.deps.repository.getManifest(target.sessionId);
        if (target.kind === 'files') return this.withFiles(target.sessionId, async fs => new Uint8Array(await fs.driver.readContent(target.path, { encoding: 'binary' })));
        if (target.kind === 'task') {
            await this.deps.kernel.task(target.sessionId, target.taskId);
            return new TextEncoder().encode(JSON.stringify((await this.deps.kernel.taskHistory(target.sessionId, target.taskId)).map(taskSummary), null, 2));
        }
        throw new FSError('EISDIR', 'Open this entry using its browser target');
    }
    async mkdir(): Promise<FSNode> { throw new FSError('EROFS', 'Use the Session file context for edits'); }
    async write(): Promise<FSNode> { throw new FSError('EROFS', 'Read-only browser projection'); }
    async delete(): Promise<void> { throw new FSError('EROFS', 'Read-only browser projection'); }
    async rename(): Promise<void> { throw new FSError('EROFS', 'Use Session title operations'); }
    async updateMetadata(): Promise<void> { throw new FSError('EROFS', 'Read-only browser projection'); }
    async setTags(): Promise<void> { throw new FSError('EROFS', 'Read-only browser projection'); }
    async getAllTags(): Promise<string[]> { return []; }
}
export function createSessionBrowser(deps: SessionBrowserDependencies) {
    return createFileSystemSource({ backend: new BrowserBackend(deps), viewId: 'session-browser:admin', access: 'ro' });
}
