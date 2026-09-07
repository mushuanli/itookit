import { generateUUID } from '@itookit/common';
import { createFileSystemView, FSError, type IFileSystem } from '@itookit/vfs-core';
import { DEFAULT_SESSION_SETTINGS, type ChatSessionSettings, type ConversationManifest, type ConversationUIState, type ISessionRepository } from './types';
import { sessionStorageRoot } from './session-storage-layout';

/** Session identity, history and attachments. No document path is a Session identity. */
export class SessionRepository implements ISessionRepository {
    private readonly listeners = new Set<() => void>();
    private closed = false;
    constructor(private readonly fs: IFileSystem) {}
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
    private paths(id: string) { const root = this.root(id); return { root, session: `${root}/session.seq`, history: `${root}/history.seq` }; }
    async createSession(title: string): Promise<string> {
        const id = generateUUID(), now = Date.now();
        const p = this.paths(id);
        for (const name of ['session.seq', 'history.seq']) await this.fs.driver.createFile({ name, parentPath: p.root, type: 'seqfile', recursive: true });
        await this.fs.driver.createDirectory({ name: 'attachments', parentPath: p.root });
        await this.fs.meta.seq!.transaction!(async tx => {
            await tx.setEntry(p.session, 'session', JSON.stringify({ storageVersion: 1, id, title, createdAt: now, updatedAt: now, revision: 0 }));
            await tx.setEntry(p.session, 'settings', JSON.stringify(DEFAULT_SESSION_SETTINGS));
            await tx.setEntry(p.history, 'index', JSON.stringify({ schemaVersion: 3, rootRoundId: null, branches: { main: null }, branchMeta: {}, currentBranch: 'main', currentHead: null, children: {} }));
        });
        this.notify(); return id;
    }
    async getManifest(id: string): Promise<ConversationManifest> {
        const p = this.paths(id);
        return this.fs.meta.seq!.transaction!(async tx => {
            const raw = await tx.getEntry(p.session, 'session');
            if (!raw) throw new FSError('ENOENT', `Session not found: ${id}`);
            const session = JSON.parse(raw);
            const history = JSON.parse(await tx.getEntry(p.history, 'index') ?? 'null');
            if (session.storageVersion !== 1 || session.id !== id || history?.schemaVersion !== 3) throw new Error('Session storage version incompatible');
            return { ...session, ...history };
        });
    }
    async list(): Promise<ConversationManifest[]> {
        this.root('catalog');
        if (!await this.fs.driver.exists('/var/lib/sessions')) return [];
        const result: ConversationManifest[] = [];
        for (const node of await this.fs.driver.getChildren('/var/lib/sessions')) {
            if (node.type === 'directory' && await this.fs.driver.exists(`${node.path}/session.seq`)) result.push(await this.getManifest(node.name));
        }
        return result.sort((a, b) => b.updatedAt - a.updatedAt);
    }
    async updateManifest(id: string, patch: Partial<ConversationManifest>): Promise<void> {
        const p = this.paths(id);
        if (patch.id && patch.id !== id) throw new FSError('EINVAL', 'Session identity cannot change');
        await this.fs.meta.seq!.transaction!(async tx => {
            const raw = await tx.getEntry(p.session, 'session');
            if (!raw) throw new FSError('ENOENT', 'Session not found');
            const current = JSON.parse(raw);
            if (current.storageVersion !== 1) throw new Error('Session storage version incompatible');
            const { id: _id, title, summary, uiState, flow, createdAt: _created, updatedAt: _updated, ...historyPatch } = patch;
            const next = { ...current, ...(title !== undefined ? { title } : {}), ...(summary !== undefined ? { summary } : {}),
                ...(uiState ? { uiState: { ...current.uiState, ...uiState, ...(uiState.branchDrafts ? { branchDrafts: { ...current.uiState?.branchDrafts, ...uiState.branchDrafts } } : {}) } } : {}), ...(flow ? { flow } : {}), updatedAt: Date.now(), revision: current.revision + 1 };
            const index = JSON.parse(await tx.getEntry(p.history, 'index') ?? 'null');
            if (index?.schemaVersion !== 3) throw new Error('Session history version incompatible');
            await tx.setEntry(p.session, 'session', JSON.stringify(next));
            await tx.setEntry(p.history, 'index', JSON.stringify({ ...index, ...historyPatch, schemaVersion: 3 }));
        });
        this.notify();
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
}
