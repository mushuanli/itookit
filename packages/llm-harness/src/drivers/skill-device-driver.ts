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
    DeviceContext,
} from '@itookit/common';

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

    // ── ISkillService ──

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
        const matches: string[] = [];
        for (const skill of this.registry.values()) {
            if (!skill.enabled) continue;
            for (const pattern of skill.triggerPatterns) {
                if (new RegExp(pattern, 'i').test(prompt)) {
                    matches.push(skill.id);
                    break;
                }
            }
        }
        return matches;
    }

    async saveSkill(skill: SkillDefinition): Promise<void> {
        this.registry.set(skill.id, skill);
        this.notifyChange();
    }

    async deleteSkill(id: string): Promise<void> {
        this.registry.delete(id);
        this.loaded.delete(id);
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
