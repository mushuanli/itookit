import { describe, expect, it, vi } from 'vitest';
import type { EventEnvelope } from '@itookit/durable-kernel';
import { RunAttachmentController, type TaskControlPlane, type AttachedTask } from './RunAttachmentController';

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
        const slow = deferred<AttachedTask>();
        const fast = deferred<AttachedTask>();
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

    it('does not resurrect an attachment detached before openTask starts', async () => {
        const plane = controlPlane(handle('stale'));
        const controller = new RunAttachmentController(plane, callbacks());
        const pending = controller.attach('stale');
        await controller.detach();
        await pending;
        expect(controller.activeTaskId).toBeUndefined();
        expect(plane.openTask).not.toHaveBeenCalled();
    });

    it('does not present a historical approval that has already been answered', async () => {
        const task = handle('task-1', [waitingEvent()]);
        vi.mocked(task.status).mockResolvedValue({ task: taskRecord({}) });
        const handlers = callbacks();
        const controller = new RunAttachmentController(controlPlane(task), handlers);
        await controller.attach(task.id);
        await until(() => handlers.onEvent.mock.calls.length === 1);
        await Promise.resolve();
        expect(handlers.onWaiting).not.toHaveBeenCalled();
        await controller.detach();
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

    it('responds only to an input belonging to the current attachment revision', async () => {
        const task = handle('task-1');
        vi.mocked(task.status).mockResolvedValue({ task: taskRecord({
            input: { id: 'input', kind: 'input', prompt: 'Essay', status: 'pending', requestedAt: 1 },
        }) });
        const controller = new RunAttachmentController(controlPlane(task), callbacks());
        await controller.attach(task.id);
        await controller.respondInput('input', { essay: 'Essay' }, controller.revision);
        expect(task.respond).toHaveBeenCalledWith({ interactionId: 'input', value: { essay: 'Essay' } });
        await expect(controller.respondInput('input', {}, controller.revision - 1)).rejects.toThrow('attachment changed');
        expect(task.respond).toHaveBeenCalledTimes(1);
        await controller.detach();
    });

    it('starts a persisted task when resume is requested', async () => {
        const task = handle('task-1');
        vi.mocked(task.status).mockResolvedValue({ task: taskRecord({}, 'created') });
        const controller = new RunAttachmentController(controlPlane(task), callbacks());
        await controller.attach('task-1');

        await controller.resume();

        expect(task.start).toHaveBeenCalledOnce();
    });

    it('resumes a durably paused task through the control API', async () => {
        const task = handle('task-1');
        vi.mocked(task.status).mockResolvedValue({ task: { ...taskRecord({}, 'ready'), control: {
            epoch: 3, requestId: 'pause', mode: 'pause', acknowledged: true,
        } } });
        const controller = new RunAttachmentController(controlPlane(task), callbacks());
        await controller.attach('task-1');
        await controller.resume();
        expect(task.resume).toHaveBeenCalledWith({ requestId: expect.any(String), expectedEpoch: 3 });
        expect(task.signal).not.toHaveBeenCalled();
    });
});

function controlPlane(task: AttachedTask): TaskControlPlane {
    return { openTask: vi.fn(async () => task) };
}

function handle(id: string, events: EventEnvelope[] = []): AttachedTask {
    return {
        id,
        events: () => stream(events),
        signal: vi.fn(), start: vi.fn(), cancel: vi.fn(), status: vi.fn(async () => ({ task: taskRecord({
            approval: { id: 'approval', kind: 'approval', prompt: 'Approve?', status: 'pending', requestedAt: 1 },
        }) })),
        respond: vi.fn(), pause: vi.fn(), interrupt: vi.fn(), resume: vi.fn(),
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
