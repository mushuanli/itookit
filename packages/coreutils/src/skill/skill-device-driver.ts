// @file: coreutils/src/skill/skill-device-driver.ts
// Skill 设备驱动：包装 ISkillService，实现 IDeviceDriver。

import type {
    ISkillService,
    IToolService,
    SkillDefinition,
    SkillToolBinding,
    SkillLoadResult,
    SkillRouteLayer,
    SkillMatchContext,
    SkillScopeLevel,
    ParsedCompactInstructions,
} from '@itookit/common';
import type {
    IDeviceDriver,
    DeviceContext,
} from '@itookit/vfs-core';
import { aggregateCompactInstructions } from './compact-extractor';
import { matchGlob } from './glob-matcher';
import type { SkillSource, SkillToolHandlerFactory } from '../ports/capabilities';

export interface SkillDeviceDriverOptions {
    registry?: Map<string, SkillDefinition>;
    source?: SkillSource;
    toolHandlerFactory?: SkillToolHandlerFactory;
}

export class SkillDeviceDriver implements IDeviceDriver, ISkillService {
    readonly handlerId = 'skills';
    readonly description = 'Skill management device';
    readonly writable = false;
    readonly streamable = false;
    readonly sessionable = false;

    private readonly registry: Map<string, SkillDefinition>;
    private loaded = new Set<string>();
    private changeListeners: Array<() => void> = [];
    private toolService: IToolService | null = null;

    // ── 新增：作用域 & Glob 状态 ──
    /** skillId → 当前挂载该 skill 的文件路径集合（L4 glob 联动） */
    private globMounted = new Map<string, Set<string>>();
    private cwd: string = '';
    private fsSkillIds = new Set<string>();
    private registeredTools = new Map<string, Set<string>>();
    /** _agent/AGENT.md 内容（项目级永久指令，始终注入系统 Prompt） */
    private agentMdContent: string = '';

    constructor(private readonly options: SkillDeviceDriverOptions = {}) {
        this.registry = options.registry ?? new Map<string, SkillDefinition>();
    }

    /** Inject ToolService so loadSkill can register HTTP-backed tools. */
    setToolService(toolService: IToolService): void {
        this.toolService = toolService;
    }

    async init(): Promise<void> {}
    async dispose(): Promise<void> {}

    // ── IDeviceDriver ──

    async read(_ctx: DeviceContext): Promise<string> {
        return this.listSkills().map((s) => `${s.id}: ${s.name}`).join('\n');
    }

    async write(_ctx: DeviceContext): Promise<void> {}

    async ioctl(_ctx: DeviceContext, command: string, arg?: unknown): Promise<unknown> {
        if (command === 'load' && typeof arg === 'string') return this.loadSkill(arg);
        if (command === 'list') return this.listSkills();
        throw new Error(`Unknown ioctl command: ${command}`);
    }

    // ── ISkillService — 基础 CRUD ──

    listSkills(): SkillDefinition[] {
        return [...this.registry.values()];
    }

    getSkill(id: string): SkillDefinition | undefined {
        return this.registry.get(id);
    }

    getSkillNames(): string[] {
        return [...this.registry.keys()];
    }

    async loadSkill(id: string): Promise<SkillLoadResult> {
        const skill = this.registry.get(id);
        if (!skill) {
            return { skillId: id, success: false, toolIds: [], error: `Skill not found: ${id}` };
        }
        if (!skill.enabled) {
            return { skillId: id, success: false, toolIds: [], error: `Skill is disabled: ${id}` };
        }

        this.loaded.add(id);
        const toolIds = skill.tools.map((t) => t.toolId);

        for (const binding of skill.tools) this.registerDynamicTool(skill, binding);

        return { skillId: id, success: true, toolIds };
    }

    async unloadSkill(id: string): Promise<void> {
        this.deactivateSkill(id);
    }

    getLoadedSkills(): SkillDefinition[] {
        return [...this.loaded]
            .map((id) => this.registry.get(id))
            .filter((s): s is SkillDefinition => s !== undefined);
    }

    getUnloadedSkills(): SkillDefinition[] {
        return this.listSkills().filter((s) => !this.loaded.has(s.id) && s.enabled);
    }

