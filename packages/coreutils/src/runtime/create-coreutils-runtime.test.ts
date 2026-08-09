import { describe, expect, it } from 'vitest';
import type {
    DurableTaskProgram,
    EffectAdapter,
    EffectExecutionContext,
    HarnessRegistration,
    JsonValue,
    SharedStateEntry,
} from '@itookit/harness';
import type { IDeviceDriver } from '@itookit/stdio';
import type { ITTYDriver, SkillDefinition } from '@itookit/common';
import { createCoreutilsRuntime } from './create-coreutils-runtime';
import { ApprovedEffectProgram } from '../programs/approved-effect-program';

describe('createCoreutilsRuntime', () => {
    it('assembles services and registers durable capability effects', async () => {
        const runtime = await createCoreutilsRuntime({ llmDriver: {} as IDeviceDriver });
        const effects: EffectAdapter[] = [];
        const programs: DurableTaskProgram[] = [];
        runtime.plugin.install(registration(effects, programs));

        expect(runtime.toolService.getToolMeta('load_skill')).toBeDefined();
        expect(runtime.toolService.getToolMeta('human_input')).toBeUndefined();
        expect(effects.map(effect => effect.kind)).toEqual([
            'llm.chat', 'tool.call', 'process.exec', 'skill.load',
        ]);
        expect(programs.map(program => program.manifest.kind)).toEqual([
            'coreutils.approved-effect', 'coreutils.exec',
        ]);

        await runtime.dispose();
    });

    it('isolates loaded Skill state between durable sessions', async () => {
        const runtime = await createCoreutilsRuntime({ llmDriver: {} as IDeviceDriver });
        await runtime.skillService.saveSkill(skillDefinition());
        const first = await runtime.sessions.get('session-a');
        const second = await runtime.sessions.get('session-b');

        await first.skillService.loadSkill('review');

        expect(first.skillService.getLoadedSkills().map(skill => skill.id)).toEqual(['review']);
        expect(second.skillService.getLoadedSkills()).toEqual([]);
        expect(first.toolService).not.toBe(second.toolService);
        await runtime.dispose();
    });

    it('releases and recreates a session capability scope', async () => {
        const runtime = await createCoreutilsRuntime({ llmDriver: {} as IDeviceDriver });
        const first = await runtime.sessions.get('session-a');

        await runtime.disposeSession('session-a');
        const recreated = await runtime.sessions.get('session-a');

        expect(recreated).not.toBe(first);
        await runtime.dispose();
    });

    it('waits for approval before dispatching a protected effect', async () => {
        const program = new ApprovedEffectProgram();
        const input = {
            prompt: 'Allow request?',
            effect: {
                id: 'llm', kind: 'llm.chat', version: '1', request: {}, idempotencyKey: 'llm',
            },
        };
        const initial = program.init(input);

        const approved = program.reduce(initial.state, {
            type: 'interaction-resolved', interactionId: 'approve:llm', value: true,
        });

        expect(initial.next.type).toBe('wait');
        expect(approved.actions).toEqual([{ type: 'effect', effect: input.effect }]);
        expect(approved.next).toEqual({ type: 'wait', on: { type: 'effect', id: 'llm' } });
    });

    it('restores loaded Skills from durable session shared state', async () => {
        const runtime = await createCoreutilsRuntime({ llmDriver: {} as IDeviceDriver });
        await runtime.skillService.saveSkill(skillDefinition());
        const effects: EffectAdapter[] = [];
        runtime.plugin.install(registration(effects));
        const state = sessionState();
        const effectContext = context(state);
        const skill = effects.find(effect => effect.kind === 'skill.load')!;
        const tool = effects.find(effect => effect.kind === 'tool.call')!;
        await skill.execute({ resourceHandleId: 'skill-handle', skillId: 'review' }, effectContext);
        await runtime.disposeSession('session-a');

        await tool.execute({
            resourceHandleId: 'tool-handle', toolId: 'missing', args: {},
        }, effectContext).catch(() => undefined);

        const restored = await runtime.sessions.get('session-a');
        expect(restored.skillService.getLoadedSkills().map(value => value.id)).toEqual(['review']);
        await runtime.dispose();
    });

    it('registers TTY tools and effect only when a TTY driver is configured', async () => {
        const tty = { supportsPty: false, spawn() { throw new Error('unused'); } } as ITTYDriver;
        const runtime = await createCoreutilsRuntime({ llmDriver: {} as IDeviceDriver, ttyDriver: tty });
        const effects: EffectAdapter[] = [];
        runtime.plugin.install(registration(effects));

        expect(runtime.toolService.getToolMeta('shell_session')).toBeDefined();
        expect(effects.map(effect => effect.kind)).toContain('tty.command');

        await runtime.dispose();
    });
});

function registration(
    effects: EffectAdapter[],
    programs: DurableTaskProgram[] = [],
): HarnessRegistration {
    return {
        registerEffect(effect) { effects.push(effect); },
        registerProgram(program) { programs.push(program); },
        registerStorageResolver() {},
        registerWorkspace() {},
    };
}

function skillDefinition(): SkillDefinition {
    return {
        id: 'review', name: 'Review', description: 'Review code', type: 'prompt',
        enabled: true, instructions: 'Review carefully.', tools: [], triggerPatterns: [],
        autoLoad: false, priority: 50,
    };
}

function context(
    sessionState: NonNullable<EffectExecutionContext['sessionState']>,
): EffectExecutionContext {
    return {
        sessionId: 'session-a', taskId: 'task-a', effectId: 'effect-a',
        abortSignal: new AbortController().signal,
        grants: ['skill', 'tool'].map(kind => ({
            handleId: `${kind}-handle`, right: 'execute' as const,
            resource: {
                id: `${kind}-resource`, sessionId: 'session-a', kind, uri: `${kind}://runtime`,
                generation: 1, createdAt: Date.now(),
            },
        })),
        sessionState,
    };
}

function sessionState(): NonNullable<EffectExecutionContext['sessionState']> {
    const values = new Map<string, SharedStateEntry>();
    return {
        async get<T extends JsonValue>(key: string) {
            return values.get(key) as SharedStateEntry<T> | undefined;
        },
        async set<T extends JsonValue>(key: string, value: T, expected?: number | null) {
            const current = values.get(key);
            if ((current?.version ?? null) !== (expected ?? null)) throw new Error('version conflict');
            const entry = { key, value, version: (current?.version ?? 0) + 1, updatedAt: Date.now() };
            values.set(key, entry);
            return entry;
        },
    };
}
