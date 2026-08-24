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
