import { describe, expect, it } from 'vitest';
import type { DagEdgeDefinition, DagNodeDefinition } from '@itookit/common';
import { downstreamNodes } from '../src/flow/graph-retry';

function node(id: string): DagNodeDefinition {
    return { id, name: id, plugin: 'builtin.transform', pluginVersion: '1.0.0', config: {}, inputs: {}, capabilities: [] };
}

function edge(from: string, to: string): DagEdgeDefinition {
    return { id: `${from}-${to}`, from, to, output: 'result', input: 'input' };
}

describe('downstreamNodes', () => {
    it('collects the transitive closure in topological order and excludes the source', () => {
        const nodes = [node('a'), node('b'), node('c'), node('d')];
        const edges = [edge('a', 'b'), edge('b', 'c'), edge('a', 'c')];
        expect(downstreamNodes('a', nodes, edges)).toEqual(['b', 'c']);
        expect(downstreamNodes('b', nodes, edges)).toEqual(['c']);
        expect(downstreamNodes('c', nodes, edges)).toEqual([]);
        // An unrelated node is never included.
        expect(downstreamNodes('a', nodes, edges)).not.toContain('d');
    });

    it('follows loop back edges so a retried loop node recomputes the whole cycle', () => {
        const nodes = [node('entry'), node('body'), node('router')];
        const edges = [edge('entry', 'body'), edge('body', 'router'), edge('router', 'entry')];
        expect(downstreamNodes('entry', nodes, edges)).toEqual(['body', 'router']);
    });

    it('rejects an unknown node', () => {
        expect(() => downstreamNodes('missing', [node('a')], [])).toThrow('Unknown node: missing');
    });
});
