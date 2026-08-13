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

    it('rejects undeclared outputs and invalid retries', () => {
        const value = workflow();
        value.tasks.push({
            id: 'second', agent: 'agent', description: 'Second', outputs: { result: 'text' },
            inputs: { source: '${tasks.first.outputs.missing}' }, retry: { max_attempts: 0 },
        });
        expect(() => validateWorkflow(value, false)).toThrow('retry.max_attempts');
        expect(() => validateWorkflow(value, false)).toThrow('undeclared output first.missing');
    });
});
