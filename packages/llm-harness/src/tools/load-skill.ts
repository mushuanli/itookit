// @file: llm-harness/src/tools/load-skill.ts
// load_skill tool — dynamically activates an agent Skill.
//
// Handler is a factory (not a plain export) because it needs a live ISkillService
// reference, which is only available after services are wired up in the factory.

import type { ToolMeta, ToolDefinition, ToolHandler, ISkillService } from '@itookit/common';

export const loadSkillMeta: ToolMeta = {
    id: 'load_skill',
    name: 'Load Skill',
    description: 'Dynamically load an agent skill to gain access to new tools and instructions',
    sideEffect: 'none',
    timeoutMs: 5_000,
    type: 'builtin',
    enabled: true,
    tags: ['skill', 'meta'],
    // Tells the executor to call markSkillLoaded(args['skill_id']) on success,
    // without hardcoding the tool name 'load_skill' in the executor.
    skillLoaderArgKey: 'skill_id',
};

export const loadSkillDefinition: ToolDefinition = {
    name: 'load_skill',
    description:
        'Load a skill to gain access to its tools and usage instructions. ' +
        'Use when the task requires specialized capabilities not currently available. ' +
        'Check the Available Skills list in the system prompt for valid skill IDs.',
    parameters: {
        type: 'object',
        properties: {
            skill_id: {
                type: 'string',
                description: 'ID of the skill to load (from the Available Skills list)',
            },
        },
        required: ['skill_id'],
    },
};

/** Returns a ToolHandler that delegates to the provided ISkillService. */
export function createLoadSkillHandler(skillService: ISkillService): ToolHandler {
    return async (args) => {
        const skillId = args['skill_id'] as string | undefined;
        if (!skillId) return 'Error: skill_id argument is required';

        // L1: action skills with disableModelInvocation must not be loaded by the model.
        const skill = skillService.getSkill(skillId);
        if (skill?.disableModelInvocation) {
            return `Error: Skill "${skillId}" is an action skill and cannot be loaded by the model. Use the /${skillId} slash command to invoke it directly.`;
        }

        const result = await skillService.loadSkill(skillId);
        if (!result.success) return `Error loading skill "${skillId}": ${result.error}`;
        return `Skill "${skillId}" loaded. New tools available: ${result.toolIds.join(', ')}`;
    };
}
