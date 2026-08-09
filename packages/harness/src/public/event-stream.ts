import type { Harness } from '../application/harness';
import type { EventEnvelope } from '../domain/types';

export async function* eventStream(
    kernel: Harness,
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
        if (taskId && await isTerminal(kernel, sessionId, taskId)) return;
        await waitForChange(kernel, sessionId, taskId, 250);
    }
}

async function isTerminal(kernel: Harness, sessionId: string, taskId: string): Promise<boolean> {
    const status = (await kernel.task(sessionId, taskId)).status;
    return status === 'succeeded' || status === 'failed' || status === 'cancelled';
}

export function waitForChange(
    kernel: Harness,
    sessionId: string,
    taskId: string | undefined,
    timeoutMs: number,
): Promise<void> {
    return new Promise(resolve => {
        const timeout = setTimeout(done, timeoutMs);
        const off = kernel.onChanged(event => {
            if (event.sessionId === sessionId && (!taskId || event.taskId === taskId)) done();
        });
        function done(): void { clearTimeout(timeout); off(); resolve(); }
    });
}
