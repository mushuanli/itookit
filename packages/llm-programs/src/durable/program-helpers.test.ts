import { describe, expect, it } from 'vitest';
import type { TaskInputEvent } from '@itookit/harness';
import { dependencyOutput, type DurableDependencyBinding } from './program-helpers';

describe('dependencyOutput', () => {
    it('extracts message.content from an agent envelope instead of the whole output', () => {
        const event = exited({
            message: { role: 'assistant', content: 'analysis text' },
            usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
            finishReason: 'stop',
            exchanges: 2,
        });
        const bindings: DurableDependencyBinding[] = [
            { taskId: 'upstream', input: 'analysis', output: 'result' },
        ];

        expect(dependencyOutput(event, bindings)).toEqual({
            taskId: 'upstream',
            key: 'analysis',
            value: 'analysis text',
        });
    });

    it('prefers the declared output artifact content for flow.value envelopes', () => {
        const event = exited({
            outputs: { result: { outputName: 'result', type: 'text', content: 'reduced' } },
        });
        const bindings: DurableDependencyBinding[] = [
            { taskId: 'upstream', input: 'input', output: 'result' },
        ];

        expect(dependencyOutput(event, bindings)).toEqual({
            taskId: 'upstream',
            key: 'input',
            value: 'reduced',
        });
    });

    it('falls back to the raw output when it has no message or matching artifact', () => {
        const event = exited('plain-text');
        const bindings: DurableDependencyBinding[] = [{ taskId: 'upstream', input: 'input' }];

        expect(dependencyOutput(event, bindings)).toEqual({
            taskId: 'upstream',
            key: 'input',
            value: 'plain-text',
        });
    });

    it('returns undefined for non task-exited events', () => {
        expect(dependencyOutput({ type: 'started' }, [])).toBeUndefined();
    });
});

function exited(output: unknown): TaskInputEvent {
    return {
        type: 'task-exited',
        taskId: 'upstream',
        exit: { taskId: 'upstream', status: 'succeeded', output, completedAt: 1 },
    };
}
