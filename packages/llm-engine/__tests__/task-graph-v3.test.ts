import { describe, expect, it } from 'vitest';
import type {
    FlowRevision,
    TaskExecutor,
    TaskResult,
    TaskExecutionContext,
    TaskHandlerRef,
    TaskEdgeId,
    TaskRunId,
} from '@itookit/common';
import {
    TaskExecutorRegistry,
    TaskGraphReconciler,
    createTaskGraphRun,
    InMemoryTaskGraphRunStore,
    BUILTIN_HANDLERS,
    replayTaskGraphRun,
    clearMigrationReports,
    migrateLegacyHarnessAsset,
    HarnessContributionRegistry,
    BUILTIN_TASK_KIND_DESCRIPTORS,
} from '../src/task-graph';

const agentHandler: TaskHandlerRef = { kind: 'plugin:test', provider: 'test', version: '1', schemaVersion: 1 };

function flow(): FlowRevision {
    return {
        id: 'flow-v3' as FlowRevision['id'], revision: 1, name: 'v3', createdAt: 1, digest: 'digest',
        nodes: [
            { id: 'a', name: 'A', handler: agentHandler, inputPorts: [], outputPorts: [{ name: 'final', required: true, order: 0 }], config: {}, joinPolicy: { kind: 'all-success' }, retryPolicy: { maxAttempts: 1 } },
            { id: 'b', name: 'B', handler: agentHandler, inputPorts: [{ name: 'source', cardinality: 'one', required: true, order: 0 }], outputPorts: [{ name: 'final', required: true, order: 0 }], config: {}, joinPolicy: { kind: 'all-success' }, retryPolicy: { maxAttempts: 1 } },
        ],
        edges: [{ id: 'e' as TaskEdgeId, from: 'a', to: 'b', kind: 'data', binding: { outputName: 'final', inputName: 'source', mode: 'artifact', required: true } }],
    };
}

