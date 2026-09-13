// @file: apps/cli/tests/crash-matrix.test.ts
// Program-level crashpoints: kill the real CLI process at a chosen point of the
// flow lifecycle (effect in flight, reply delivered but uncommitted, mid-loop,
// budget exhausted) and require `resume` to converge without duplicating work.
//
// The storage-level SIGKILL matrix lives in
// packages/vfsdriver-localfs/tests/20-kernel-ipc.test.ts; this file covers the
// Flow/program layer: first step, loop iteration, route-free single node,
// terminal commit and budget accounting.
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { createServer, type ServerResponse } from 'node:http';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { SeqFileKernelStore } from '@itookit/durable-kernel';
import { CliStorageResolver, cliStorage, openProfileInspectionFs } from '../src/runtime';
import { listenForTest } from './listen';
import { exportCommand, resumeCommand } from '../src/commands';

// A killed CLI cannot release its Session lease or the Run's scheduler lease; shorten
// both TTLs so recovery can take over within the test instead of waiting the
// production 60s / 30s.
process.env.MINDOS_SESSION_LEASE_TTL_MS = '1500';
process.env.MINDOS_SCHEDULER_LEASE_TTL_MS = '1500';

const CLI = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
const CLI_CWD = fileURLToPath(new URL('../', import.meta.url));
const children: ChildProcess[] = [];
const servers: ReturnType<typeof createServer>[] = [];
const roots: string[] = [];

afterEach(async () => {
    for (const child of children.splice(0)) if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve()))));
    for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
    delete process.env.MINDOS_TEST_API_KEY;
});

/** Wait for the killed owner's Session and scheduler leases to expire before resuming. */
const settleLease = () => new Promise(resolve => setTimeout(resolve, 1800));

type KillPoint = { request: number; when: 'before-reply' | 'after-reply' };

/** Mock model server that SIGKILLs the CLI at the configured request. */
function crashingServer(killPoint: KillPoint, replies: (prompt: string, index: number) => string) {
    let child: ChildProcess | undefined;
    const prompts: string[] = [];
    const server = createServer((request, response) => {
        let body = '';
        request.on('data', chunk => { body += chunk; });
        request.on('end', () => {
            const index = prompts.length + 1;
            const prompt = firstUser(body);
            prompts.push(prompt);
            if (index === killPoint.request && killPoint.when === 'before-reply') {
                child?.kill('SIGKILL');
                response.destroy();
                return;
            }
            reply(response, replies(prompt, index));
            if (index === killPoint.request && killPoint.when === 'after-reply') child?.kill('SIGKILL');
        });
    });
    return { server, prompts, attach: (value: ChildProcess) => { child = value; } };
}

function firstUser(body: string): string {
    const parsed = JSON.parse(body) as { messages?: Array<{ role: string; content: unknown }> };
    const message = parsed.messages?.find(item => item.role === 'user');
    return typeof message?.content === 'string' ? message.content : JSON.stringify(message?.content ?? '');
}

function reply(response: ServerResponse, content: string): void {
    const chunk = (text: string, finish: string | null) => JSON.stringify({
        id: 'mock', object: 'chat.completion.chunk', created: 1, model: 'mock-model',
        choices: [{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: finish }],
        usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 },
    });
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.write(`data: ${chunk(content, null)}\n\n`);
    response.write(`data: ${chunk('', 'stop')}\n\n`);
    response.end('data: [DONE]\n\n');
}

function startRun(configPath: string, stateDir: string, crash?: { tool: string; phase: string }): ChildProcess {
    const entry = crash ? fileURLToPath(new URL('./fixtures/memory-crash.ts', import.meta.url)) : CLI;
    const child = spawn(process.execPath, ['--import', 'tsx', entry, 'run', '-f', configPath,
        '--state-dir', stateDir, '--headless', '--json'], { cwd: CLI_CWD, stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, ...(crash ? { MINDOS_TEST_MEMORY_CRASH_TOOL: crash.tool, MINDOS_TEST_MEMORY_CRASH_PHASE: crash.phase } : {}) } });
    children.push(child);
    return child;
}

