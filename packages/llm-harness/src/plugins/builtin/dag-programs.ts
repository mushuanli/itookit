import type {
    DagNodeOutcome,
    ProcessContext,
    ProcessEvent,
    ProcessProgram,
    ProcessSignal,
    ProcessTransition,
} from '@itookit/common';

interface ValueState {
    outcome: DagNodeOutcome;
}

export class DagValueProgram implements ProcessProgram<
    ValueState,
    ValueState,
    DagNodeOutcome
> {
    readonly kind = 'dag.value';

    async initialize(input: ValueState): Promise<ValueState> {
        return structuredClone(input);
    }

    async *run(
        state: ValueState,
        _context: ProcessContext,
    ): AsyncGenerator<ProcessEvent, ProcessTransition<ValueState, DagNodeOutcome>> {
        return { type: 'completed', output: structuredClone(state.outcome) };
    }
}

interface HumanState {
    requestId: string;
    prompt: string;
    schema?: unknown;
}

export class DagHumanProgram implements ProcessProgram<
    HumanState,
    HumanState,
    DagNodeOutcome
> {
    readonly kind = 'dag.human';

    async initialize(input: HumanState): Promise<HumanState> {
        if (!input.prompt) throw new Error('Human DAG node requires a prompt');
        return structuredClone(input);
    }

    async *run(
        state: HumanState,
        _context: ProcessContext,
        signal?: ProcessSignal,
    ): AsyncGenerator<ProcessEvent, ProcessTransition<HumanState, DagNodeOutcome>> {
        if (signal?.type === 'respond') {
            return {
                type: 'completed',
                output: {
                    outputs: {
                        response: {
                            outputName: 'response',
                            type: 'json',
                            content: signal.response as never,
                        },
                    },
                },
            };
        }
        return {
            type: 'waiting',
            state,
            waitFor: {
                type: 'human-signal',
                requestId: state.requestId,
                prompt: state.prompt,
                schema: state.schema,
                conversational: true,
            },
        };
    }
}
