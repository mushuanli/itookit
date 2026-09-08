import { runSessionSkillOperation } from './operation-queue';
import type { SessionSkillControls, ISkillService } from '@itookit/common';
import type { Kernel } from '@itookit/durable-kernel';
import type { SessionCapabilityRegistry } from '../ports/capabilities';
import { forgetLoadedSkill, parseLoadedSkillIds, rememberLoadedSkill } from './loaded-state';

/** UI control uses Session shared state directly; it does not impersonate an Agent Effect. */
export function createSessionSkillControls(kernel: Kernel, registry: SessionCapabilityRegistry): SessionSkillControls {
    const serial = <T>(id: string, action: () => Promise<T>) => runSessionSkillOperation(registry, id, action);
    const list = async (sessionId: string, onlyLoaded: boolean) => {
            const session = await kernel.openSession(sessionId);
            const ids = parseLoadedSkillIds((await session.getShared('kernel-adapters.skills.loaded'))?.value);
            const scope = await registry.get(sessionId);
            const loaded = new Set([...ids, ...scope.skillService.getLoadedSkills().map(skill => skill.id)]);
            const all = new Set([...loaded, ...(onlyLoaded ? [] : scope.skillService.listSkills().map(skill => skill.id))]);
            return [...all].sort().map(id => {
                const skill = scope.skillService.getSkill(id);
                return { id, name: skill?.name ?? id, description: skill?.description ?? '', loaded: loaded.has(id),
                    enabled: !!skill?.enabled && !skill.disableModelInvocation && skill.triggerStrategy !== 'action', toolCount: skill?.tools.length ?? 0 };
            });
    };
    return {
        list: id => serial(id, () => list(id, false)),
        listLoaded: id => serial(id, () => list(id, true)),
        load: (id, skillId) => serial(id, async () => {
            const session = await kernel.openSession(id);
            const state: NonNullable<import('@itookit/durable-kernel').EffectExecutionContext['sessionState']> = {
                get: key => session.getShared(key),
                set: (key, value, expectedVersion) => session.setShared(key, value, { expectedVersion }) };
            parseLoadedSkillIds((await state.get('kernel-adapters.skills.loaded'))?.value);
            const service = (await registry.get(id)).skillService;
            return loadAndRemember(service, skillId, state);
        }),
        unload: (sessionId, skillId) => serial(sessionId, async () => {
            const session = await kernel.openSession(sessionId);
            await forgetLoadedSkill(skillId, {
                get: key => session.getShared(key),
                set: (key, value, expectedVersion) => session.setShared(key, value, { expectedVersion }),
            });
            await (await registry.get(sessionId)).skillService.unloadSkill(skillId);
        }),
    };
}

async function loadAndRemember(service: ISkillService, id: string,
    state: NonNullable<import('@itookit/durable-kernel').EffectExecutionContext['sessionState']>): Promise<string[]> {
    if (typeof id !== 'string' || !id.trim()) throw new Error('Skill id is required');
    const skill = service.getSkill(id);
    if (!skill?.enabled || skill.disableModelInvocation || skill.triggerStrategy === 'action') throw new Error(`Skill cannot be loaded into model context: ${id}`);
    const wasLoaded = service.getLoadedSkills().some(item => item.id === id);
    const result = await service.loadSkill(id);
    if (!result.success) throw new Error(result.error ?? `Failed to load Skill: ${id}`);
    try { await rememberLoadedSkill(id, state); }
    catch (error) {
        if (!wasLoaded) await service.unloadSkill(id);
        throw error;
    }
    return result.toolIds;
}
