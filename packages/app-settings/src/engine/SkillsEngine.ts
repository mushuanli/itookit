// @file app-settings/engine/SkillsEngine.ts
// ISessionEngine adapter for the Skills workspace.
//
// Bridges IAgentManagementService → ISessionEngine so VFSUIShell can render
// the skill list without any custom sidebar code.
//
// Skill storage remains in device-llm (etc module / llm/.skills/*.yaml).
// This engine reads/writes through the service layer, never the VFS directly.

import type {
    ISessionEngine, EngineNode, EngineEvent, EngineEventType, EngineSearchQuery,
    LLMSkill, IAgentManagementService,
} from '@itookit/common';
import yaml from 'js-yaml';

export class SkillsEngine implements ISessionEngine {
    public readonly moduleName = 'skills';

    private listeners = new Map<string, Set<(e: EngineEvent) => void>>();
    private unsubscribe: (() => void) | null = null;

    constructor(private readonly service: IAgentManagementService) {
        // Forward agentService changes to VFSUIShell as batch_updated events.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        this.unsubscribe = (service as any).onChange?.(() =>
            this.emit('node:batch_updated', {} as EngineEvent),
        ) ?? null;
    }

    async init(): Promise<void> {}

    async getChildren(parentId: string): Promise<EngineNode[]> {
        if (parentId !== '/') return [];
        const skills = await this.service.getSkills();
        return skills.map((s) => this.toNode(s));
    }

    async getNode(id: string): Promise<EngineNode | null> {
        const skills = await this.service.getSkills();
        const s = skills.find((x) => x.id === id);
        return s ? this.toNode(s) : null;
    }

    /** Returns the skill as YAML — passed to SkillSettingsEditor.init() as content. */
    async readContent(id: string): Promise<string> {
        const skills = await this.service.getSkills();
        const s = skills.find((x) => x.id === id);
        if (!s) return '';
        return yaml.dump(s, { lineWidth: -1, noRefs: true });
    }

    /** Called by editor-connector on blur — merges form YAML back into the skill. */
    async writeContent(id: string, content: string | ArrayBuffer): Promise<void> {
        const text = typeof content === 'string' ? content : new TextDecoder().decode(content as ArrayBuffer);
        if (!text.trim()) return;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const incoming = yaml.load(text) as any;
        if (!incoming || typeof incoming !== 'object') return;

        const skills = await this.service.getSkills();
        const existing = skills.find((s) => s.id === id);
        const updated: LLMSkill = { ...existing, ...incoming, id, modifiedAt: Date.now() };
        await this.service.saveSkill(updated);
    }

    async createFile(name: string): Promise<EngineNode> {
        const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `skill-${Date.now()}`;
        const now = Date.now();
        const skill: LLMSkill = { id, name, type: 'prompt', enabled: false, createdAt: now, modifiedAt: now };
        await this.service.saveSkill(skill);
        this.emit('node:created', { nodeId: id, parentId: null } as unknown as EngineEvent);
        return this.toNode(skill);
    }

    async rename(id: string, newName: string): Promise<void> {
        const skills = await this.service.getSkills();
        const s = skills.find((x) => x.id === id);
        if (!s) return;
        await this.service.saveSkill({ ...s, name: newName, modifiedAt: Date.now() });
        this.emit('node:updated', { nodeId: id } as unknown as EngineEvent);
    }

    async delete(ids: string[]): Promise<void> {
        for (const id of ids) {
            await this.service.deleteSkill(id);
        }
        this.emit('node:deleted', { nodeIds: ids } as unknown as EngineEvent);
    }

    async search(query: EngineSearchQuery): Promise<EngineNode[]> {
        if (!query.text) return [];
        const lower = query.text.toLowerCase();
        const skills = await this.service.getSkills();
        return skills
            .filter((s) => s.name.toLowerCase().includes(lower) || s.id.includes(lower))
            .map((s) => this.toNode(s));
    }

    async updateMetadata(_id: string, _meta: Record<string, unknown>): Promise<void> {}
    async setTags(id: string, tags: string[]): Promise<void> {
        const skills = await this.service.getSkills();
        const s = skills.find((x) => x.id === id);
        if (!s) return;
        await this.service.saveSkill({ ...s, metadata: { ...(s.metadata ?? {}), tags }, modifiedAt: Date.now() });
    }
    async move(_ids: string[], _parentId: string | null): Promise<void> {}
    async createDirectory(): Promise<EngineNode> { throw new Error('not supported'); }
    async createAsset(): Promise<EngineNode> { throw new Error('not supported'); }
    async getAssetDirectoryId(): Promise<string | null> { return null; }

    on(event: EngineEventType, handler: (e: EngineEvent) => void): () => void {
        if (!this.listeners.has(event)) this.listeners.set(event, new Set());
        this.listeners.get(event)!.add(handler);
        return () => this.listeners.get(event)?.delete(handler);
    }

    dispose(): void {
        this.unsubscribe?.();
        this.listeners.clear();
    }

    // ── Private ──

    private toNode(s: LLMSkill): EngineNode {
        return {
            id:         s.id,
            parentId:   null,
            name:       s.name,
            type:       'file',
            icon:       s.icon ?? '⚡',
            path:       `/${s.id}`,
            size:       0,
            createdAt:  s.createdAt  ?? Date.now(),
            modifiedAt: s.modifiedAt ?? Date.now(),
            moduleId:   'skills',
            metadata:   {
                title:       s.name,
                tags:        s.enabled ? [] : ['disabled'],
                lastModified: s.modifiedAt ?? Date.now(),
                custom:      { skillType: s.type, enabled: s.enabled },
            },
        } as EngineNode;
    }

    private emit(type: string, event: EngineEvent): void {
        for (const h of this.listeners.get(type) ?? []) h(event);
    }
}
