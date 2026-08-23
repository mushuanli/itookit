import { describe, expect, it, vi } from 'vitest';
import type { EventEnvelope, TaskHandle } from '@itookit/durable-kernel';
import { RunAttachmentController, type TaskControlPlane } from './RunAttachmentController';

describe('RunAttachmentController', () => {
    it('replays task events and exposes interaction requests', async () => {
        const events = [statusEvent(), waitingEvent()];
        const onEvent = vi.fn();
        const onWaiting = vi.fn();
        const controller = new RunAttachmentController(
            controlPlane(handle('task-1', events)),
            { onEvent, onWaiting },
        );

        await controller.attach('task-1');
        await until(() => onEvent.mock.calls.length === events.length);

        expect(onEvent).toHaveBeenCalledTimes(2);
        expect(onWaiting).toHaveBeenCalledWith(expect.objectContaining({ id: 'approval' }));
    });

    it('does not let a stale attach replace the current task', async () => {
        const slow = deferred<TaskHandle>();
        const fast = deferred<TaskHandle>();
        const plane: TaskControlPlane = {
            openTask: taskId => taskId === 'slow' ? slow.promise : fast.promise,
        };
        const controller = new RunAttachmentController(plane, {
            onEvent: vi.fn(), onWaiting: vi.fn(),
        });

        const slowAttach = controller.attach('slow');
        const fastAttach = controller.attach('fast');
        fast.resolve(handle('fast'));
        await fastAttach;
        slow.resolve(handle('slow'));
        await slowAttach;

        expect(controller.activeTaskId).toBe('fast');
    });

    it('approves the latest pending approval on the attached task', async () => {
        const task = handle('task-1');
        vi.mocked(task.status).mockResolvedValue({
            task: taskRecord({
                approval: {
                    id: 'approval', kind: 'approval', prompt: 'Approve?', status: 'pending', requestedAt: 1,
                },
            }),
        });
        const controller = new RunAttachmentController(controlPlane(task), callbacks());
        await controller.attach('task-1');

        await controller.approve('reviewed');

        expect(task.respond).toHaveBeenCalledWith({
            interactionId: 'approval', value: { approved: true, note: 'reviewed' },
        });
    });

    it('starts a persisted task when resume is requested', async () => {
        const task = handle('task-1');
        vi.mocked(task.status).mockResolvedValue({ task: taskRecord({}, 'created') });
        const controller = new RunAttachmentController(controlPlane(task), callbacks());
        await controller.attach('task-1');

        await controller.resume();

        expect(task.start).toHaveBeenCalledOnce();
    });
});

function controlPlane(task: TaskHandle): TaskControlPlane {
    return { openTask: vi.fn(async () => task) };
}

function handle(id: string, events: EventEnvelope[] = []): TaskHandle {
    return {
        id,
        events: () => stream(events),
        signal: vi.fn(), start: vi.fn(), cancel: vi.fn(), status: vi.fn(), wait: vi.fn(), poll: vi.fn(),
        respond: vi.fn(), createResource: vi.fn(), history: vi.fn(), attempts: vi.fn(),
    };
}

function callbacks() {
    return { onEvent: vi.fn(), onWaiting: vi.fn() };
}

function taskRecord(
    interactions: import('@itookit/durable-kernel').TaskRecord['interactions'],
    status: import('@itookit/durable-kernel').TaskStatus = 'waiting',
): import('@itookit/durable-kernel').TaskRecord {
    return {
        id: 'task-1', sessionId: 'session-1', rootTaskId: 'task-1',
        program: { kind: 'test', version: '1' }, status, input: null,
        pendingEvents: [], unresolvedDeps: 0, priority: 0,
        retry: { maxAttempts: 1 }, attemptCount: 0, effects: {}, interactions,
        version: 1, createdAt: 1, updatedAt: 1,
    };
}

async function* stream(events: EventEnvelope[]): AsyncGenerator<EventEnvelope> {
    for (const event of events) yield event;
}

function statusEvent(): EventEnvelope { return envelope(1, 'task.running'); }

function waitingEvent(): EventEnvelope {
    return envelope(2, 'task.interaction.requested', {
        id: 'approval', kind: 'approval', prompt: 'Approve?', payload: null,
    });
}

function envelope(sequence: number, type: string, payload?: unknown): EventEnvelope {
    return { sequence, occurredAt: sequence, sessionId: 'session-1', taskId: 'task-1', type, payload };
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(done => { resolve = done; });
    return { promise, resolve };
}

async function until(predicate: () => boolean): Promise<void> {
    for (let index = 0; index < 20 && !predicate(); index++) await new Promise(resolve => setTimeout(resolve, 0));
}
