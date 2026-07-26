import { describe, expect, it } from 'vitest';
import type { DagPlugin } from '@itookit/common';
import { DagPluginRegistry } from './dag-plugin-registry';

describe('DagPluginRegistry', () => {
    it('loads manifest, runtime and UI from separate entries', async () => {
        const registry = new DagPluginRegistry();
        registry.register(plugin('1.0.0'));
        registry.register(plugin('2.0.0'));

        const latest = registry.getManifest('test.node');
        const runtime = await registry.loadRuntime('test.node', '1.0.0');
        const ui = await registry.loadUI('test.node', '1.0.0');

        expect(latest?.version).toBe('2.0.0');
        expect(runtime.createProcess(context()).programKind).toBe('test.program');
        expect(ui?.palette.label).toBe('Test node');
        expect(JSON.parse(JSON.stringify(registry.listManifests()))).toEqual(
            registry.listManifests(),
        );
    });
});

function plugin(version: string): DagPlugin<Record<string, never>> {
    return {
        manifest: {
            id: 'test.node',
            version,
            kind: 'test',
            title: 'Test node',
            category: 'Tests',
            configSchema: { type: 'object' },
            inputs: [],
            outputs: [],
        },
        runtime: async () => ({
            createProcess: () => ({
                programKind: 'test.program',
                input: {},
            }),
        }),
        ui: async () => ({
            palette: { label: 'Test node', group: 'Tests' },
            node: { summarize: () => 'Test' },
            inspector: {},
        }),
    };
}

function context(): import('@itookit/common').DagNodeContext<Record<string, never>> {
    return {
        runId: 'run',
        nodeRunId: 'node',
        config: {},
        inputs: {},
    };
}
