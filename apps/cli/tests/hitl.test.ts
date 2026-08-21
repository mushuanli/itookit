import { createServer } from 'node:http';
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { respondCommand, resumeCommand, runCommand } from '../src/commands';

const servers: ReturnType<typeof createServer>[] = [];

afterEach(async () => {
    await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve()))));
    delete process.env.MINDOS_TEST_API_KEY;
});

describe('HITL run → respond → resume', () => {
    it('pauses for human input, then resumes after respond', async () => {
        const server = createServer((_request, response) => respondHitl(response));
        const port = await startServer(server);

        const workspace = await mkdtemp(path.join(tmpdir(), 'mindos-hitl-'));
        const configPath = path.join(workspace, 'mindos.yml');
        process.env.MINDOS_TEST_API_KEY = 'test-secret-value';
        await writeFile(configPath, hitlConfig(port), 'utf8');

        // 1) run 在 AskUserQuestion 处暂停（headless 返回退出码 3）。
        expect(await runCommand({ file: configPath, headless: true, json: true })).toBe(3);

        const stateDir = path.join(workspace, '.mindos');
        const runId = await latestRun(stateDir);
        const manifest = await readManifest(stateDir, runId);
        expect(manifest.status).toBe('waiting');
        const requestId = (manifest.pendingInteractions as Array<{ interactionId: string }>)[0].interactionId;

        // 2) respond 批准后，resume 继续执行到完成。
        expect(await respondCommand(runId, requestId, { stateDir, approve: true, json: true })).toBe(0);
        expect(await resumeCommand(runId, { stateDir, headless: true, json: true })).toBe(0);

        expect(await readManifest(stateDir, runId)).toMatchObject({ status: 'succeeded' });
        expect(await readFile(path.join(stateDir, 'runs', runId, 'result.txt'), 'utf8')).toBe('done');
    }, 20_000);
});

// ── Mock LLM server ──────────────────────────────────────────────────────────

function respondHitl(response: import('node:http').ServerResponse): void {
    // 第一次调用返回 AskUserQuestion tool_use；后续调用返回最终文本。
    if (hitlCalls++ === 0) {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({
            id: 'mock', object: 'chat.completion', created: 1, model: 'mock-model',
            choices: [{
                index: 0,
                message: {
                    role: 'assistant',
                    content: null,
                    tool_calls: [{
                        id: 'call_1', type: 'function',
                        function: {
                            name: 'AskUserQuestion',
                            arguments: JSON.stringify({
                                questions: [{
                                    question: '继续执行吗？',
                                    header: 'Continue',
                                    options: [
                                        { label: 'yes', description: '继续' },
                                        { label: 'no', description: '停止' },
                                    ],
                                }],
                            }),
                        },
                    }],
                },
                finish_reason: 'tool_calls',
            }],
            usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 },
        }));
        return;
    }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({
        id: 'mock', object: 'chat.completion', created: 1, model: 'mock-model',
        choices: [{ index: 0, message: { role: 'assistant', content: 'done' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 },
    }));
}

let hitlCalls = 0;

async function startServer(server: ReturnType<typeof createServer>): Promise<number> {
    servers.push(server);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Mock server did not bind');
    return address.port;
}

async function latestRun(stateDir: string): Promise<string> {
    const runIds = await readdir(path.join(stateDir, 'runs'));
    if (!runIds.length) throw new Error('No run directory found');
    return runIds[0];
}

async function readManifest(stateDir: string, runId: string): Promise<Record<string, unknown>> {
    return JSON.parse(await readFile(path.join(stateDir, 'runs', runId, 'run.json'), 'utf8'));
}

function hitlConfig(port: number): string {
    return `version: 1
name: hitl
goal: Ask then finish
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
    stream: false
    tools: [AskUserQuestion]
tasks:
  - id: ask
    agent: worker
    description: 询问后完成
    outputs:
      result: text
result:
  task: ask
  output: result
sandbox:
  mode: native
`;
}