async function workspace(prefix: string): Promise<string> {
    const root = await mkdtemp(path.join(tmpdir(), prefix));
    roots.push(root);
    return root;
}

async function latestRun(workspaceDir: string): Promise<string> {
    return (await readdir(path.join(workspaceDir, '.mindos', 'runs')))[0];
}

async function manifest(workspaceDir: string, runId: string): Promise<{
    status: string;
    rootTaskId?: string;
    nodeTaskIds?: Record<string, string>;
    blockedEffects?: Array<{ taskId: string; effectId: string }>;
}> {
    return JSON.parse(await readFile(path.join(workspaceDir, '.mindos', 'runs', runId, 'run.json'), 'utf8'));
}

// A killed process cannot prove whether its in-flight LLM call reached the provider, so
// the kernel reconciles the lost Effect to `indeterminate`. The Run must block on that
// decision instead of pretending the call failed; `--retry-indeterminate` is the host's
// authorization to replay the same logical Effect.
async function resumeWithReplay(runId: string, stateDir: string): Promise<number> {
    expect(await resumeCommand(runId, { stateDir, headless: true, json: true })).toBe(3);
    return resumeCommand(runId, { stateDir, headless: true, json: true, retryIndeterminate: true });
}

async function storedMemory(stateDir: string, runId: string) {
    const inspection = await openProfileInspectionFs(stateDir);
    try {
        const resolver = new CliStorageResolver(inspection.fs), binding = await resolver.resolve(cliStorage(runId));
        const store = new SeqFileKernelStore(binding, reference => resolver.resolve(reference));
        const tasks = await store.listTasks(binding);
        const effects = tasks.flatMap(task => Object.values(task.effects)).filter(effect => effect.request.kind === 'tool.call');
        return { memory: await store.getShared(binding, 'memory.entries.["agent","project"]'), effects };
    } finally { await inspection.dispose(); }
}

function memoryReply(response: ServerResponse, tool?: string): void {
    const args = { scope: 'project', entryId: 'note', ...(tool === 'memory_write' ? { content: 'durable memory' } : {}) };
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ id: 'mock', object: 'chat.completion', created: 1, model: 'mock-model',
        choices: [{ index: 0, message: tool ? { role: 'assistant', content: '', tool_calls: [{ id: tool, type: 'function',
            function: { name: tool, arguments: JSON.stringify(args) } }] } : { role: 'assistant', content: 'done' },
        finish_reason: tool ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }));
}

it.each([
    { tool: 'memory_write', phase: 'before' }, { tool: 'memory_write', phase: 'after' },
    { tool: 'memory_remove', phase: 'before' }, { tool: 'memory_remove', phase: 'after' },
])('blocks an unreceipted $tool killed $phase its mutation until explicit replay', async crash => {
    let requests = 0;
    const server = createServer((request, response) => {
        request.resume(); request.on('end', () => {
            requests++;
            memoryReply(response, requests === 1 ? 'memory_write'
                : crash.tool === 'memory_remove' && requests === 2 ? 'memory_remove' : undefined);
        });
    });
    servers.push(server);
    const port = await listenForTest(server), root = await workspace('mindos-memory-unreceipted-');
    const stateDir = path.join(root, '.mindos'), configPath = path.join(root, 'mindos.yml');
    const config = parse(singleNodeConfig(port));
    Object.assign(config.agents[0], { tools: ['memory_write', 'memory_remove'], stream: false, approval: 'none',
        memory_policy: { namespace_id: 'agent', read_scopes: ['project'], write_scopes: ['project'] } });
    process.env.MINDOS_TEST_API_KEY = 'test-secret-value';
    await writeFile(configPath, stringify(config));
    const child = startRun(configPath, stateDir, crash);
    let stderr = ''; child.stderr?.on('data', data => { stderr += data; });
    expect(await once(child, 'exit'), stderr).toEqual([null, 'SIGKILL']);
    const runId = await latestRun(root);
    await settleLease();
    const killed = await storedMemory(stateDir, runId);
    const present = crash.tool === 'memory_write' ? crash.phase === 'after' : crash.phase === 'before';
    expect(killed.memory?.value ?? []).toEqual(present ? [expect.objectContaining({ content: 'durable memory' })] : []);
    expect(killed.effects.filter(effect => effect.status === 'leased')).toHaveLength(1);
    const callsAtCrash = requests;
    expect(await resumeCommand(runId, { stateDir, headless: true, json: true })).toBe(3);
    expect(requests).toBe(callsAtCrash);
    const blocked = await storedMemory(stateDir, runId);
    expect(blocked.memory).toEqual(killed.memory);
    const uncertain = blocked.effects.filter(effect => effect.status === 'indeterminate');
    expect(uncertain).toHaveLength(1);
    expect(uncertain[0].error?.code).toBe('TOOL_INDETERMINATE');
    expect(await resumeCommand(runId, { stateDir, headless: true, json: true, retryIndeterminate: true })).toBe(0);
    expect(requests).toBe(callsAtCrash + 1);
    const recovered = await storedMemory(stateDir, runId);
    expect(recovered.memory?.value).toEqual(crash.tool === 'memory_write'
        ? [expect.objectContaining({ content: 'durable memory' })] : []);
    expect(recovered.effects.every(effect => effect.status === 'succeeded')).toBe(true);
    expect(await manifest(root, runId)).toMatchObject({ status: 'succeeded' });
}, 40_000);

