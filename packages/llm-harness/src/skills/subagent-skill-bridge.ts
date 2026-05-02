// @file: llm-harness/src/skills/subagent-skill-bridge.ts
// Subagent 委托：生成委托提示和子代理系统 Prompt。

import type { SkillDefinition } from '@itookit/common';

/**
 * 生成 Subagent 委托提示（注入到 loadSkill 结果中）。
 * 若 skill 不支持 subagent，返回 null。
 */
export function getDelegationHint(skill: SkillDefinition): string | null {
    if (!skill.supportsSubagent || !skill.subagentRole) return null;
    return (
        `[Subagent Available] This skill can delegate to a \`${skill.subagentRole}\` subagent. ` +
        `For computationally intensive tasks, prefer delegate_task.`
    );
}

/**
 * 构建子代理专用系统 Prompt。
 *
 * 包含：角色声明 + skill instructions + compact 红线规则（若有）。
 */
export function buildSubagentSystemPrompt(skill: SkillDefinition): string {
    const role = skill.subagentRole ?? 'specialized-agent';
    const redLines = skill.compact?.redLines ?? [];

    let prompt = `You are a specialized subagent: ${role}\n\n## Instructions\n${skill.instructions}`;

    if (redLines.length > 0) {
        prompt +=
            '\n\n## Critical Rules\n' +
            redLines.map((r) => `- [红线] ${r}`).join('\n');
    }

    return prompt;
}
