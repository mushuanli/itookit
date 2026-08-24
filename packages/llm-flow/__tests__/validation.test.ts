import { describe, expect, it } from 'vitest';
import type { FlowId, FlowNodeDefinition, FlowNodeId, FlowRevision } from '@itookit/common';
import { createBuiltinDagPluginRegistry } from '../src/flow/builtin-plugins';
import { validateFlowRevision } from '../src/flow/validation';

function revision(maxIterations: unknown): FlowRevision {
    const node: FlowNodeDefinition = {
        id: 'agent' as FlowNodeId,
        name: 'Agent',
        plugin: 'builtin.agent',
        pluginVersion: '1.0.0',
        config: { prompt: 'hi', approval: 'external', maxIterations },
        inputs: {},
    };
    return {
        id: 'f1' as FlowId,
        revision: 1,
        name: 'Test',
        nodes: [node],
        edges: [],
        parameters: [{ name: 'max_rounds', type: 'number', default: 2 }],
        createdAt: 0,
        digest: '',
    };
}

const plugins = createBuiltinDagPluginRegistry();

describe('validateFlowRevision schema checks', () => {
    it('accepts a ${params.x} placeholder for an integer field', () => {
        expect(validateFlowRevision(revision('${params.max_rounds}'), plugins)).toEqual([]);
    });

    it('accepts a literal integer', () => {
        expect(validateFlowRevision(revision(2), plugins)).toEqual([]);
    });

    it('rejects a non-placeholder string for an integer field', () => {
        const issues = validateFlowRevision(revision('abc'), plugins);
        expect(issues.some(issue =>
            issue.code === 'invalid-config' && issue.message.includes('maxIterations must be integer'),
        )).toBe(true);
    });
});
