import { generateUUID } from '@itookit/common';
import { createFileSystemView, FSError, type IFileSystem, type ISeqFileTransaction } from '@itookit/vfs-core';
import { DEFAULT_SESSION_SETTINGS, type ChatSessionSettings, type ConversationManifest, type ConversationUIState, type ISessionRepository, type SessionFolder, type SessionOrigin } from './types';
import { sessionStorageRoot } from './session-storage-layout';

const FOLDERS_PATH = '/var/lib/sessions/folders.seq';
const FOLDERS_KEY = 'folders';

interface SessionPaths { root: string; session: string; history: string }

/** Session identity, history and attachments. No document path is a Session identity. */
export class SessionRepository implements ISessionRepository {
    private readonly listeners = new Set<() => void>();
    private closed = false;
    constructor(private readonly fs: IFileSystem,
        private readonly initializeNewSession?: (sessionId: string) => Promise<void>) {}
    async init(): Promise<void> {
        if (this.closed) throw new FSError('EACCES', 'Session repository is closed');
        if (!this.fs.meta.seq?.transaction) throw new Error('Session storage requires record transactions');
    }
    async dispose(): Promise<void> { this.closed = true; this.listeners.clear(); }
    subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
    private notify() { for (const listener of this.listeners) listener(); }
    private root(id: string) { if (this.closed) throw new FSError('EACCES', 'Session repository is closed'); return sessionStorageRoot(id); }
    private name(name: string): string {
        if (!name || name.includes('/') || name.includes('\\') || name.includes('\0') || name === '.' || name === '..') throw new FSError('EINVAL', 'Invalid Session data name');
        return name;
    }
    private paths(id: string): SessionPaths { const root = this.root(id); return { root, session: `${root}/session.seq`, history: `${root}/history.seq` }; }
    async createSession(title: string, folder: string | null = null): Promise<string> {
        return this.ensureSession(generateUUID(), title, 'tauri', folder);
    }
    /** Idempotently create a Session with a host-supplied durable identity. */
    async ensureSession(id: string, title: string, origin: SessionOrigin = 'tauri', folder: string | null = null): Promise<string> {
        if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new FSError('EINVAL', 'Invalid Session identity');
        const p = this.paths(id);
        const normalizedFolder = normalizeFolderPath(folder);
        const now = Date.now();
        const existed = await this.fs.driver.exists(p.session);
        let repaired = await this.ensureSessionFiles(p);
        await this.ensureFolderRecord();
        try {
            if (await this.fs.meta.seq!.transaction!(tx => this.initializeSessionTx(tx, p, { id, title, origin, folder: normalizedFolder, now }))) {
                repaired = true;
            }
            if (!existed) await this.initializeNewSession?.(id);
        } catch (error) {
            // Only this call's own empty directory is removed; an existing Session
            // that merely failed to validate is left untouched.
            if (!existed) await this.fs.driver.delete([p.root], { recursive: true }).catch(() => undefined);
            throw error;
        }
        if (repaired) this.notify();
        return id;
    }
    /** Create missing seq files; a fresh file must start empty (records outlive files). */
    private async ensureSessionFiles(p: SessionPaths): Promise<boolean> {
        let repaired = false;
        for (const [path, name] of [[p.session, 'session.seq'], [p.history, 'history.seq']] as const) {
            if (await this.fs.driver.exists(path)) continue;
            await this.fs.driver.createFile({ name, parentPath: p.root, type: 'seqfile', recursive: true });
            await this.clearEntries([path]);
            repaired = true;
        }
        if (!await this.fs.driver.exists(`${p.root}/attachments`)) {
            await this.fs.driver.createDirectory({ name: 'attachments', parentPath: p.root });
            repaired = true;
        }
        return repaired;
    }
    /** Returns whether anything had to be repaired (session, settings or history). */
    private async initializeSessionTx(tx: ISeqFileTransaction, p: SessionPaths, init: {
        id: string; title: string; origin: SessionOrigin; folder: string | null; now: number;
    }): Promise<boolean> {
        let repaired = false;
        const rawSession = await tx.getEntry(p.session, 'session');
        if (rawSession) {
            const session = JSON.parse(rawSession);
            if (session.storageVersion !== 1 || session.id !== init.id) throw new Error('Session storage version incompatible');
        } else {
            // A new Session must land in an existing folder; otherwise it would be
            // invisible in every listing without any way to reach it.
            if (init.folder && !(await this.readFolderEntries(tx)).some(item => item.path === init.folder)) {
                throw new FSError('ENOENT', 'Session folder not found');
            }
            const record = { storageVersion: 1, id: init.id, title: init.title, origin: init.origin, folder: init.folder,
                createdAt: init.now, updatedAt: init.now, revision: 0 };
            await tx.setEntry(p.session, 'session', JSON.stringify(record));
            repaired = true;
        }
        if (!await tx.getEntry(p.session, 'settings')) {
            await tx.setEntry(p.session, 'settings', JSON.stringify(DEFAULT_SESSION_SETTINGS));
            repaired = true;
        }
        const rawHistory = await tx.getEntry(p.history, 'index');
        if (rawHistory) {
            const history = JSON.parse(rawHistory);
            if (history?.schemaVersion !== 3) throw new Error('Session history version incompatible');
        } else {
            await tx.setEntry(p.history, 'index', JSON.stringify({ schemaVersion: 3, rootRoundId: null, branches: { main: null }, branchMeta: {}, currentBranch: 'main', currentHead: null, children: {} }));
            repaired = true;
        }
        return repaired;
    }
    async getManifest(id: string): Promise<ConversationManifest> {
        const p = this.paths(id);
        return this.fs.meta.seq!.transaction!(async tx => {
            const raw = await tx.getEntry(p.session, 'session');
            if (!raw) throw new FSError('ENOENT', `Session not found: ${id}`);
            const session = JSON.parse(raw);
            if (session.storageVersion !== 1 || session.id !== id) throw new Error('Session storage version incompatible');
            const rawHistory = await tx.getEntry(p.history, 'index');
            if (!rawHistory) throw new FSError('ENOENT', `Session history not found: ${id}`);
            const history = JSON.parse(rawHistory);
            if (history?.schemaVersion !== 3) throw new Error('Session history version incompatible');
            return { ...session, ...history };
        });
    }
    async list(): Promise<ConversationManifest[]> {
        this.root('catalog');
        if (!await this.fs.driver.exists('/var/lib/sessions')) return [];
        const result: ConversationManifest[] = [];
        for (const node of await this.fs.driver.getChildren('/var/lib/sessions')) {
            if (node.type !== 'directory' || !await this.fs.driver.exists(`${node.path}/session.seq`)) continue;
            try {
                result.push(await this.getManifest(node.name));
            } catch (error) {
                // A crash can leave seqfiles behind before the init transaction
                // commits; skip incomplete records until ensureSession repairs them.
                if (!(error instanceof FSError && error.code === 'ENOENT')) throw error;
            }
        }
        return result.sort((a, b) => b.updatedAt - a.updatedAt);
    }
    async deleteSession(id: string): Promise<void> {
        const root = this.root(id);
        const p = this.paths(id);
        await this.getManifest(id);
        // Physical storage goes first. Clearing records before a delete that can
        // still fail (fixed Kernel layout, host permissions) loses the Session
        // while leaving its directory behind, which is unrecoverable.
        if (await this.fs.driver.exists(root)) await this.fs.driver.delete([root], { recursive: true });
        // Deleting files does not purge SeqFile records, and stale records would
        // resurrect the Session if its identity is ever reused.
        await this.clearEntries([p.session, p.history]);
        this.notify();
    }
    async listFolders(): Promise<SessionFolder[]> {
        return (await this.readFolders()).sort((a, b) => a.path.localeCompare(b.path));
    }
    async createFolder(path: string): Promise<SessionFolder> {
        const normalized = normalizeFolderPath(path);
        if (!normalized) throw new FSError('EINVAL', 'Invalid Session folder path');
        const folder = await this.mutateFolders(folders => {
            const existing = folders.find(item => item.path === normalized);
            if (existing) return { folders, result: existing };
            const parentPath = folderParent(normalized);
            if (parentPath && !folders.some(item => item.path === parentPath)) throw new FSError('ENOENT', 'Parent Session folder not found');
            const created: SessionFolder = { path: normalized, name: normalized.slice(normalized.lastIndexOf('/') + 1), parentPath, updatedAt: Date.now() };
            return { folders: [...folders, created], result: created };
        });
        this.notify();
        return folder;
    }
    async deleteFolder(path: string, recursive = false): Promise<void> {
        const normalized = normalizeFolderPath(path);
        if (!normalized) throw new FSError('EINVAL', 'Invalid Session folder path');
        const folders = await this.readFolders();
        if (!folders.some(folder => folder.path === normalized)) throw new FSError('ENOENT', 'Session folder not found');
        const sessions = (await this.list()).filter(session => session.folder === normalized || session.folder?.startsWith(`${normalized}/`));
        const hasChildren = folders.some(folder => folder.parentPath === normalized);
        if ((hasChildren || sessions.length) && !recursive) throw new FSError('ENOTEMPTY', 'Session folder is not empty');
        if (recursive) for (const session of sessions) await this.deleteSession(session.id);
        await this.mutateFolders(current => ({
            folders: current.filter(folder => folder.path !== normalized && !folder.path.startsWith(`${normalized}/`)),
            result: undefined,
        }));
        this.notify();
    }
    async renameFolder(from: string, to: string): Promise<void> {
        const source = normalizeFolderPath(from), target = normalizeFolderPath(to);
        if (!source || !target) throw new FSError('EINVAL', 'Invalid Session folder path');
        const folders = await this.readFolders();
        if (!folders.some(folder => folder.path === source)) throw new FSError('ENOENT', 'Session folder not found');
        if (folders.some(folder => folder.path === target)) throw new FSError('EEXIST', 'Session folder already exists');
        if (target.startsWith(`${source}/`)) throw new FSError('EINVAL', 'Cannot move a Session folder into itself');
        const parentPath = folderParent(target);
        if (parentPath && !folders.some(folder => folder.path === parentPath)) throw new FSError('ENOENT', 'Parent Session folder not found');
        const now = Date.now();
        const owned = (await this.list()).filter(session => session.folder === source || session.folder?.startsWith(`${source}/`));
        await this.ensureFolderRecord();
        // Folder records and every affected Session ownership change commit together,
        // so a failure can never leave Sessions pointing at a folder that is gone.
        await this.fs.meta.seq!.transaction!(async tx => {
            const current = await this.readFolderEntries(tx);
            if (!current.some(folder => folder.path === source)) throw new FSError('ENOENT', 'Session folder not found');
            if (current.some(folder => folder.path === target)) throw new FSError('EEXIST', 'Session folder already exists');
            await tx.setEntry(FOLDERS_PATH, FOLDERS_KEY, JSON.stringify(current.map(folder => {
                if (folder.path === source) return { ...folder, path: target, name: target.slice(target.lastIndexOf('/') + 1), parentPath, updatedAt: now };
                if (folder.path.startsWith(`${source}/`)) {
                    const path = target + folder.path.slice(source.length);
                    return { ...folder, path, parentPath: folderParent(path), updatedAt: now };
                }
                return folder;
            })));
            for (const session of owned) {
                const folder = session.folder === source ? target : target + (session.folder ?? '').slice(source.length);
                await this.writeManifestTx(tx, this.paths(session.id), { folder });
            }
        });
        this.notify();
    }
    async updateManifest(id: string, patch: Partial<ConversationManifest>): Promise<void> {
        const p = this.paths(id);
        if (patch.id && patch.id !== id) throw new FSError('EINVAL', 'Session identity cannot change');
        if (patch.folder !== undefined) await this.ensureFolderRecord();
        await this.fs.meta.seq!.transaction!(tx => this.writeManifestTx(tx, p, patch));
        this.notify();
    }
    private async writeManifestTx(tx: ISeqFileTransaction, p: SessionPaths, patch: Partial<ConversationManifest>): Promise<void> {
        const raw = await tx.getEntry(p.session, 'session');
        if (!raw) throw new FSError('ENOENT', 'Session not found');
        const current = JSON.parse(raw);
        if (current.storageVersion !== 1) throw new Error('Session storage version incompatible');
        const { id: _id, title, summary, origin, folder, uiState, flow, createdAt: _created, updatedAt: _updated, ...historyPatch } = patch;
        const normalizedFolder = folder === undefined ? undefined : normalizeFolderPath(folder);
        if (normalizedFolder && normalizedFolder !== current.folder
            && !(await this.readFolderEntries(tx)).some(item => item.path === normalizedFolder)) {
            throw new FSError('ENOENT', 'Session folder not found');
        }
        const next = { ...current, ...(title !== undefined ? { title } : {}), ...(summary !== undefined ? { summary } : {}), ...(origin !== undefined ? { origin } : {}),
            ...(normalizedFolder !== undefined ? { folder: normalizedFolder } : {}),
            ...(uiState ? { uiState: { ...current.uiState, ...uiState, ...(uiState.branchDrafts ? { branchDrafts: { ...current.uiState?.branchDrafts, ...uiState.branchDrafts } } : {}) } } : {}), ...(flow ? { flow } : {}), updatedAt: Date.now(), revision: current.revision + 1 };
        const index = JSON.parse(await tx.getEntry(p.history, 'index') ?? 'null');
        if (index?.schemaVersion !== 3) throw new Error('Session history version incompatible');
        await tx.setEntry(p.session, 'session', JSON.stringify(next));
        await tx.setEntry(p.history, 'index', JSON.stringify({ ...index, ...historyPatch, schemaVersion: 3 }));
    }
    async getUIState(id: string): Promise<ConversationUIState | null> { return (await this.getManifest(id)).uiState ?? null; }
    async updateUIState(id: string, updates: Partial<ConversationUIState>): Promise<void> { await this.updateManifest(id, { uiState: updates }); }
    async getSessionSettings(id: string): Promise<ChatSessionSettings> {
        await this.getManifest(id);
        return { ...DEFAULT_SESSION_SETTINGS, ...JSON.parse(await this.fs.meta.seq!.getEntry(this.paths(id).session, 'settings') ?? '{}') };
    }
    async saveSessionSettings(id: string, patch: Partial<ChatSessionSettings>): Promise<void> {
        await this.getManifest(id);
        const path = this.paths(id).session;
        await this.fs.meta.seq!.transaction!(async tx => {
            const current = JSON.parse(await tx.getEntry(path, 'settings') ?? '{}');
            await tx.setEntry(path, 'settings', JSON.stringify({ ...current, ...patch, version: '1.0', updatedAt: new Date().toISOString() }));
        });
    }
    async readDocument(id: string, name: string): Promise<string | null> {
        await this.getManifest(id);
        return this.fs.meta.seq!.getEntry(this.paths(id).history, `document/${this.name(name)}`);
    }
    async writeDocument(id: string, name: string, content: string): Promise<void> {
        await this.getManifest(id);
        JSON.parse(content);
        await this.fs.meta.seq!.setEntry(this.paths(id).history, `document/${this.name(name)}`, content);
    }
    async listHistory(id: string): Promise<string[]> {
        await this.getManifest(id);
        const names: string[] = [];
        await this.fs.meta.seq!.walkEntries(this.paths(id).history, entry => { names.push(entry.key.slice('document/'.length)); return true; }, { keyPrefix: 'document/' });
        return names;
    }
    async writeAttachment(id: string, name: string, content: ArrayBuffer): Promise<void> {
        await this.getManifest(id);
        await this.fs.driver.createFile({ name: this.name(name), parentPath: `${this.root(id)}/attachments`, content, overwrite: true });
    }
    async openAttachments(id: string) {
        await this.getManifest(id);
        return createFileSystemView({ viewId: `attachments:${id}`, mounts: [{ mountId: 'attachments', at: '/', root: `${this.root(id)}/attachments`, fs: this.fs, access: 'rw' }] });
    }
    async readSessionAsset(id: string, name: string): Promise<Blob | null> {
        const view = await this.openAttachments(id);
        try { const path = '/' + this.name(name.replace(/^@asset\//, '')); return await view.driver.exists(path) ? new Blob([await view.driver.readContent(path, { encoding: 'binary' })]) : null; }
        finally { await view.dispose(); }
    }
    private async readFolders(): Promise<SessionFolder[]> {
        if (!await this.fs.driver.exists(FOLDERS_PATH)) return [];
        return this.readFolderEntries(this.fs.meta.seq!);
    }
    /** Drop every record of the given seq files (records outlive deleted files). */
    private async clearEntries(paths: string[]): Promise<void> {
        await this.fs.meta.seq!.transaction!(async tx => {
            for (const path of paths) {
                const keys: string[] = [];
                await tx.walkEntries(path, entry => { keys.push(entry.key); return true; });
                for (const key of keys) await tx.deleteEntry(path, key);
            }
        });
    }
    /** Read-modify-write the folder record inside one transaction (no lost updates). */
    private async mutateFolders<T>(mutate: (folders: SessionFolder[]) => { folders: SessionFolder[]; result: T }): Promise<T> {
        await this.ensureFolderRecord();
        return this.fs.meta.seq!.transaction!(async tx => {
            const { folders, result } = mutate(await this.readFolderEntries(tx));
            await tx.setEntry(FOLDERS_PATH, FOLDERS_KEY, JSON.stringify(folders));
            return result;
        });
    }
    private async readFolderEntries(tx: Pick<ISeqFileTransaction, 'getEntry'>): Promise<SessionFolder[]> {
        const raw = await tx.getEntry(FOLDERS_PATH, FOLDERS_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) throw new FSError('EIO', 'Invalid Session folder record');
        return parsed as SessionFolder[];
    }
    private async ensureFolderRecord(): Promise<void> {
        if (await this.fs.driver.exists(FOLDERS_PATH)) return;
        try {
            await this.fs.driver.createFile({ name: 'folders.seq', parentPath: '/var/lib/sessions', type: 'seqfile', recursive: true });
        } catch (error) {
            if (!(error instanceof FSError && error.code === 'EEXIST')) throw error;
        }
    }
}

function normalizeFolderPath(value: string | null | undefined): string | null {
    if (value === null || value === undefined) return null;
    const trimmed = String(value).trim();
    if (!trimmed || trimmed === '/') return null;
    const parts = trimmed.split('/').filter(Boolean);
    if (!parts.length || parts.some(part => part === '.' || part === '..' || part.includes('\\') || part.includes('\0'))) {
        throw new FSError('EINVAL', 'Invalid Session folder path');
    }
    return '/' + parts.join('/');
}

function folderParent(path: string): string | null {
    const index = path.lastIndexOf('/');
    return index <= 0 ? null : path.slice(0, index);
}
