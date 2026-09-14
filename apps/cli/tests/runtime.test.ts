import { describe, expect, it } from 'vitest';
import { compileDag } from '../src/runtime';
import { compileRunDefinition } from '../src/run-definition';
import type { CompiledWorkflow } from '../src/types';

describe('compileDag', () => {
    it('maps explicit task outputs to deterministic DAG edges', () => {
        const workflow: CompiledWorkflow = {
            workspaceRoot: '/work', stateDir: '/work/.mindos',
            config: {
                version: 1, name: 'test', goal: 'goal',
                providers: [{
                    id: 'p', implementation: 'openai-compatible', base_url: 'http://localhost',
                    api_key_env: 'KEY', models: [{ id: 'm' }],
                }],
                connections: [{ id: 'c', provider: 'p', tiers: { standard: 'm' } }],
                agents: [{ id: 'a', connection: 'c', tools: ['file_read', 'bash', 'human_input'] }],
                tasks: [
                    { id: 'one', agent: 'a', description: 'one', outputs: { report: 'text' } },
                    {
                        id: 'two', agent: 'a', description: 'two',
                        inputs: { source: '${tasks.one.outputs.report}' }, outputs: { result: 'text' },
                        workspace_access: 'write', retry: { max_attempts: 3, backoff_ms: 10 },
                    },
                ],
                result: { task: 'two', output: 'result' },
            },
        };
        const dag = compileDag(workflow);
        expect(dag.edges).toEqual([{
            id: 'one:report->two:source', from: 'one', to: 'two', output: 'report', input: 'source',
        }]);
        expect(dag.nodes[0].capabilities).toEqual(['Read', 'AskUserQuestion', 'RequestWorkspaceAccess']);
        expect(dag.nodes[1].capabilities).toEqual(['Read', 'Bash', 'AskUserQuestion', 'RequestWorkspaceAccess']);
        expect(dag.nodes[1].retry).toEqual({ maxAttempts: 3, backoffMs: 10 });
    });
});

describe('compileRunDefinition', () => {
    it('wraps the compiled graph with environment and policy', () => {
        const workflow: CompiledWorkflow = {
            workspaceRoot: '/work', stateDir: '/work/.mindos',
            config: {
                version: 1, name: 'test', goal: 'goal',
                providers: [{
                    id: 'p', implementation: 'openai-compatible', base_url: 'http://localhost',
                    api_key_env: 'KEY', models: [{ id: 'm' }],
                }],
                connections: [{ id: 'c', provider: 'p', tiers: { standard: 'm' } }],
                agents: [{ id: 'a', connection: 'c', tools: ['file_read'] }],
                tasks: [{ id: 'one', agent: 'a', description: 'one', outputs: { result: 'text' } }],
                result: { task: 'one', output: 'result' },
            },
        };
        const definition = compileRunDefinition(workflow, 'digest');
        expect(definition).toMatchObject({
            id: 'test', source: 'yaml', digest: 'digest',
            environment: { providers: [{ id: 'p', baseUrl: 'http://localhost' }], connections: [{ id: 'c' }] },
            policy: { result: { task: 'one', output: 'result' }, workspaceRoot: '/work' },
        });
        expect(definition.graph.nodes).toHaveLength(1);
    });
});

it('compiles delegation with the selected agent and an intersection of parent and child tools', () => {
    const workflow = { workspaceRoot: '/work', config: { goal: 'goal',
        connections: [{ id: 'c', tiers: { standard: 'm' } }], agents: [
            { id: 'parent', connection: 'c', tools: ['file_read'] },
            { id: 'child', connection: 'c', tools: ['file_read', 'bash'], system_prompt: 'child persona' },
        ], tasks: [{ id: 'one', agent: 'parent', workspace_access: 'write',
            delegation: { agent: 'child', instruction: 'Handle one payload', max_tasks: 2, max_concurrency: 1 } }],
    } } as CompiledWorkflow;
    const config = compileDag(workflow).nodes[0].config as any;
    expect(config.delegation.resolvedTemplate.capabilities).toEqual(['Read', 'RequestWorkspaceAccess']);
    expect(config.delegation.resolvedTemplate.config.messages[0].content).toContain('child persona');
    expect(config.delegation.resolvedTemplate.config.messages[1].content).toBe('Handle one payload');
    expect(config.delegation.fanout).toMatchObject({ maxTasks: 2, maxConcurrency: 1, maxDepth: 1 });
    expect(config.delegation.resolvedTemplate.config.delegation).toBeUndefined();
});
