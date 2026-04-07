// @file: device-skills/src/skill-service.ts
// Skill 服务核心实现。

import type {
    SkillDefinition,
    SkillLoadResult,
    ISkillService,
    IToolService,
    ToolMeta,
    ToolHandler,
    ToolExecutionContext,
} from '@itookit/common';

/**
 * Skill 服务实现。
 *
 * 职责：
 * 1. Skill 注册表管理（CRUD）
 * 2. Skill 加载/卸载生命周期
 * 3. 自动检测匹配的 Skill
 * 4. 与 ToolService 协作注册/注销 Skill 工具
 *
 * 设计原则：
 * - SRP: 只负责 Skill 的管理，工具执行委托给 device-tools
 * - DIP: 依赖 IToolService 接口，不直接依赖 ToolService 实现
 */
export class SkillService implements ISkillService {
    private skills = new Map<string, SkillDefinition>();
    private loadedSkills = new Set<string>();
    private listeners = new Set<() => void>();

    constructor(
        private toolService: IToolService,
    ) {}

    // ── 查询 ──

    listSkills(): SkillDefinition[] {
        return [...this.skills.values()];
    }

    getSkill(id: string): SkillDefinition | undefined {
        return this.skills.get(id);
    }

    getSkillNames(): string[] {
        return [...this.skills.keys()];
    }

    getLoadedSkills(): SkillDefinition[] {
        const loaded: SkillDefinition[] = [];
        for (const id of this.loadedSkills) {
            const skill = this.skills.get(id);
            if (skill) loaded.push(skill);
        }
        return loaded.sort((a, b) => a.priority - b.priority);
    }

    getUnloadedSkills(): SkillDefinition[] {
        const unloaded: SkillDefinition[] = [];
        for (const [id, skill] of this.skills) {
            if (!this.loadedSkills.has(id) && !skill.autoLoad) {
                unloaded.push(skill);
            }
        }
        return unloaded.sort((a, b) => a.priority - b.priority);
    }

    // ── 生命周期 ──

    /**
     * 加载 Skill。
     *
     * 将 Skill 的工具注册到 device-tools 中。
     */
    async loadSkill(id: string): Promise<SkillLoadResult> {
        const skill = this.skills.get(id);
        if (!skill) {
            return {
                skillId: id,
                success: false,
                toolIds: [],
                error: `Skill '${id}' not found. Available: ${this.getSkillNames().join(', ')}`,
            };
        }

        if (this.loadedSkills.has(id)) {
            return {
                skillId: id,
                success: true,
                toolIds: skill.tools.map(t => t.toolId),
                error: `Skill '${id}' is already loaded.`,
            };
        }

        const registeredToolIds: string[] = [];

        for (const binding of skill.tools) {
            // 根据执行类型构建 handler
            const handler = this.buildToolHandler(skill, binding);
            if (!handler) continue;

            const meta: ToolMeta = {
                id: binding.toolId,
                name: binding.definition.function?.name ?? binding.toolId,
                description: binding.definition.function?.description ?? '',
                sideEffect: binding.sideEffect ?? 'none',
                timeoutMs: binding.timeoutMs ?? 30_000,
                type: 'plugin',
                enabled: true,
                tags: [`skill:${id}`],
            };

            this.toolService.registerTool(meta, binding.definition, handler);
            registeredToolIds.push(binding.toolId);
        }

        this.loadedSkills.add(id);
        this.notifyListeners();

        return {
            skillId: id,
            success: true,
            toolIds: registeredToolIds,
        };
    }

    /**
     * 卸载 Skill。
     *
     * 从 device-tools 中移除 Skill 的工具。
     */
    async unloadSkill(id: string): Promise<void> {
        const skill = this.skills.get(id);
        if (!skill) return;

        for (const binding of skill.tools) {
            this.toolService.unregisterTool(binding.toolId);
        }

        this.loadedSkills.delete(id);
        this.notifyListeners();
    }

