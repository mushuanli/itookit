import { expect, it, vi } from 'vitest';
import { createRunCatalog } from '../src/flow/run-catalog';
import { createBuiltinDagPluginRegistry } from '../src/flow/builtin-plugins';

it('isolates registered manifests from caller mutation', () => {
    const plugins = createBuiltinDagPluginRegistry();
    const manifest = plugins.getManifest('builtin.transform', '1.0.0')!;
    manifest.id = 'custom';
    plugins.register({ manifest, runtime: async () => ({ createTask: () => ({ programKind: 'test', programVersion: '1', input: null }) }) });
    manifest.inputs.length = 0; manifest.id = 'changed';
    expect(plugins.getManifest('custom', '1.0.0')?.inputs.length).toBeGreaterThan(0);
    expect(plugins.listManifests().some(item => item.id === 'changed')).toBe(false);
});

it('pins initial and dynamic contract definitions including missing references', () => {
    const plugins = createBuiltinDagPluginRegistry();
    const original = plugins.getManifest('builtin.transform', '1.0.0')!;
    const manifest = { ...original, inputs: original.inputs.map(port => ({ ...port, schema: { id: 'report' } })) };
    let schema: any = { type: 'string' };
    const source = { getManifest: vi.fn(() => manifest), getSchema: vi.fn(() => schema),
        listManifests: () => [manifest], loadRuntime: vi.fn(), loadUI: vi.fn() };
    const run = createRunCatalog(source, [{ plugin: 'typed', pluginVersion: '1' } as never]);
    schema.type = 'number'; manifest.inputs.length = 0;
    expect(run.getSchema!({ id: 'report' })).toEqual({ type: 'string' });
    expect(run.getManifest('typed', '1')?.inputs.length).toBeGreaterThan(0);
    (run.getSchema!({ id: 'report' }) as any).type = 'boolean';
    expect(run.getSchema!({ id: 'report' })).toEqual({ type: 'string' });
    schema = undefined;
    expect(run.getSchema!({ id: 'missing' })).toBeUndefined();
    schema = true;
    expect(run.getSchema!({ id: 'missing' })).toBeUndefined();
    expect(run.getSchema!({ id: 'new' })).toBe(true);
    schema = false;
    expect(run.getSchema!({ id: 'new' })).toBe(true);
});


it.each(['manifest', 'schema', 'missing'])('rejects persisted %s drift after serialization', kind => {
    const registry = createBuiltinDagPluginRegistry();
    const manifest = registry.getManifest('builtin.transform', '1.0.0')!;
    manifest.outputs[0].schema = { id: 'report' };
    let schema: any = { type: 'object', properties: { count: { type: 'integer' } } };
    const source = { ...registry, getManifest: () => manifest, getSchema: () => schema,
        listManifests: () => [manifest], loadRuntime: vi.fn(), loadUI: vi.fn() };
    const nodes = [{ plugin: 'builtin.transform', pluginVersion: '1.0.0' } as never];
    const snapshot = JSON.parse(JSON.stringify(createRunCatalog(source, nodes).snapshot()));
    // Object key order is not contract identity.
    schema = { properties: { count: { type: 'integer' } }, type: 'object' };
    expect(() => createRunCatalog(source, nodes, snapshot)).not.toThrow();
    if (kind === 'manifest') manifest.outputs.length = 0;
    else schema = kind === 'missing' ? undefined : { type: 'string' };
    expect(() => createRunCatalog(source, nodes, snapshot)).toThrow(/drift/);
    expect(source.loadRuntime).not.toHaveBeenCalled();
});

it('persists contracts discovered by dynamic nodes and keeps snapshots isolated', () => {
    const source = createBuiltinDagPluginRegistry();
    const run = createRunCatalog(source, []);
    run.getManifest('builtin.transform', '1.0.0');
    const saved = run.snapshot();
    expect(saved.manifests).toHaveLength(1);
    saved.manifests[0][1]!.outputs.length = 0;
    expect(run.getManifest('builtin.transform', '1.0.0')!.outputs.length).toBeGreaterThan(0);
    expect(() => createRunCatalog(source, [], run.snapshot())).not.toThrow();
});
