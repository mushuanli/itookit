import type {
    HarnessControlPlane,
    ProcessSignal,
    RunEventEnvelope,
    RunHandle,
    WaitCondition,
} from '@itookit/common';

export interface RunAttachmentCallbacks {
    onEvent(event: RunEventEnvelope): void;
    onWaiting(condition: WaitCondition): void;
    onError?(error: Error): void;
    onDetached?(runId: string): void;
}

export class RunAttachmentController {
    private handle?: RunHandle;
    private iterator?: AsyncIterator<RunEventEnvelope>;
    private generation = 0;

    constructor(
        private readonly controlPlane: HarnessControlPlane,
        private readonly callbacks: RunAttachmentCallbacks,
    ) {}

    get activeRunId(): string | undefined {
        return this.handle?.runId;
    }

    async attach(runId: string): Promise<void> {
        await this.detach();
        const generation = ++this.generation;
        const handle = await this.controlPlane.attach(runId);
        if (generation !== this.generation) return;
        this.handle = handle;
        const events = handle.events()[Symbol.asyncIterator]();
        this.iterator = events;
        void this.consume(events, generation).catch(error => {
            if (generation !== this.generation) return;
            this.callbacks.onError?.(toError(error));
        });
    }

    async signal(signal: ProcessSignal): Promise<void> {
        if (!this.handle) throw new Error('No execution run is attached');
        await this.handle.signal(signal);
    }

    async cancel(): Promise<void> {
        await this.handle?.cancel();
    }

    async detach(): Promise<void> {
        const runId = this.handle?.runId;
        this.generation++;
        void this.iterator?.return?.();
        this.iterator = undefined;
        this.handle = undefined;
        if (runId) this.callbacks.onDetached?.(runId);
    }

    private async consume(
        iterator: AsyncIterator<RunEventEnvelope>,
        generation: number,
    ): Promise<void> {
        while (generation === this.generation) {
            const result = await iterator.next();
            if (result.done || generation !== this.generation) return;
            this.callbacks.onEvent(result.value);
            const condition = waitingCondition(result.value);
            if (condition) this.callbacks.onWaiting(condition);
        }
    }
}

function waitingCondition(event: RunEventEnvelope): WaitCondition | undefined {
    return event.event.type === 'process:checkpoint'
        ? event.event.checkpoint.waitFor
        : undefined;
}

function toError(error: unknown): Error {
    return error instanceof Error ? error : new Error(String(error));
}
