import { describe, expect, it, vi } from 'vitest';
import type { DagNodeDefinition, DagPluginCatalog, FlowRevision, JsonSchemaRef } from '@itookit/common';
import { dataEdgeSchemaIssue } from '../src/flow/port-contract';
import { validateFlowRevision } from '../src/flow/validation';
import { validateGraphPatch } from '../src/flow/graph-patch';
import { DurableFlowExecutor } from '../src/flow/executor';

const node = (id: string): DagNodeDefinition => ({ id, name: id, plugin: id, pluginVersion: '1', config: {}, inputs: {} });
const source = node('source'), target = node('target');
const edge = { id: 'edge', from: source.id, to: target.id, kind: 'data' as const, output: 'result', input: 'input' };
function catalog(output?: JsonSchemaRef, input?: JsonSchemaRef): DagPluginCatalog {
    return { getSchema: () => true, getManifest: (id: string) => ({ id, version: '1', kind: id, title: id, category: 'test', configSchema: {},
        outputs: [{ name: 'result', required: false, order: 0, schema: id === source.id ? output : undefined }],
        inputs: [{ name: 'input', required: false, order: 0, cardinality: 'one', schema: id === target.id ? input : undefined }],
    }) } as DagPluginCatalog;
}

describe('data edge schema references', () => {
    it.each([
        [{ id: 'report', version: '1' }, { id: 'report', version: '1' }, true],
        [{ id: 'report' }, { id: 'report' }, true],
        [undefined, undefined, true],
        [{ id: 'report' }, undefined, true],
        [undefined, { id: 'report' }, false],
        [{ id: 'text' }, { id: 'report' }, false],
        [{ id: 'report', version: '1' }, { id: 'report', version: '2' }, false],
        [{ id: 'report', version: '1' }, { id: 'report' }, false],
    ] as const)('checks declared source %j against target %j', (output, input, compatible) => {
        expect(dataEdgeSchemaIssue(edge, source, target, catalog(output, input)) === undefined).toBe(compatible);
    });

    it('rejects unresolved matching references during publish, submit and patch validation', async () => {
        const plugins = catalog({ id: 'report' }, { id: 'report' });
        plugins.getSchema = () => undefined;
        const revision = { id: 'flow', revision: 1, name: 'Flow', digest: '', createdAt: 0,
            nodes: [source, target], edges: [edge] } as unknown as FlowRevision;
        expect(validateFlowRevision(revision, plugins)).toContainEqual(expect.objectContaining({ message: expect.stringContaining('Unregistered schema') }));
        const openSession = vi.fn();
        await expect(new DurableFlowExecutor({ kernel: { openSession } as never, plugins })
            .submit('s', { nodes: [source, target], edges: [edge] })).rejects.toThrow('Unregistered schema');
        expect(openSession).not.toHaveBeenCalled();
        expect(() => validateGraphPatch({ idempotencyKey: 'patch', nodes: [target], edges: [edge] }, [source], [], source.id, plugins))
            .toThrow('Unregistered schema');
    });

    it('does not impose data schemas on a control dependency', () => {
        expect(dataEdgeSchemaIssue({ ...edge, kind: 'control' }, source, target, catalog(undefined, { id: 'report' }))).toBeUndefined();
    });

    it('blocks incompatible publish, direct execution and dynamic patches before submission', async () => {
        const plugins = catalog({ id: 'text' }, { id: 'report' });
        const revision = { id: 'flow', revision: 1, name: 'Flow', digest: '', createdAt: 0,
            nodes: [source, target], edges: [edge] } as unknown as FlowRevision;
        expect(validateFlowRevision(revision, plugins)).toContainEqual(expect.objectContaining({ code: 'incompatible-port-schema', edgeId: 'edge' }));
        const openSession = vi.fn();
        const executor = new DurableFlowExecutor({ kernel: { openSession } as never, plugins });
        await expect(executor.submit('s', { nodes: [source, target], edges: [edge] })).rejects.toThrow('Schema mismatch');
        expect(openSession).not.toHaveBeenCalled();
        expect(() => validateGraphPatch({ idempotencyKey: 'patch', nodes: [target], edges: [edge] }, [source], [], source.id, plugins)).toThrow('Schema mismatch');
    });
});
