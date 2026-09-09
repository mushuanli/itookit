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
