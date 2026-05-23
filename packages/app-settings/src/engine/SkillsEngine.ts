/**
 * @file app-settings/engine/SkillsEngine.ts
 * @desc Custom IModuleFS implementation — maps LLMSkill objects to virtual file nodes.
 *       Read-write via IAgentManagementService. Flat list, no directories.
 *
 * v3.3: Refactored from IFSEngine → IModuleFS.
 *
 * Event payloads match EngineAdapter expectations:
 *   node:created → { nodes: [{nodeId, parentId, path, type}] }
 *   node:updated → { nodes: [{nodeId}] }
 *   node:deleted → { requestedIds, allDeletedIds }
 *   node:renamed → { nodes: [{nodeId, oldName, newName}] }
 *   node:moved   → any  (triggers EngineAdapter.loadData() full refresh)
 */
import type {
    IModuleFS,
    IFSDriver,
    FSCapabilities,
    FSNode,
    FSFileNode,
    FSSearchResult,
    FSModuleStats,
    FileContent,
    ReadOptions,
    CreateFileOptions,
    CreateDirectoryOptions,
    DeleteOptions,
    RenameOptions,
    MoveOptions,
    FSEventType,
    FSEvent,
    IAssetOperations,
    ITagOperations,
    LLMSkill,
    IAgentManagementService,
} from '@itookit/common';
import { FSCapabilityError } from '@itookit/common';
import yaml from 'js-yaml';

/** Strip common skill file extensions from a user-typed or imported filename. */
function cleanName(raw: string): string {
    return raw.replace(/\.(skill\.(yaml|yml)|yaml|yml|json)$/i, '').trim() || raw.trim();
}

// ── 能力声明 ───────────────────────────────────────────────────

const SKILLS_CAPS: FSCapabilities = Object.freeze({
    readonly: false, search: true, semanticSearch: false, syncable: false,
    assets: false, tags: true, deviceFiles: false,
    seqFiles: false, references: false, symlinks: false, hardlinks: false,
    partialRead: false, partialWrite: false, treeWalk: false,
    streaming: false, watch: false, mount: false,
});

// ── Assets no-op ───────────────────────────────────────────────

const noopAssets: IAssetOperations = {
    putAsset: async () => ({ type: 'file' } as FSFileNode),
    getAsset: async () => null,
    getAssetDirPath: async () => null,
    ensureAssetDir: async () => { throw new FSCapabilityError('assets', 'skills'); },
    listAssets: async () => [],
    deleteAsset: async () => {},
    removeAssetDir: async () => {},
    hasAssetDir: async () => false,
};

// ═══════════════════════════════════════════════════════════════
// SkillsEngine
// ═══════════════════════════════════════════════════════════════

export class SkillsEngine implements IModuleFS {
    readonly moduleId = 'skills';
    readonly capabilities: FSCapabilities = SKILLS_CAPS;
    readonly driver: IFSDriver;
    readonly meta: import('@itookit/common').IFSMetaDriver;
    readonly tags: ITagOperations;

    private readonly listeners = new Map<string, Set<(e: FSEvent) => void>>();
    private unsubscribe: (() => void) | null = null;
    private _suppressOnChange = false;

    constructor(private readonly service: IAgentManagementService) {
        const driverImpl = new SkillsDriver(this, this.listeners);
        this.driver = driverImpl;

        // Tags impl delegates to driver's setTags
        const engine = this;
        this.tags = {
            getAllTags: async () => [],
            setTags: (id: string, tags: string[]) => engine.driver.updateMetadata(id, { tags }),
            addTag: async () => {},
            removeTag: async () => {},
            walkByTag: async () => ({ total: 0, processed: 0 }),
        };

        this.meta = {
            assets: noopAssets,
            tags: this.tags,
        };

        this.unsubscribe = (service as any).onChange?.(() => {
            if (this._suppressOnChange) return;
            driverImpl.fire('node:moved', {});
        }) ?? null;
    }

    async init(): Promise<void> {}

    openFile(_nodeId: string): never {
        throw new Error('SkillsEngine: openFile not supported');
    }

    async dispose(): Promise<void> {
        this.unsubscribe?.();
        this.listeners.clear();
    }

    on = (e: any, cb: any) => this.driver.on(e, cb);
}

// ═══════════════════════════════════════════════════════════════
// SkillsDriver — 内联 IFSDriver
// ═══════════════════════════════════════════════════════════════

class SkillsDriver implements IFSDriver {
    readonly moduleId = 'skills';
    readonly capabilities: FSCapabilities = SKILLS_CAPS;

    constructor(
        private readonly engine: SkillsEngine,
        private readonly listeners: Map<string, Set<(e: FSEvent) => void>>,
    ) {}

