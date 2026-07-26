import { describe, expect, it, vi } from 'vitest';
import type {
    HarnessControlPlane,
    RunEventEnvelope,
    RunHandle,
} from '@itookit/common';
import { RunAttachmentController } from './RunAttachmentController';

describe('RunAttachmentController', () => {
    it('replays run events and exposes waiting conditions', async () => {
        const events = [statusEvent(), waitingEvent()];
        const onEvent = vi.fn();
        const onWaiting = vi.fn();
        const controller = new RunAttachmentController(
            controlPlane(handle('run-1', events)),
            { onEvent, onWaiting },
        );

        await controller.attach('run-1');
        await until(() => onEvent.mock.calls.length === events.length);

        expect(onEvent).toHaveBeenCalledTimes(2);
        expect(onWaiting).toHaveBeenCalledWith(expect.objectContaining({
            type: 'human-signal',
            requestId: 'approval',
        }));
    });

    it('does not let a stale attach replace the current run', async () => {
        const slow = deferred<RunHandle>();
        const fast = deferred<RunHandle>();
        const plane: HarnessControlPlane = {
            submit: vi.fn(),
            attach: runId => runId === 'slow' ? slow.promise : fast.promise,
        };
        const controller = new RunAttachmentController(plane, {
            onEvent: vi.fn(),
            onWaiting: vi.fn(),
        });

        const slowAttach = controller.attach('slow');
        const fastAttach = controller.attach('fast');
        fast.resolve(handle('fast'));
        await fastAttach;
        slow.resolve(handle('slow'));
        await slowAttach;

        expect(controller.activeRunId).toBe('fast');
    });
});

function controlPlane(runHandle: RunHandle): HarnessControlPlane {
    return {
        submit: vi.fn(),
        attach: vi.fn(async () => runHandle),
    };
}

function handle(runId: string, events: RunEventEnvelope[] = []): RunHandle {
    return {
        runId,
        events: () => stream(events),
        signal: vi.fn(),
        cancel: vi.fn(),
        snapshot: vi.fn(),
    };
}

async function* stream(events: RunEventEnvelope[]): AsyncGenerator<RunEventEnvelope> {
    for (const event of events) yield event;
}

function statusEvent(): RunEventEnvelope {
    return envelope(1, { type: 'run:status', status: 'running' });
}

function waitingEvent(): RunEventEnvelope {
    return envelope(2, {
        type: 'process:checkpoint',
        checkpoint: {
            processId: 'process-1',
            runId: 'run-1',
            programKind: 'test',
            state: {},
            waitFor: {
                type: 'human-signal',
                requestId: 'approval',
                prompt: 'Approve?',
            },
            sequence: 1,
            createdAt: 1,
        },
    });
}

function envelope(
    sequence: number,
    event: RunEventEnvelope['event'],
): RunEventEnvelope {
    return {
        sequence,
        occurredAt: sequence,
        runId: 'run-1',
        processId: 'process-1',
        event,
    };
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(done => { resolve = done; });
    return { promise, resolve };
}

async function until(predicate: () => boolean): Promise<void> {
    for (let attempt = 0; attempt < 10 && !predicate(); attempt++) {
        await Promise.resolve();
    }
}
