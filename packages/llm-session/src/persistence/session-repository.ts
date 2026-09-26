import { SessionRelations, assertSessionAvailable, readSessionMetadata, touchSessionRelations } from './session-relations';
import { generateUUID } from '@itookit/common';
import { createFileSystemView, FSError, type IFileSystem, type ISeqFileTransaction } from '@itookit/vfs-core';
import { DEFAULT_SESSION_SETTINGS, type ChatSessionSettings, type ConversationManifest, type ConversationUIState, type ISessionRepository, type SessionFolder, type SessionOrigin, type SessionLoadState, type SessionView, type SessionRepositoryChange } from './types';
import { sessionStorageRoot } from './session-storage-layout';
import { collectHistoryChain, readRoundDocument, type SessionHistoryChain } from './history-chain';
import type { PersistedRound, RoundManifest } from './round-types';

const FOLDERS_PATH = '/var/lib/sessions/folders.seq';
const FOLDERS_KEY = 'folders';

interface SessionPaths { root: string; session: string; history: string }

/** Session identity, history and attachments. No document path is a Session identity. */
export class SessionRepository implements ISessionRepository {
    private readonly listeners = new Set<(change?: SessionRepositoryChange) => void>();
    private closed = false;
    private structuralWriteGuard?: (ids: string[]) => Promise<void>;
    async assertStructuralWritable(ids: string[]): Promise<void> { await this.structuralWriteGuard?.(ids); }
    setStructuralWriteGuard(guard: (ids: string[]) => Promise<void>): void { this.structuralWriteGuard = guard; }
    private get relations() { return new SessionRelations(this.fs, () => this.list(), this.structuralWriteGuard); }
    constructor(private readonly fs: IFileSystem,
        private readonly initializeNewSession?: (sessionId: string) => Promise<void>) {}
    async init(): Promise<void> {
        if (this.closed) throw new FSError('EACCES', 'Session repository is closed');
        if (!this.fs.meta.seq?.transaction) throw new Error('Session storage requires record transactions');
    }
    async dispose(): Promise<void> { this.closed = true; this.listeners.clear(); }
    subscribe(listener: (change?: SessionRepositoryChange) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
    private notify(change: SessionRepositoryChange = { kind: 'session' }) { for (const listener of this.listeners) listener(change); }
    private root(id: string) { if (this.closed) throw new FSError('EACCES', 'Session repository is closed'); return sessionStorageRoot(id); }
    private name(name: string): string {
        if (!name || name.includes('/') || name.includes('\\') || name.includes('\0') || name === '.' || name === '..') throw new FSError('EINVAL', 'Invalid Session data name');
        return name;
    }
    private paths(id: string): SessionPaths { const root = this.root(id); return { root, session: `${root}/session.seq`, history: `${root}/history.seq` }; }
    async createSession(title: string, folder: string | null = null, parentSessionId: string | null = null): Promise<string> {
        return this.ensureSession(generateUUID(), title, 'tauri', folder, parentSessionId);
    }
    /** Idempotently create a Session with a host-supplied durable identity. */
    async ensureSession(id: string, title: string, origin: SessionOrigin = 'tauri', folder: string | null = null, parentSessionId: string | null = null): Promise<string> {
        if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new FSError('EINVAL', 'Invalid Session identity');
        await this.structuralWriteGuard?.([id, ...(parentSessionId ? [parentSessionId] : [])]);
        const p = this.paths(id);
        const normalizedFolder = normalizeFolderPath(folder);
        const now = Date.now();
        const existed = await this.fs.driver.exists(p.session);
        let repaired = await this.ensureSessionFiles(p);
        await this.ensureFolderRecord();
        try {
            if (await this.fs.meta.seq!.transaction!(tx => this.initializeSessionTx(tx, p, { id, title, origin, folder: normalizedFolder, parentSessionId, now }))) {
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
        id: string; title: string; origin: SessionOrigin; folder: string | null; parentSessionId: string | null; now: number;
    }): Promise<boolean> {
        await assertSessionAvailable(tx, init.id);
        let repaired = false;
        const rawSession = await tx.getEntry(p.session, 'session');
        if (rawSession) {
            const session = JSON.parse(rawSession);
            if (session.storageVersion !== 1 || session.id !== init.id) throw new Error('Session storage version incompatible');
        } else {
            if (init.parentSessionId) {
                await assertSessionAvailable(tx, init.parentSessionId);
                const parent = await readSessionMetadata(tx, init.parentSessionId);
                init.folder = parent.folder ?? null;
            }
            // A new Session must land in an existing folder; otherwise it would be
            // invisible in every listing without any way to reach it.
            if (init.folder && !(await this.readFolderEntries(tx)).some(item => item.path === init.folder)) {
                throw new FSError('ENOENT', 'Session folder not found');
            }
            const record = { storageVersion: 1, id: init.id, title: init.title, origin: init.origin, folder: init.folder, parentSessionId: init.parentSessionId,
                createdAt: init.now, updatedAt: init.now, revision: 0 };
            await tx.setEntry(p.session, 'session', JSON.stringify(record));
            await touchSessionRelations(tx);
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
        return this.fs.meta.seq!.transaction!(tx => this.readManifestTx(tx, p, id));
    }
    async getLoadState(id: string): Promise<SessionLoadState> {
        const p = this.paths(id);
        return this.fs.meta.seq!.transaction!(async tx => {
            const rows = await tx.getEntries(p.session, ['session', 'settings']);
            return {
                manifest: await this.readManifestTx(tx, p, id, rows.session ?? null),
                settings: { ...DEFAULT_SESSION_SETTINGS, ...JSON.parse(rows.settings ?? '{}') },
            };
        });
    }
    /**
     * Projection plus history chain for one editor load. The editor needs both, and reading them
     * together keeps one storage snapshot (one sidecar transaction, one journal probe) per bind.
     */
    async loadView(id: string): Promise<SessionView> {
        const p = this.paths(id);
        return this.fs.meta.seq!.transaction!(async tx => {
            const rows = await tx.getEntries(p.session, ['session', 'settings']);
            const manifest = await this.readManifestTx(tx, p, id, rows.session ?? null);
            const chain = await this.readIndexedHistoryChain(tx, p, manifest)
                ?? await collectHistoryChain(manifest, roundId => this.readRound(tx, p, roundId));
            return {
                manifest,
                settings: { ...DEFAULT_SESSION_SETTINGS, ...JSON.parse(rows.settings ?? '{}') },
                chain,
            };
        });
    }
    async readHistoryChain(id: string): Promise<SessionHistoryChain> {
        const p = this.paths(id);
        return this.fs.meta.seq!.transaction!(async tx => {
            const manifest = await this.readManifestTx(tx, p, id);
            return await this.readIndexedHistoryChain(tx, p, manifest)
                ?? collectHistoryChain(manifest, roundId => this.readRound(tx, p, roundId));
        });
    }
    private async readIndexedHistoryChain(tx: ISeqFileTransaction, p: SessionPaths,
        manifest: ConversationManifest): Promise<SessionHistoryChain | null> {
        const candidates = indexedHistoryCandidates(manifest);
        if (!candidates) return null;
        const keys = candidates.map(id => `document/${this.name(`round-${id}.json`)}`);
        const rows = await tx.getEntries(p.history, keys);
        const parsed = await Promise.all(keys.map(key => readRoundDocument(async () => rows[key] ?? null)));
        if (!historyIndexMatches(candidates, parsed)) return null;
        const byId = new Map(candidates.map((id, index) => [id, parsed[index]]));
        return collectHistoryChain(manifest, async roundId => byId.get(roundId) ?? null);
    }
    private readRound(tx: ISeqFileTransaction, p: SessionPaths, roundId: string) {
        return readRoundDocument(() => tx.getEntry(
            p.history, `document/${this.name(`round-${roundId}.json`)}`,
        ));
    }
    private async readManifestTx(tx: ISeqFileTransaction, p: SessionPaths, id: string,
        sessionValue?: string | null): Promise<ConversationManifest> {
        const raw = sessionValue === undefined ? await tx.getEntry(p.session, 'session') : sessionValue;
        if (!raw) throw new FSError('ENOENT', `Session not found: ${id}`);
        const session = JSON.parse(raw);
        if (session.storageVersion !== 1 || session.id !== id) throw new Error('Session storage version incompatible');
        const rawHistory = await tx.getEntry(p.history, 'index');
        if (!rawHistory) throw new FSError('ENOENT', `Session history not found: ${id}`);
        const history = JSON.parse(rawHistory);
        if (history?.schemaVersion !== 3) throw new Error('Session history version incompatible');
        return { ...session, ...history };
    }
    async list(): Promise<ConversationManifest[]> {
        this.root('catalog');
        if (!await this.fs.driver.exists('/var/lib/sessions')) return [];
        const candidates: Array<{ id: string; path: string }> = [];
        for (const node of await this.fs.driver.getChildren('/var/lib/sessions', { fields: 'entry' })) {
            if (node.type === 'directory') candidates.push({ id: node.name, path: node.path });
        }
        const result: ConversationManifest[] = [];
        // Bound transaction duration without opening a transaction for every Session.
        for (let start = 0; start < candidates.length; start += 64) {
            const batch = candidates.slice(start, start + 64);
            const present = await Promise.all(batch.map(async ({ id, path }) =>
                await this.fs.driver.exists(`${path}/session.seq`) ? id : null));
            result.push(...await this.readManifestBatch(present.filter((id): id is string => id !== null)));
        }
        return result.sort((a, b) => b.updatedAt - a.updatedAt);
    }
    private readManifestBatch(ids: string[]): Promise<ConversationManifest[]> {
        return this.fs.meta.seq!.transaction!(async tx => {
            const result: ConversationManifest[] = [];
            for (const id of ids) {
                try {
                    result.push(await this.readManifestTx(tx, this.paths(id), id));
                } catch (error) {
                    // A crash can leave seqfiles behind before the init transaction
                    // commits; skip incomplete records until ensureSession repairs them.
                    if (!(error instanceof FSError && error.code === 'ENOENT')) throw error;
                }
            }
            return result;
        });
    }
    async deleteSession(id: string): Promise<void> {
        const root = this.root(id);
        const p = this.paths(id);
        await this.prepareSessionDeletion(id);
        // Physical storage goes first. Clearing records before a delete that can
        // still fail (fixed Kernel layout, host permissions) loses the Session
        // while leaving its directory behind, which is unrecoverable.
        if (await this.fs.driver.exists(root)) await this.fs.driver.delete([root], { recursive: true });
        // Deleting files does not purge SeqFile records, and stale records would
        // resurrect the Session if its identity is ever reused.
        await this.clearEntries([p.session, p.history]);
        await this.relations.finishDeletion(id);
        this.notify();
    }
    async prepareSessionDeletion(id: string): Promise<void> {
        await this.ensureFolderRecord();
        await this.relations.prepareDeletion(id); this.notify();
    }
    async isSessionDeletionPending(id: string): Promise<boolean> {
        if (!await this.fs.driver.exists(FOLDERS_PATH)) return false;
        return !!await this.fs.meta.seq!.getEntry(FOLDERS_PATH, `deleting/${id}`);
    }
    pendingSessionDeletions(): Promise<Array<{ id: string }>> { return this.relations.pending(); }
    async listFolders(): Promise<SessionFolder[]> {
        return (await this.readFolders()).sort((a, b) => a.path.localeCompare(b.path));
    }
    async createFolder(path: string, project?: SessionFolder['project']): Promise<SessionFolder> {
        const normalized = normalizeFolderPath(path);
        if (!normalized) throw new FSError('EINVAL', 'Invalid Session folder path');
        const folder = await this.mutateFolders(folders => {
            const existing = folders.find(item => item.path === normalized);
            if (existing) {
                if (project && existing.project?.id !== project.id) throw new FSError('EEXIST', 'Project folder already exists');
                return { folders, result: existing };
            }
            const parentPath = folderParent(normalized);
            if (parentPath && !folders.some(item => item.path === parentPath)) throw new FSError('ENOENT', 'Parent Session folder not found');
            if (project && (!/^[a-zA-Z0-9_-]+$/.test(project.id) || !project.directory)) throw new FSError('EINVAL', 'Invalid project reference');
            const created: SessionFolder = { path: normalized, name: normalized.slice(normalized.lastIndexOf('/') + 1), parentPath, updatedAt: Date.now(),
                ...(project ? { project: { ...project } } : {}) };
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
        const relationRevision = await this.fs.meta.seq!.getEntry(FOLDERS_PATH, 'relations-revision');
        const owned = (await this.list()).filter(session => session.folder === source || session.folder?.startsWith(`${source}/`));
        await this.ensureFolderRecord();
        await this.structuralWriteGuard?.(owned.map(item => item.id));
        // Folder records and every affected Session ownership change commit together,
        // so a failure can never leave Sessions pointing at a folder that is gone.
        await this.fs.meta.seq!.transaction!(async tx => {
            if (await tx.getEntry(FOLDERS_PATH, 'relations-revision') !== relationRevision) throw new FSError('EBUSY', 'Session hierarchy changed; retry the folder move');
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
            await touchSessionRelations(tx);
            for (const session of owned) {
                await assertSessionAvailable(tx, session.id);
                const folder = session.folder === source ? target : target + (session.folder ?? '').slice(source.length);
                await this.writeManifestTx(tx, this.paths(session.id), { folder });
            }
        });
        this.notify();
    }
    async updateManifest(id: string, patch: Partial<ConversationManifest>): Promise<void> {
        const p = this.paths(id);
        if (patch.id && patch.id !== id) throw new FSError('EINVAL', 'Session identity cannot change');
        if (patch.folder !== undefined || patch.parentSessionId !== undefined) {
            await this.ensureFolderRecord();
            await this.relations.move(id, patch.parentSessionId, patch.folder === undefined ? undefined : normalizeFolderPath(patch.folder));
            const { folder: _folder, parentSessionId: _parent, ...rest } = patch;
            patch = rest; this.notify();
        }
        const changed = await this.fs.meta.seq!.transaction!(tx => this.writeManifestTx(tx, p, patch));
        if (changed) this.notify({ sessionId: id, kind: Object.keys(patch).every(key => key === 'uiState') ? 'ui-state' : 'session' });
    }
    private async writeManifestTx(tx: ISeqFileTransaction, p: SessionPaths, patch: Partial<ConversationManifest>): Promise<boolean> {
        const raw = await tx.getEntry(p.session, 'session');
        if (!raw) throw new FSError('ENOENT', 'Session not found');
        const current = JSON.parse(raw);
        if (current.storageVersion !== 1) throw new Error('Session storage version incompatible');
        const { id: _id, title, summary, origin, folder, parentSessionId: _parent, uiState, flow, createdAt: _created, updatedAt: _updated, ...historyPatch } = patch;
        const normalizedFolder = folder === undefined ? undefined : normalizeFolderPath(folder);
        if (normalizedFolder && normalizedFolder !== current.folder
            && !(await this.readFolderEntries(tx)).some(item => item.path === normalizedFolder)) {
            throw new FSError('ENOENT', 'Session folder not found');
        }
        const next = { ...current, ...(title !== undefined ? { title } : {}), ...(summary !== undefined ? { summary } : {}), ...(origin !== undefined ? { origin } : {}),
            ...(normalizedFolder !== undefined ? { folder: normalizedFolder } : {}),
            ...(uiState ? { uiState: { ...current.uiState, ...uiState, ...(uiState.branchDrafts ? { branchDrafts: { ...current.uiState?.branchDrafts, ...uiState.branchDrafts } } : {}) } } : {}), ...(flow ? { flow } : {}) };
        const historyChanged = await this.writeHistoryPatchTx(tx, p, historyPatch);
        if (!historyChanged && JSON.stringify(current) === JSON.stringify(next)) return false;
        await tx.setEntry(p.session, 'session', JSON.stringify({ ...next, updatedAt: Date.now(), revision: current.revision + 1 }));
        return true;
    }
    private async writeHistoryPatchTx(tx: ISeqFileTransaction, p: SessionPaths, patch: object): Promise<boolean> {
        if (!Object.keys(patch).length) return false;
        const index = JSON.parse(await tx.getEntry(p.history, 'index') ?? 'null');
        if (index?.schemaVersion !== 3) throw new Error('Session history version incompatible');
        const next = JSON.stringify({ ...index, ...patch, schemaVersion: 3 });
        if (JSON.stringify(index) === next) return false;
        await tx.setEntry(p.history, 'index', next);
        return true;
    }
    async getUIState(id: string): Promise<ConversationUIState | null> { return (await this.getManifest(id)).uiState ?? null; }
    async updateUIState(id: string, updates: Partial<ConversationUIState>): Promise<void> { await this.updateManifest(id, { uiState: updates }); }
    async getSessionSettings(id: string): Promise<ChatSessionSettings> {
        return (await this.getLoadState(id)).settings;
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
        const p = this.paths(id), key = `document/${this.name(name)}`;
        return this.fs.meta.seq!.transaction!(async tx => {
            await this.readManifestTx(tx, p, id);
            return tx.getEntry(p.history, key);
        });
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
            await touchSessionRelations(tx);
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

function indexedHistoryCandidates(manifest: Pick<RoundManifest, 'currentHead' | 'children'>): string[] | null {
    if (!manifest.currentHead) return [];
    const parents = new Map<string, string>();
    for (const [parent, children] of Object.entries(manifest.children ?? {})) {
        for (const child of children) {
            const previous = parents.get(child);
            if (previous && previous !== parent) return null;
            parents.set(child, parent);
        }
    }
    const result: string[] = [], visited = new Set<string>();
    let current: string | undefined = manifest.currentHead;
    while (current && !visited.has(current)) {
        result.push(current); visited.add(current); current = parents.get(current);
    }
    return result;
}

function historyIndexMatches(candidates: string[], rounds: Array<PersistedRound | null>): boolean {
    return rounds.every((round, index) => !round
        || round.historyParentIds[0] === candidates[index + 1]);
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
