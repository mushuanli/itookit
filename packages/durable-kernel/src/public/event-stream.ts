import type { Kernel } from '../application/kernel';
import type { EventEnvelope } from '../domain/types';

export async function* eventStream(
    kernel: Kernel,
    sessionId: string,
    taskId: string | undefined,
    after: number,
): AsyncGenerator<EventEnvelope> {
    let cursor = after;
    while (true) {
        const events = await kernel.eventList(sessionId, cursor);
        for (const event of events) {
            cursor = event.sequence;
            if (!taskId || event.taskId === taskId) yield event;
        }
        if (taskId && await isTerminal(kernel, sessionId, taskId)) {
            // Terminal state and journal are committed together. Read the tail
            // after observing terminal so a concurrent final commit is not lost.
            for (const event of await kernel.eventList(sessionId, cursor)) {
                cursor = event.sequence;
                if (event.taskId === taskId) yield event;
            }
            return;
        }
        await waitForChange(kernel, sessionId, taskId, 250);
    }
}

async function isTerminal(kernel: Kernel, sessionId: string, taskId: string): Promise<boolean> {
    const status = (await kernel.task(sessionId, taskId)).status;
    return status === 'succeeded' || status === 'failed' || status === 'cancelled';
}

export function waitForChange(
    kernel: Kernel,
    sessionId: string,
    taskId: string | undefined,
    timeoutMs: number,
): Promise<void> {
    return new Promise(resolve => {
        const timeout = setTimeout(done, timeoutMs);
        const off = kernel.onChanged(event => {
            if (event.sessionId === sessionId && (!taskId || !event.taskId || event.taskId === taskId)) done();
        });
        function done(): void { clearTimeout(timeout); off(); resolve(); }
    });
}