it.each(['write', 'remove'] as const)('preserves a committed memory %s across CLI SIGKILL and resume without replay', async operation => {
    const requests: any[] = [];
    const killRequest = operation === 'write' ? 2 : 3;
    let child: ChildProcess;
    const server = createServer((request, response) => {
        let body = ''; request.on('data', chunk => { body += chunk; });
        request.on('end', () => {
            requests.push(JSON.parse(body));
            if (requests.length === killRequest) { child.kill('SIGKILL'); response.destroy(); return; }
            memoryReply(response, requests.length === 1 ? 'memory_write'
                : operation === 'remove' && requests.length === 2 ? 'memory_remove' : undefined);
        });
    });
    servers.push(server);
    const port = await listenForTest(server), root = await workspace('mindos-crash-memory-');
    const stateDir = path.join(root, '.mindos'), configPath = path.join(root, 'mindos.yml');
    const config = parse(singleNodeConfig(port));
    Object.assign(config.agents[0], { tools: ['memory_write', 'memory_remove'], stream: false, approval: 'none',
        memory_policy: { namespace_id: 'agent', read_scopes: ['project'], write_scopes: ['project'] } });
    process.env.MINDOS_TEST_API_KEY = 'test-secret-value';
    await writeFile(configPath, stringify(config));
    child = startRun(configPath, stateDir);
    const [code, signal] = await once(child, 'exit');
    expect([code, signal]).toEqual([null, 'SIGKILL']);
    const runId = await latestRun(root);
    await settleLease();
    const committed = await storedMemory(stateDir, runId);
    expect(committed.memory?.value).toEqual(operation === 'write'
        ? [expect.objectContaining({ entryId: 'note', content: 'durable memory' })] : []);
    expect(committed.effects).toHaveLength(killRequest - 1);
    for (const effect of committed.effects) expect(effect).toMatchObject({ status: 'succeeded', attemptCount: 1 });
    const toolResults = requests.at(-1).messages.filter((message: any) => message.role === 'tool');
    expect(toolResults).toHaveLength(killRequest - 1);
    for (const result of toolResults) expect(result.content).toContain('success');
    expect(await resumeCommand(runId, { stateDir, headless: true, json: true })).toBe(3);
    expect(requests).toHaveLength(killRequest);
    expect(await storedMemory(stateDir, runId)).toEqual(committed);
    expect(await resumeCommand(runId, { stateDir, headless: true, json: true, retryIndeterminate: true })).toBe(0);
    expect(requests).toHaveLength(killRequest + 1);
    // Compare the entire versioned record: an unconditional duplicate write would change it.
    expect(await storedMemory(stateDir, runId)).toEqual(committed);
    expect(await manifest(root, runId)).toMatchObject({ status: 'succeeded' });
}, 40_000);

