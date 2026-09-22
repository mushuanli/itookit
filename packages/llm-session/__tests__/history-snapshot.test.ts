import { afterEach, expect, it, vi } from 'vitest';
import { createVFS, MemoryBackend } from '@itookit/vfs-core';
import { SessionRepository } from '../src/persistence/session-repository';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); vi.restoreAllMocks(); });

async function fixture() {
    const backend = new MemoryBackend();
    const { manager } = await createVFS({ rootBackend: backend });
    cleanup.push(() => manager.dispose());
    const repository = new SessionRepository(await manager.openFileSystem('/'));
    await repository.init();
    const id = await repository.createSession('History');
    const write = (round: string, parent?: string) => repository.writeDocument(id, `round-${round}.json`,
        JSON.stringify({ id: round, historyParentIds: parent ? [parent] : [] }));
    await write('r0'); await write('r1', 'r0'); await write('other');
    await repository.updateManifest(id, { rootRoundId: 'r0', currentHead: 'r1', branches: { main: 'r1', other: 'other' } });
    return { repository, id, write, backend };
}

it('reads one selected chain without writes, and sees later branch changes on the next snapshot', async () => {
    const { repository, id, backend } = await fixture();
    const transaction = vi.spyOn(backend.records!, 'transaction');
    const changed = vi.fn(); repository.subscribe(changed);
    expect(await repository.readHistoryChain(id)).toMatchObject({ chain: ['r0', 'r1'], rounds: [{ id: 'r0' }, { id: 'r1' }], branch: 'main' });
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(changed).not.toHaveBeenCalled();
    await repository.updateManifest(id, { currentHead: 'other', currentBranch: 'other' });
    expect(await repository.readHistoryChain(id)).toMatchObject({ chain: ['other'], rounds: [{ id: 'other' }], branch: 'other' });
    await repository.updateManifest(id, { currentHead: null });
    expect(await repository.readHistoryChain(id)).toMatchObject({ chain: [], rounds: [] });
});

it('bounds cycles and tolerates missing or malformed ancestor documents', async () => {
    const { repository, id, write } = await fixture();
    await write('r0', 'r1');
    expect((await repository.readHistoryChain(id)).chain).toEqual(['r0', 'r1']);
    await write('r0', 'missing');
    expect((await repository.readHistoryChain(id)).rounds.map(round => round.id)).toEqual(['r0', 'r1']);
    await repository.writeDocument(id, 'round-r0.json', 'null');
    expect((await repository.readHistoryChain(id)).rounds.map(round => round.id)).toEqual(['r1']);
});

it('loads manifest, branch drafts and settings in one fresh transaction without caching later loads', async () => {
    const { repository, id, backend } = await fixture();
    await repository.updateUIState(id, { branchDrafts: { other: { inputText: 'review draft' } } });
    await repository.saveSessionSettings(id, { executionMode: 'agent' });
    const transaction = vi.spyOn(backend.records!, 'transaction');
    expect(await repository.getLoadState(id)).toMatchObject({
        manifest: { currentBranch: 'main', uiState: { branchDrafts: { other: { inputText: 'review draft' } } } },
        settings: { executionMode: 'agent' },
    });
    expect(transaction).toHaveBeenCalledTimes(1);
    await repository.updateManifest(id, { currentBranch: 'other', currentHead: 'other', title: 'Changed' });
    await repository.saveSessionSettings(id, { executionMode: 'chat' });
    expect(await repository.getLoadState(id)).toMatchObject({
        manifest: { title: 'Changed', currentBranch: 'other' }, settings: { executionMode: 'chat' },
    });
});
