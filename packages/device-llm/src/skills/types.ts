// @file: device-llm/skills/types.ts

import { ToolDefinition } from '../types/message';

/**
 * 技能定义
 */
export interface SkillDefinition {
    /** 技能 ID */
    id: string;

    /** 技能名称 */
    name: string;

    /** 技能描述 */
    description: string;

    /** 技能类型 */
    type: 'builtin' | 'mcp' | 'custom';

    /** 工具定义 (用于 LLM) */
    tool: ToolDefinition;

    /** 是否启用 */
    enabled?: boolean;

    /** 元数据 */
    metadata?: Record<string, any>;
}

/**
 * 技能执行上下文
 */
export interface SkillExecutionContext {
    /** 会话 ID */
    sessionId?: string;

    /** 用户 ID */
    userId?: string;

    /** 超时 (ms) */
    timeout?: number;

    /** 中止信号 */
    signal?: AbortSignal;

    /** 额外上下文 */
    extra?: Record<string, any>;
}

/**
 * 技能执行结果
 */
export interface SkillResult {
    /** 是否成功 */
    success: boolean;

    /** 结果数据 */
    data?: any;

    /** 错误信息 */
    error?: string;

    /** 执行时间 (ms) */
    duration?: number;

    /** 元数据 */
    metadata?: Record<string, any>;
}

/**
 * 技能接口
 */
export interface Skill {
    /** 技能定义 */
    definition: SkillDefinition;

    /** 执行技能 */
    execute(args: Record<string, any>, context?: SkillExecutionContext): Promise<SkillResult>;

    /** 验证参数 */
    validate?(args: Record<string, any>): boolean | string;
}
