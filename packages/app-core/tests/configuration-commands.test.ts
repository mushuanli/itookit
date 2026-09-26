import { afterEach, expect, it, vi } from 'vitest';
import { MemoryBackend } from '@itookit/vfs-core';
import { createApplicationRuntime, type ApplicationRuntime } from '../src/runtime/create-application-runtime';
import { ConfigurationMutationError, ModelConfigurationCommands } from '../src/configuration/model-commands';
import { ToolboxDrawers } from '../src/configuration/toolbox-drawers';

let runtime: ApplicationRuntime;
afterEach(async () => { vi.restoreAllMocks(); await runtime?.dispose(); });
async function setup() {
    runtime = await createApplicationRuntime({ backend: new MemoryBackend(), ownerKind: 'web' });
    const store = runtime.agentService;
    await store.saveProvider({ id: 'remove-me', name: 'Remove', implementation: 'openai-compatible', models: [] });
    await store.saveConnection({ id: 'linked', name: 'Linked', providerId: 'remove-me' });
    await store.saveAgent({ id: 'dependent', name: 'Dependent', type: 'agent', config: { connectionId: 'linked', modelName: '' } });
    return { store, commands: new ModelConfigurationCommands(store) };
}
it('rejects a stale dependency preview before writing any configuration', async () => {
    const { store, commands } = await setup(), impact = await commands.inspectProviderDeletion(['remove-me']);
    await store.saveConnection({ id: 'new-link', name: 'New link', providerId: 'remove-me' });
    await expect(commands.deleteProviders({ revision: impact.revision, agents: { mode: 'keep' } })).rejects.toMatchObject({ code: 'EBUSY' });
    expect(store.getFullProvider('remove-me')).toBeDefined();
    expect(await store.getFullConnection('linked')).toBeDefined();
});
it('validates a replacement and preserves the provider when updating an agent fails', async () => {
    const { store, commands } = await setup(), impact = await commands.inspectProviderDeletion(['remove-me']);
    await expect(commands.deleteProviders({ revision: impact.revision, agents: { mode: 'replace', connectionId: 'linked' } })).rejects.toMatchObject({ code: 'EINVAL' });
    vi.spyOn(store, 'saveAgent').mockRejectedValueOnce(new Error('write unavailable'));
    await expect(commands.deleteProviders({ revision: impact.revision, agents: { mode: 'replace', connectionId: 'default' } })).rejects.toMatchObject({ completed: [] });
    expect(store.getFullProvider('remove-me')).toBeDefined();
    expect(await store.getFullConnection('linked')).toBeDefined();
});
it('reports completed steps when a later storage operation fails', async () => {
    const { store, commands } = await setup(), impact = await commands.inspectProviderDeletion(['remove-me']);
    vi.spyOn(store, 'deleteConnection').mockRejectedValueOnce(new Error('delete unavailable'));
    let failure: unknown;
    try { await commands.deleteProviders({ revision: impact.revision, agents: { mode: 'replace', connectionId: 'default' } }); }
    catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(ConfigurationMutationError);
    expect(failure).toMatchObject({ completed: ['agent:dependent'] });
    expect((await store.getAgents()).find(item => item.id === 'dependent')?.config.connectionId).toBe('default');
    expect(store.getFullProvider('remove-me')).toBeDefined();
});
it('groups resources without rendering and isolates snapshots from callers', async () => {
    await setup();
    const groups = new ToolboxDrawers(await runtime.vfs.openFileSystem('/etc')); await groups.init();
    groups.setCatalog([{ kind: 'skills', path: '/skills/a' }], []);
    await groups.assign([{ path: '/skills/a', name: 'Learning' }]);
    const group = groups.forPath('/skills/a')!;
    group.paths.length = 0; group.name = 'Mutated';
    expect(groups.forPath('/skills/a')?.name).toBe('Learning');
    await groups.remove(groups.forPath('/skills/a')!);
    expect(groups.forPath('/skills/a')?.id).toBe('/drawers/ungrouped-skills');
});
