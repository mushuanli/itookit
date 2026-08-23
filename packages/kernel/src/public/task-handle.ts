import type { Kernel } from '../application/kernel';
import type {
    EventEnvelope,
    ExitRecord,
    InteractionResponse,
    JsonValue,
    ResourceGrant,
    TaskResourceSpec,
    TaskAttempt,
    TaskHandle,
    TaskRecord,
    TaskSignal,
    TaskSnapshot,
} from '../domain/types';
import { eventStream, waitForChange } from './event-stream';

export class DefaultTaskHandle<O> implements TaskHandle<O> {
    constructor(
        private readonly kernel: Kernel,
        private readonly sessionId: string,
        readonly id: string,
    ) {}

    async status(): Promise<TaskSnapshot> {
        return { task: await this.kernel.task(this.sessionId, this.id) };
    }

    async wait(options?: { timeoutMs?: number }): Promise<ExitRecord<O>> {
        const startedAt = Date.now();
        while (true) {
            const exit = await this.poll();
            if (exit) return exit;
            if (timedOut(startedAt, options?.timeoutMs)) throw new Error(`Task wait timed out: ${this.id}`);
            await waitForChange(this.kernel, this.sessionId, this.id, 100);
        }
    }

    async poll(): Promise<ExitRecord<O> | undefined> {
        return (await this.kernel.task(this.sessionId, this.id)).exit as ExitRecord<O> | undefined;
    }

    signal(signal: TaskSignal): Promise<void> {
        return this.kernel.signal(this.sessionId, this.id, signal);
    }

    start(): Promise<void> {
        return this.kernel.startTask(this.sessionId, this.id);
    }

    respond<T extends JsonValue>(response: InteractionResponse<T>): Promise<void> {
        return this.kernel.respondInteraction(this.sessionId, this.id, response);
    }

    createResource(spec: TaskResourceSpec): Promise<ResourceGrant> {
        return this.kernel.createResource(this.sessionId, { ...spec, ownerTaskId: this.id });
    }

    cancel(reason?: string): Promise<void> {
        return this.kernel.cancel(this.sessionId, this.id, reason);
    }

    events(options?: { after?: number }): AsyncIterable<EventEnvelope> {
        return eventStream(this.kernel, this.sessionId, this.id, options?.after ?? 0);
    }

    history(options?: { afterVersion?: number }): Promise<TaskRecord[]> {
        return this.kernel.taskHistory(this.sessionId, this.id, options?.afterVersion ?? -1);
    }

    attempts(): Promise<TaskAttempt[]> {
        return this.kernel.taskAttempts(this.sessionId, this.id);
    }
}

function timedOut(startedAt: number, timeoutMs: number | undefined): boolean {
    return timeoutMs !== undefined && Date.now() - startedAt >= timeoutMs;
}
