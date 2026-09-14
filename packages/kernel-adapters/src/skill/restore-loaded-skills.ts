import type { ISkillService } from '@itookit/common';
import { parseLoadedSkillIds } from './loaded-state';

/** Roll back only activations introduced by this restoration attempt. */
export async function restoreLoadedSkills(service: ISkillService, value: unknown): Promise<void> {
    const ids = parseLoadedSkillIds(value);
    const previous = new Set(service.getLoadedSkills().map(skill => skill.id));
    const activated: string[] = [];
    try {
        for (const id of ids) {
            const skill = service.getSkill(id);
            if (skill?.disableModelInvocation || skill?.triggerStrategy === 'action') {
                throw new Error(`Skill cannot be restored for model invocation: ${id}`);
            }
            const result = await service.loadSkill(id);
            if (!result.success) throw new Error(result.error ?? `Failed to restore Skill: ${id}`);
            if (!previous.has(id)) activated.push(id);
        }
    } catch (error) {
        const errors: unknown[] = [error];
        for (const id of activated.reverse()) {
            try { await service.unloadSkill(id); } catch (cleanup) { errors.push(cleanup); }
        }
        if (errors.length > 1) throw new AggregateError(errors, 'Skill restoration and cleanup failed');
        throw error;
    }
}