    autoDetectSkills(prompt: string): string[] {
        return this.semanticMatchSkills(prompt);
    }

    async saveSkill(skill: SkillDefinition): Promise<void> {
        this.registry.set(skill.id, skill);
        this.notifyChange();
    }

    /**
     * 删除 skill。
     * 保护：source='filesystem' 的 skill 不受 VFS 同步删除影响。
     * VFS 同步调用时应先检查来源。
     */
    async deleteSkill(id: string): Promise<void> {
        const skill = this.registry.get(id);
        if (skill?.source === 'filesystem') return; // 文件系统 skill 不被 VFS 同步删除
        this.registry.delete(id);
        this.deactivateSkill(id);
        this.notifyChange();
    }

    onChange(listener: () => void): () => void {
        this.changeListeners.push(listener);
        return () => {
            const idx = this.changeListeners.indexOf(listener);
            if (idx >= 0) this.changeListeners.splice(idx, 1);
        };
    }

    getService(): ISkillService {
        return this;
    }

    // ── ISkillService — 四层路由 ──

    getRouteLayers(): SkillRouteLayer {
        const layers: SkillRouteLayer = {
            silent: [],
            index: [],
            dynamicMount: [],
            spatial: [],
        };

        for (const skill of this.getScopedSkills()) {
            if (!skill.enabled) continue;

            // L1: action skill with disableModelInvocation → silent
            if (skill.disableModelInvocation) {
                layers.silent.push(skill);
                continue;
            }

            const isLoaded = this.loaded.has(skill.id);
            const isGlobMounted = (this.globMounted.get(skill.id)?.size ?? 0) > 0;

            if (isLoaded && isGlobMounted) {
                layers.spatial.push(skill); // L4
            } else if (isLoaded) {
                layers.dynamicMount.push(skill); // L3
            } else {
                layers.index.push(skill); // L2
            }
        }

        return layers;
    }

    /**
     * 语义匹配，返回应加载的 skill id 列表。
     * 跳过 L1 action skill（disableModelInvocation=true）。
     * 优先级：triggerPatterns → 关键词重叠(≥2) → globs
     */
    semanticMatchSkills(userMessage: string, context?: SkillMatchContext): string[] {
        const matched = new Set<string>();
        const lowerMsg = userMessage.toLowerCase();
        const msgWords = lowerMsg.split(/\W+/).filter((w) => w.length > 2);

        for (const skill of this.getScopedSkills()) {
            if (!skill.enabled || skill.disableModelInvocation) continue;
            if (this.loaded.has(skill.id)) continue;

            // 1. triggerPatterns (regex, backward compat)
            if (skill.triggerPatterns.some((p) => new RegExp(p, 'i').test(userMessage))) {
                matched.add(skill.id);
                continue;
            }

            // 2. Keyword overlap: ≥2 words from description appear in message
            const descWords = skill.description.toLowerCase().split(/\W+/).filter((w) => w.length > 2);
            const overlap = descWords.filter((w) => msgWords.includes(w));
            if (overlap.length >= 2) {
                matched.add(skill.id);
                continue;
            }

            // 3. Glob match against openFiles context
            if (context?.openFiles?.length && skill.globs?.length) {
                if (context.openFiles.some((f) => matchGlob(f, skill.globs!))) {
                    matched.add(skill.id);
                }
            }
        }

        return [...matched];
    }

    mountByGlob(filePath: string): void {
        for (const skill of this.getScopedSkills()) {
            if (!skill.enabled || !skill.globs?.length) continue;
            if (matchGlob(filePath, skill.globs)) {
                if (!this.globMounted.has(skill.id)) {
                    this.globMounted.set(skill.id, new Set());
                }
                this.globMounted.get(skill.id)!.add(filePath);
                this.loaded.add(skill.id);
            }
        }
    }

    unmountByGlob(filePath: string): void {
        for (const [skillId, files] of this.globMounted) {
            files.delete(filePath);
            if (files.size === 0) {
                this.globMounted.delete(skillId);
                this.deactivateSkill(skillId);
            }
        }
    }

