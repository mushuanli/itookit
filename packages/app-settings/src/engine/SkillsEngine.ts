// @file app-settings/engine/SkillsEngine.ts
// ISessionEngine adapter for the Skills workspace.
//
// Display contract (→ NodeMapper):
//   node.name      = s.id    ← "filename" = skill ID (no extension)
//   metadata.title = s.id    ← primary label in VFSUIShell list
//   node.content   = s.name  ← NodeMapper uses first line as summary (the "brief")
//   WS_SKILLS sets showSummary=true → human-readable name shows below the ID
//
// Event payloads must match EngineAdapter expectations:
//   node:created → { nodes: [{nodeId, parentId, path, type}] }
//   node:updated → { nodes: [{nodeId}] }
//   node:deleted → { requestedIds, allDeletedIds }
//   node:renamed → { nodes: [{nodeId, oldName, newName}] }
//   node:moved   → any  (triggers EngineAdapter.loadData() full refresh)

import type {
    ISessionEngine, EngineNode, EngineEvent, EngineEventType, EngineSearchQuery,
    LLMSkill, IAgentManagementService,
} from '@itookit/common';
import yaml from 'js-yaml';

/** Strip common skill file extensions from a user-typed or imported filename. */
function cleanName(raw: string): string {
    return raw.replace(/\.(skill\.(yaml|yml)|yaml|yml|json)$/i, '').trim() || raw.trim();
}

export class SkillsEngine implements ISessionEngine {
    public readonly moduleName = 'skills';

    private readonly listeners = new Map<string, Set<(e: EngineEvent) => void>>();
    private unsubscribe: (() => void) | null = null;

    constructor(private readonly service: IAgentManagementService) {
        // 'node:moved' is the only EngineAdapter event that calls loadData() —
        // use it to force a full list refresh when skills change externally
        // (e.g., another tab saves via agentService).
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        this.unsubscribe = (service as any).onChange?.(() => {
            this.fire('node:moved', {});
        }) ?? null;
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

    /**
     * Returns the skill's human-readable NAME (not full YAML).
     *
     * Two consumers:
     *  1. NodeMapper — uses it as the list-item summary (the brief below the name).
     *     Returns s.id so the brief shows the skill ID (essay-review-cn).
     *  2. editor-connector — passes it as options.initialContent to the factory,
     *     but SkillSettingsEditor formOnly mode uses options.nodeId instead, so
     *     this content is effectively ignored by the form editor.
     */
    async readContent(id: string): Promise<string> {
        // Return the skill ID so NodeMapper uses it as the summary line.
        // Combined with node.name = s.name as primary, the list shows:
        //   [⚡] 中学生作文审查   ← name  (primary, from metadata.title)
        //        essay-review-cn  ← id    (summary, from this content)
        return id;
    }

    /**
     * Called by editor-connector on blur (form auto-save) OR by VFSUIShell's
     * ImportCommandHandler after creating a placeholder node for a dragged-in file.
     *
     * Key behaviour: if the YAML has an `id` field that differs from the current
     * node `id` (e.g. file "essay-review.skill.yaml" → placeholder id "essay-review",
     * but YAML says `id: essay-review-cn`), we:
     *   1. Save the skill under the YAML's correct id.
     *   2. Delete the placeholder.
     *   3. Emit node:deleted + node:created so VFSUIShell refreshes correctly.
     */
    async writeContent(id: string, content: string | ArrayBuffer): Promise<void> {
        const text = typeof content === 'string' ? content : new TextDecoder().decode(content as ArrayBuffer);
        if (!text.trim()) return;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let incoming: any;
        try { incoming = yaml.load(text); } catch { return; }
        // Ignore non-object content (e.g. readContent() returning just the skill id as a string).
        if (!incoming || typeof incoming !== 'object') return;

        const skills = await this.service.getSkills();
        const existing = skills.find((s) => s.id === id);

        // Prefer the id from YAML (canonical) over the placeholder id derived from filename.
        const targetId = (typeof incoming.id === 'string' && incoming.id.trim()) ? incoming.id.trim() : id;

        const updated: LLMSkill = { ...existing, ...incoming, id: targetId, modifiedAt: Date.now() };
        await this.service.saveSkill(updated);

        if (targetId !== id) {
            // Remove the filename-derived placeholder node.
            if (existing) await this.service.deleteSkill(id).catch(() => {});
            this.fire('node:deleted', { requestedIds: [id], allDeletedIds: [id] });
            this.fire('node:created', { nodes: [{ nodeId: targetId, parentId: null, path: `/${targetId}`, type: 'file' }] });
        } else {
            this.fire('node:updated', { nodes: [{ nodeId: targetId }] });
        }
    }

    async createFile(rawName: string): Promise<EngineNode> {
        // Strip file extensions so drag-dropped "essay-review.skill.yaml" becomes "essay-review"
        const name = cleanName(rawName);
        const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `skill-${Date.now()}`;
        const now = Date.now();
        const skill: LLMSkill = { id, name, type: 'prompt', enabled: false, createdAt: now, modifiedAt: now };
        await this.service.saveSkill(skill);
        const node = this.toNode(skill);
        this.fire('node:created', { nodes: [{ nodeId: id, parentId: null, path: `/${id}`, type: 'file' }] });
        return node;
    }

    async rename(id: string, newName: string): Promise<void> {
        const skills = await this.service.getSkills();
        const s = skills.find((x) => x.id === id);
        if (!s) return;
        const oldName = s.name;
        await this.service.saveSkill({ ...s, name: newName, modifiedAt: Date.now() });
        this.fire('node:renamed', { nodes: [{ nodeId: id, oldName, newName }] });
    }

    async delete(ids: string[]): Promise<void> {
        for (const id of ids) {
            await this.service.deleteSkill(id);
        }
        this.fire('node:deleted', { requestedIds: ids, allDeletedIds: ids });
    }

    async search(query: EngineSearchQuery): Promise<EngineNode[]> {
        if (!query.text) return [];
        const lower = query.text.toLowerCase();
        const skills = await this.service.getSkills();
        return skills
            .filter((s) =>
                s.name.toLowerCase().includes(lower) ||
                s.id.includes(lower) ||
                (s.description ?? '').toLowerCase().includes(lower),
            )
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
        const node = {
            id:         s.id,
            parentId:   null,
            name:       s.name,          // human-readable name as primary label
            type:       'file',
            icon:       s.icon ?? '⚡',
            path:       `/${s.id}`,
            size:       0,
            createdAt:  s.createdAt  ?? Date.now(),
            modifiedAt: s.modifiedAt ?? Date.now(),
            moduleId:   'skills',
            metadata:   {
                title:        s.name,  // primary display: 中学生作文审查
                tags:         s.enabled ? [] : ['disabled'],
                lastModified: s.modifiedAt ?? Date.now(),
                custom:       { skillType: s.type, enabled: s.enabled },
            },
        } as EngineNode;

        // Attach skill ID as node.content so NodeMapper uses it as the summary line.
        // With showSummary=true, the list shows:
        //   [⚡] 中学生作文审查   ← name (primary)
        //        essay-review-cn  ← id  (summary / brief)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (node as any).content = s.id;

        return node;
    }

    private fire(type: EngineEventType, payload: unknown): void {
        const event: EngineEvent = { type, payload };
        for (const h of this.listeners.get(type) ?? []) h(event);
    }
}
