import type { Kernel } from '@itookit/durable-kernel';
import type { SessionCapabilityRegistry } from '../ports/capabilities';
import { buildSkillPromptContext } from './prompt-context';
import { rememberLoadedSkill } from './loaded-state';
import { runSessionSkillOperation } from './operation-queue';

/** Restore identities and freeze new-run instructions under the shared Skill queue. */
export function resolveSessionSkillContext(kernel: Kernel, registry: SessionCapabilityRegistry,
    sessionId: string, userMessage: string) {
    return runSessionSkillOperation(registry, sessionId, async () => {
        const session = await kernel.openSession(sessionId);
        const loaded = await session.getShared('kernel-adapters.skills.loaded');
        const scope = await registry.restore(sessionId, loaded?.value);
        return buildSkillPromptContext(scope.skillService, { userMessage, onAutoLoaded: id => rememberLoadedSkill(id, {
            get: key => session.getShared(key),
            set: (key, value, expectedVersion) => session.setShared(key, value, { expectedVersion }),
        }) });
    });
}
