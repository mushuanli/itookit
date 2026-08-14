import type {
    ISkillService,
    SkillDefinition,
    SkillLoadResult,
    SkillScopeLevel,
    SkillToolBinding,
    ToolHandler,
} from '@itookit/common';
import type { EffectExecutionContext } from '@itookit/harness';

export type CapabilityResolver<T> = (
    context: EffectExecutionContext,
) => T | Promise<T>;

export type CapabilitySource<T> = T | CapabilityResolver<T>;

export interface SkillScopeSnapshot {
    cwd: string;
    agentInstructions: string;
    skills: SkillDefinition[];
}

export interface SkillSource {
    loadScope(cwd: string): Promise<SkillScopeSnapshot>;
    loadDirectory?(
        dirPath: string,
        scopeLevel: SkillScopeLevel,
        scopeRoot: string,
    ): Promise<SkillDefinition[]>;
}

export interface SkillToolHandlerFactory {
    create(skill: SkillDefinition, binding: SkillToolBinding): ToolHandler | undefined;
}

export interface SessionCapabilityScope {
    readonly toolService: import('@itookit/common').IToolService;
    readonly skillService: ISkillService;
    dispose(): Promise<void>;
}

export interface SessionCapabilityRegistry {
    get(sessionId: string): Promise<SessionCapabilityScope>;
    disposeSession(sessionId: string): Promise<void>;
    dispose(): Promise<void>;
}

export function resolveCapability<T>(
    source: CapabilitySource<T>,
    context: EffectExecutionContext,
): Promise<T> {
    return Promise.resolve(typeof source === 'function'
        ? (source as CapabilityResolver<T>)(context)
        : source);
}

export function failedSkillLoad(skillId: string, error: string): SkillLoadResult {
    return { skillId, success: false, toolIds: [], error };
}
