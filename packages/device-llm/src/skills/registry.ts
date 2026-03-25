// @file: device-llm/skills/registry.ts

import { Skill, SkillExecutionContext, SkillResult } from './types';
import { ToolDefinition, ToolCall } from '../types/message';
import { log } from '../utils/logger';

/**
 * 技能注册表
 */
export class SkillRegistry {
    private skills = new Map<string, Skill>();

    /**
     * 注册技能
     */
    register(skill: Skill): void {
        const id = skill.definition.id;
        if (this.skills.has(id)) {
            log.warn('Skill already registered, overwriting', { id });
        }
        this.skills.set(id, skill);
        log.debug('Skill registered', { id, name: skill.definition.name });
    }

    /**
     * 注销技能
     */
    unregister(id: string): boolean {
        const result = this.skills.delete(id);
        if (result) {
            log.debug('Skill unregistered', { id });
        }
        return result;
    }

    /**
     * 获取技能
     */
    get(id: string): Skill | undefined {
        return this.skills.get(id);
    }

    /**
     * 获取所有技能
     */
    getAll(): Skill[] {
        return Array.from(this.skills.values());
    }

    /**
     * 获取启用的技能
     */
    getEnabled(): Skill[] {
        return this.getAll().filter(s => s.definition.enabled !== false);
    }

    /**
     * 获取工具定义列表 (用于 LLM)
     */
    getToolDefinitions(): ToolDefinition[] {
        return this.getEnabled().map(s => s.definition.tool);
    }

    /**
     * 执行工具调用
     */
    async executeToolCall(
        toolCall: ToolCall,
        context?: SkillExecutionContext
    ): Promise<SkillResult> {
        const startTime = Date.now();

        // 查找技能
        const skillId = toolCall.function?.name;
        if (!skillId) {
            return {
                success: false,
                error: 'Tool call missing function name',
                duration: Date.now() - startTime
            };
        }

        const skill = this.skills.get(skillId);
        if (!skill) {
            return {
                success: false,
                error: `Skill not found: ${skillId}`,
                duration: Date.now() - startTime
            };
        }

        // 解析参数
        let args: Record<string, any>;
        try {
            args = JSON.parse(toolCall.function?.arguments || '{}');
        } catch (e) {
            return {
                success: false,
                error: `Invalid arguments JSON: ${e}`,
                duration: Date.now() - startTime
            };
        }

        // 验证参数
        if (skill.validate) {
            const validation = skill.validate(args);
            if (validation !== true) {
                return {
                    success: false,
                    error: typeof validation === 'string' ? validation : 'Validation failed',
                    duration: Date.now() - startTime
                };
            }
        }

        // 执行
        try {
            log.debug('Executing skill', { skillId, args });
            const result = await skill.execute(args, context);
            result.duration = Date.now() - startTime;
            log.debug('Skill executed', { skillId, success: result.success, duration: result.duration });
            return result;
        } catch (error: any) {
            log.error('Skill execution failed', { skillId, error: error.message });
            return {
                success: false,
                error: error.message || 'Unknown error',
                duration: Date.now() - startTime
            };
        }
    }

    /**
     * 批量执行工具调用
     */
    async executeToolCalls(
        toolCalls: ToolCall[],
        context?: SkillExecutionContext,
        options?: { parallel?: boolean }
    ): Promise<Map<string, SkillResult>> {
        const results = new Map<string, SkillResult>();

        if (options?.parallel) {
            // 并行执行
            const promises = toolCalls.map(async (tc) => {
                const result = await this.executeToolCall(tc, context);
                return { id: tc.id, result };
            });

            const settled = await Promise.all(promises);
            for (const { id, result } of settled) {
                results.set(id, result);
            }
        } else {
            // 串行执行
            for (const tc of toolCalls) {
                const result = await this.executeToolCall(tc, context);
                results.set(tc.id, result);
            }
        }

        return results;
    }
}

/**
 * 全局技能注册表实例
 */
export const globalSkillRegistry = new SkillRegistry();
