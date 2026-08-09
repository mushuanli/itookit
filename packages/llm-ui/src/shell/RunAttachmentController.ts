import type {
    EventEnvelope,
    InteractionRequest,
    JsonValue,
    TaskHandle,
    TaskSignal,
} from '@itookit/harness';

export interface TaskControlPlane {
    openTask(id: string): Promise<TaskHandle>;
}

export interface RunAttachmentCallbacks {
    onEvent(event: EventEnvelope): void;
    onWaiting(request: InteractionRequest<JsonValue>): void;
    onError?(error: Error): void;
    onDetached?(taskId: string): void;
}

export class RunAttachmentController {
    private handle?: TaskHandle;
    private iterator?: AsyncIterator<EventEnvelope>;
    private generation = 0;

    constructor(
        private readonly controlPlane: TaskControlPlane,
        private readonly callbacks: RunAttachmentCallbacks,
    ) {}

    get activeTaskId(): string | undefined { return this.handle?.id; }

    async attach(taskId: string): Promise<void> {
        await this.detach();
        const generation = ++this.generation;
        const handle = await this.controlPlane.openTask(taskId);
        if (generation !== this.generation) return;
        this.handle = handle;
        const events = handle.events()[Symbol.asyncIterator]();
        this.iterator = events;
        void this.consume(events, generation).catch(error => {
            if (generation === this.generation) this.callbacks.onError?.(toError(error));
        });
    }

    async signal(signal: TaskSignal): Promise<void> {
        if (!this.handle) throw new Error('No task is attached');
        await this.handle.signal(signal);
    }

    async cancel(): Promise<void> { await this.handle?.cancel(); }

    async detach(): Promise<void> {
        const taskId = this.handle?.id;
        this.generation++;
        void this.iterator?.return?.();
        this.iterator = undefined;
        this.handle = undefined;
        if (taskId) this.callbacks.onDetached?.(taskId);
    }

    private async consume(iterator: AsyncIterator<EventEnvelope>, generation: number): Promise<void> {
        while (generation === this.generation) {
            const result = await iterator.next();
            if (result.done || generation !== this.generation) return;
            this.callbacks.onEvent(result.value);
            const request = interactionRequest(result.value);
            if (request) this.callbacks.onWaiting(request);
        }
    }
}

function interactionRequest(event: EventEnvelope): InteractionRequest<JsonValue> | undefined {
    return event.type === 'task.interaction.requested'
        ? event.payload as InteractionRequest<JsonValue>
        : undefined;
}

function toError(error: unknown): Error {
    return error instanceof Error ? error : new Error(String(error));
}
