import { describe, expect, it } from 'vitest';
import type {
    DagRunSpec,
    ProcessResourcePorts,
    RunEventEnvelope,
} from '@itookit/common';
import { HarnessKernel } from '../../kernel/harness-kernel';
import { DagPluginRegistry } from '../../plugins/dag-plugin-registry';
import {
    builtinDagPrograms,
    registerBuiltinDagPlugins,
} from '../../plugins/builtin';
import { DagScheduler } from './dag-scheduler';

describe('DagScheduler', () => {
    it('submits dependent plugin processes and returns terminal artifacts', async () => {
        const plugins = new DagPluginRegistry();
        registerBuiltinDagPlugins(plugins);
        const kernel = new HarnessKernel({ resources: resources() });
        for (const program of builtinDagPrograms()) kernel.registerProgram(program);
        kernel.registerScheduler(new DagScheduler(plugins));

        const handle = await kernel.submit({ scheduler: 'dag', spec: flow() });
        const terminal = await terminalEvent(handle.events());

        expect(terminal.event.type).toBe('run:completed');
        if (terminal.event.type !== 'run:completed') return;
        expect(terminal.event.output).toMatchObject({
            nodes: {
                second: {
                    final: { content: 'hello' },
                },
            },
        });
    });
});

function flow(): DagRunSpec {
    return {
        nodes: [
            node('first', { operation: 'identity', value: 'hello', outputName: 'result' }),
            node('second', { operation: 'identity', outputName: 'final' }),
        ],
        edges: [{
            id: 'edge-1',
            from: 'first',
            to: 'second',
            output: 'result',
            input: 'input',
        }],
    };
}

function node(id: string, config: Record<string, unknown>) {
    return {
        id,
        name: id,
        plugin: 'builtin.transform',
        pluginVersion: '1.0.0',
        config,
        inputs: {},
    };
}

async function terminalEvent(
    events: AsyncIterable<RunEventEnvelope>,
): Promise<RunEventEnvelope> {
    for await (const event of events) {
        if (event.event.type === 'run:completed' || event.event.type === 'run:failed') {
            return event;
        }
    }
    throw new Error('Run ended without a terminal event');
}

function resources(): ProcessResourcePorts {
    return {
        llm: {
            chatStream: async function* () {},
            getConnection: async () => undefined,
            getDefaultConnection: async () => null,
            getProvider: async () => undefined,
            estimateTokens: () => 0,
        },
        tools: {
            listTools: () => [],
            getToolMeta: () => undefined,
            getToolDefinitions: () => [],
            invoke: async () => ({ toolId: '', success: true, output: '', durationMs: 0 }),
            invokeBatch: async () => ({ results: [], totalDurationMs: 0 }),
        },
        vfs: {
            readFile: async () => '',
            writeFile: async () => {},
            listFiles: async () => [],
        },
    };
}
