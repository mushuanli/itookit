import { expect, it } from 'vitest';
import { fromAgentDef, toRuntimeAgent } from '../src/constants/llm-loader';
import type { AgentDefinition } from '@itookit/common';

it('preserves explicit grants, policies and extended config through Agent import/export', () => {
    const agent: AgentDefinition = { id: 'locked', name: 'Locked', type: 'agent', version: 'v1', createdAt: 1, modifiedAt: 2,
        config: { connectionId: 'default', modelName: 'exact-model', systemPromptId: 'rules', mcpServers: ['legacy'] },
        capabilityPolicy: { toolIds: [], skillIds: ['review'], mcpProfileIds: ['server'] },
        memoryPolicy: { namespaceId: 'private', readScopes: [], writeScopes: [] },
        modelPolicy: { connectionId: 'local', thinking: false }, defaultContextPolicy: { tokenBudget: 5000 },
        systemPrompt: 'POLICY', defaultPrompts: [{ name: 'Review', prompt: 'Review code' }] };
    const exported = fromAgentDef(agent); expect(exported).not.toHaveProperty('createdAt'); expect(exported).not.toHaveProperty('modifiedAt');
    const imported = toRuntimeAgent(exported);
    expect(imported).toMatchObject({ ...exported });
    imported.capabilityPolicy!.mcpProfileIds.push('later');
    imported.config.mcpServers!.push('later');
    expect(exported.config.mcpServers).toEqual(['legacy']);
    expect(agent.capabilityPolicy!.mcpProfileIds).toEqual(['server']); expect(exported.capabilityPolicy!.mcpProfileIds).toEqual(['server']);
});
