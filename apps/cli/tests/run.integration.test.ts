import { createServer } from 'node:http';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runCommand } from '../src/commands';

const servers: ReturnType<typeof createServer>[] = [];

afterEach(async () => {
    await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve()))));
    delete process.env.MINDOS_TEST_API_KEY;
});

describe('CLI run', () => {
    it('runs a durable DAG and persists its final result', async () => {
        const server = createServer((_request, response) => {
            response.writeHead(200, { 'content-type': 'text/event-stream' });
            response.write(`data: ${JSON.stringify(chunk('done', null))}\n\n`);
            response.write(`data: ${JSON.stringify(chunk('', 'stop', { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 }))}\n\n`);
            response.end('data: [DONE]\n\n');
        });
        servers.push(server);
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('Mock server did not bind');

        const workspace = await mkdtemp(path.join(tmpdir(), 'mindos-run-'));
        const configPath = path.join(workspace, 'mindos.yml');
        process.env.MINDOS_TEST_API_KEY = 'test-secret-value';
        await writeFile(configPath, config(address.port), 'utf8');
        const code = await runCommand({ file: configPath, headless: true, json: true });
        expect(code).toBe(0);

        const runsDir = path.join(workspace, '.mindos', 'runs');
        const { readdir } = await import('node:fs/promises');
        const runIds = await readdir(runsDir);
        const manifest = JSON.parse(await readFile(path.join(runsDir, runIds[0], 'run.json'), 'utf8'));
        expect(manifest.status).toBe('succeeded');
        expect(await readFile(path.join(runsDir, runIds[0], 'result.txt'), 'utf8')).toBe('done');
        expect(await readFile(path.join(runsDir, runIds[0], 'config.snapshot.yml'), 'utf8'))
            .not.toContain('test-secret-value');
    }, 15_000);
});

function chunk(content: string, finishReason: string | null, usage?: Record<string, number>) {
    return {
        id: 'mock', object: 'chat.completion.chunk', created: 1, model: 'mock-model',
        choices: [{ index: 0, delta: { role: 'assistant', content }, finish_reason: finishReason }],
        usage,
    };
}

function config(port: number): string {
    return `version: 1
name: integration
goal: Finish
workspace:
  root: .
providers:
  - id: mock
    implementation: openai-compatible
    base_url: http://127.0.0.1:${port}
    default_path: /v1/chat/completions
    api_key_env: MINDOS_TEST_API_KEY
    models:
      - id: mock-model
connections:
  - id: default
    provider: mock
    tiers:
      standard: mock-model
agents:
  - id: worker
    connection: default
tasks:
  - id: finish
    agent: worker
    description: Return done
    outputs:
      result: text
result:
  task: finish
  output: result
sandbox:
  mode: native
`;
}