    async registerFromDirectory(
        dirPath: string,
        scopeLevel: SkillScopeLevel,
        scopeRoot: string
    ): Promise<SkillLoadResult[]> {
        const loader = this.options.source?.loadDirectory;
        if (!loader) return [];
        const skills = await loader(dirPath, scopeLevel, scopeRoot);
        return this.replaceFileSystemSkills(skills, false);
    }

    // ── ISkillService — Compact Instructions ──

    parseCompactInstructions(skillId: string): ParsedCompactInstructions {
        const skill = this.registry.get(skillId);
        if (!skill?.compact) return { redLines: [], fullText: '' };
        const { redLines, rawContent } = skill.compact;
        return { redLines, fullText: rawContent };
    }

    getCompactInstructions(): string {
        return aggregateCompactInstructions(this.listSkills());
    }

    // ── ISkillService — 作用域管理 ──

    getAgentMdContent(): string {
        return this.agentMdContent;
    }

    async setCwd(cwd: string): Promise<void> {
        this.cwd = cwd;
        await this.refreshScopedSkills();
    }

    getScopedSkills(): SkillDefinition[] {
        return this.listSkills().filter((s) => this.isSkillInScope(s));
    }

    async refreshScopedSkills(): Promise<SkillLoadResult[]> {
        if (!this.options.source) return [];
        const snapshot = await this.options.source.loadScope(this.cwd);
        this.agentMdContent = snapshot.agentInstructions;
        return this.replaceFileSystemSkills(snapshot.skills, true);
    }

    // ── 私有工具 ──

    /**
     * 判断 skill 是否在当前作用域内可见（设计文档 6.3 节）。
     */
    private isSkillInScope(skill: SkillDefinition): boolean {
        const level = skill.scopeLevel;
        // VFS skills and skills without scope are always visible
        if (!level || level === 'vfs' || level === 'global-fs') return true;

        const scopeRoot = skill.scopeRoot ?? '';
        if (level === 'local-fs') {
            return this.cwd === scopeRoot;
        }

        // parent-fs: scopeRoot must be an ancestor of cwd
        return this.cwd === scopeRoot || this.cwd.startsWith(scopeRoot + '/');
    }

    private registerDynamicTool(skill: SkillDefinition, binding: SkillToolBinding): void {
        if (!this.toolService || binding.executionType === 'builtin') return;
        if (this.toolService.getToolMeta(binding.toolId)) return;
        const handler = this.options.toolHandlerFactory?.create(skill, binding);
        if (!handler) return;
        this.toolService.registerTool(toolMeta(skill, binding), binding.definition, handler);
        const owned = this.registeredTools.get(skill.id) ?? new Set<string>();
        owned.add(binding.toolId);
        this.registeredTools.set(skill.id, owned);
    }

    private deactivateSkill(id: string): void {
        this.loaded.delete(id);
        this.globMounted.delete(id);
        for (const toolId of this.registeredTools.get(id) ?? []) {
            this.toolService?.unregisterTool(toolId);
        }
        this.registeredTools.delete(id);
    }

    private replaceFileSystemSkills(skills: SkillDefinition[], replace: boolean): SkillLoadResult[] {
        if (replace) {
            for (const id of this.fsSkillIds) {
                this.registry.delete(id);
                this.deactivateSkill(id);
            }
            this.fsSkillIds.clear();
        }
        for (const skill of skills) {
            this.registry.set(skill.id, skill);
            this.fsSkillIds.add(skill.id);
        }
        if (skills.length > 0 || replace) this.notifyChange();
        return skills.map(skill => ({ skillId: skill.id, success: true, toolIds: [] }));
    }

    private notifyChange(): void {
        for (const l of this.changeListeners) l();
    }
}

function toolMeta(skill: SkillDefinition, binding: SkillToolBinding): import('@itookit/common').ToolMeta {
    return {
        id: binding.toolId,
        name: binding.definition.function?.name ?? binding.definition.name ?? binding.toolId,
        description: binding.definition.function?.description ?? skill.description,
        sideEffect: binding.sideEffect ?? (binding.executionType === 'http' ? 'external' : 'local'),
        timeoutMs: binding.timeoutMs ?? 30_000,
        type: 'plugin',
        enabled: true,
    };
}
