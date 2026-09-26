import { sessionFamilyRoots } from '../projects/session-family';
import { createFileSystemSource, FSError, normalizeVirtualPath, type FSNode, type IStorageBackend } from '@itookit/vfs-core';
import { t, ENTITY_ICONS } from '@itookit/common';
import type { ISessionRepository, SessionFolder } from '@itookit/llm-session';
import type { EventEnvelope, Kernel, TaskRecord } from '@itookit/durable-kernel';
import { taskStat } from '@itookit/durable-kernel';
import type { SessionFilesService } from '../vfs/session-files';
import { exportSessionBundle, importSessionBundle, isSessionBundle } from './session-bundle';
import type { ProjectService } from '../projects/project-service';
import { SessionLifecycleService } from './session-lifecycle';

export type BrowserTarget =
    | { kind: 'folder'; path: string }
    | { kind: 'project-files'; folder: string; path: string }
    | { kind: 'session'; sessionId: string }
    | { kind: 'tasks'; sessionId: string }
    | { kind: 'task'; sessionId: string; taskId: string }
    | { kind: 'files'; sessionId: string; path: string };

type FileTarget = Extract<BrowserTarget, { kind: 'files' | 'project-files' }>;
function isFileTarget(target: BrowserTarget): target is FileTarget { return target.kind === 'files' || target.kind === 'project-files'; }

const FOLDER_SEGMENT_PREFIX = 'folder:';

