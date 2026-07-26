import { describe, expect, it } from 'vitest';
import type {
    DagNodeDefinition,
    DagRunSpec,
} from '@itookit/common';
import { applyEffects, createGraph } from './dag-graph';

describe('DAG graph effects', () => {
    it('applies a graph patch once for the same idempotency key', () => {
        const graph = createGraph(baseSpec());
        const effect = {
            type: 'patch-graph' as const,
            patch: {
                idempotencyKey: 'spawn-child-once',
                nodes: [node('child')],
                edges: [{
                    id: 'root-child',
                    from: 'root',
                    to: 'child',
                }],
            },
        };

        applyEffects(graph, [effect], 10);
        applyEffects(graph, [effect], 10);

        expect([...graph.nodes.keys()]).toEqual(['root', 'child']);
        expect([...graph.edges.keys()]).toEqual(['root-child']);
        expect(graph.appliedPatchKeys).toEqual(new Set(['spawn-child-once']));
    });
});

function baseSpec(): DagRunSpec {
    return {
        nodes: [node('root')],
        edges: [],
    };
}

function node(id: string): DagNodeDefinition {
    return {
        id,
        name: id,
        plugin: 'test.node',
        pluginVersion: '1.0.0',
        config: {},
        inputs: {},
    };
}
