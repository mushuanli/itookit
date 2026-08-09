import YAML from 'yaml';
import { BaseModuleService } from '@itookit/stdio';
import {
    buildRenamedFilename,
    generateUUID,
} from '@itookit/common';
import {
    FS_MODULE_CHAT,
    guessMimeType,
    type FSNode,
    type IVFSManager,
} from '@itookit/stdio';
import {
    DEFAULT_SESSION_SETTINGS,
    type ChatSessionSettings,
    type ConversationManifest,
    type ConversationUIState,
    type IChatEngine,
} from './types';

const CHAT_EXTENSION = '.chat';
const SETTINGS_ASSET = 'settings.yaml';

export class ChatEngine extends BaseModuleService implements IChatEngine {
    private readonly sessionFiles = new Map<string, string>();
    private readonly settingsTails = new Map<string, Promise<void>>();

    constructor(vfs: IVFSManager) {
        super(FS_MODULE_CHAT, { description: 'Chat Sessions' }, vfs);
    }

    protected async onLoad(): Promise<void> {}

    async createSession(title: string): Promise<string> {
        const file = await this.createFile(title, null);
        const manifest = await this.getManifest(file.path);
        return manifest.id;
    }

    async initializeExistingFile(nodeId: string, title: string): Promise<string> {
        const existing = await this.readRawManifest(nodeId);
        if (isConversationManifest(existing)) {
            this.sessionFiles.set(existing.id, nodeId);
            return existing.id;
        }
        // Tolerate unrecognized / legacy file content instead of failing hard —
        // a stale .chat file (old schema, interrupted init) would otherwise block
        // the whole editor from starting. Rebuild a valid manifest, preserving any
        // id/title the old content carried so references stay stable.
        const legacy = existing && typeof existing === 'object' && !Array.isArray(existing)
            ? existing as Record<string, unknown>
            : null;
        if (legacy && Object.keys(legacy).length > 0) {
            console.warn(`[ChatEngine] Migrating non-v3 manifest for ${nodeId}:`, JSON.stringify(legacy));
        }
        const manifest = createManifest(typeof legacy?.title === 'string' ? legacy.title : title);
        // Restore a stable session id from either the legacy manifest id or the
        // editor snapshot's sessionId field, so persisted assets keep their binding.
        const legacyId = typeof legacy?.id === 'string' ? legacy.id
            : typeof legacy?.sessionId === 'string' ? legacy.sessionId
            : undefined;
        if (legacyId) manifest.id = legacyId;
        await this.engine.driver.writeContent(nodeId, serialize(manifest));
        await this.engine.meta.assets.ensureAssetDir(nodeId);
        await this.writeSettings(nodeId, DEFAULT_SESSION_SETTINGS);
        await this.engine.driver.updateMetadata(nodeId, {
            title: manifest.title,
            icon: '💬',
            sessionId: manifest.id,
        });
        this.sessionFiles.set(manifest.id, nodeId);
        this.notify();
        return manifest.id;
    }

    async getManifest(nodeId: string): Promise<ConversationManifest> {
        const raw = await this.readRawManifest(nodeId);
        if (!isConversationManifest(raw)) {
            throw new Error(`Invalid conversation manifest: ${nodeId}`);
        }
        this.sessionFiles.set(raw.id, nodeId);
        return raw;
    }

    async getSessionIdFromNodeId(nodeId: string): Promise<string | null> {
        try {
            return (await this.getManifest(nodeId)).id;
        } catch {
            return null;
        }
    }

    async getSessionNodeId(sessionId: string): Promise<string | null> {
        return this.resolveSessionFile(sessionId);
    }

    async validateManifest(nodeId: string, sessionId: string): Promise<boolean> {
        const manifest = await this.getManifest(nodeId);
        if (manifest.id !== sessionId) {
            throw new Error(`Conversation session mismatch: ${sessionId}`);
        }
        return true;
    }

    async updateManifest(
        nodeId: string,
        updates: Partial<ConversationManifest>,
    ): Promise<void> {
        const manifest = await this.getManifest(nodeId);
        await this.writeManifest(nodeId, { ...manifest, ...updates });
    }

    async getUIState(nodeId: string): Promise<ConversationUIState | null> {
        return (await this.getManifest(nodeId)).uiState ?? null;
    }

    async updateUIState(
        nodeId: string,
        updates: Partial<ConversationUIState>,
    ): Promise<void> {
        const manifest = await this.getManifest(nodeId);
        await this.writeManifest(nodeId, {
            ...manifest,
            uiState: { ...manifest.uiState, ...updates },
        });
    }

