import { expect, it } from 'vitest';
import { DurableAgentProgram } from './agent-program';

it.each([1, 2])('keeps output validation evidence and respects a %s-exchange budget', maxExchanges => {
    const program = new DurableAgentProgram();
    const initial = program.init({ sessionId: 's', roundId: 'r', connectionId: 'c', maxExchanges,
        messages: [{ role: 'user', content: 'Review' }], responseFormat: { type: 'json_object' },
        outputValidation: { onInvalid: 'repair', retries: 1 } });
    const requested = program.reduce(initial.state, { type: 'signal', sequence: 1,
        signal: { type: 'capabilities', payload: { llmHandleId: 'llm' } } });
    const invalid = program.reduce(requested.state, { type: 'effect-completed', effectId: 'llm-exchange-1',
        result: { choices: [{ message: { role: 'assistant', content: 'not JSON' }, finish_reason: 'stop' }] } });
    if (maxExchanges === 1) {
        expect(invalid.next).toMatchObject({ type: 'fail', error: { code: 'BUDGET_EXHAUSTED' } });
        if (invalid.next.type === 'fail') {
            expect(invalid.next.error.message).toContain('response is not valid JSON');
            expect(invalid.next.error.message).toContain('maxExchanges=1');
        }
        expect(invalid.state.exchanges).toBe(1);
        expect(invalid.actions?.some(action => action.type === 'effect')).toBe(false);
    } else {
        expect(invalid.state.exchanges).toBe(2);
        const repaired = program.reduce(JSON.parse(JSON.stringify(invalid.state)), { type: 'effect-completed', effectId: 'llm-exchange-2',
            result: { choices: [{ message: { role: 'assistant', content: '{"score":9}' }, finish_reason: 'stop' }] } });
        expect(repaired.next).toMatchObject({ type: 'complete', output: { exchanges: 2, message: { content: '{"score":9}' } } });
    }
});

it.each([
    { schema: { type: 'object', properties: { score: { type: 'number' } }, required: ['score'], additionalProperties: false }, invalid: { score: 9, additionalProperties: false }, valid: { score: 9 }, path: '$.additionalProperties' },
    { schema: { type: 'object', properties: { review: { type: 'object', properties: {}, additionalProperties: false } } }, invalid: { review: { extra: 1 } }, valid: { review: {} }, path: '$.review.extra' },
    { schema: { type: 'object', additionalProperties: { type: 'number' } }, invalid: { extra: 'bad' }, valid: { extra: 9 }, path: '$.extra' },
    { schema: { type: 'object', properties: { forbidden: false } }, invalid: { forbidden: 1 }, valid: {}, path: '$.forbidden' },
    { schema: { type: 'array', items: false }, invalid: [1], valid: [], path: '$[0]' },
])('repairs schema violations at $path before reporting Task success', ({ schema, invalid, valid, path }) => {
    const program = new DurableAgentProgram();
    const initial = program.init({ sessionId: 's', roundId: 'r', connectionId: 'c', maxExchanges: 3,
        messages: [{ role: 'user', content: 'Review' }],
        responseFormat: { type: 'json_schema', json_schema: { name: 'review', schema } },
        outputValidation: { onInvalid: 'repair', retries: 1 } });
    const requested = program.reduce(initial.state, { type: 'signal', sequence: 1, signal: { type: 'capabilities', payload: { llmHandleId: 'llm' } } });
    const response = (content: unknown, id: number) => ({ type: 'effect-completed' as const, effectId: `llm-exchange-${id}`,
        result: { choices: [{ message: { role: 'assistant', content: JSON.stringify(content) }, finish_reason: 'stop' }] } });
    const repair = program.reduce(requested.state, response(invalid, 1));
    expect(repair.state.outputValidationAttempts).toBe(1);
    expect(repair.state.messages.at(-1)?.content).toContain(path);
    const resumed = JSON.parse(JSON.stringify(repair.state));
    expect(program.reduce(resumed, response(valid, 2)).next.type).toBe('complete');
    const failed = program.reduce(JSON.parse(JSON.stringify(repair.state)), response(invalid, 2));
    expect(failed.next).toMatchObject({ type: 'fail', error: { code: 'INVALID_OUTPUT' } });
});