function isFolderSegment(segment: string): boolean {
    return segment.startsWith(FOLDER_SEGMENT_PREFIX) && segment.length > FOLDER_SEGMENT_PREFIX.length;
}
export function folderBrowserPath(folder: string | null | undefined): string {
    if (!folder || folder === '/') return '';
    return '/' + folder.split('/').filter(Boolean).map(segment => FOLDER_SEGMENT_PREFIX + encodeURIComponent(segment)).join('/');
}
function browserFolderPath(path: string): string | null {
    const segments = normalizeVirtualPath(path).slice(1).split('/').filter(Boolean);
    const prefix: string[] = [];
    for (const segment of segments) {
        if (!isFolderSegment(segment)) break;
        prefix.push(segment);
    }
    return prefix.length ? '/' + prefix.join('/') : null;
}
export function folderPathFromBrowserPath(path: string): string | null {
    const prefix = browserFolderPath(path);
    if (!prefix) return null;
    return '/' + prefix.slice(1).split('/').filter(Boolean).map(segment => decodeURIComponent(segment.slice(FOLDER_SEGMENT_PREFIX.length))).join('/');
}
function sessionBrowserPrefix(path: string): string {
    const segments = normalizeVirtualPath(path).slice(1).split('/').filter(Boolean);
    let index = 0;
    while (index < segments.length && isFolderSegment(segments[index])) index++;
    return '/' + segments.slice(0, index + 1).join('/');
}
function filesBrowserPrefix(path: string): string {
    const target = resolveBrowserTarget(path);
    return target.kind === 'project-files' ? `${folderBrowserPath(target.folder)}/@files` : `${sessionBrowserPrefix(path)}/files`;
}
function parentBrowserPath(path: string): string {
    const normalized = normalizeVirtualPath(path);
    const index = normalized.lastIndexOf('/');
    return index <= 0 ? '/' : normalized.slice(0, index);
}
function browserName(path: string): string {
    const segment = normalizeVirtualPath(path).split('/').filter(Boolean).pop() ?? '';
    return isFolderSegment(segment) ? decodeURIComponent(segment.slice(FOLDER_SEGMENT_PREFIX.length)) : segment;
}
export function resolveBrowserTarget(path: string): BrowserTarget {
    const normalized = normalizeVirtualPath(path);
    if (normalized === '/') return { kind: 'folder', path: '/' };
    const segments = normalized.slice(1).split('/').filter(Boolean);
    let index = 0;
    while (index < segments.length && isFolderSegment(segments[index])) index++;
    const folderPrefix = '/' + segments.slice(0, index).join('/');
    if (index === segments.length) return { kind: 'folder', path: folderPrefix };
    if (segments[index] === '@files' && index > 0) return { kind: 'project-files',
        folder: folderPathFromBrowserPath(folderPrefix)!, path: '/' + segments.slice(index + 1).join('/') };
    const sessionId = segments[index];
    if (!/^[a-zA-Z0-9_-]+$/.test(sessionId)) throw new FSError('EINVAL', 'Invalid Session browser path');
    const area = segments[index + 1];
    const rest = segments.slice(index + 2);
    if (!area) return { kind: 'session', sessionId };
    if (area === 'files') {
        const filePath = '/' + rest.join('/');
        return { kind: 'files', sessionId, path: filePath };
    }
    if (area === 'tasks' && !rest.length) return { kind: 'tasks', sessionId };
    if (area === 'tasks' && rest.length === 1 && rest[0] === '@more') return { kind: 'tasks', sessionId };
    if (area === 'tasks' && rest.length === 1 && /^[a-zA-Z0-9_-]+$/.test(rest[0])) return { kind: 'task', sessionId, taskId: rest[0] };
    throw new FSError('ENOENT', 'Session browser entry not found');
}
export function taskSummary(task: TaskRecord) {
    // `control.acknowledged` is false while a cancel is still waiting for the external stop to
    // be confirmed, so an observer can tell "requested" apart from "really stopped".
    const stat = taskStat(task);
    return { id: task.id, sessionId: task.sessionId, parentTaskId: task.parentTaskId, program: task.program,
        status: task.status, version: task.version, createdAt: task.createdAt, updatedAt: task.updatedAt,
        input: task.input, output: task.output, error: task.lastError,
        control: stat.control, activeOperations: stat.activeOperations };
}
/** User-facing timeline: omit scheduler chatter and streamed text already in the result. */
export function taskKeyEvent(event: EventEnvelope) {
    const type = event.type;
    const payload = event.payload && typeof event.payload === 'object'
        ? event.payload as Record<string, unknown> : undefined;
    const agentType = type === 'agent.event' && typeof payload?.type === 'string' ? payload.type : undefined;
    const key = agentType
        ? /^(tool:|skill:)/.test(agentType) || agentType === 'error'
        : /^(task\.interaction\.|task\.control\.|effect\.retry\.|effect\.resolved$|task\.attempt\.lost$|task\.program\.unavailable$)/.test(type)
            || ['task.failed', 'task.cancelled', 'effect.failed', 'effect.indeterminate', 'task.spawned'].includes(type);
    if (!key) return undefined;
    return { sequence: event.sequence, occurredAt: event.occurredAt, type: agentType ?? type, payload: event.payload };
}
export interface SessionBrowserDependencies {
    repository: ISessionRepository;
    projects?: ProjectService;
    files: SessionFilesService;
    kernel: Kernel;
    /** Defaults to a service over `repository` and `kernel`. */
    lifecycle?: SessionLifecycleService;
}
class BrowserBackend implements IStorageBackend {
    readonly name = 'session-browser';
    private readonly lifecycle: SessionLifecycleService;
    constructor(private readonly deps: SessionBrowserDependencies) {
        this.lifecycle = deps.lifecycle ?? new SessionLifecycleService({ repository: deps.repository, kernel: deps.kernel });
    }
    async init() {} async close() {}
    async assertMutableSubtree(_path: string): Promise<void> {
        // Displayed tasks and mounted files are not owned Session storage. Session lifecycle
        // and delegated file mutations enforce the layout guard on the actual storage instead.
    }
    /** `readOnly` marks entries the backend refuses to mutate (Task history). */
    private node(path: string, title: string, directory: boolean, updatedAt = 0, readOnly = false): FSNode {
        const segment = path.split('/').pop() || '';
        const name = isFolderSegment(segment) ? decodeURIComponent(segment.slice(FOLDER_SEGMENT_PREFIX.length)) : segment;
        const base = { path, name, parentPath: path === '/' ? null : path.slice(0, path.lastIndexOf('/')) || '/',
            createdAt: updatedAt, modifiedAt: updatedAt, version: 1, tags: [],
            metadata: { title, _showAll: true, ...(readOnly ? { _readOnly: true } : {}) }, icon: directory ? '📁' : '📋' };
        return directory ? { ...base, type: 'directory' } : { ...base, type: 'file', size: 0 };
    }
    private async withFiles<T>(target: FileTarget, fn: (fs: import('@itookit/vfs-core').IFileSystem) => Promise<T>): Promise<T> {
        if (target.kind === 'project-files') {
            if (!this.deps.projects) throw new FSError('ENOENT', 'Projects unavailable');
            const owner = await this.deps.projects.openFiles(target.folder);
            try { return await fn(owner.fs); } finally { await owner.dispose(); }
        }
        const owner = await this.deps.files.acquireFiles(target.sessionId);
        try { return await fn(owner.context.fs); } finally { await owner.release(); }
    }
    private async mapped(fs: import('@itookit/vfs-core').IFileSystem, node: FSNode, prefix: string): Promise<FSNode> {
        const readOnly = node.metadata?._readOnly === true || (await fs.capabilitiesAt(node.path)).readonly;
        return { ...node, ...(node.type === 'file' && node.assetDirPath ? { assetDirPath: prefix + node.assetDirPath } : {}), path: prefix + (node.path === '/' ? '' : node.path), parentPath: node.path === '/' ? prefix : prefix + (node.parentPath === '/' ? '' : node.parentPath ?? ''), metadata: { ...node.metadata, _showAll: true, _readOnly: readOnly } };
    }
    private sessionBrowserPath(id: string, folder: string | null | undefined): string {
        return `${folderBrowserPath(folder)}/${id}`;
    }
    private sessionNode(manifest: { id: string; title: string; createdAt: number; updatedAt: number; folder?: string | null; parentSessionId?: string | null }): FSNode {
        return { ...this.node(this.sessionBrowserPath(manifest.id, manifest.folder), manifest.title, true, manifest.updatedAt),
            createdAt: manifest.createdAt, icon: ENTITY_ICONS.chat, metadata: { title: manifest.title, _showAll: true, parentSessionId: manifest.parentSessionId ?? null } };
    }
    private sessionNodes(sessions: import('@itookit/llm-session').ConversationManifest[], folder: string | null): FSNode[] {
        const roots = sessionFamilyRoots(sessions);
        const counts = new Map<string, number>();
        for (const root of roots.values()) counts.set(root, (counts.get(root) ?? 0) + 1);
        return sessions.filter(item => (item.folder ?? null) === folder).map(item => {
            const node = this.sessionNode(item), root = roots.get(item.id)!;
            return { ...node, metadata: { ...node.metadata, familyRoot: root, familyCount: counts.get(root) ?? 1,
                parentTitle: sessions.find(parent => parent.id === item.parentSessionId)?.title ?? '' } };
        });
    }
    private folderNode(folder: SessionFolder): FSNode {
        const title = folder.name === '@sessions' ? t('project.sessions') : folder.name;
        const node = this.node(folderBrowserPath(folder.path), title, true, folder.updatedAt);
        return { ...node, ...(folder.project ? { icon: ENTITY_ICONS.project } : {}),
            metadata: { ...node.metadata, ...(folder.project ? { projectId: folder.project.id, directory: folder.project.directory } : {}) } };
    }
    private isFolderContainer(path: string): boolean {
        if (path === '/') return true;
        try { return resolveBrowserTarget(path).kind === 'folder'; } catch { return false; }
    }
    private async sessionBundle(id: string): Promise<Uint8Array> {
        return new TextEncoder().encode((await exportSessionBundle(this.deps.repository, id)).content);
    }
    async stat(path: string): Promise<FSNode | null> {
        if (path === '/') return this.node('/', 'Sessions', true);
        let target: BrowserTarget;
        try { target = resolveBrowserTarget(path); }
        catch (error) { if (error instanceof FSError && error.code === 'EINVAL') return null; throw error; }
        if (target.kind === 'folder') {
            const folderPath = folderPathFromBrowserPath(path);
            if (!folderPath) return this.node('/', 'Sessions', true);
            const folder = (await this.deps.repository.listFolders()).find(item => item.path === folderPath);
            return folder ? this.folderNode(folder) : null;
        }
        if (target.kind === 'project-files') return this.statFiles(path, target);
        let manifest;
        try { manifest = await this.deps.repository.getManifest(target.sessionId); }
        catch (error) { if (error instanceof FSError && error.code === 'ENOENT') return null; throw error; }
        if (target.kind === 'session') return this.sessionNode(manifest);
        if (target.kind === 'tasks') return this.node(path, path.endsWith('/@more') ? t('session.tasks.more') : 'tasks', !path.endsWith('/@more'), 0, true);
        if (target.kind === 'task') {
            const task = await this.deps.kernel.task(target.sessionId, target.taskId);
            return this.node(path, `${task.program.kind} · ${task.status} · ${task.id}`, false, task.updatedAt, true);
        }
        return this.statFiles(path, target);
    }
    private statFiles(path: string, target: FileTarget): Promise<FSNode | null> {
        const prefix = filesBrowserPrefix(path);
        return this.withFiles(target, async fs => {
            if (target.path === '/') return this.node(path, t('project.files'), true, 0, (await fs.capabilitiesAt('/')).readonly);
            const node = await fs.driver.getNode(target.path); return node ? this.mapped(fs, node, prefix) : null;
        });
    }
    async list(path: string): Promise<FSNode[]> {
        if (path === '/') {
            const [folders, sessions] = await Promise.all([this.deps.repository.listFolders(), this.deps.repository.list()]);
            return [
                ...folders.filter(folder => !folder.parentPath).map(folder => this.folderNode(folder)),
                ...this.sessionNodes(sessions, null),
            ];
        }
        const target = resolveBrowserTarget(path);
        if (target.kind === 'folder') {
            const folderPath = folderPathFromBrowserPath(path);
            const [folders, sessions] = await Promise.all([this.deps.repository.listFolders(), this.deps.repository.list()]);
            return [
                ...folders.filter(folder => folder.parentPath === folderPath).map(folder => this.folderNode(folder)),
                ...(this.deps.projects && folders.find(folder => folder.path === folderPath)?.project
                    ? [this.node(path + '/@files', t('project.files'), true)] : []),
                ...this.sessionNodes(sessions, folderPath),
            ];
        }
        if (target.kind === 'project-files') return this.listFiles(path, target);
        await this.deps.repository.getManifest(target.sessionId);
        if (target.kind === 'session') return [this.node(path + '/tasks', 'tasks', true, 0, true), this.node(path + '/files', 'files', true, 0, true)];
        if (target.kind === 'tasks') {
            if (path.endsWith('/@more')) throw new FSError('ENOTDIR', 'Open the paginated Task list');
            let exists = false;
            for await (const session of this.deps.kernel.listSessions()) if (session.id === target.sessionId) { exists = true; break; }
            if (!exists) return [];
            const page = await this.deps.kernel.listSessionTaskPage(target.sessionId);
            const nodes = page.items.map(t => this.node(`${path}/${t.id}`, `${t.program.kind} · ${t.status} · ${t.id}`, false, t.updatedAt, true));
            if (page.nextAfterIndex !== undefined) nodes.push(this.node(`${path}/@more`, t('session.tasks.more'), false, 0, true));
            return nodes;
        }
        if (target.kind === 'files') return this.listFiles(path, target);
        throw new FSError('ENOTDIR', 'Task is a history entry');
    }
    private listFiles(path: string, target: FileTarget): Promise<FSNode[]> {
        const prefix = filesBrowserPrefix(path);
        return this.withFiles(target, async fs => Promise.all((await fs.driver.getChildren(target.path)).map(n => this.mapped(fs, n, prefix))));
    }
    async read(path: string): Promise<Uint8Array> {
        const target = resolveBrowserTarget(path);
        if (target.kind === 'folder') throw new FSError('EISDIR', 'Open this folder using its browser target');
        if (target.kind === 'session') return this.sessionBundle(target.sessionId);
        if (isFileTarget(target)) return this.withFiles(target, async fs => new Uint8Array(await fs.driver.readContent(target.path, { encoding: 'binary' })));
        await this.deps.repository.getManifest(target.sessionId);
        if (target.kind === 'task') {
            const task = await this.deps.kernel.task(target.sessionId, target.taskId);
            return new TextEncoder().encode(JSON.stringify(taskSummary(task), null, 2));
        }
        throw new FSError('EISDIR', 'Open this entry using its browser target');
    }
    async mkdir(path: string): Promise<FSNode> {
        const parent = parentBrowserPath(path);
        if (this.isFolderContainer(parent)) {
            const folderPath = `${folderPathFromBrowserPath(parent) ?? ''}/${browserName(path)}`;
            const folder = await this.deps.repository.createFolder(folderPath);
            return this.folderNode(folder);
        }
        const target = resolveBrowserTarget(path);
        if (isFileTarget(target)) {
            const prefix = filesBrowserPrefix(path);
            return this.withFiles(target, async fs => {
                const node = await fs.driver.createDirectory({ parentPath: parentBrowserPath(target.path), name: browserName(target.path) });
                return this.mapped(fs, node, prefix);
            });
        }
        throw new FSError('EROFS', 'Use the Session file context for this path');
    }
    async write(path: string, content: Uint8Array): Promise<FSNode> {
        const parent = parentBrowserPath(path);
        if (this.isFolderContainer(parent)) {
            const text = new TextDecoder().decode(content);
            const folder = folderPathFromBrowserPath(parent);
            const title = browserName(path).replace(/\.[^.]+$/, '');
            // A bundle restores its index and documents; any other file at folder
            // level is a new empty Session named after it (sidebar file creation).
            const id = isSessionBundle(text)
                ? await importSessionBundle(this.deps.repository, text, { folder })
                : await this.deps.repository.createSession(title || 'Imported Session', folder);
            return this.sessionNode(await this.deps.repository.getManifest(id));
        }
        const target = resolveBrowserTarget(path);
        if (isFileTarget(target)) {
            const prefix = filesBrowserPrefix(path);
            const buffer = content.buffer.slice(content.byteOffset, content.byteOffset + content.byteLength) as ArrayBuffer;
            return this.withFiles(target, async fs => {
                if (await fs.driver.exists(target.path)) {
                    await fs.driver.writeContent(target.path, buffer);
                    const node = await fs.driver.getNode(target.path);
                    if (!node) throw new FSError('EIO', 'Session file disappeared after write');
                    return this.mapped(fs, node, prefix);
                }
                const node = await fs.driver.createFile({ parentPath: parentBrowserPath(target.path), name: browserName(target.path), content: buffer });
                return this.mapped(fs, node, prefix);
            });
        }
        throw new FSError('EROFS', 'Only Session folders and Session files are writable');
    }
    async delete(path: string): Promise<void> {
        const target = resolveBrowserTarget(path);
        if (target.kind === 'folder') {
            const folderPath = folderPathFromBrowserPath(path);
            if (!folderPath) throw new FSError('EINVAL', 'Cannot delete the Session browser root');
            if (folderPath.endsWith('/@sessions')) throw new FSError('EACCES', 'Cannot delete the Sessions section');
            await this.lifecycle.deleteFolder(folderPath, true);
            return;
        }
        if (target.kind === 'session') {
            await this.lifecycle.deleteSession(target.sessionId);
            return;
        }
        if (isFileTarget(target)) {
            if (target.path === '/') throw new FSError('EACCES', 'Cannot delete a file root');
            await this.withFiles(target, fs => fs.driver.delete([target.path], { recursive: true }));
            return;
        }
        throw new FSError('EROFS', 'Tasks are read-only');
    }
    async rename(from: string, to: string): Promise<void> {
        const targetPath = to.startsWith('/') ? to : `${parentBrowserPath(from)}/${to}`;
        const source = resolveBrowserTarget(from);
        if (source.kind === 'session') {
            const manifest = await this.deps.repository.getManifest(source.sessionId);
            await this.deps.projects?.assertMove(manifest.folder ?? null, folderPathFromBrowserPath(parentBrowserPath(targetPath)));
            await this.deps.repository.updateManifest(source.sessionId, {
                title: browserName(targetPath) === browserName(from) ? manifest.title : browserName(targetPath).replace(/\.[^.]+$/, ''),
                folder: folderPathFromBrowserPath(parentBrowserPath(targetPath)),
            });
            return;
        }
        if (source.kind === 'folder') {
            const fromFolder = folderPathFromBrowserPath(from);
            const parentFolder = folderPathFromBrowserPath(parentBrowserPath(targetPath));
            if (!fromFolder) throw new FSError('EINVAL', 'Cannot rename the Session browser root');
            if (fromFolder.endsWith('/@sessions')) throw new FSError('EACCES', 'Cannot rename the Sessions section');
            const folders = await this.deps.repository.listFolders();
            const containsProject = folders.some(folder => folder.project && (folder.path === fromFolder || folder.path.startsWith(fromFolder + '/')));
            await this.deps.projects?.assertMove(fromFolder, parentFolder, containsProject);
            await this.deps.repository.renameFolder(fromFolder, `${parentFolder ?? ''}/${browserName(targetPath)}`);
            return;
        }
        if (isFileTarget(source)) {
            const destination = resolveBrowserTarget(targetPath);
            if (!isFileTarget(destination) || filesBrowserPrefix(from) !== filesBrowserPrefix(targetPath)) throw new FSError('EACCES', 'Cannot move files between projects or Sessions');
            if (source.path === '/') throw new FSError('EACCES', 'Cannot rename a file root');
            await this.withFiles(source, async fs => {
                if (parentBrowserPath(source.path) === parentBrowserPath(destination.path)) {
                    await fs.driver.rename(source.path, browserName(destination.path));
                } else {
                    if (browserName(source.path) !== browserName(destination.path)) throw new FSError('EINVAL', 'Move and rename separately');
                    await fs.driver.move([source.path], parentBrowserPath(destination.path));
                }
            });
            return;
        }
        throw new FSError('EROFS', 'Unsupported browser rename');
    }
    async updateMetadata(path: string, metadata: Record<string, unknown>): Promise<void> {
        const target = resolveBrowserTarget(path);
        if (target.kind === 'session') {
            await this.deps.repository.updateManifest(target.sessionId, {
                ...(typeof metadata.title === 'string' ? { title: metadata.title } : {}),
            });
            return;
        }
        if (isFileTarget(target)) {
            await this.withFiles(target, fs => fs.driver.updateMetadata(target.path, metadata));
            return;
        }
        throw new FSError('EROFS', 'Metadata is read-only for this entry');
    }
    async setTags(path: string, tags: string[]): Promise<void> {
        const target = resolveBrowserTarget(path);
        if (!isFileTarget(target)) throw new FSError('EROFS', 'Tags are read-only for this entry');
        await this.withFiles(target, async fs => {
            if (!fs.meta.tags) throw new FSError('EROFS', 'Tags are unavailable');
            await fs.meta.tags.setTags(target.path, tags);
        });
    }
    async getAllTags(): Promise<string[]> { return []; }
}
export function createSessionBrowser(deps: SessionBrowserDependencies) {
    return createFileSystemSource({ tags: false, backend: new BrowserBackend(deps), viewId: 'session-browser:admin', access: 'rw' });
}
