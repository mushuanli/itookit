// @file: llm-harness/src/drivers/skill-device-driver.ts
// Skill 设备驱动：包装 ISkillService，实现 IDeviceDriver。

// node:child_process is loaded dynamically in registerShellTool to stay browser-safe.
import type {
    IDeviceDriver,
    ISkillService,
    IToolService,
    ToolHandler,
    SkillDefinition,
    SkillToolBinding,
    SkillLoadResult,
    SkillRouteLayer,
    SkillMatchContext,
    SkillScopeLevel,
    ParsedCompactInstructions,
    DeviceContext,
    ScopeEntry,
} from '@itookit/common';
import { aggregateCompactInstructions } from '../skills/compact-extractor';
import { matchGlob } from '../skills/glob-matcher';
import {
    findProjectRoot,
    buildScopeEntries,
    scanScopeEntry,
    fsSkillToSkillDef,
    loadAgentMd,
} from '../skills/fs-skill-loader';

export class SkillDeviceDriver implements IDeviceDriver, ISkillService {
    readonly handlerId = 'skills';
    readonly description = 'Skill management device';
    readonly writable = false;
    readonly streamable = false;
    readonly sessionable = false;

    private registry = new Map<string, SkillDefinition>();
    private loaded = new Set<string>();
    private changeListeners: Array<() => void> = [];
    private toolService: IToolService | null = null;

    // ── 新增：作用域 & Glob 状态 ──
    /** skillId → 当前挂载该 skill 的文件路径集合（L4 glob 联动） */
    private globMounted = new Map<string, Set<string>>();
    private cwd: string = '';
    private scopeEntries: ScopeEntry[] = [];
    /** 文件系统扫描注册的 skill id 集合（不受 VFS 同步删除） */
    private fsSkillIds = new Set<string>();
    /** _agent/AGENT.md 内容（项目级永久指令，始终注入系统 Prompt） */
    private agentMdContent: string = '';

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

        // Register dynamic tools (http / shell) into ToolService on demand.
        // 'builtin' tools are already registered; 'prompt' skills need no tools.
        if (this.toolService) {
            for (const binding of skill.tools) {
                if (binding.executionType === 'http') {
                    this.registerHttpTool(skill, binding);
                } else if (binding.executionType === 'shell') {
                    this.registerShellTool(skill, binding);
                }
            }
        }

