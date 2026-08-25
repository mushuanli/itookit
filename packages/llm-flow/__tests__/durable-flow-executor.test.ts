import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ChatCompletionResponse, DagRunSpec } from '@itookit/common';
import {
    Kernel,
    type EffectAdapter,
} from '@itookit/durable-kernel';
import { createVFS, MemoryBackend, type IModuleFS, type IVFSManager } from '@itookit/vfs-core';
import { DurableAgentProgram } from '@itookit/llm-tasks';
import { createBuiltinDagPluginRegistry } from '../src/flow/builtin-plugins';
import { DurableFlowExecutor, upstreamOf } from '../src/flow/executor';
import { FlowAggregateProgram, FlowHumanProgram, FlowValueProgram } from '../src/flow/programs';

describe('DurableFlowExecutor', () => {
    let manager: IVFSManager;
    let fs: IModuleFS;
    let kernel: Kernel;

    beforeEach(async () => {
        ({ manager } = await createVFS({ rootBackend: new MemoryBackend(), modules: [{ name: 'test' }] }));
        await manager.mount('test');
        fs = manager.getEngine('test');
        await fs.init();
        kernel = new Kernel({ catalog: { fs }, pollMs: 5 });
        kernel.registerStorageResolver({
            kind: 'test',
            async resolve() { return { fs, rootPath: '/sessions/one/.kernel' }; },
        });
        registerPrograms(kernel);
        kernel.registerEffect(llmEffect());
        await kernel.initialize();
        await kernel.createSession({ id: 'session-one', storage: { kind: 'test', locator: null } });
    });

    afterEach(async () => { kernel.dispose(); await manager.dispose(); });

    it('persists fan-in DAG nodes and aggregates every output', async () => {
        const execution = await executor(kernel).submit('session-one', valueFlow());
        const exit = await execution.root.wait({ timeoutMs: 2_000 });
        const nodes = (exit.output as { nodes: Record<string, unknown> }).nodes;

        expect(exit.status).toBe('succeeded');
        expect(Object.keys(nodes)).toEqual(['left', 'right', 'join']);
        expect(JSON.stringify(nodes.join)).toContain('left');
        expect(JSON.stringify(nodes.join)).toContain('right');
    });

    it('runs an Agent node through a granted durable LLM Effect', async () => {
        const execution = await executor(kernel).submit('session-one', agentFlow());
        const exit = await execution.root.wait({ timeoutMs: 2_000 });

        expect(exit.status).toBe('succeeded');
        expect(JSON.stringify(exit.output)).toContain('durable answer');
        expect((await execution.nodes.get('agent')!.status()).task.effects).not.toEqual({});
    });

    it('routes to the active branch and skips the disabled branch', async () => {
        const execution = await executor(kernel).submit('session-one', routeFlow('go-right'));
        const exit = await execution.root.wait({ timeoutMs: 2_000 });
        const nodes = (exit.output as { nodes: Record<string, unknown> }).nodes;

        expect(exit.status).toBe('succeeded');
        expect(Object.keys(nodes)).toEqual(['source', 'router', 'right']);
        expect(JSON.stringify(nodes.right)).toContain('RIGHT');
        expect(execution.nodes.has('left')).toBe(false);
    });

    it('activates the fallback branch when no rule matches', async () => {
        const execution = await executor(kernel).submit('session-one', routeFlow('unknown'));
        const exit = await execution.root.wait({ timeoutMs: 2_000 });
        const nodes = (exit.output as { nodes: Record<string, unknown> }).nodes;

        expect(exit.status).toBe('succeeded');
        expect(Object.keys(nodes)).toEqual(['source', 'router', 'left']);
        expect(execution.nodes.has('right')).toBe(false);
    });

    it('re-executes loop body nodes up to their iteration limit', async () => {
        const execution = await executor(kernel).submit('session-one', loopFlow(3));
        const exit = await execution.root.wait({ timeoutMs: 3_000 });

        expect(exit.status).toBe('succeeded');
        expect(execution.iterations.get('entry')).toBe(3);
        expect(execution.iterations.get('body')).toBe(3);
        expect(Object.keys((exit.output as { nodes: Record<string, unknown> }).nodes)).toEqual(['entry', 'body']);
    });

    it('dynamically spawns nodes via a patch-graph effect', async () => {
        const execution = await executor(kernel).submit('session-one', spawnFlow());
        const exit = await execution.root.wait({ timeoutMs: 3_000 });
        const nodes = (exit.output as { nodes: Record<string, unknown> }).nodes;

        expect(exit.status).toBe('succeeded');
        expect(Object.keys(nodes)).toEqual(['source', 'spawned']);
        expect(JSON.stringify(nodes.spawned)).toContain('SPAWNED');
        expect(execution.iterations.get('spawned')).toBe(1);
    });

    it('fans out bounded structured delegation payloads', async () => {
        const execution = await executor(kernel).submit('session-one', delegationFlow());
        const exit = await execution.root.wait({ timeoutMs: 3_000 });
        const nodes = (exit.output as { nodes: Record<string, unknown> }).nodes;

        expect(exit.status).toBe('succeeded');
        expect(Object.keys(nodes)).toContain('parent:delegate:1:0');
        expect(Object.keys(nodes)).toContain('parent:delegate:1:1');
        expect(Object.keys(nodes)).not.toContain('parent:delegate:1:2');
        expect(JSON.stringify(nodes['parent:delegate:1:0'])).toContain('durable answer');
    });

    it('keeps parent upstream data when the child template is isolated', async () => {
        const flow = delegationFlow();
        flow.nodes.unshift(valueNode('source', 'delegate now'));
        (flow.nodes.find(node => node.id === 'parent')!.config as Record<string, unknown>).messages = [
            { role: 'system', content: 'Use the upstream request' },
        ];
        flow.edges.push({
            id: 'source-parent', from: 'source', to: 'parent', output: 'result', input: 'request', kind: 'data',
        });

        const execution = await executor(kernel).submit('session-one', flow);
        expect(execution.nodes.has('parent:delegate:1:0')).toBe(true);
    });

    it('fails the flow and cancels the delegation group on fail-fast', async () => {
        const flow = delegationFlow();
        const delegation = (flow.nodes[0].config as Record<string, any>).delegation;
        delegation.resolvedTemplate.config.messages = [{ role: 'system', content: 'fail child' }];
        delegation.failure = { policy: 'fail-fast' };

        await expect(executor(kernel).submit('session-one', flow)).rejects.toThrow('child failed');
    });

    it('can exclude delegated outputs from the Flow result', async () => {
        const flow = delegationFlow();
        (flow.nodes[0].config as Record<string, any>).delegation.join = { mode: 'none' };
        const execution = await executor(kernel).submit('session-one', flow);
        const exit = await execution.root.wait({ timeoutMs: 3_000 });
        const nodes = (exit.output as { nodes: Record<string, unknown> }).nodes;

        expect(Object.keys(nodes)).toEqual(['parent']);
    });
});

