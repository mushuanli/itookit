import { assertEffectGrant } from '@itookit/durable-kernel';
import type { ISkillService } from '@itookit/common';
import type { EffectAdapter, EffectExecutionContext, EffectReconcileResult } from '@itookit/durable-kernel';
import { resolveCapability, type CapabilitySource } from '../ports/capabilities';
import { forgetLoadedSkill } from '../skill/loaded-state';
import type { SkillLoadEffectRequest } from './skill-load-effect';

export interface SkillUnloadResult { skillId: string; unloaded: true; }

/** Remove durable identity first; retries also revoke any remaining live registrations. */
export class SkillUnloadEffectAdapter implements EffectAdapter<SkillLoadEffectRequest, SkillUnloadResult> {
    readonly kind = 'skill.unload';
    readonly version = '1';
    constructor(private readonly service: CapabilitySource<ISkillService>) {}

    async execute(request: SkillLoadEffectRequest, context: EffectExecutionContext): Promise<SkillUnloadResult> {
        assertEffectGrant(context, request.resourceHandleId, 'skill');
        if (!request.skillId.trim()) throw new Error('Skill id is required');
        await forgetLoadedSkill(request.skillId, context.sessionState);
        await (await resolveCapability(this.service, context)).unloadSkill(request.skillId);
        return { skillId: request.skillId, unloaded: true };
    }

    async reconcile(): Promise<EffectReconcileResult<SkillUnloadResult>> { return { status: 'retry' }; }
}
