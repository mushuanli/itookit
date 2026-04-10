// @file: common/interfaces/skills/skill-types.ts
// Skill 相关的核心类型定义。

import type { ToolDefinition } from '../llm/message';

/**
 * Skill 类型分类。
 *
 * - builtin:  代码内置（如 load_skill 元工具自身）
 * - http:     远程 HTTP 端点，包装为 function-calling 工具
 * - shell:    本地 Shell 命令，包装为 function-calling 工具
 * - prompt:   纯 Markdown 指令注入，不产生可调用工具（最常用）
 * - mcp:      通过 MCP 协议提供
 * - custom:   用户自定义脚本
 */
export type SkillType = 'builtin' | 'http' | 'shell' | 'prompt' | 'mcp' | 'custom';

/**
 * Skill 定义。
 *
 * Skill = 一组相关的工具 + 系统指令 + 触发条件。
 *
 * 这是渐进式暴露（Progressive Disclosure）的核心单元：
 * 平时 LLM 只看到基础工具 + "有哪些 Skill 可以加载"的提示，
 * 当需要某个 Skill 时通过 load_skill 工具加载。
 */
export interface SkillDefinition {
    /** 唯一标识 */
    id: string;
    /** 名称 */
    name: string;
    /** 描述（显示在 AvailableSkillsSection 中） */
    description: string;
    /** 类型 */
    type: SkillType;
    /** 是否启用 */
    enabled: boolean;
    /** 图标 */
    icon?: string;

    /** 注入到系统提示词的指令（Markdown 格式） */
    instructions: string;

    /**
     * 此 Skill 附带的工具定义列表。
     *
     * 加载 Skill 时，这些工具会注册到 device-tools 中，
     * 并在系统提示词中添加 instructions。
     */
    tools: SkillToolBinding[];

    /**
     * 触发自动加载的关键词/正则模式。
     *
     * 当任务 prompt 匹配任一 pattern 时，自动加载此 Skill。
     */
    triggerPatterns: string[];

    /** 是否随会话自动加载（核心 Skill 设为 true） */
    autoLoad: boolean;

    /** 加载优先级（越小越优先） */
    priority: number;

    /** HTTP 端点配置（type='http' 时使用） */
    endpoint?: string;
    method?: 'GET' | 'POST' | 'PUT';
    headers?: Record<string, string>;

    /** LLM function-calling 参数 Schema（type='http' 时使用） */
    parameters?: Record<string, unknown>;

    /** 额外元数据 */
    metadata?: Record<string, unknown>;
    createdAt?: number;
    modifiedAt?: number;
}

/**
 * Skill 工具绑定。
 *
 * 描述 Skill 附带的一个工具：其 LLM 定义和执行方式。
 */
export interface SkillToolBinding {
    /** 工具 ID */
    toolId: string;
    /** LLM ToolDefinition */
    definition: ToolDefinition;
    /**
     * 执行方式：
     * - 'builtin':   由 llm-harness 内置工具处理（已注册，skill 只是引用）
     * - 'http':      HTTP 调用 skill 的 endpoint
     * - 'shell':     本地 Shell 命令，支持 {{argName}} 模板替换
     * - 'handler':   由 Skill 自身的 handler 函数处理（预留）
     */
    executionType: 'builtin' | 'http' | 'shell' | 'handler';
    /**
     * Shell 命令模板（executionType='shell'）。
     * 支持 {{argName}} 占位符，由 LLM 传入的参数替换。
     * 例：`git log --oneline -{{n}} -- {{path}}`
     */
    command?: string;
    /** 工具副作用（用于并行策略） */
    sideEffect?: import('../tools/tool-types').ToolSideEffect;
    /** 超时覆盖 */
    timeoutMs?: number;
}

/**
 * Skill 加载结果
 */
export interface SkillLoadResult {
    /** Skill ID */
    skillId: string;
    /** 是否成功加载 */
    success: boolean;
    /** 新增的工具 ID 列表 */
    toolIds: string[];
    /** 错误信息（仅 success=false 时） */
    error?: string;
}
