import type { EffectExecutionContext } from '@itookit/durable-kernel';

/** Merge a successful load into the durable identity set using the Session CAS boundary. */
export async function rememberLoadedSkill(id: string, state: EffectExecutionContext['sessionState']): Promise<void> {
    if (!state) return;
    await updateLoadedSkill(id, state, true);
}

export async function forgetLoadedSkill(id: string, state: EffectExecutionContext['sessionState']): Promise<void> {
    if (!state) throw new Error('Durable Skill unload requires Session shared state');
    await updateLoadedSkill(id, state, false);
}

async function updateLoadedSkill(id: string, state: NonNullable<EffectExecutionContext['sessionState']>, loaded: boolean): Promise<void> {
    if (typeof id !== 'string' || !id.trim()) throw new Error('Skill id is required');
    const key = 'kernel-adapters.skills.loaded';
    for (let attempt = 0; attempt < 3; attempt++) {
        const saved = await state.get(key);
        const ids = parseLoadedSkillIds(saved?.value);
        if (ids.includes(id) === loaded) return;
        try { await state.set(key, loaded ? [...ids, id] : ids.filter(value => value !== id), saved?.version ?? null); return; }
        catch (error) { if (attempt === 2) throw error; }
    }
}

/** Shared records must not be silently repaired by an unrelated load or unload. */
export function parseLoadedSkillIds(value: unknown): string[] {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value) || value.some(id => typeof id !== 'string' || !id.trim())) {
        throw new Error('Invalid loaded Skill identities');
    }
    return [...new Set(value as string[])];
}