function registerPrograms(kernel: Kernel): void {
    kernel.registerProgram(new DurableAgentProgram());
    kernel.registerProgram(new FlowValueProgram());
    kernel.registerProgram(new FlowHumanProgram());
    kernel.registerProgram(new FlowAggregateProgram());
}

function executor(kernel: Kernel): DurableFlowExecutor {
    return new DurableFlowExecutor({ kernel, plugins: createBuiltinDagPluginRegistry() });
}

function llmEffect(): EffectAdapter<Record<string, unknown>, ChatCompletionResponse> {
    return {
        kind: 'llm.chat', version: '1',
        async execute(request) {
            const inner = request.request && typeof request.request === 'object'
                ? request.request as Record<string, unknown>
                : request;
            const messages = Array.isArray(inner.messages) ? inner.messages : [];
            if (messages.some(message => JSON.stringify(message).includes('delegate now'))) {
                return {
                    choices: [{
                        index: 0,
                        message: {
                            role: 'assistant', content: '',
                            tool_calls: [{
                                id: 'delegate-one', type: 'function',
                                function: { name: 'delegate_tasks', arguments: JSON.stringify({ items: [{ id: 1 }, { id: 2 }, { id: 3 }] }) },
                            }],
                        },
                        finish_reason: 'tool_calls',
                    }],
                    usage: { total_tokens: 2 },
                };
            }
            if (messages.some(message => JSON.stringify(message).includes('fail child'))) {
                throw new Error('child failed');
            }
            return {
                choices: [{
                    index: 0,
                    message: { role: 'assistant', content: 'durable answer' },
                    finish_reason: 'stop',
                }],
                usage: { total_tokens: 2 },
            };
        },
    };
}

