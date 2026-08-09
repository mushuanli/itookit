import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ChatCompletionResponse, DagRunSpec } from '@itookit/common';
import {
    Harness,
    type EffectAdapter,
} from '@itookit/harness';
import { createVFS, MemoryBackend, type IModuleFS, type IVFSManager } from '@itookit/stdio';
import { DurableAgentProgram } from '@itookit/llm-runtime';
import { createBuiltinDagPluginRegistry } from '../src/flow/builtin-plugins';
import { DurableFlowExecutor } from '../src/flow/executor';
import { FlowAggregateProgram, FlowHumanProgram, FlowValueProgram } from '../src/flow/programs';

describe('DurableFlowExecutor', () => {
    let manager: IVFSManager;
    let fs: IModuleFS;
    let harness: Harness;

    beforeEach(async () => {
        ({ manager } = await createVFS({ rootBackend: new MemoryBackend(), modules: [{ name: 'test' }] }));
        await manager.mount('test');
        fs = manager.getEngine('test');
        await fs.init();
        harness = new Harness({ catalog: { fs }, pollMs: 5 });
        harness.registerStorageResolver({
            kind: 'test',
            async resolve() { return { fs, rootPath: '/sessions/one/.harness' }; },
        });
        registerPrograms(harness);
        harness.registerEffect(llmEffect());
        await harness.initialize();
        await harness.createSession({ id: 'session-one', storage: { kind: 'test', locator: null } });
    });

    afterEach(async () => { harness.dispose(); await manager.dispose(); });

    it('persists fan-in DAG nodes and aggregates every output', async () => {
        const execution = await executor(harness).submit('session-one', valueFlow());
        const exit = await execution.root.wait({ timeoutMs: 2_000 });
        const nodes = (exit.output as { nodes: Record<string, unknown> }).nodes;

        expect(exit.status).toBe('succeeded');
        expect(Object.keys(nodes)).toEqual(['left', 'right', 'join']);
        expect(JSON.stringify(nodes.join)).toContain('left');
        expect(JSON.stringify(nodes.join)).toContain('right');
    });

    it('runs an Agent node through a granted durable LLM Effect', async () => {
        const execution = await executor(harness).submit('session-one', agentFlow());
        const exit = await execution.root.wait({ timeoutMs: 2_000 });

        expect(exit.status).toBe('succeeded');
        expect(JSON.stringify(exit.output)).toContain('durable answer');
        expect((await execution.nodes.get('agent')!.status()).task.effects).not.toEqual({});
    });
});

function registerPrograms(harness: Harness): void {
    harness.registerProgram(new DurableAgentProgram());
    harness.registerProgram(new FlowValueProgram());
    harness.registerProgram(new FlowHumanProgram());
    harness.registerProgram(new FlowAggregateProgram());
}

function executor(harness: Harness): DurableFlowExecutor {
    return new DurableFlowExecutor({ harness, plugins: createBuiltinDagPluginRegistry() });
}

function llmEffect(): EffectAdapter<Record<string, unknown>, ChatCompletionResponse> {
    return {
        kind: 'llm.chat', version: '1',
        async execute() {
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