it('recovers a run killed while the first Effect is in flight', async () => {
    const crash = crashingServer({ request: 1, when: 'before-reply' }, () => 'done');
    const port = await listenForTest(crash.server);
    servers.push(crash.server);

    const root = await workspace('mindos-crash-effect-');
    const stateDir = path.join(root, '.mindos');
    const configPath = path.join(root, 'mindos.yml');
    process.env.MINDOS_TEST_API_KEY = 'test-secret-value';
    await writeFile(configPath, singleNodeConfig(port), 'utf8');

    const child = startRun(configPath, stateDir);
    crash.attach(child);
    const [code, signal] = await once(child, 'exit');
    expect(signal).toBe('SIGKILL');
    expect(code).toBeNull();

    const runId = await latestRun(root);
    const killed = await manifest(root, runId);
    expect(killed.status).not.toBe('succeeded');
    // A non-interactive Run never reaches the monitor, so the killed manifest has no
    // nodeTaskIds; `export` must still find the node Tasks through the Session.
    expect(killed.nodeTaskIds).toEqual({});

    await settleLease();
    // Export holds a Session lease itself, so it also waits for the killed owner.
    const exportPath = path.join(root, 'crash-export.json');
    expect(await exportCommand(runId, { stateDir, headless: true, json: true, out: exportPath })).toBe(0);
    const exported = JSON.parse(await readFile(exportPath, 'utf8')) as {
        nodes: Array<{ nodeId: string; taskId: string; transcript?: unknown; error?: string }>;
    };
    expect(exported.nodes.map(node => node.nodeId)).toEqual(['finish']);
    expect(exported.nodes[0]?.transcript ?? exported.nodes[0]?.error).toBeTruthy();

    // The Run root is persisted before the first node runs, so a crash at any later
    // point stays resumable instead of restarting the graph.
    expect(await resumeCommand(runId, { stateDir, headless: true, json: true })).toBe(3);
    const waiting = await manifest(root, runId);
    expect(waiting.rootTaskId).toBeTruthy();
    expect(waiting.blockedEffects?.length).toBeGreaterThan(0);

    expect(await resumeCommand(runId, { stateDir, headless: true, json: true, retryIndeterminate: true })).toBe(0);
    const final = await manifest(root, runId);
    expect(final).toMatchObject({ status: 'succeeded' });
    expect(final.blockedEffects).toBeUndefined();
    expect(await readFile(path.join(stateDir, 'runs', runId, 'result.txt'), 'utf8')).toBe('done');
    expect(crash.prompts.length).toBeGreaterThanOrEqual(2);
}, 40_000);

it('reconciles a run killed after the reply was delivered but before it committed', async () => {
    const crash = crashingServer({ request: 1, when: 'after-reply' }, () => 'done');
    const port = await listenForTest(crash.server);
    servers.push(crash.server);

    const root = await workspace('mindos-crash-commit-');
    const stateDir = path.join(root, '.mindos');
    const configPath = path.join(root, 'mindos.yml');
    process.env.MINDOS_TEST_API_KEY = 'test-secret-value';
    await writeFile(configPath, singleNodeConfig(port), 'utf8');

    const child = startRun(configPath, stateDir);
    crash.attach(child);
    await once(child, 'exit');
    const runId = await latestRun(root);
    expect((await manifest(root, runId)).status).not.toBe('succeeded');

    await settleLease();
    expect(await resumeWithReplay(runId, stateDir)).toBe(0);
    expect(await manifest(root, runId)).toMatchObject({ status: 'succeeded' });
    expect(await readFile(path.join(stateDir, 'runs', runId, 'result.txt'), 'utf8')).toBe('done');
}, 40_000);

