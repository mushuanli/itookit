// @file: common/interfaces/skills/skill-service.ts
// Skill 设备的服务接口定义。

import type { SkillDefinition, SkillLoadResult } from './skill-types';

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
}
