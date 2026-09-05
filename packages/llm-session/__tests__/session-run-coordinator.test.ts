import { describe, expect, it, vi } from 'vitest';
import { SessionRunCoordinator } from '../src/session/session-run-coordinator';

describe('SessionRunCoordinator.updateNodeId', () => {
    it('updates cached persistence and an active task', () => {
        const updateNodeId = vi.fn();
        const task = {
            nodeId: '/old.chat',
            input: { nodeId: '/old.chat' },
        };
        const coordinator = Object.create(SessionRunCoordinator.prototype) as any;
        coordinator.logs = new Map([['session-1', { updateNodeId }]]);
        coordinator.active = new Map([['session-1', task]]);

        coordinator.updateNodeId('session-1', '/new.chat');

        expect(updateNodeId).toHaveBeenCalledWith('/new.chat');
        expect(task.nodeId).toBe('/new.chat');
        expect(task.input.nodeId).toBe('/new.chat');
    });
});