it('continues a loop from the last committed iteration after a kill', async () => {
    const crash = crashingServer({ request: 3, when: 'after-reply' },
        (prompt, index) => prompt.includes('循环入口') ? `entry-${index}` : `body-${index}`);
    const port = await listenForTest(crash.server);
    servers.push(crash.server);

    const root = await workspace('mindos-crash-loop-');
    const stateDir = path.join(root, '.mindos');
    const configPath = path.join(root, 'mindos.yml');
    process.env.MINDOS_TEST_API_KEY = 'test-secret-value';
    await writeFile(configPath, loopConfig(port), 'utf8');

    const child = startRun(configPath, stateDir);
    crash.attach(child);
    await once(child, 'exit');
    const runId = await latestRun(root);
    expect(crash.prompts.length).toBeGreaterThanOrEqual(2);

    await settleLease();
    expect(await resumeWithReplay(runId, stateDir)).toBe(0);
    expect(await manifest(root, runId)).toMatchObject({ status: 'succeeded' });
    // max_iterations=3: the loop stops after three committed iterations. The iteration
    // in flight at the kill is replayed once, so the entry node is called at most four
    // times while the body node — never in flight — is called exactly three times.
    const entryCalls = crash.prompts.filter(prompt => prompt.includes('循环入口')).length;
    const bodyCalls = crash.prompts.filter(prompt => prompt.includes('循环体')).length;
    expect(entryCalls).toBeLessThanOrEqual(4);
    expect(bodyCalls).toBe(3);
    // The result is the last body call's reply, proving the resumed Run continued the
    // loop instead of restarting it from iteration one.
    const lastBodyCall = crash.prompts.reduce((last, prompt, index) =>
        prompt.includes('循环体') ? index : last, -1);
    expect(await readFile(path.join(stateDir, 'runs', runId, 'result.txt'), 'utf8'))
        .toBe(`body-${lastBodyCall + 1}`);
}, 60_000);

it('preserves budget accounting across a crash and resume', async () => {
    const crash = crashingServer({ request: 2, when: 'after-reply' },
        (prompt, index) => prompt.includes('循环入口') ? `entry-${index}` : `body-${index}`);
    const port = await listenForTest(crash.server);
    servers.push(crash.server);

    const root = await workspace('mindos-crash-budget-');
    const stateDir = path.join(root, '.mindos');
    const configPath = path.join(root, 'mindos.yml');
    process.env.MINDOS_TEST_API_KEY = 'test-secret-value';
    // Each reply reports 3 tokens; a 9-token budget on the entry node allows three
    // iterations. A resumed run must not restart the counter.
    await writeFile(configPath, loopConfig(port, { budget: 9 }), 'utf8');

    const child = startRun(configPath, stateDir);
    crash.attach(child);
    await once(child, 'exit');
    const runId = await latestRun(root);

    await settleLease();
    const code = await resumeWithReplay(runId, stateDir);
    const final = await manifest(root, runId);
    expect(['succeeded', 'failed']).toContain(final.status);
    expect(code === 0 || code === 1).toBe(true);
    expect(crash.prompts.filter(prompt => prompt.includes('循环入口')).length).toBeLessThanOrEqual(4);
}, 60_000);

// ── Config builders ─────────────────────────────────────────────────────────

function header(port: number, name: string): string {
    return `version: 1
name: ${name}
goal: Crash matrix
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
`;
}

function singleNodeConfig(port: number): string {
    return `${header(port, 'single')}tasks:
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

function loopConfig(port: number, options: { budget?: number } = {}): string {
    return `${header(port, 'loop')}tasks:
  - id: entry
    agent: worker
    description: 循环入口
    max_iterations: 3
${options.budget === undefined ? '' : `    budget:
      tokens: ${options.budget}
`}    outputs:
      result: text
  - id: body
    agent: worker
    description: 循环体
    depends_on: [entry]
    outputs:
      result: text
  - id: router
    route:
      rules:
        # The mock always answers, so the body output always exists and the back edge
        # keeps looping until max_iterations stops the entry node.
        - when:
            exists: true
          then: entry
      default: exit
    depends_on: [body]
    inputs:
      input: \${tasks.body.outputs.result}
  - id: exit
    agent: worker
    description: 退出循环
    outputs:
      result: text
result:
  task: body
  output: result
sandbox:
  mode: native
`;
}