    /**
     * 根据任务 prompt 自动检测应加载的 Skill。
     */
    autoDetectSkills(prompt: string): string[] {
        const detected: string[] = [];
        const lower = prompt.toLowerCase();

        for (const [id, skill] of this.skills) {
            if (skill.autoLoad) {
                detected.push(id);
                continue;
            }

            for (const pattern of skill.triggerPatterns) {
                try {
                    if (new RegExp(pattern, 'i').test(lower)) {
                        detected.push(id);
                        break;
                    }
                } catch {
                    // 无效正则时回退到简单包含匹配
                    if (lower.includes(pattern.toLowerCase())) {
                        detected.push(id);
                        break;
                    }
                }
            }
        }

        return detected;
    }

    // ── CRUD ──

    async saveSkill(skill: SkillDefinition): Promise<void> {
        const now = Date.now();
        const existing = this.skills.get(skill.id);

        this.skills.set(skill.id, {
            ...skill,
            createdAt: existing?.createdAt ?? now,
            modifiedAt: now,
        });

        this.notifyListeners();
    }

    async deleteSkill(id: string): Promise<void> {
        // 先卸载
        if (this.loadedSkills.has(id)) {
            await this.unloadSkill(id);
        }

        this.skills.delete(id);
        this.notifyListeners();
    }

    // ── 变更监听 ──

    onChange(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    private notifyListeners(): void {
        for (const listener of this.listeners) {
            try {
                listener();
            } catch (err) {
                console.error('[SkillService] Listener error:', err);
            }
        }
    }

    // ── 工具 Handler 构建 ──

    /**
     * 根据 Skill 工具绑定的执行类型构建对应的 ToolHandler。
     */
    private buildToolHandler(
        skill: SkillDefinition,
        binding: import('@itookit/common').SkillToolBinding,
    ): ToolHandler | null {
        switch (binding.executionType) {
            case 'builtin':
                // builtin 类型的工具已经在 device-tools 中注册，
                // Skill 只是引用它，不需要额外 handler
                return null;

            case 'http':
                return this.buildHttpHandler(skill, binding);

            case 'handler':
                // handler 类型目前不支持动态函数传递，
                // 预留给未来的插件系统
                console.warn(
                    `[SkillService] 'handler' execution type not yet supported for tool '${binding.toolId}'`,
                );
                return null;

            default:
                return null;
        }
    }

    /**
     * 构建 HTTP 调用 handler。
     *
     * Skill 的 HTTP 工具通过 fetch 调用远程端点。
     */
    private buildHttpHandler(
        skill: SkillDefinition,
        binding: import('@itookit/common').SkillToolBinding,
    ): ToolHandler {
        return async (
            args: Record<string, unknown>,
            ctx: import('@itookit/common').ToolExecutionContext,
        ): Promise<string> => {
            const endpoint = skill.endpoint;
            if (!endpoint) {
                return `Error: Skill '${skill.id}' has no endpoint configured for HTTP execution.`;
            }

            const method = skill.method ?? 'POST';
            const headers: Record<string, string> = {
                'Content-Type': 'application/json',
                ...(skill.headers ?? {}),
            };

            try {
                const response = await fetch(endpoint, {
                    method,
                    headers,
                    body: method !== 'GET' ? JSON.stringify(args) : undefined,
                    signal: ctx.signal,
                });

                if (!response.ok) {
                    const text = await response.text().catch(() => '');
                    return `Error: HTTP ${response.status} ${response.statusText}\n${text}`.trim();
                }

                const contentType = response.headers.get('content-type') ?? '';
                if (contentType.includes('application/json')) {
                    const json = await response.json();
                    return JSON.stringify(json, null, 2);
                }

                return await response.text();
            } catch (err: any) {
                if (err.name === 'AbortError') {
                    return `Error: HTTP request to '${endpoint}' was aborted.`;
                }
                return `Error: Failed to call '${endpoint}': ${err.message}`;
            }
        };
    }
}