function delegationFlow(): DagRunSpec {
    return {
        nodes: [{
            id: 'parent', name: 'parent', plugin: 'builtin.agent', pluginVersion: '1.0.0',
            config: {
                sessionId: 'session-one', roundId: 'round-parent', connectionId: 'default', approval: 'none',
                messages: [{ role: 'user', content: 'delegate now' }],
                delegation: {
                    enabled: true,
                    toolName: 'delegate_tasks',
                    resolvedTemplate: {
                        plugin: 'builtin.agent', pluginVersion: '1.0.0', capabilities: [],
                        config: {
                            sessionId: 'session-one', roundId: 'round-child', connectionId: 'default', approval: 'none',
                            messages: [{ role: 'system', content: 'Handle one payload' }],
                        },
                    },
                    fanout: { maxTasks: 2, maxConcurrency: 1, maxDepth: 1, order: 'sequential' },
                    failure: { policy: 'continue' },
                },
            },
            inputs: {}, capabilities: [],
        }],
        edges: [],
    };
}

function valueFlow(): DagRunSpec {
    return {
        nodes: [
            valueNode('left', 'left'),
            valueNode('right', 'right'),
            {
                ...valueNode('join', null), plugin: 'builtin.reduce',
                config: { outputName: 'result', type: 'text', separator: ',' },
            },
        ],
        edges: [
            { id: 'left-join', from: 'left', to: 'join', output: 'result', input: 'input' },
            { id: 'right-join', from: 'right', to: 'join', output: 'result', input: 'input' },
        ],
    };
}

function valueNode(id: string, value: string | null): DagRunSpec['nodes'][number] {
    return {
        id, name: id, plugin: 'builtin.transform', pluginVersion: '1.0.0',
        config: { operation: 'identity', outputName: 'result', type: 'text', value }, inputs: {},
    };
}

function agentFlow(): DagRunSpec {
    return {
        nodes: [{
            id: 'agent', name: 'Agent', plugin: 'builtin.agent', pluginVersion: '1.0.0',
            config: {
                sessionId: 'session-one', roundId: 'round-one', connectionId: 'default',
                messages: [{ role: 'user', content: 'hello' }], approval: 'none',
            },
            inputs: {}, capabilities: [],
        }],
        edges: [],
    };
}

function routeFlow(source: string): DagRunSpec {
    return {
        nodes: [
            valueNode('source', source),
            {
                id: 'router', name: 'router', plugin: 'builtin.route', pluginVersion: '1.0.0',
                config: {
                    mode: 'exclusive',
                    rules: [
                        { edgeId: 'router-left', expression: routeEq('go-left') },
                        { edgeId: 'router-right', expression: routeEq('go-right') },
                    ],
                    defaultEdgeId: 'router-left',
                },
                inputs: {},
            },
            valueNode('left', 'LEFT'),
            valueNode('right', 'RIGHT'),
        ],
        edges: [
            { id: 'source-router', from: 'source', to: 'router', output: 'result', input: 'input' },
            { id: 'router-left', from: 'router', to: 'left', output: 'result', input: 'input' },
            { id: 'router-right', from: 'router', to: 'right', output: 'result', input: 'input' },
        ],
    };
}

function routeEq(value: string) {
    return { kind: 'eq', args: [{ kind: 'path', path: ['input'] }, { kind: 'literal', value }] };
}

function loopFlow(maxIterations: number): DagRunSpec {
    return {
        nodes: [
            {
                ...valueNode('entry', 'A'),
                config: { ...valueNode('entry', 'A').config, maxIterations },
            },
            valueNode('body', 'B'),
        ],
        edges: [
            { id: 'entry-body', from: 'entry', to: 'body', output: 'result', input: 'input' },
            { id: 'body-entry', from: 'body', to: 'entry', output: 'result', input: 'input' },
        ],
    };
}

function spawnFlow(): DagRunSpec {
    return {
        nodes: [{
            id: 'source', name: 'source', plugin: 'builtin.spawn', pluginVersion: '1.0.0',
            config: {
                value: 'done', outputName: 'result', type: 'text',
                spawn: {
                    nodes: [{
                        id: 'spawned', name: 'spawned', plugin: 'builtin.transform', pluginVersion: '1.0.0',
                        config: { operation: 'identity', outputName: 'result', type: 'text', value: 'SPAWNED' },
                        inputs: {},
                    }],
                    edges: [{ id: 'source-spawned', from: 'source', to: 'spawned', output: 'result', input: 'input' }],
                },
            },
            inputs: {},
        }],
        edges: [],
    };
}