    async getSessionSettings(sessionId: string): Promise<ChatSessionSettings> {
        const nodeId = await this.resolveSessionFile(sessionId);
        if (!nodeId) throw new Error(`Conversation session not found: ${sessionId}`);
        const text = await this.engine.openFile(nodeId).asset(SETTINGS_ASSET).readText();
        if (!text) return { ...DEFAULT_SESSION_SETTINGS };
        return { ...DEFAULT_SESSION_SETTINGS, ...YAML.parse(text) };
    }

    async saveSessionSettings(
        sessionId: string,
        settings: Partial<ChatSessionSettings>,
    ): Promise<void> {
        await this.withSettingsLock(sessionId, async () => {
            const nodeId = await this.resolveSessionFile(sessionId);
            if (!nodeId) throw new Error(`Conversation session not found: ${sessionId}`);
            const current = await this.getSessionSettings(sessionId);
            await this.writeSettings(nodeId, {
                ...current,
                ...settings,
                version: '1.0',
                updatedAt: new Date().toISOString(),
            });
        });
    }

    async readSessionAsset(sessionId: string, assetPath: string): Promise<Blob | null> {
        const nodeId = await this.resolveSessionFile(sessionId);
        if (!nodeId) return null;
        const name = normalizeAssetName(assetPath);
        const content = await this.engine.meta.assets.getAsset(nodeId, name);
        if (content == null) return null;
        return new Blob([toBlobPart(content)], { type: guessMimeType(name) });
    }

    async createFile(
        name: string,
        parentId: string | null,
    ): Promise<FSNode> {
        const title = stripChatExtension(name || 'New Chat');
        const filename = await this.availableFilename(title, parentId);
        const node = await this.engine.driver.createFile({
            name: filename,
            parentPath: parentId,
            content: '{}',
            metadata: { title, icon: '💬' },
        });
        await this.initializeExistingFile(node.path, title);
        return node;
    }

    async createDirectory(name: string, parentId: string | null): Promise<FSNode> {
        return this.engine.driver.createDirectory({ name, parentPath: parentId });
    }

    async rename(id: string, newName: string): Promise<void> {
        const node = await this.engine.driver.getNode(id);
        if (!node) throw new Error(`Conversation file not found: ${id}`);
        const sourceName = node.name.endsWith(CHAT_EXTENSION)
            ? node.name
            : `${node.name}${CHAT_EXTENSION}`;
        const { filename, title } = buildRenamedFilename(newName, sourceName);
        await this.engine.driver.rename(id, filename);
        const newPath = replaceBasename(id, filename);
        const manifest = await this.getManifest(newPath);
        await this.writeManifest(newPath, { ...manifest, title });
        await this.engine.driver.updateMetadata(newPath, { title });
        this.sessionFiles.set(manifest.id, newPath);
    }

    async delete(ids: string[]): Promise<void> {
        await this.engine.driver.delete(ids);
        for (const [sessionId, path] of this.sessionFiles) {
            if (ids.includes(path)) this.sessionFiles.delete(sessionId);
        }
        this.notify();
    }

    async getNode(id: string): Promise<FSNode | null> {
        return this.engine.driver.getNode(id);
    }

    async readContent(id: string): Promise<string | ArrayBuffer> {
        return normalizeContent(await this.engine.driver.readContent(id));
    }

    async getChildren(parentId: string): Promise<FSNode[]> {
        const nodes = await this.engine.driver.getChildren(parentId);
        return nodes.filter(isVisibleConversationNode);
    }

    async search(query: {
        type?: string;
        text?: string;
        tags?: string[];
        limit?: number;
    }): Promise<FSNode[]> {
        const result = await this.engine.driver.search({
            type: query.type as 'file' | 'directory' | undefined,
            name: query.text ? { contains: query.text } : undefined,
            tags: query.tags ? { any: query.tags } : undefined,
            limit: query.limit,
        });
        return [...result.nodes].filter(isConversationFile);
    }

    async updateMetadata(id: string, metadata: Record<string, unknown>): Promise<void> {
        await this.engine.driver.updateMetadata(id, metadata);
    }

    async setTags(id: string, tags: string[]): Promise<void> {
        await this.engine.meta.tags.setTags(id, tags);
    }

    async createAsset(
        ownerNodeId: string,
        filename: string,
        content: string | ArrayBuffer,
    ): Promise<FSNode> {
        return this.engine.meta.assets.putAsset(ownerNodeId, filename, content);
    }

    async readAsset(
        ownerNodeId: string,
        filename: string,
    ): Promise<string | ArrayBuffer | null> {
        const content = await this.engine.meta.assets.getAsset(ownerNodeId, filename);
        return content == null ? null : normalizeContent(content);
    }

