import { expect, it, vi } from 'vitest';
import type { ICommandBus } from '@itookit/common';
import { SessionCommand, type ISessionRepository } from '@itookit/llm-session';
import { SessionService } from './SessionService';

it('supports repositories without load snapshots and reads preferences after branch selection', async () => {
    let branch = 'main';
    const manifest = vi.fn(async () => ({ title: 'Existing', currentBranch: branch }));
    const execute = vi.fn(async (command: string) => {
        if (command === 'vcs.branch.switch') branch = 'review';
        if (command === SessionCommand.GetSettings) return { executionMode: 'agent' };
        return { sessions: [], currentBranch: branch };
    });
    const service = new SessionService({ getManifest: manifest } as unknown as ISessionRepository,
        { execute } as unknown as ICommandBus);
    expect(await service.loadSession('s', 'Default', 'review')).toMatchObject({
        title: 'Existing', manifest: { currentBranch: 'review' }, settings: { executionMode: 'agent' },
        snapshot: { currentBranch: 'review' },
    });
    expect(manifest).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls.map(([name]) => name)).toEqual([
        SessionCommand.Bind, 'vcs.branch.switch', SessionCommand.GetSnapshot, SessionCommand.GetSettings,
    ]);
});