describe('upstreamOf', () => {
    it('returns ancestors nearest-first (reverse compensation order)', () => {
        const edges = [
            { id: 'a-b', from: 'a', to: 'b', output: 'result', input: 'input' },
            { id: 'b-c', from: 'b', to: 'c', output: 'result', input: 'input' },
        ];
        expect(upstreamOf(edges, 'c')).toEqual(['b', 'a']);
    });
});

describe('conditional loop exit', () => {
    let manager: IVFSManager;
    let fs: IModuleFS;
    let kernel: Kernel;

    async function setup(score: number): Promise<void> {
        ({ manager } = await createVFS({ rootBackend: new MemoryBackend(), modules: [{ name: 'test' }] }));
        await manager.mount('test');
        fs = manager.getEngine('test');
        await fs.init();
        kernel = new Kernel({ catalog: { fs }, pollMs: 5 });
        kernel.registerStorageResolver({ kind: 'test', async resolve() { return { fs, rootPath: '/sessions/one/.kernel' }; } });
        registerPrograms(kernel);
        kernel.registerEffect(scoringEffect(score));
        await kernel.initialize();
        await kernel.createSession({ id: 'session-one', storage: { kind: 'test', locator: null } });
    }

    afterEach(async () => { kernel.dispose(); await manager.dispose(); });

    it('exits the rewrite loop once the verdict score reaches the threshold', async () => {
        await setup(55);
        const execution = await executor(kernel).submit('session-one', conditionalLoopFlow());
        const exit = await execution.root.wait({ timeoutMs: 3000 });
        expect(exit.status).toBe('succeeded');
        expect(execution.iterations.get('verdict')).toBe(1);
        expect(execution.iterations.get('rewrite')).toBeUndefined();
    });

    it('keeps rewriting until maxIterations when the score stays below the threshold', async () => {
        await setup(53);
        const execution = await executor(kernel).submit('session-one', conditionalLoopFlow());
        const exit = await execution.root.wait({ timeoutMs: 3000 });
        expect(exit.status).toBe('succeeded');
        expect(execution.iterations.get('verdict')).toBe(2);
        expect(execution.iterations.get('rewrite')).toBe(2);
    });
});

function scoringEffect(score: number): EffectAdapter<Record<string, unknown>, ChatCompletionResponse> {
    return {
        kind: 'llm.chat', version: '1',
        async execute() {
            return {
                choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify({ score }) }, finish_reason: 'stop' }],
                usage: { total_tokens: 1 },
            };
        },
    };
}

function conditionalLoopFlow(): DagRunSpec {
    const agent = (id: string): DagRunSpec['nodes'][number] => ({
        id, name: id, plugin: 'builtin.agent', pluginVersion: '1.0.0',
        config: { sessionId: 'session-one', roundId: `round-${id}`, connectionId: 'default', messages: [{ role: 'user', content: 'go' }], approval: 'none', maxIterations: 2 },
        inputs: {}, capabilities: [],
    });
    return {
        nodes: [
            agent('verdict'),
            {
                id: 'decide', name: 'decide', plugin: 'builtin.route', pluginVersion: '1.0.0',
                config: {
                    mode: 'exclusive',
                    rules: [
                        { edgeId: 'decide->report', expression: { kind: 'gte', args: [{ kind: 'path', path: ['input', 'score'] }, { kind: 'literal', value: 54 }] } },
                    ],
                    defaultEdgeId: 'decide->rewrite',
                },
                inputs: {},
            },
            agent('rewrite'),
            agent('report'),
        ],
        edges: [
            { id: 'verdict->decide', from: 'verdict', to: 'decide', output: 'result', input: 'input' },
            { id: 'verdict->report', from: 'verdict', to: 'report', output: 'result', input: 'input' },
            { id: 'decide->report', from: 'decide', to: 'report', output: 'result', input: 'input' },
            { id: 'decide->rewrite', from: 'decide', to: 'rewrite', output: 'result', input: 'input' },
            { id: 'rewrite->verdict', from: 'rewrite', to: 'verdict', output: 'result', input: 'input' },
        ],
    };
}
