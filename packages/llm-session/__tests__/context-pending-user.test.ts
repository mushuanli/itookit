import { expect, it, vi } from 'vitest';
import type { ContextPlan } from '@itookit/common';
import { ContextAssembler } from '@itookit/llm-tasks';
import { ConversationRunCoordinator } from '../src/session/conversation-run-coordinator';

function coordinator(): ConversationRunCoordinator {
    return new ConversationRunCoordinator({
        kernel: {}, eventBus: {}, dagPlugins: {}, engine: {}, loadArtifact: async () => null,
    } as never);
}

/** Regenerate/resend reuses the Round as branch head; the plan must still carry the prompt. */
it('always plans the pending user message with its owning Round', async () => {
    const assemble = vi.spyOn(ContextAssembler.prototype, 'assemble')
        .mockResolvedValue({ snapshot: {} as never, messages: [] });
    try {
        const execution = {
            task: { id: 'run', sessionId: 'session', input: { text: 'current question' } },
            config: { id: 'agent' },
            roundId: 'r1',
            log: {
                loadManifest: async () => ({ currentBranch: 'main', branches: { main: 'r1' }, branchMeta: {} }),
                readRound: async () => ({ input: [], output: [], historyParentIds: [] }),
            },
        };
        await (coordinator() as unknown as {
            assembleContext(execution: unknown, location: unknown): Promise<unknown>;
        }).assembleContext(execution, { branchRef: 'main', branchHead: 'r1' });

        const plan = assemble.mock.calls[0][0] as ContextPlan;
        expect(plan.pendingUserMessage).toEqual({ role: 'user', content: 'current question' });
        expect(plan.pendingRoundId).toBe('r1');
    } finally {
        assemble.mockRestore();
    }
});
