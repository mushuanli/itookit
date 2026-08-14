import { assertEffectGrant } from '@itookit/harness';
import type { ISkillService, SkillLoadResult } from '@itookit/common';
import type { EffectAdapter, EffectExecutionContext, EffectReconcileResult } from '@itookit/harness';
import { resolveCapability, type CapabilitySource } from '../ports/capabilities';

export interface SkillLoadEffectRequest { resourceHandleId: string; skillId: string; }

export class SkillLoadEffectAdapter implements EffectAdapter<SkillLoadEffectRequest, SkillLoadResult> {
    readonly kind = 'skill.load';
    readonly version = '1';

    constructor(
        private readonly service: CapabilitySource<ISkillService>,
        private readonly onLoaded?: (
            result: SkillLoadResult,
            context: EffectExecutionContext,
        ) => void | Promise<void>,
    ) {}

    async execute(request: SkillLoadEffectRequest, context: EffectExecutionContext): Promise<SkillLoadResult> {
        assertEffectGrant(context, request.resourceHandleId, 'skill');
        if (!request.skillId.trim()) throw new Error('Skill id is required');
        const service = await resolveCapability(this.service, context);
        const result = await service.loadSkill(request.skillId);
        if (!result.success) throw new Error(result.error ?? `Skill failed to load: ${request.skillId}`);
        await this.onLoaded?.(result, context);
        return result;
    }

    async reconcile(): Promise<EffectReconcileResult<SkillLoadResult>> {
        return { status: 'retry' };
    }
}
