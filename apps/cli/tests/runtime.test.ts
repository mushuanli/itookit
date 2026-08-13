import { describe, expect, it } from 'vitest';
import { compileDag } from '../src/runtime';
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
