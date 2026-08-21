import { describe, expect, it } from 'vitest';
import { expandWorkflow } from '../src/expand';
import { validateWorkflow } from '../src/config';
import type { WorkflowConfigV1 } from '../src/types';

describe('expandWorkflow', () => {
    it('expands model/env/prompt/needs shorthand into a full workflow', () => {
        const expanded = expandWorkflow({
            version: 1,
            name: 'x',
            goal: 'ship',
            model: 'anthropic/claude-sonnet',
            env: { api_key: 'ANTHROPIC_API_KEY' },
            tasks: [
                { id: 'inspect', prompt: '检查代码' },
                { id: 'report', needs: 'inspect', prompt: '报告' },
            ],
            result: 'report',
        }) as WorkflowConfigV1;

        expect(expanded.providers[0]).toMatchObject({
            id: 'default', implementation: 'anthropic', api_key_env: 'ANTHROPIC_API_KEY',
        });
        expect(expanded.agents[0]).toEqual({ id: 'default', connection: 'default' });
        expect(expanded.tasks[0]).toMatchObject({ id: 'inspect', agent: 'default', description: '检查代码', outputs: { result: 'text' } });
        expect(expanded.tasks[1]).toMatchObject({ id: 'report', depends_on: ['inspect'] });
        expect(expanded.result).toEqual({ task: 'report', output: 'result' });
        // 展开后的完整配置能通过校验。
        expect(validateWorkflow(expanded, false).name).toBe('x');
    });

    it('rejects an unknown provider without base_url', () => {
        expect(() => expandWorkflow({ model: 'foo/bar', env: { api_key: 'K' } })).toThrow('base_url');
    });

    it('rejects model shorthand without an api key env', () => {
        expect(() => expandWorkflow({ model: 'anthropic/claude' })).toThrow('api_key');
    });
});