describe('Harness v3 TaskGraph', () => {
    it('exposes serializable descriptors and validates nested plugin config', () => {
        const registry = new HarnessContributionRegistry();
        registry.register({
            id: 'builtin',
            version: '1',
            schemaVersion: 1,
            taskKinds: BUILTIN_TASK_KIND_DESCRIPTORS,
        });
        const descriptors = registry.listTaskKindDescriptors();
        expect(descriptors).toHaveLength(7);
        expect(descriptors.map(item => item.handler.kind)).toEqual([
            'agent', 'route', 'transform', 'reduce', 'human', 'subflow', 'spawn',
        ]);
        expect(JSON.parse(JSON.stringify(descriptors))).toEqual(descriptors);
        expect(registry.validateConfig(BUILTIN_HANDLERS.agent, {
            agent: { id: 'default', version: '1' },
            prompt: '',
            contextPolicy: { mode: 'invalid' },
            statePolicy: { mode: 'stateless' },
            loopMode: 'chat',
        })).toContain('$.contextPolicy.mode is not an allowed value');
    });

    it('uses TaskRun/artifact-only data flow and stable input resolution', async () => {
        const seen: string[][] = [];
        const registry = new TaskExecutorRegistry();
        const executor: TaskExecutor = {
            handler: agentHandler,
            execute: async (context: TaskExecutionContext): Promise<TaskResult> => {
                seen.push(context.inputs.flatMap(input => input.artifacts));
                return { artifacts: [{ outputName: 'final', type: 'text', content: `result-${String(context.taskRunId)}` }] };
            },
        };
        registry.register(executor);
        const seed = createTaskGraphRun(flow());
        const reconciler = new TaskGraphReconciler({ executorRegistry: registry });
        const result = await reconciler.run(seed);
        expect(result.graphRun.status).toBe('succeeded');
        expect(Object.values(result.taskStatuses)).toEqual(['succeeded', 'succeeded']);
        expect(seen[0]).toEqual([]);
        expect(seen[1]).toHaveLength(1);
        const replayed = replayTaskGraphRun(seed, await reconciler.stores.eventStore.after(result.graphRun.id, 0));
        expect(Object.values(replayed.tasks ?? {}).map(task => task.status)).toEqual(['succeeded', 'succeeded']);
        expect(Object.values(replayed.edgeStates ?? {}).map(edge => edge.state)).toContain('satisfied');
    });

    it('applies SpawnPlan atomically and idempotently', async () => {
        const registry = new TaskExecutorRegistry();
        registry.register({ handler: agentHandler, execute: async () => ({ artifacts: [{ outputName: 'final', type: 'text', content: 'ok' }] }) });
        const run = createTaskGraphRun({ ...flow(), nodes: [flow().nodes[0]], edges: [] });
        const store = new InMemoryTaskGraphRunStore(handler => registry.resolve(handler));
        run.tasks![run.rootTaskRunIds[0]].status = 'succeeded';
        await store.save(run);
        const plan = { spawnKey: 'once', parentTaskRunId: run.rootTaskRunIds[0], children: [{ key: 'item-0', handler: agentHandler, config: {}, inputs: [] }] };
        const first = await store.applyExpansion(run.id, 0, plan);
        const second = await store.applyExpansion(run.id, 0, plan);
        expect(first).toEqual(second);
        expect(Object.keys((await store.get(run.id))!.tasks ?? {})).toHaveLength(2);
    });

    it('keeps HumanTask awaiting_signal until an explicit response', async () => {
        const registry = new TaskExecutorRegistry();
        registry.register({ handler: BUILTIN_HANDLERS.human, execute: async context => ({
            artifacts: context.inputs.flatMap(input => input.bindings).some(binding => binding.kind === 'text' && binding.label === 'human-response')
                ? [{ outputName: 'response', type: 'text', content: 'accepted' }]
                : [],
            effects: context.inputs.flatMap(input => input.bindings).some(binding => binding.kind === 'text' && binding.label === 'human-response')
                ? [] : [{ kind: 'await-human', request: { requestId: 'approval', prompt: 'Approve?' } }],
        }) });
        const humanFlow: FlowRevision = {
            id: 'human-flow' as FlowRevision['id'], revision: 1, name: 'human', createdAt: 1, digest: 'human', nodes: [{
                id: 'human', name: 'Approve', handler: BUILTIN_HANDLERS.human, inputPorts: [], outputPorts: [], config: { prompt: 'Approve?' }, joinPolicy: { kind: 'all-success' }, retryPolicy: { maxAttempts: 1 },
            }], edges: [],
        };
        const reconciler = new TaskGraphReconciler({ executorRegistry: registry });
        const paused = await reconciler.run(createTaskGraphRun(humanFlow));
        const taskId = paused.graphRun.rootTaskRunIds[0];
        expect(paused.graphRun.status).toBe('paused');
        expect(paused.taskStatuses[String(taskId)]).toBe('awaiting_signal');
        const resumed = await reconciler.respond(paused.graphRun.id, taskId, 'yes');
        expect(resumed.graphRun.status).toBe('succeeded');
    });

    it('does not let a Route decision wait on or skip the unselected branch', async () => {
        const routeHandler: TaskHandlerRef = { kind: 'route', provider: 'test', version: '1', schemaVersion: 1 };
        const registry = new TaskExecutorRegistry();
        registry.register({ handler: routeHandler, execute: context => ({ artifacts: [], effects: [{ kind: 'route', decision: { activatedEdgeIds: ['route-a'] as TaskEdgeId[], skippedEdgeIds: ['route-b'] as TaskEdgeId[] } }] }) });
        registry.register({ handler: agentHandler, execute: async () => ({ artifacts: [{ outputName: 'final', type: 'text', content: 'done' }] }) });
        const routed: FlowRevision = {
            id: 'route-flow' as FlowRevision['id'], revision: 1, name: 'route', createdAt: 1, digest: 'route',
            nodes: [
                { id: 'route', name: 'Route', handler: routeHandler, inputPorts: [], outputPorts: [], config: { mode: 'multicast', rules: [] }, joinPolicy: { kind: 'all-success' }, retryPolicy: { maxAttempts: 1 } },
                { id: 'a', name: 'A', handler: agentHandler, inputPorts: [], outputPorts: [], config: {}, joinPolicy: { kind: 'all-success' }, retryPolicy: { maxAttempts: 1 } },
                { id: 'b', name: 'B', handler: agentHandler, inputPorts: [], outputPorts: [], config: {}, joinPolicy: { kind: 'all-success' }, retryPolicy: { maxAttempts: 1 } },
            ],
            edges: [
                { id: 'route-a' as TaskEdgeId, from: 'route', to: 'a', kind: 'control', condition: { source: { kind: 'status' }, expression: { kind: 'literal', value: true } } },
                { id: 'route-b' as TaskEdgeId, from: 'route', to: 'b', kind: 'control', condition: { source: { kind: 'status' }, expression: { kind: 'literal', value: false } } },
            ],
        };
        const result = await new TaskGraphReconciler({ executorRegistry: registry }).run(createTaskGraphRun(routed));
        expect(Object.values(result.taskStatuses)).toContain('succeeded');
        expect(Object.values(result.taskStatuses)).toContain('skipped');
        expect(result.graphRun.status).toBe('succeeded');
    });

    it('migrates a legacy asset once into the v3 flow/artifact projection', () => {
        clearMigrationReports();
        const asset = {
            goal: {
                id: 'legacy-goal',
                nodes: [{ id: 'legacy-node', agent: { id: 'agent', version: '1' }, prompt: 'finish the task' }],
                edges: [],
            },
            runs: [{
                id: 'legacy-node', status: 'succeeded' as const,
                attempts: [{ attempt: 0, startedAt: 1, completedAt: 2, status: 'succeeded' as const }],
            }],
            artifacts: [{ id: 'legacy-artifact', runId: 'legacy-node', type: 'text' as const, content: 'done', contentHash: 'hash', createdAt: 2 }],
        };
        const first = migrateLegacyHarnessAsset(asset);
        const second = migrateLegacyHarnessAsset(asset);
        const migrated = first.migratedArtifacts[0];

        expect(second).toEqual(first);
        expect(first.flow.nodes[0].handler.kind).toBe('agent');
        expect(migrated.taskRunId).toBe(first.taskRunIdByAgentRunId['legacy-node']);
        expect(migrated.outputName).toBe('final');
        expect('runId' in migrated).toBe(false);
    });
});