    // ── Events ───────────────────────────────────────
    on<E extends FSEventType>(event: E, cb: (e: FSEvent<E>) => void): () => void {
        const key = event;
        if (!this.listeners.has(key)) this.listeners.set(key, new Set());
        this.listeners.get(key)!.add(cb as any);
        return () => this.listeners.get(key)?.delete(cb as any);
    }

    /** @internal — used by SkillsEngine to fire events */
    fire(type: string, payload: unknown): void {
        const event = { type, payload } as FSEvent;
        for (const h of this.listeners.get(type) ?? []) (h as any)(event);
    }

    private get _suppress() { return this.engine['_suppressOnChange']; }
    private set _suppress(v: boolean) { this.engine['_suppressOnChange'] = v; }
    private get service() { return this.engine['service']; }

    // ── Read ─────────────────────────────────────────

    async getNode(id: string): Promise<FSNode | null> {
        const skills = await this.service.getSkills();
        const s = skills.find((x: LLMSkill) => x.id === id);
        return s ? toFSNode(s) : null;
    }

    async getChildren(parentId: string, _options?: any): Promise<FSNode[]> {
        if (parentId !== '/') return [];
        const skills = await this.service.getSkills();
        return skills.map((s: LLMSkill) => toFSNode(s));
    }

    readContent(id: string, options: ReadOptions & { encoding: 'utf-8' }): Promise<string>;
    readContent(id: string, options: ReadOptions & { encoding: 'binary' }): Promise<ArrayBuffer>;
    readContent(id: string, options?: ReadOptions): Promise<FileContent>;
    async readContent(id: string, _options?: ReadOptions): Promise<FileContent> {
        return id;
    }

    async resolvePath(_path: string): Promise<string | null> {
        const skills = await this.service.getSkills();
        for (const s of skills) {
            if (_path === `/${s.id}`) return s.id;
        }
        return null;
    }

    async exists(id: string): Promise<boolean> {
        const skills = await this.service.getSkills();
        return skills.some((s: LLMSkill) => s.id === id);
    }

    async search(query: any): Promise<FSSearchResult> {
        const text = query?.name?.contains as string | undefined;
        const nodes: FSNode[] = [];
        if (text) {
            const lower = text.toLowerCase();
            const skills = await this.service.getSkills();
            for (const s of skills as LLMSkill[]) {
                if (s.name.toLowerCase().includes(lower) ||
                    s.id.includes(lower) ||
                    (s.description ?? '').toLowerCase().includes(lower)) {
                    nodes.push(toFSNode(s));
                }
            }
        }
        return { nodes: nodes, total: nodes.length, hasMore: false };
    }

    async getStats(): Promise<FSModuleStats> {
        const skills = await this.service.getSkills();
        return { fileCount: skills.length, directoryCount: 1, totalSize: 0, lastModifiedAt: Date.now() };
    }

    // ── Write ────────────────────────────────────────

    async writeContent(id: string, content: FileContent): Promise<void> {
        const text = typeof content === 'string' ? content : new TextDecoder().decode(content as ArrayBuffer);
        if (!text.trim()) { console.warn('[skill] writeContent: empty, skipping'); return; }

        let incoming: any;
        try { incoming = yaml.load(text); } catch (e) { console.error('[skill] writeContent: yaml failed', e); return; }
        if (!incoming || typeof incoming !== 'object') return;

        const skills = await this.service.getSkills() as LLMSkill[];
        const existing = skills.find((s: LLMSkill) => s.id === id);
        const targetId = (typeof incoming.id === 'string' && incoming.id.trim()) ? incoming.id.trim() : id;

        const updated: LLMSkill = { ...existing, ...incoming, id: targetId, modifiedAt: Date.now() };
        await this.service.saveSkill(updated);

        if (targetId !== id) {
            if (existing) await this.service.deleteSkill(id).catch(() => {});
            this.fire('node:deleted', { requestedIds: [id], allDeletedIds: [id] });
            this.fire('node:created', { nodes: [{ nodeId: targetId, parentId: null, path: `/${targetId}`, type: 'file' }] });
        } else {
            this.fire('node:updated', { nodes: [{ nodeId: targetId }] });
        }
    }

    async updateMetadata(id: string, metadata: Record<string, unknown>): Promise<void> {
        const skills = await this.service.getSkills() as LLMSkill[];
        const s = skills.find((x: LLMSkill) => x.id === id);
        if (!s) return;

        const updates: Partial<LLMSkill> = {};
        if ('icon' in metadata) updates.icon = (metadata.icon as string) || undefined;
        if ('description' in metadata) updates.description = (metadata.description as string) || undefined;

        if (Object.keys(updates).length === 0) return;

        this._suppress = true;
        try {
            await this.service.saveSkill({ ...s, ...updates, modifiedAt: Date.now() });
        } finally {
            this._suppress = false;
        }
        this.fire('node:updated', { nodes: [{ nodeId: id }] });
    }

