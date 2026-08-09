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

    async cancel(): Promise<void> {
        if (!this.handle) throw new Error('No task is attached');
        await this.handle.cancel('Cancelled by privileged command');
    }

    async resume(): Promise<void> {
        const handle = this.requireHandle();
        const { task } = await handle.status();
        if (task.status === 'created') return handle.start();
        if (task.status === 'ready' || task.status === 'running') return;
        if (task.status === 'waiting' && acceptsSignal(task.wait, 'resume')) {
            return handle.signal({ type: 'resume' });
        }
        if (task.status === 'waiting') throw new Error('Task is waiting for an effect or approval');
        throw new Error(`Task cannot be resumed from ${task.status}`);
    }

    async approve(note = ''): Promise<void> {
        const handle = this.requireHandle();
        const { task } = await handle.status();
        const interaction = Object.values(task.interactions)
            .filter(item => item.status === 'pending' && item.kind === 'approval')
            .sort((left, right) => right.requestedAt - left.requestedAt)[0];
        if (!interaction) throw new Error('Attached task has no pending approval');
        await handle.respond({
            interactionId: interaction.id,
            value: { approved: true, ...(note.trim() ? { note: note.trim() } : {}) },
        });
    }

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

    private requireHandle(): TaskHandle {
        if (!this.handle) throw new Error('No task is attached');
        return this.handle;
    }
}

function acceptsSignal(wait: import('@itookit/harness').WaitSpec | undefined, type: string): boolean {
    if (!wait) return false;
    if (wait.type === 'signal') return wait.id === undefined || wait.id === type;
    if (wait.type === 'any' || wait.type === 'all' || wait.type === 'quorum') {
        return wait.waits.some(item => acceptsSignal(item, type));
    }
    return false;
}

function interactionRequest(event: EventEnvelope): InteractionRequest<JsonValue> | undefined {
    return event.type === 'task.interaction.requested'
        ? event.payload as InteractionRequest<JsonValue>
        : undefined;
}

function toError(error: unknown): Error {
    return error instanceof Error ? error : new Error(String(error));
}
