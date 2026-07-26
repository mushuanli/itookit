import { describe, expect, it } from 'vitest';
import { DagPluginRegistry } from '../dag-plugin-registry';
import { registerBuiltinDagPlugins } from './index';

describe('builtin DAG plugins', () => {
    it('maps AgentProgram output to a final-answer artifact', async () => {
        const registry = new DagPluginRegistry();
        registerBuiltinDagPlugins(registry);
        const runtime = await registry.loadRuntime('builtin.agent', '1.0.0');

        const outcome = runtime.mapOutput?.({
            message: { role: 'assistant', content: 'final response' },
            usage: {},
            exchanges: 1,
        });

        expect(outcome?.outputs.result).toMatchObject({
            outputName: 'result',
            type: 'final-answer',
            content: 'final response',
        });
    });
});