    async getAssetDirectoryId(ownerNodeId: string): Promise<string | null> {
        return this.engine.meta.assets.getAssetDirPath(ownerNodeId);
    }

    async getAssets(ownerNodeId: string): Promise<FSNode[]> {
        const path = await this.engine.meta.assets.getAssetDirPath(ownerNodeId);
        return path ? this.engine.driver.getChildren(path) : [];
    }

    private async readRawManifest(
        nodeId: string,
    ): Promise<Record<string, unknown> | null> {
        try {
            const content = await this.engine.driver.readContent(nodeId, { encoding: 'utf-8' });
            return JSON.parse(content) as Record<string, unknown>;
        } catch {
            return null;
        }
    }

    private async writeManifest(
        nodeId: string,
        manifest: ConversationManifest,
    ): Promise<void> {
        await this.engine.driver.writeContent(nodeId, serialize({
            ...manifest,
            updatedAt: Date.now(),
        }));
    }

    private async resolveSessionFile(sessionId: string): Promise<string | null> {
        const cached = this.sessionFiles.get(sessionId);
        if (cached && await this.engine.driver.exists(cached)) return cached;
        const result = await this.engine.driver.search({
            type: 'file',
            name: { endsWith: CHAT_EXTENSION },
        });
        for (const node of result.nodes) {
            const id = await this.getSessionIdFromNodeId(node.path);
            if (id === sessionId) return node.path;
        }
        return null;
    }

    private async availableFilename(title: string, parentId: string | null): Promise<string> {
        const children = await this.engine.driver.getChildren(parentId ?? '/');
        const names = new Set(children.map(node => node.name.toLowerCase()));
        const initial = `${title}${CHAT_EXTENSION}`;
        if (!names.has(initial.toLowerCase())) return initial;
        for (let index = 1; index <= 100; index++) {
            const candidate = `${title} (${index})${CHAT_EXTENSION}`;
            if (!names.has(candidate.toLowerCase())) return candidate;
        }
        return `${title}-${generateUUID().slice(0, 8)}${CHAT_EXTENSION}`;
    }

    private async writeSettings(
        nodeId: string,
        settings: ChatSessionSettings,
    ): Promise<void> {
        const yaml = YAML.stringify(settings, { indent: 2, lineWidth: 0 });
        await this.engine.meta.assets.putAsset(nodeId, SETTINGS_ASSET, yaml);
    }

    private async withSettingsLock(
        sessionId: string,
        operation: () => Promise<void>,
    ): Promise<void> {
        const previous = this.settingsTails.get(sessionId) ?? Promise.resolve();
        const current = previous.then(operation, operation);
        this.settingsTails.set(sessionId, current);
        try {
            await current;
        } finally {
            if (this.settingsTails.get(sessionId) === current) {
                this.settingsTails.delete(sessionId);
            }
        }
    }
}

function createManifest(title: string): ConversationManifest {
    const now = Date.now();
    return {
        schemaVersion: 3,
        id: generateUUID(),
        title,
        createdAt: now,
        updatedAt: now,
        rootRoundId: null,
        branches: { main: null },
        branchMeta: {},
        currentBranch: 'main',
        currentHead: null,
        children: {},
    };
}

function isConversationManifest(
    value: unknown,
): value is ConversationManifest {
    if (!value || typeof value !== 'object') return false;
    const record = value as Record<string, unknown>;
    return record.schemaVersion === 3
        && typeof record.id === 'string'
        && typeof record.title === 'string'
        && typeof record.branches === 'object'
        && typeof record.children === 'object';
}

function isVisibleConversationNode(node: FSNode): boolean {
    if (node.name.startsWith('.') || node.name.startsWith('_')) return false;
    return node.type === 'directory' || isConversationFile(node);
}

function isConversationFile(node: FSNode): boolean {
    return node.type === 'file' && node.name.toLowerCase().endsWith(CHAT_EXTENSION);
}

function stripChatExtension(name: string): string {
    return name.replace(/\.chat$/i, '');
}

function normalizeAssetName(path: string): string {
    return path.replace(/^\.\/|^@asset\//, '');
}

function normalizeContent(content: unknown): string | ArrayBuffer {
    if (typeof content === 'string' || content instanceof ArrayBuffer) return content;
    const bytes = content as Uint8Array;
    return new Uint8Array(bytes).buffer;
}

function toBlobPart(content: unknown): BlobPart {
    return normalizeContent(content) as BlobPart;
}

function replaceBasename(path: string, basename: string): string {
    const index = path.lastIndexOf('/');
    return index < 0 ? basename : `${path.slice(0, index + 1)}${basename}`;
}

function serialize(value: unknown): string {
    return JSON.stringify(value, null, 2);
}
