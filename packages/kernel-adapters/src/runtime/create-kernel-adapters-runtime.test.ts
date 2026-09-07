import { describe, expect, it } from 'vitest';
import type {
    DurableTaskProgram,
    EffectAdapter,
    EffectExecutionContext,
    KernelRegistration,
    JsonValue,
    SharedStateEntry,
} from '@itookit/durable-kernel';
import type { IDeviceDriver } from '@itookit/vfs-core';
import type { ITTYDriver, SkillDefinition } from '@itookit/common';
import { createKernelAdaptersRuntime } from './create-kernel-adapters-runtime';
import { ApprovedEffectProgram } from '../programs/approved-effect-program';

describe('createKernelAdaptersRuntime', () => {
    it('assembles services and registers durable capability effects', async () => {
        const runtime = await createKernelAdaptersRuntime({ llmDriver: {} as IDeviceDriver });
        const effects: EffectAdapter[] = [];
        const programs: DurableTaskProgram[] = [];
        runtime.plugin.install(registration(effects, programs));

        expect(runtime.toolCatalog.getToolMeta('load_skill')).toBeDefined();
        expect(runtime.toolCatalog.getToolMeta('human_input')).toBeUndefined();
        expect(effects.map(effect => effect.kind)).toEqual([
            'llm.chat', 'tool.call', 'process.exec', 'skill.load',
        ]);
        expect(programs.map(program => program.manifest.kind)).toEqual([
            'kernel-adapters.approved-effect', 'kernel-adapters.exec',
        ]);

        await runtime.dispose();
    });

    it('has no global execution service and denies file IO without a Session grant', async () => {
        const runtime = await createKernelAdaptersRuntime({ llmDriver: {} as IDeviceDriver });
        expect('toolService' in runtime).toBe(false);
        expect('toolDriver' in runtime).toBe(false);
        const scope = await runtime.sessions.get('unconfigured');
        const result = await scope.toolService.invoke({ toolId: 'Read', args: { file_path: '/etc/passwd' } });
        expect(result.success).toBe(false);
        await runtime.dispose();
    });

    it('isolates loaded Skill state between durable sessions', async () => {
        const runtime = await createKernelAdaptersRuntime({ llmDriver: {} as IDeviceDriver });
        await runtime.skillCatalog.saveSkill(skillDefinition());
        const first = await runtime.sessions.get('session-a');
        const second = await runtime.sessions.get('session-b');

        await first.skillService.loadSkill('review');

        expect(first.skillService.getLoadedSkills().map(skill => skill.id)).toEqual(['review']);
        expect(second.skillService.getLoadedSkills()).toEqual([]);
        expect(first.toolService).not.toBe(second.toolService);
        await runtime.dispose();
    });

    it('releases and recreates a session capability scope', async () => {
        const runtime = await createKernelAdaptersRuntime({ llmDriver: {} as IDeviceDriver });
        const first = await runtime.sessions.get('session-a');

        await runtime.disposeSession('session-a');
        const recreated = await runtime.sessions.get('session-a');

        expect(recreated).not.toBe(first);
        await runtime.dispose();
    });

    it('acquires independent file contexts, retries failed acquisition, and releases each once', async () => {
        const calls: string[] = [], released: string[] = [];
        let fail = true;
        const runtime = await createKernelAdaptersRuntime({
            llmDriver: {} as IDeviceDriver,
            fileContextForSession: async id => {
                calls.push(id);
                if (id === 'retry' && fail) { fail = false; throw new Error('Unavailable source'); }
                return { cwd: '/workspace', vfs: {
                    readFile: async () => id, writeFile: async () => {}, listFiles: async () => [],
                }, release: async () => { released.push(id); } };
            },
        });
        expect(calls).toEqual([]);
        const [a, duplicate, b] = await Promise.all([runtime.sessions.get('a'), runtime.sessions.get('a'), runtime.sessions.get('legacy')]);
        expect(a).toBe(duplicate);
        expect(a).not.toBe(b);
        expect(calls).toEqual(['a', 'legacy']);
        const readA = await a.toolService.invoke({ toolId: 'Read', args: { file_path: '/workspace/same.md' } });
        const readB = await b.toolService.invoke({ toolId: 'Read', args: { file_path: '/workspace/same.md' } });
        expect(readA.success).toBe(true);
        expect(readA.output).toContain('a');
        expect(readB.success).toBe(true);
        expect(readB.output).toContain('legacy');
        await expect(runtime.sessions.get('retry')).rejects.toThrow('Unavailable source');
        await runtime.sessions.get('retry');
        await runtime.disposeSession('a');
        await runtime.disposeSession('a');
        await runtime.dispose();
        expect(released.sort()).toEqual(['a', 'legacy', 'retry']);
        await expect(runtime.sessions.get('after-close')).rejects.toThrow('closed');
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
        const runtime = await createKernelAdaptersRuntime({ llmDriver: {} as IDeviceDriver });
        await runtime.skillCatalog.saveSkill(skillDefinition());
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
        const runtime = await createKernelAdaptersRuntime({ llmDriver: {} as IDeviceDriver, fileContextForSession: async () => ({
            vfs: { readFile: async () => '', writeFile: async () => {}, listFiles: async () => [] },
            cwd: '/', ttyDriver: tty, release: async () => {},
        }) });
        const effects: EffectAdapter[] = [];
        runtime.plugin.install(registration(effects));

        expect((await runtime.sessions.get('tty-session')).toolService.getToolMeta('shell_session')).toBeDefined();
        expect(effects.map(effect => effect.kind)).toContain('tty.command');

        await runtime.dispose();
    });
});

function registration(
    effects: EffectAdapter[],
    programs: DurableTaskProgram[] = [],
): KernelRegistration {
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
