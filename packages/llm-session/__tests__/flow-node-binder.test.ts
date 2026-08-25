import { describe, expect, it } from 'vitest';
import type { FlowNodeDefinition } from '@itookit/common';
import { bindFlowNode } from '../src/session/flow-node-binder';
import type { AgentResolver } from '../src/session/agent-resolver';

describe('bindFlowNode', () => {
    it('normalizes legacy fields and resolves an isolated child independently', async () => {
        const node = {
            id: 'parent', name: 'Parent', plugin: 'builtin.agent', pluginVersion: '1.0.0',
            config: {
                prompt: 'legacy parent instruction',
                model: 'legacy-node-model',
                delegation: {
                    enabled: true,
                    template: { prompt: 'legacy child instruction', contextSource: 'isolated' },
                },
            },
            inputs: {}, capabilities: [],
        } as FlowNodeDefinition;
        const patch = await bindFlowNode(
            node,
            { modelName: 'flow-model' } as never,
            {
                canonicalMessages: [
                    { role: 'system', content: 'snapshot identity' },
                    { role: 'user', content: 'history' },
                ],
            } as never,
            { sessionId: 'session', input: { text: 'current task' } } as never,
            {
                roundId: 'round',
                config: {
                    id: 'session-agent', name: 'Session Agent', type: 'agent',
                    model: 'session-model', connectionId: 'default', systemPrompt: ['session identity'],
                },
            },
            agents(),
        );
        const config = patch.config as unknown as Record<string, any>;
        const child = config.delegation.resolvedTemplate.config as Record<string, any>;

        expect(config.modelName).toBe('legacy-node-model');
        expect(config.model).toBeUndefined();
        expect(config.instruction).toBe('legacy parent instruction');
        expect(config.includeDependencyOutputs).toBeUndefined();
        expect(child.instruction).toBe('legacy child instruction');
        expect(child.includeDependencyOutputs).toBe(false);
        expect(child.messages).toEqual([
            { role: 'system', content: 'session identity' },
            { role: 'system', content: 'legacy child instruction' },
        ]);
    });

    it('session context source keeps the session history for the child', async () => {
        const patch = await bindWithContext('session');
        const child = (patch.config as Record<string, any>).delegation.resolvedTemplate.config as Record<string, any>;
        expect(child.historyPolicy).toBe('inherit');
        expect(child.messages).toEqual([
            { role: 'system', content: 'child instruction' },
            { role: 'user', content: 'history' },
        ]);
    });

    it('parent context source merges parent system and body into the child', async () => {
        const patch = await bindWithContext('parent');
        const child = (patch.config as Record<string, any>).delegation.resolvedTemplate.config as Record<string, any>;
        expect(child.messages).toEqual([
            { role: 'system', content: 'parent instruction' },
            { role: 'system', content: 'child instruction' },
            { role: 'user', content: 'history' },
        ]);
    });

    it('upstream context source keeps only the child system messages', async () => {
        const patch = await bindWithContext('upstream');
        const child = (patch.config as Record<string, any>).delegation.resolvedTemplate.config as Record<string, any>;
        expect(child.messages).toEqual([
            { role: 'system', content: 'child instruction' },
        ]);
    });
});

function bindWithContext(contextSource: string) {
    const node = {
        id: 'parent', name: 'Parent', plugin: 'builtin.agent', pluginVersion: '1.0.0',
        config: {
            instruction: 'parent instruction',
            delegation: {
                enabled: true,
                template: { instruction: 'child instruction', contextSource },
            },
        },
        inputs: {}, capabilities: [],
    } as FlowNodeDefinition;
    return bindFlowNode(
        node,
        {} as never,
        {
            canonicalMessages: [
                { role: 'system', content: 'session identity' },
                { role: 'user', content: 'history' },
            ],
        } as never,
        { sessionId: 'session', input: { text: 'current task' } } as never,
        {
            roundId: 'round',
            config: {
                id: 'session-agent', name: 'Session Agent', type: 'agent',
                model: 'session-model', connectionId: 'default',
                systemPrompt: [],
            },
        },
        agents(),
    );
}

function agents(): AgentResolver {
    return {
        async resolveExact() { throw new Error('not configured'); },
        async getSystemPrompt() { return null; },
        async getSkills() { return []; },
    } as unknown as AgentResolver;
}
