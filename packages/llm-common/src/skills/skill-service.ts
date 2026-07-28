// @file: common/interfaces/skills/skill-service.ts
// Skill 设备的服务接口定义。

import type {
    SkillDefinition,
    SkillLoadResult,
    SkillRouteLayer,
    SkillMatchContext,
    SkillScopeLevel,
    ParsedCompactInstructions,
} from './skill-types';

/**
 * Skill 设备服务接口。
 *
 * 由 device-skills 的 SkillDeviceDriver 实现。
 * llm-agent 通过此接口管理 Skill 的生命周期。
 */
export interface ISkillService {
    /** 获取所有已注册的 Skill 定义 */
    listSkills(): SkillDefinition[];

    /** 获取指定 Skill */
    getSkill(id: string): SkillDefinition | undefined;

    /** 获取所有 Skill 名称（用于 load_skill 提示） */
    getSkillNames(): string[];

    /**
     * 加载 Skill 到当前会话。
     *
     * 会将 Skill 的工具注册到 device-tools，
     * 并返回加载结果（包含新增的工具列表）。
     */
    loadSkill(id: string): Promise<SkillLoadResult>;

    /**
     * 卸载 Skill。
     *
     * 从 device-tools 中移除 Skill 的工具。
     */
    unloadSkill(id: string): Promise<void>;

    /**
     * 获取已加载的 Skill 列表（用于 prompt 注入） */
    getLoadedSkills(): SkillDefinition[];

    /**
     * 获取尚未加载的 Skill 列表（用于提示 LLM 可用的 Skill）
     */
    getUnloadedSkills(): SkillDefinition[];

    /**
     * 根据任务 prompt 自动检测应加载的 Skill。
     */
    autoDetectSkills(prompt: string): string[];

    // ── CRUD（持久化管理）──
    saveSkill(skill: SkillDefinition): Promise<void>;
    deleteSkill(id: string): Promise<void>;

    /** 监听变化 */
    onChange(listener: () => void): () => void;

    // ── 四层路由 ──

    /**
     * 返回四层路由分类（L1 silent / L2 index / L3 dynamicMount / L4 spatial）。
     * ContextManager 据此构建 P2/P3/P4 系统 Prompt。
     */
    getRouteLayers(): SkillRouteLayer;

    /**
     * 语义匹配：给定用户消息和上下文，返回应加载的 skill id 列表。
     *
     * 优先级：triggerPatterns(regex) → 关键词重叠(≥2) → globs(openFiles)
     */
    semanticMatchSkills(userMessage: string, context?: SkillMatchContext): string[];

    /**
     * 文件打开时触发 Glob 挂载（L4 层）。
     * 若文件路径匹配某 skill 的 globs，将该 skill 标记为已挂载并加载。
     */
    mountByGlob(filePath: string): void;

    /**
     * 文件关闭时触发 Glob 卸载（L4 层）。
     * 若该 skill 无更多匹配文件，从已加载集合移除。
     */
    unmountByGlob(filePath: string): void;

    /**
     * 扫描指定目录下的 skill 子目录，注册为文件系统 skill。
     * 已注册的 skill 幂等（覆盖更新）。
     */
    registerFromDirectory(
        dirPath: string,
        scopeLevel: SkillScopeLevel,
        scopeRoot: string
    ): Promise<SkillLoadResult[]>;

    // ── Compact Instructions ──

    /** 解析单个 skill 的 compact instructions */
    parseCompactInstructions(skillId: string): ParsedCompactInstructions;

    /**
     * 聚合所有已启用 skill 的 compact instructions。
     * 用于注入 L3 压缩提示词。
     */
    getCompactInstructions(): string;

    // ── 作用域管理 ──

    /**
     * 设置当前工作目录，触发作用域重建。
     *
     * 流程：findProjectRoot → buildScopeEntries → refreshScopedSkills
     */
    setCwd(cwd: string): Promise<void>;

    /**
     * 返回当前作用域可见的 skill 列表（已过滤不在作用域内的 skill）。
     */
    getScopedSkills(): SkillDefinition[];

    /**
     * 重新扫描当前作用域条目，卸载失效 skill，加载新 skill。
     */
    refreshScopedSkills(): Promise<SkillLoadResult[]>;

    /**
     * 返回当前项目的 _agent/AGENT.md 内容。
     * 注入到系统 Prompt P0.5 层（预算豁免，始终包含）。
     * 无 AGENT.md 或浏览器环境时返回空字符串。
     */
    getAgentMdContent(): string;
}
