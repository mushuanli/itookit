import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '@itookit/common';
import type { PersistedRound } from '../src/persistence/round-types';
import { roundToProjection } from '../src/persistence/round-log';
import { SessionState } from '../src/session/session-state';

function round(id: string, status: PersistedRound['status'], error?: string): PersistedRound {
    return {
        id,
        sessionId: 'test-session-id',
        historyParentIds: [],
        input: [{ role: 'user', content: 'run the harness' } as ChatMessage],
        output: [],
        executions: [],
        status,
        createdAt: 1,
        completedAt: 2,
        origin: 'user',
        error,
    };
}

describe('terminal round without assistant output', () => {
    it('projects a failed assistant placeholder so the transcript does not end on the user message', () => {
        const projection = roundToProjection(round('r1', 'failed', 'Load failed'), 'r1');

        expect(projection.assistantMessage).toMatchObject({
            content: '',
            status: 'failed',
            persistedNodeId: 'r1',
            error: 'Load failed',
        });

        const state = new SessionState('session');
        state.loadFromProjection(projection);
        expect(state.getLastSession()?.role).toBe('assistant');
    });

    it('maps a cancelled round onto an aborted assistant placeholder', () => {
        const projection = roundToProjection(round('r1', 'cancelled'), 'r1');
        expect(projection.assistantMessage).toMatchObject({ status: 'aborted', content: '' });
    });

    it('keeps user-only projection for non-terminal rounds', () => {
        const projection = roundToProjection(round('r1', 'running'), 'r1');
        expect(projection.assistantMessage).toBeUndefined();
    });

    it('materializes the placeholder when the failure arrives as a round:updated event', () => {
        const state = new SessionState('session');
        state.apply({ type: 'round:appended', ref: 'main', roundId: 'r1', projection: roundToProjection(round('r1', 'pending'), 'r1') });
        expect(state.getLastSession()?.role).toBe('user');

        const events = state.apply({
            type: 'round:updated',
            roundId: 'r1',
            changes: { status: 'failed', error: 'Load failed' },
        });

        const appended = events.find(event => event.type === 'message:appended');
        expect(appended).toBeDefined();
        expect(appended!.payload.sessionGroup).toMatchObject({ role: 'assistant', roundId: 'r1' });
        expect(appended!.payload.sessionGroup.executionRoot).toMatchObject({
            status: 'failed',
            data: { error: 'Load failed' },
        });
        expect(state.getLastSession()?.role).toBe('assistant');
    });
});
