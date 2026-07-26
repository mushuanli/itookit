import { describe, expect, it } from 'vitest';
import type {
    ProcessContext,
    ProcessEvent,
    ProcessProgram,
    ProcessSignal,
    ProcessTransition,
} from '@itookit/common';
import { HarnessKernel } from './harness-kernel';

const resources = {
    llm: {} as import('@itookit/common').LLMPort,
    tools: {} as import('@itookit/common').ToolPort,
    vfs: {} as import('@itookit/common').VfsPort,
};

class EchoProgram implements ProcessProgram<{ value: string }, string, string> {
    readonly kind = 'test.echo';

    async initialize(input: string) {
        return { value: input };
    }

    async *run(
        state: { value: string },
    ): AsyncGenerator<ProcessEvent, ProcessTransition<{ value: string }, string>> {
        yield { type: 'diagnostic', name: 'echo' };
        return { type: 'completed', output: state.value };
    }
}

class WaitingProgram implements ProcessProgram<{ waiting: boolean }, null, string> {
    readonly kind = 'test.waiting';

    async initialize() {
        return { waiting: false };
    }

    async *run(
        _state: { waiting: boolean },
        _context: ProcessContext,
        signal?: ProcessSignal,
    ): AsyncGenerator<ProcessEvent, ProcessTransition<{ waiting: boolean }, string>> {
        if (signal?.type === 'respond') {
            return { type: 'completed', output: String(signal.response) };
        }
        return {
            type: 'waiting',
            state: { waiting: true },
            waitFor: {
                type: 'human-signal',
                requestId: 'approval',
                prompt: 'Approve?',
            },
        };
    }
}

describe('HarnessKernel', () => {
    it('runs a direct process and replays its event stream', async () => {
        const kernel = new HarnessKernel({ resources });
        kernel.registerProgram(new EchoProgram());
        const handle = await kernel.submit({
            scheduler: 'direct',
            spec: { programKind: 'test.echo', input: 'done' },
        });

        const events = await collect(handle.events());
        const snapshot = await handle.snapshot();
        const replayed = await collect((await kernel.attach(handle.runId)).events());

        expect(events.at(-1)?.event.type).toBe('run:completed');
        expect(snapshot.run.status).toBe('completed');
        expect(snapshot.run.output).toEqual({ result: 'done' });
        expect(replayed.map(event => event.sequence)).toEqual(events.map(event => event.sequence));
    });

    it('checkpoints a waiting process and resumes it with a signal', async () => {
        const kernel = new HarnessKernel({ resources });
        kernel.registerProgram(new WaitingProgram());
        const handle = await kernel.submit({
            scheduler: 'direct',
            spec: { programKind: 'test.waiting', input: null },
        });

        const waitingEvents = await collectUntilWaiting(handle.events());
        const waiting = await handle.snapshot();
        await handle.signal({ type: 'respond', requestId: 'approval', response: 'yes' });
        const resumed = await collect(handle.events(waitingEvents.at(-1)?.sequence));
        const completed = await handle.snapshot();

        expect(waiting.run.status).toBe('waiting');
        expect(waiting.processes[0].state).toEqual({ waiting: true });
        expect(resumed.at(-1)?.event.type).toBe('run:completed');
        expect(completed.run.output).toEqual({ result: 'yes' });
    });
});

async function collect(
    events: AsyncIterable<import('@itookit/common').RunEventEnvelope>,
): Promise<import('@itookit/common').RunEventEnvelope[]> {
    const result = [];
    for await (const event of events) result.push(event);
    return result;
}

async function collectUntilWaiting(
    events: AsyncIterable<import('@itookit/common').RunEventEnvelope>,
): Promise<import('@itookit/common').RunEventEnvelope[]> {
    const result = [];
    for await (const event of events) {
        result.push(event);
        if (event.event.type === 'run:status' && event.event.status === 'waiting') break;
    }
    return result;
}