        return { skillId: id, success: true, toolIds };
    }

    async unloadSkill(id: string): Promise<void> {
        this.loaded.delete(id);
        this.globMounted.delete(id);
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
        this.loaded.delete(id);
        this.globMounted.delete(id);
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
                this.loaded.delete(skillId);
            }
        }
    }

    async registerFromDirectory(
        dirPath: string,
        scopeLevel: SkillScopeLevel,
        scopeRoot: string
    ): Promise<SkillLoadResult[]> {
        const entry: ScopeEntry = { dirPath, scopeLevel: scopeLevel as ScopeEntry['scopeLevel'], scopeRoot };
        const dirs = await scanScopeEntry(entry);
        const results: SkillLoadResult[] = [];

        for (const dir of dirs) {
            const skillDef = fsSkillToSkillDef(dir, entry);
            this.registry.set(skillDef.id, skillDef);
            this.fsSkillIds.add(skillDef.id);
            results.push({ skillId: skillDef.id, success: true, toolIds: [] });
        }

        if (dirs.length > 0) this.notifyChange();
        return results;
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
        const root = await findProjectRoot(cwd);

        if (!root) {
            this.scopeEntries = [];
            this.agentMdContent = '';
            return;
        }

        // Load project-level AGENT.md (always-on instructions, injected at P0.5)
        this.agentMdContent = await loadAgentMd(root);

        // Dynamic import path module (browser safe)
        let pathModule: typeof import('node:path') | null = null;
        try {
            pathModule = await import('node:path');
        } catch {
            return;
        }

        this.scopeEntries = buildScopeEntries(root, cwd, pathModule);
        await this.refreshScopedSkills();
    }

    getScopedSkills(): SkillDefinition[] {
        return this.listSkills().filter((s) => this.isSkillInScope(s));
    }

    async refreshScopedSkills(): Promise<SkillLoadResult[]> {
        // Collect current scope roots
        const activeScopeRoots = new Set(this.scopeEntries.map((e) => e.scopeRoot));

        // Unload skills from no-longer-active scope roots
        for (const skill of this.listSkills()) {
            if (skill.source !== 'filesystem') continue;
            if (skill.scopeRoot && !activeScopeRoots.has(skill.scopeRoot)) {
                this.registry.delete(skill.id);
                this.loaded.delete(skill.id);
                this.globMounted.delete(skill.id);
                this.fsSkillIds.delete(skill.id);
            }
        }

        // Scan new scope entries
        const allResults: SkillLoadResult[] = [];
        for (const entry of this.scopeEntries) {
            const results = await this.registerFromDirectory(
                entry.dirPath,
                entry.scopeLevel,
                entry.scopeRoot
            );
            allResults.push(...results);
        }

        this.notifyChange();
        return allResults;
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

    private registerHttpTool(skill: SkillDefinition, binding: SkillToolBinding): void {
        if (!this.toolService || !skill.endpoint) return;
        // Avoid re-registering on repeated loadSkill calls.
        if (this.toolService.getToolMeta(binding.toolId)) return;

        const endpoint = skill.endpoint;
        const method = skill.method ?? 'POST';
        const headers = skill.headers ?? {};

        const handler: ToolHandler = async (args) => {
            const response = await fetch(endpoint, {
                method,
                headers: { 'Content-Type': 'application/json', ...headers },
                body: method !== 'GET' ? JSON.stringify(args) : undefined,
            });
            if (!response.ok) {
                return `Error: HTTP ${response.status} from ${endpoint}`;
            }
            const text = await response.text();
            return text;
        };

        this.toolService.registerTool(
            {
                id: binding.toolId,
                name: binding.toolId,
                description: binding.definition.function?.description ?? binding.definition.name ?? binding.toolId,
                sideEffect: binding.sideEffect ?? 'external',
                timeoutMs: binding.timeoutMs ?? 30_000,
                type: 'builtin',
                enabled: true,
            },
            binding.definition,
            handler,
        );
    }

    /**
     * Shell 命令工具注册。
     * 将 binding.command 模板渲染后通过 spawn 执行，输出作为工具结果返回给 LLM。
     */
    private registerShellTool(_skill: SkillDefinition, binding: SkillToolBinding): void {
        if (!this.toolService) return;
        if (this.toolService.getToolMeta(binding.toolId)) return; // idempotent

        const template = binding.command ?? '';
        const MAX_OUTPUT = 50_000;

        const handler: ToolHandler = async (args, ctx) => {
            // Dynamic import keeps node:child_process out of browser bundles.
            let spawnFn: typeof import('node:child_process').spawn;
            try {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const cp = await import('node:child_process' as any);
                spawnFn = cp.spawn;
            } catch {
                return 'Error: shell skill tools are not available in browser environments';
            }

            // Render {{argName}} placeholders
            let command = template;
            for (const [k, v] of Object.entries(args)) {
                command = command.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), String(v));
            }

            return new Promise((resolve) => {
                const chunks: string[] = [];
                let timedOut = false;

                const proc = spawnFn('sh', ['-c', command], {
                    cwd: ctx.cwd,
                    env: { ...process.env },
                    stdio: ['ignore', 'pipe', 'pipe'],
                });

                const timer = setTimeout(() => {
                    timedOut = true;
                    proc.kill('SIGTERM');
                }, ctx.timeoutMs);

                const onData = (chunk: Buffer) => {
                    chunks.push(chunk.toString());
                    if (chunks.join('').length > MAX_OUTPUT) proc.kill('SIGTERM');
                };

                proc.stdout.on('data', onData);
                proc.stderr.on('data', onData);
                ctx.signal?.addEventListener('abort', () => proc.kill('SIGTERM'));

                proc.on('close', (code) => {
                    clearTimeout(timer);
                    let output = chunks.join('');
                    if (output.length > MAX_OUTPUT) output = output.slice(0, MAX_OUTPUT) + '\n[output truncated]';
                    const prefix = timedOut ? `[timeout after ${ctx.timeoutMs}ms]\n` : `[exit ${code ?? '?'}]\n`;
                    resolve(`$ ${command}\n${prefix}${output}`);
                });

                proc.on('error', (err) => {
                    clearTimeout(timer);
                    resolve(`Error spawning command: ${err.message}`);
                });
            });
        };

        this.toolService.registerTool(
            {
                id: binding.toolId,
                name: binding.definition.function?.name ?? binding.toolId,
                description: binding.definition.function?.description ?? '',
                sideEffect: binding.sideEffect ?? 'local',
                timeoutMs: binding.timeoutMs ?? 30_000,
                type: 'builtin',
                enabled: true,
            },
            binding.definition,
            handler,
        );
    }

    private notifyChange(): void {
        for (const l of this.changeListeners) l();
    }
}
