import { describe, expect, it } from 'vitest';
import type { IChatEngine } from '../src/persistence/types';
import { GoalDraftService } from '../src/persistence/goal-draft-service';
import { DependencyScheduler } from '../src/core/goal/dependency-scheduler';

function createMemoryEngine(): IChatEngine {
    const assets = new Map<string, string>();
    return {
        createAsset: async (_nodeId: string, name: string, content: string | ArrayBuffer) => {
            assets.set(name, typeof content === 'string' ? content : new TextDecoder().decode(content));
            return name;
        },
        openFile: () => ({
            asset: (name: string) => ({ readText: async () => assets.get(name) ?? '' }),
        }),
    } as unknown as IChatEngine;
}

describe('GoalDraftService', () => {
    it('removes a node and all incident edges atomically', () => {
        const service = new GoalDraftService(createMemoryEngine(), 'chat');
        let draft = service.createDraft('DAG', 'goal');
        draft = service.addNode(draft, { id: 'a', agent: { id: 'agent-a', version: '1' } });
        draft = service.addNode(draft, { id: 'b', agent: { id: 'agent-b', version: '1' } });
        draft = service.addNode(draft, { id: 'c', agent: { id: 'agent-c', version: '1' } });
        draft = service.addEdge(draft, { id: 'ab', from: 'a', to: 'b', kind: 'control' });
        draft = service.addEdge(draft, { id: 'bc', from: 'b', to: 'c', kind: 'control' });

        const result = service.removeNode(draft, 'b');

        expect(result.draft.nodes.map(node => node.id)).toEqual(['a', 'c']);
        expect(result.draft.edges).toEqual([]);
        expect(result.removed.edges.map(edge => edge.id)).toEqual(['ab', 'bc']);
    });

    it('validates cycles across control and data edges', () => {
        const service = new GoalDraftService(createMemoryEngine(), 'chat');
        let draft = service.createDraft();
        draft = service.addNode(draft, { id: 'a', agent: { id: 'a', version: '1' }, outputPorts: ['final'] });
        draft = service.addNode(draft, { id: 'b', agent: { id: 'b', version: '1' }, outputPorts: ['final'] });
        draft = service.addEdge(draft, {
            from: 'a', to: 'b', kind: 'data', outputPort: 'final', inputPort: 'source',
        });
        draft = service.addEdge(draft, { from: 'b', to: 'a', kind: 'control' });

        expect(service.validate(draft).map(issue => issue.code)).toContain('cycle');
    });

    it('creates immutable revisions and fresh AgentRun IDs per execution', async () => {
        const service = new GoalDraftService(createMemoryEngine(), 'chat');
        let draft = service.createDraft('DAG', 'definition');
        draft = service.addNode(draft, { id: 'a', agent: { id: 'agent-a', version: 'v1' } });
        draft = service.addNode(draft, { id: 'b', agent: { id: 'agent-b', version: 'v1' } });
        draft = service.addEdge(draft, { from: 'a', to: 'b', kind: 'control' });

        const revision = await service.createRevision(draft);
        const first = service.instantiate(revision);
        const second = service.instantiate(revision);

        expect(first.definition).toEqual({ id: 'definition', revision: 1, digest: revision.digest });
        expect(first.nodeRuns?.a).not.toBe(second.nodeRuns?.a);
        expect(first.nodes[0].id).toBe(first.nodeRuns?.a);
        expect(first.edges?.[0]).toMatchObject({ from: first.nodeRuns?.a, to: first.nodeRuns?.b });
    });

    it('turns data edges into downstream upstream-output bindings', async () => {
        const service = new GoalDraftService(createMemoryEngine(), 'chat');
        let draft = service.createDraft('DAG', 'definition');
        draft = service.addNode(draft, { id: 'a', agent: { id: 'agent-a', version: 'v1' }, outputPorts: ['final'] });
        draft = service.addNode(draft, { id: 'b', agent: { id: 'agent-b', version: 'v1' } });
        draft = service.addEdge(draft, {
            from: 'a', to: 'b', kind: 'data', outputPort: 'final', inputPort: 'research', order: 2,
        });

        const goal = service.instantiate(await service.createRevision(draft));
        const consumer = goal.nodes.find(node => node.id === goal.nodeRuns?.b)!;
        expect(consumer.inputs).toContainEqual({
            kind: 'upstream-output', runId: goal.nodeRuns?.a,
            outputPort: 'final', inputLabel: 'research', order: 2,
        });
    });
});

describe('DependencyScheduler data dependencies', () => {
    it('does not ready a data consumer before its producer completes', () => {
        const nodes = [
            { id: 'producer', agent: { id: 'a', version: '1' }, prompt: '', inputs: [] },
            { id: 'consumer', agent: { id: 'b', version: '1' }, prompt: '', inputs: [] },
        ];
        const scheduler = new DependencyScheduler(nodes, [
            { from: 'producer', to: 'consumer', kind: 'data', outputPort: 'final', inputPort: 'source' },
        ]);

        expect(scheduler.readyIds()).toEqual(['producer']);
        scheduler.complete('producer');
        expect(scheduler.readyIds()).toEqual(['consumer']);
    });
});