    async appendContent(): Promise<void> { throw new Error('not supported'); }

    async createFile(options: CreateFileOptions): Promise<FSNode> {
        const rawName = options.name;
        const content = options.content;

        if (content) {
            const text = typeof content === 'string' ? content : new TextDecoder().decode(content as ArrayBuffer);
            try {
                const parsed = yaml.load(text) as any;
                if (parsed && typeof parsed === 'object') {
                    const skillId = (typeof parsed.id === 'string' && parsed.id.trim())
                        ? parsed.id.trim()
                        : cleanName(rawName).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `skill-${Date.now()}`;
                    const skillName = (typeof parsed.name === 'string' && parsed.name.trim())
                        ? parsed.name.trim()
                        : cleanName(rawName);

                    const skill: LLMSkill = {
                        type: 'prompt', enabled: false,
                        ...parsed, id: skillId, name: skillName,
                        createdAt: parsed.createdAt ?? Date.now(),
                        modifiedAt: Date.now(),
                    };
                    await this.service.saveSkill(skill);
                    const node = toFSNode(skill);
                    this.fire('node:created', { nodes: [{ nodeId: skill.id, parentId: null, path: `/${skill.id}`, type: 'file' }] });
                    return node;
                }
            } catch (e) {
                console.warn('[skill] createFile: YAML parse failed, fallback to filename', e);
            }
        }

        // Fallback: no content or invalid YAML
        const name = cleanName(rawName);
        const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `skill-${Date.now()}`;
        const now = Date.now();
        const skill: LLMSkill = { id, name, type: 'prompt', enabled: false, createdAt: now, modifiedAt: now };
        await this.service.saveSkill(skill);
        const node = toFSNode(skill);
        this.fire('node:created', { nodes: [{ nodeId: id, parentId: null, path: `/${id}`, type: 'file' }] });
        return node;
    }

    async createDirectory(_options: CreateDirectoryOptions): Promise<FSNode> {
        throw new Error('not supported');
    }

    async rename(id: string, newName: string, _opts?: RenameOptions): Promise<void> {
        const skills = await this.service.getSkills() as LLMSkill[];
        const s = skills.find((x: LLMSkill) => x.id === id);
        if (!s || s.name === newName) return;
        const oldName = s.name;
        this._suppress = true;
        try {
            await this.service.saveSkill({ ...s, name: newName, modifiedAt: Date.now() });
        } finally {
            this._suppress = false;
        }
        this.fire('node:renamed', { nodes: [{ nodeId: id, oldName, newName }] });
    }

    async delete(ids: string[], _options?: DeleteOptions): Promise<void> {
        for (const id of ids) {
            await this.service.deleteSkill(id);
        }
        this.fire('node:deleted', { requestedIds: ids, allDeletedIds: ids });
    }

    async move(_ids: string[], _parent: string | null, _opts?: MoveOptions): Promise<void> {
        // Flat list — no-op
    }

    // ── Links (unsupported) ───────────────────────────
    async symlink(): Promise<FSNode> { throw new FSCapabilityError('symlinks', this.moduleId); }
    async readlink(): Promise<string> { throw new FSCapabilityError('symlinks', this.moduleId); }
    async hardlink(): Promise<FSNode> { throw new FSCapabilityError('hardlinks', this.moduleId); }

    // ── Transaction (unsupported) ────────────────────
    async transaction<T>(): Promise<T> {
        throw new FSCapabilityError('transaction', this.moduleId);
    }
}

// ═══════════════════════════════════════════════════════════════
// Helper
// ═══════════════════════════════════════════════════════════════

function toFSNode(s: LLMSkill): FSFileNode {
    return {
        id: s.id,
        parentPath: null,
        name: s.name,
        type: 'file',
        icon: s.icon ?? '⚡',
        path: `/${s.id}`,
        size: 0,
        createdAt: s.createdAt ?? Date.now(),
        modifiedAt: s.modifiedAt ?? Date.now(),
        version: 0,
        moduleId: 'skills',
        tags: s.enabled ? [] : ['disabled'],
        metadata: {
            title: s.name,
            lastModified: s.modifiedAt ?? Date.now(),
            hasUnreadUpdate: s.enabled,
            skillType: s.type,
            enabled: s.enabled,
        },
    };
}
