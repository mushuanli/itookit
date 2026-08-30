import { describe, expect, it } from 'vitest';
import type { FlowConnection, FlowId, FlowNodeDefinition, FlowNodeId, FlowRevision } from '@itookit/common';
import { resolveConnectionId } from '../src/flow/connections';
import { flowToDag } from '../src/flow/to-dag';
import { validateFlowRevision } from '../src/flow/validation';

const connections: FlowConnection[] = [
    { name: 'default', connectionId: 'conn-default' },
    { name: 'economy', connectionId: 'conn-cheap' },
    { name: 'premium', connectionId: 'conn-pro' },
];

describe('resolveConnectionId', () => {
    it('resolves a slot name to its global connection id', () => {
        expect(resolveConnectionId('economy', connections, 'default')).toBe('conn-cheap');
    });

    it('passes a raw global connection id through unchanged', () => {
        expect(resolveConnectionId('conn-custom', connections, 'default')).toBe('conn-custom');
    });

    it('falls back to defaultConnection when the raw value is empty', () => {
        expect(resolveConnectionId(undefined, connections, 'premium')).toBe('conn-pro');
        expect(resolveConnectionId('', connections, 'premium')).toBe('conn-pro');
    });

    it('falls back to the first slot when defaultConnection is absent', () => {
        expect(resolveConnectionId(undefined, connections, undefined)).toBe('conn-default');
    });

    it('returns undefined when there are no slots at all', () => {
        expect(resolveConnectionId(undefined, undefined, undefined)).toBeUndefined();
    });
});

function agentNode(id: string, connectionId?: string): FlowNodeDefinition {
    return {
        id: id as FlowNodeId,
        name: id,
        plugin: 'builtin.agent',
        pluginVersion: '1.0.0',
        config: { prompt: 'hi', approval: 'external', ...(connectionId !== undefined ? { connectionId } : {}) },
        inputs: {},
    };
}

function revision(nodes: FlowNodeDefinition[]): FlowRevision {
    return {
        id: 'f1' as FlowId,
        revision: 1,
        name: 'Test',
        nodes,
        edges: [],
        connections,
        defaultConnection: 'default',
        createdAt: 0,
        digest: '',
    };
}

describe('flowToDag connection resolution', () => {
    it('resolves a node slot name into the global connection id', async () => {
        const spec = await flowToDag(revision([agentNode('a', 'premium')]));
        expect((spec.nodes[0].config as Record<string, unknown>).connectionId).toBe('conn-pro');
    });

    it('inherits defaultConnection when the node omits connectionId', async () => {
        const spec = await flowToDag(revision([agentNode('a')]));
        expect((spec.nodes[0].config as Record<string, unknown>).connectionId).toBe('conn-default');
    });

    it('applies Flow defaults while preserving explicit node overrides', async () => {
        const flow = revision([{
            ...agentNode('a'),
            config: {
                temperature: 0.2,
                systemPrompt: ['node prompt'],
                toolIds: ['node-tool', 'shared-tool'],
                skillIds: ['node-skill'],
            },
        }]);
        flow.systemPrompt = ['legacy flow prompt'];
        flow.toolIds = ['legacy-tool'];
        flow.defaults = {
            connectionId: 'premium',
            temperature: 0.8,
            systemPrompt: ['flow prompt'],
            toolIds: ['shared-tool', 'flow-tool'],
            skillIds: ['flow-skill'],
        };
        const config = (await flowToDag(flow)).nodes[0].config as Record<string, unknown>;
        expect(config.connectionId).toBe('conn-pro');
        expect(config.temperature).toBe(0.2);
        expect(config.systemPrompt).toEqual(['legacy flow prompt', 'flow prompt', 'node prompt']);
        expect(config.toolIds).toEqual(['legacy-tool', 'shared-tool', 'flow-tool', 'node-tool']);
        expect(config.skillIds).toEqual(['flow-skill', 'node-skill']);
    });

    it('expands Composite Flow nodes into one namespaced DAG', async () => {
        const value = (id: string, content: unknown): FlowNodeDefinition => ({
            id: id as FlowNodeId, name: id, plugin: 'builtin.transform', pluginVersion: '1.0.0',
            config: { value: content, outputName: 'result', type: 'json' }, inputs: {},
        });
        const child = revision([value('first', '${params.value}'), value('last', 'last')]);
        child.id = 'child' as FlowId;
        child.edges = [{ id: 'inner' as never, from: 'first' as never, to: 'last' as never, output: 'result', input: 'input' }];
        const parent = revision([
            value('source', 'source'),
            { ...value('composite', null), plugin: 'builtin.flow', config: { flowId: 'child', revision: 1, parameters: { value: 42 } } },
            value('sink', 'sink'),
        ]);
        parent.edges = [
            { id: 'into' as never, from: 'source' as never, to: 'composite' as never, output: 'result', input: 'input' },
            { id: 'out' as never, from: 'composite' as never, to: 'sink' as never, output: 'result', input: 'input' },
        ];

        const spec = await flowToDag(parent, undefined, undefined, async id => id === 'child' ? child : null);
        expect(spec.nodes.map(node => node.id)).toEqual(['source', 'sink', 'composite/first', 'composite/last']);
        expect((spec.nodes.find(node => node.id === 'composite/first')!.config as Record<string, unknown>).value).toBe(42);
        expect(spec.edges.some(edge => edge.from === 'source' && edge.to === 'composite/first')).toBe(true);
        expect(spec.edges.some(edge => edge.from === 'composite/last' && edge.to === 'sink')).toBe(true);
    });
});

describe('validateFlowRevision connections', () => {
    it('accepts a valid connection list and default', () => {
        expect(validateFlowRevision(revision([agentNode('a')]))).toEqual([]);
    });

    it('flags duplicate slot names', () => {
        const flow = revision([agentNode('a')]);
        flow.connections = [
            { name: 'default', connectionId: 'conn-default' },
            { name: 'default', connectionId: 'conn-other' },
        ];
        expect(validateFlowRevision(flow).some(issue => issue.code === 'duplicate-connection')).toBe(true);
    });

    it('flags a defaultConnection that is not a defined slot', () => {
        const flow = revision([agentNode('a')]);
        flow.defaultConnection = 'missing';
        expect(validateFlowRevision(flow).some(issue => issue.code === 'invalid-default-connection')).toBe(true);
    });
});
