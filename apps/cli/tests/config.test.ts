import { describe, expect, it } from 'vitest';
import { validateWorkflow } from '../src/config';
import type { WorkflowConfigV1 } from '../src/types';

function workflow(): WorkflowConfigV1 {
    return {
        version: 1,
        name: 'test',
        goal: 'ship',
        providers: [{
            id: 'provider', implementation: 'openai-compatible', base_url: 'http://localhost',
            api_key_env: 'TEST_API_KEY', models: [{ id: 'model' }],
        }],
        connections: [{ id: 'default', provider: 'provider', tiers: { standard: 'model' } }],
        agents: [{ id: 'agent', connection: 'default', tools: ['file_read'] }],
        tasks: [{ id: 'first', agent: 'agent', description: 'First', outputs: { result: 'text' } }],
        result: { task: 'first', output: 'result' },
    };
}

describe('validateWorkflow', () => {
    it('accepts a minimal workflow', () => {
        expect(validateWorkflow(workflow(), false).name).toBe('test');
    });

    it('rejects cyclic tasks', () => {
        const value = workflow();
        value.tasks = [
            { id: 'first', agent: 'agent', description: 'First', depends_on: ['second'], outputs: { result: 'text' } },
            { id: 'second', agent: 'agent', description: 'Second', depends_on: ['first'], outputs: { result: 'text' } },
        ];
        expect(() => validateWorkflow(value, false)).toThrow('dependency cycle');
    });

    it('rejects an unknown output reference', () => {
        const value = workflow();
        value.tasks.push({
            id: 'second', agent: 'agent', description: 'Second', depends_on: [], outputs: { result: 'text' },
            inputs: { source: '${tasks.missing.outputs.result}' },
        });
        expect(() => validateWorkflow(value, false)).toThrow('unknown task missing');
    });

    it('rejects invalid retries', () => {
        const value = workflow();
        value.tasks.push({
            id: 'second', agent: 'agent', description: 'Second', outputs: { result: 'text' },
            retry: { max_attempts: 0 },
        });
        expect(() => validateWorkflow(value, false)).toThrow('retry.max_attempts');
    });

    it('rejects undeclared outputs', () => {
        const value = workflow();
        value.tasks.push({
            id: 'second', agent: 'agent', description: 'Second', outputs: { result: 'text' },
            inputs: { source: '${tasks.first.outputs.missing}' },
        });
        expect(() => validateWorkflow(value, false)).toThrow('undeclared output first.missing');
    });

    it('rejects an invalid agent approval strategy', () => {
        const value = workflow();
        value.agents[0].approval = 'sometimes' as never;
        expect(() => validateWorkflow(value, false)).toThrow('approval');
    });

    it('rejects an invalid route mode', () => {
        const value = workflow();
        value.tasks.push({
            id: 'router', route: { mode: 'parallel' as never, rules: [{ when: 'x', then: 'first' }] },
            depends_on: [], inputs: { input: '${tasks.first.outputs.result}' },
        });
        expect(() => validateWorkflow(value, false)).toThrow('route.mode');
    });

    it('rejects an invalid on_failure value', () => {
        const value = workflow();
        value.tasks.push({
            id: 'second', agent: 'agent', description: 'Second',
            depends_on: [{ task: 'first', on_failure: 'retry' as never }], outputs: { result: 'text' },
        });
        expect(() => validateWorkflow(value, false)).toThrow('depends_on');
    });

    it('rejects a route condition with no operator', () => {
        const value = workflow();
        value.tasks.push({
            id: 'router', route: { rules: [{ when: {} as never, then: 'first' }] },
            depends_on: [], inputs: { input: '${tasks.first.outputs.result}' },
        });
        expect(() => validateWorkflow(value, false)).toThrow('no condition operator');
    });

    it('accepts a composite route condition', () => {
        const value = workflow();
        value.tasks.push({
            id: 'router',
            route: {
                rules: [{
                    when: { and: [{ in: ['a', 'b'] }, { not: 'c' }] },
                    then: 'first',
                }],
            },
            depends_on: [], inputs: { input: '${tasks.first.outputs.result}' },
        });
        expect(validateWorkflow(value, false).tasks).toHaveLength(2);
    });

    it('rejects a route condition with multiple operators', () => {
        const value = workflow();
        value.tasks.push({
            id: 'router',
            route: { rules: [{ when: { eq: 'x', or: [{ eq: 'y' }] }, then: 'first' }] },
            inputs: { input: '${tasks.first.outputs.result}' },
        });
        expect(() => validateWorkflow(value, false)).toThrow('exactly one');
    });

    it('rejects an explicit control kind without its configuration', () => {
        const value = workflow();
        value.tasks.push({ id: 'router', kind: 'route' } as never);
        expect(() => validateWorkflow(value, false)).toThrow('requires route');
    });

    it('accepts a route condition with a field path', () => {
        const value = workflow();
        value.tasks.push({
            id: 'router',
            route: { rules: [{ when: { path: ['kind'], eq: 'search' }, then: 'first' }] },
            depends_on: [], inputs: { input: '${tasks.first.outputs.result}' },
        });
        expect(validateWorkflow(value, false).tasks).toHaveLength(2);
    });

    it('rejects a task combining route and spawn (mutually exclusive kinds)', () => {
        const value = workflow();
        value.tasks.push({
            id: 'router',
            route: { rules: [{ when: 'x', then: 'first' }] },
            spawn: { tasks: [{ id: 'w', agent: 'agent', description: 'w' }], edges: [] },
            depends_on: [], inputs: { input: '${tasks.first.outputs.result}' },
        } as never);
        expect(() => validateWorkflow(value, false)).toThrow('cannot combine');
    });

    it('rejects unknown fields (strict schema)', () => {
        const value = workflow() as WorkflowConfigV1 & { tasks: Array<Record<string, unknown>> };
        (value.tasks[0] as Record<string, unknown>).typo_field = true;
        expect(() => validateWorkflow(value, false)).toThrow('Unrecognized');
    });
});
