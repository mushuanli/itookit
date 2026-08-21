import { randomUUID } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import type { EventEnvelope, ExitRecord, JsonValue, TaskHandle } from '@itookit/harness';
import { loadWorkflow, parseDuration } from './config';
import { compileDag, createCliRuntime, cliStorage, type CliRuntime } from './runtime';
import { RunStore, selectFinalResult } from './run-store';
import { sandboxDoctor } from './shell';
import type { CompiledWorkflow, PendingInteraction, RunManifest } from './types';

export interface CommandOptions {
    file?: string;
    stateDir?: string;
    headless?: boolean;
    json?: boolean;
    sandbox?: 'native' | 'oci';
    follow?: boolean;
    approve?: boolean;
    deny?: boolean;
    value?: string;
    offline?: boolean;
}

interface InterruptWatcher {
    signal?: NodeJS.Signals;
    dispose(): void;
}

const STALL_WARN_MS = 60_000;

export async function validateCommand(options: CommandOptions): Promise<number> {
    // --offline skips the environment check so configs can be validated without API keys set.
    const loaded = await loadWorkflow(options.file ?? 'mindos.yml', !options.offline);
    print(options, { valid: true, name: loaded.workflow.config.name, tasks: loaded.workflow.config.tasks.length });
    return 0;
}

/** 打印编译后的 DAG 结构（节点 + 边），不执行 —— 等价于 run --dry-run 的诉求。 */
export async function graphCommand(options: CommandOptions): Promise<number> {
    const loaded = await loadWorkflow(options.file ?? 'mindos.yml', !options.offline);
    const dag = compileDag(loaded.workflow);
    print(options, {
        name: loaded.workflow.config.name,
        nodes: dag.nodes.map(node => ({ id: node.id, plugin: node.plugin, name: node.name })),
        edges: dag.edges.map(edge => ({
            from: edge.from, to: edge.to, output: edge.output, input: edge.input,
            ...(edge.onFailure ? { onFailure: edge.onFailure } : {}),
        })),
    });
    return 0;
}

export async function runCommand(options: CommandOptions): Promise<number> {
    const loaded = await loadWorkflow(options.file ?? 'mindos.yml');
    return runLoaded(loaded, options);
}

type LoadedWorkflow = Awaited<ReturnType<typeof loadWorkflow>>;

async function runLoaded(loaded: LoadedWorkflow, options: CommandOptions): Promise<number> {
    if (options.sandbox) loaded.workflow.config.sandbox = { ...loaded.workflow.config.sandbox, mode: options.sandbox };
    const id = createRunId();
    const store = new RunStore(loaded.workflow.stateDir);
    const now = Date.now();
    const manifest: RunManifest = {
        version: 1,
        id,
        name: loaded.workflow.config.name,
        goal: loaded.workflow.config.goal,
        workspaceRoot: loaded.workflow.workspaceRoot,
        configPath: store.configSnapshot(id),
        configHash: loaded.hash,
        status: 'created',
        sessionId: id,
        nodeTaskIds: {},
        taskStatuses: {},
        taskStartedAt: {},
        pendingInteractions: [],
        grants: [],
        lastEventSequence: 0,
        createdAt: now,
        updatedAt: now,
    };
    await store.create(manifest, loaded.source);
    let runtime: CliRuntime | undefined;
    try {
        runtime = await runtimeFor(loaded.workflow, manifest, store);
        await runtime.kernel.createSession({ id, storage: cliStorage(id) });
        const flow = await runtime.executor.submit(id, compileDag(loaded.workflow));
        manifest.rootTaskId = flow.root.id;
        manifest.nodeTaskIds = Object.fromEntries([...flow.nodes].map(([nodeId, handle]) => [nodeId, handle.id]));
        manifest.status = 'running';
        await store.save(manifest);
        print(options, { type: 'run.started', runId: id, tasks: Object.keys(manifest.nodeTaskIds).length });
        return await monitor(loaded.workflow, manifest, store, runtime, options);
    } catch (error) {
        manifest.status = 'failed';
        manifest.error = errorMessage(error);
        manifest.completedAt = Date.now();
        await store.save(manifest);
        printError(options, manifest.error);
        return 1;
    } finally {
        await runtime?.dispose();
    }
}

/** 用某个 run 的配置快照重跑整个 DAG（新 run id）。 */
export async function rerunCommand(runId: string, options: CommandOptions): Promise<number> {
    const store = new RunStore(resolveStateDir(options));
    const manifest = await store.load(runId);
    const loaded = await loadWorkflow(store.configSnapshot(runId), false);
    loaded.workflow.workspaceRoot = manifest.workspaceRoot;
    loaded.workflow.stateDir = store.stateDir;
    return runLoaded(loaded, options);
}

/** 把某个 run 的配置快照复制为可编辑文件，供 fork 后修改再 run。 */
export async function forkCommand(runId: string, options: CommandOptions): Promise<number> {
    const store = new RunStore(resolveStateDir(options));
    await store.load(runId);
    const source = await readFile(store.configSnapshot(runId), 'utf8');
    const target = path.join(store.stateDir, 'forks', `${runId}.yml`);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, source, 'utf8');
    print(options, { type: 'run.forked', runId, configPath: target });
    return 0;
}

/** 导出某次运行的配置快照。保留 fork 作为兼容别名。 */
export const exportConfigCommand = forkCommand;

/** 展示 run 的节点级 checkpoint 视图（状态 + 产物路径）。 */
export async function checkpointsCommand(runId: string, options: CommandOptions): Promise<number> {
    const store = new RunStore(resolveStateDir(options));
    const manifest = await store.load(runId);
    const checkpoints = Object.entries(manifest.taskStatuses)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([nodeId, status]) => ({
            nodeId,
            status,
            startedAt: manifest.taskStartedAt?.[nodeId],
            ...(status === 'succeeded'
                ? { artifact: `artifacts/${nodeId.replace(/[^a-zA-Z0-9._-]/g, '_')}/result.json` }
                : {}),
        }));
    print(options, { runId, status: manifest.status, error: manifest.error, checkpoints });
    return 0;
}


/** 展示节点运行状态。保留 checkpoints 作为兼容别名；它不是可恢复的状态快照。 */
export const tasksCommand = checkpointsCommand;

export async function resumeCommand(runId: string, options: CommandOptions): Promise<number> {
    const store = new RunStore(resolveStateDir(options));
    const manifest = await store.load(runId);
    if (isTerminal(manifest.status)) {
        print(options, manifest);
        return manifest.status === 'succeeded' ? 0 : 1;
    }
    const loaded = await loadWorkflow(store.configSnapshot(runId));
    loaded.workflow.workspaceRoot = manifest.workspaceRoot;
    loaded.workflow.stateDir = store.stateDir;
    if (options.sandbox) loaded.workflow.config.sandbox = { ...loaded.workflow.config.sandbox, mode: options.sandbox };
    const runtime = await runtimeFor(loaded.workflow, manifest, store);
    try {
        manifest.status = 'running';
        await store.save(manifest);
        return await monitor(loaded.workflow, manifest, store, runtime, options);
    } finally {
        await runtime.dispose();
    }
}

export async function respondCommand(
    runId: string,
    requestId: string,
    options: CommandOptions,
): Promise<number> {
    const store = new RunStore(resolveStateDir(options));
    const manifest = await store.load(runId);
    const pending = manifest.pendingInteractions.find(item => item.interactionId === requestId);
    if (!pending) throw new Error(`Pending interaction not found: ${requestId}`);
    const loaded = await loadWorkflow(store.configSnapshot(runId));
    loaded.workflow.workspaceRoot = manifest.workspaceRoot;
    loaded.workflow.stateDir = store.stateDir;
    const runtime = await runtimeFor(loaded.workflow, manifest, store);
    try {
        await runtime.kernel.respondInteraction(manifest.sessionId, pending.taskId, {
            interactionId: requestId,
            value: resolveRespondValue(options),
        });
        manifest.pendingInteractions = manifest.pendingInteractions.filter(item => item !== pending);
        manifest.status = 'running';
        await store.save(manifest);
        print(options, { type: 'interaction.resolved', runId, requestId });
        return 0;
    } finally {
        await runtime.dispose();
    }
}

export async function deleteCommand(runId: string, options: CommandOptions): Promise<number> {
    const store = new RunStore(resolveStateDir(options));
    const manifest = await store.load(runId);
    if (!isTerminal(manifest.status)) {
        throw new Error(`Run ${runId} is still ${manifest.status}; cancel it before deleting`);
    }
    await store.delete(runId);
    print(options, { type: 'run.deleted', runId });
    return 0;
}

export async function cancelCommand(runId: string, options: CommandOptions): Promise<number> {
    const store = new RunStore(resolveStateDir(options));
    const manifest = await store.load(runId);
    if (isTerminal(manifest.status)) return 0;
    const loaded = await loadWorkflow(store.configSnapshot(runId));
    loaded.workflow.workspaceRoot = manifest.workspaceRoot;
    loaded.workflow.stateDir = store.stateDir;
    const runtime = await runtimeFor(loaded.workflow, manifest, store);
    try {
        for (const taskId of Object.values(manifest.nodeTaskIds)) {
            await (await runtime.kernel.openTask(taskId)).cancel('Cancelled by CLI').catch(() => {});
        }
        if (manifest.rootTaskId) await (await runtime.kernel.openTask(manifest.rootTaskId)).cancel('Cancelled by CLI').catch(() => {});
        manifest.status = 'cancelled';
        manifest.completedAt = Date.now();
        await store.save(manifest);
        print(options, { type: 'run.cancelled', runId });
        return 0;
    } finally {
        await runtime.dispose();
    }
}

export async function statusCommand(runId: string | undefined, options: CommandOptions): Promise<number> {
    const store = new RunStore(resolveStateDir(options));
    if (runId) print(options, await store.load(runId));
    else print(options, await store.list());
    return 0;
}

export async function logsCommand(runId: string, options: CommandOptions): Promise<number> {
    const store = new RunStore(resolveStateDir(options));
    let offset = 0;
    while (true) {
        const content = await readFile(store.eventsPath(runId), 'utf8').catch(() => '');
        if (content.length > offset) process.stdout.write(content.slice(offset));
        offset = content.length;
        if (!options.follow || isTerminal((await store.load(runId)).status)) return 0;
        await delay(500);
    }
}

export async function doctorCommand(options: CommandOptions): Promise<number> {
    const result = await sandboxDoctor();
    print(options, result);
    return result.available ? 0 : 1;
}

async function monitor(
    workflow: CompiledWorkflow,
    manifest: RunManifest,
    store: RunStore,
    runtime: CliRuntime,
    options: CommandOptions,
): Promise<number> {
    if (!manifest.rootTaskId) throw new Error('Run root task is missing');
    const root = await runtime.kernel.openTask(manifest.rootTaskId);
    const interruption = watchInterrupt();
    let lastSnapshot = '';
    let stallSince = Date.now();
    let stallWarned = false;
    try {
        while (true) {
            const result = await monitorIteration(workflow, manifest, store, runtime, options, root, interruption);
            if (result !== undefined) return result;
            const snapshot = progressSnapshot(manifest);
            if (snapshot === lastSnapshot) {
                if (!stallWarned && Date.now() - stallSince > STALL_WARN_MS) {
                    stallWarned = true;
                    printStallDiagnostic(manifest, options);
                }
            } else {
                lastSnapshot = snapshot;
                stallSince = Date.now();
                stallWarned = false;
            }
            await delay(150);
        }
    } finally {
        interruption.dispose();
    }
}

function progressSnapshot(manifest: RunManifest): string {
    return `${manifest.lastEventSequence}|${Object.entries(manifest.taskStatuses)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([id, status]) => `${id}:${status}`).join(',')}|${manifest.pendingInteractions.length}`;
}

function printStallDiagnostic(manifest: RunManifest, options: CommandOptions): void {
    const statuses = Object.entries(manifest.taskStatuses)
        .map(([id, status]) => `${id}:${status}`).join(' ') || '(none)';
    printError(options, `No run progress for ${STALL_WARN_MS / 1000}s. Task statuses: ${statuses}`);
}

async function monitorIteration(
    workflow: CompiledWorkflow,
    manifest: RunManifest,
    store: RunStore,
    runtime: CliRuntime,
    options: CommandOptions,
    root: TaskHandle,
    interruption: InterruptWatcher,
): Promise<number | undefined> {
    if (interruption.signal) return cancelInterrupted(manifest, store, root, interruption.signal, options);
    await collectEvents(manifest, store, runtime, options);
    await refreshTaskStatuses(workflow, manifest, runtime);
    const interaction = await processInteractions(manifest, store, runtime, options);
    if (interaction !== undefined) return interaction;
    const exit = await root.poll();
    if (exit) return finishRun(workflow, manifest, store, exit, options);
    if (workflow.maxDurationMs && Date.now() - manifest.createdAt > workflow.maxDurationMs) {
        return cancelExpiredRun(manifest, store, root);
    }
    await store.save(manifest);
    return undefined;
}

function watchInterrupt(): InterruptWatcher {
    const watcher: InterruptWatcher = { dispose };
    const interrupt = () => { watcher.signal = 'SIGINT'; };
    const terminate = () => { watcher.signal = 'SIGTERM'; };
    process.once('SIGINT', interrupt);
    process.once('SIGTERM', terminate);
    function dispose(): void {
        process.removeListener('SIGINT', interrupt);
        process.removeListener('SIGTERM', terminate);
    }
    return watcher;
}

async function cancelInterrupted(
    manifest: RunManifest,
    store: RunStore,
    root: TaskHandle,
    signal: NodeJS.Signals,
    options: CommandOptions,
): Promise<number> {
    await root.cancel(`Interrupted by ${signal}`);
    manifest.status = 'cancelled';
    manifest.error = `Interrupted by ${signal}`;
    manifest.completedAt = Date.now();
    await store.save(manifest);
    printError(options, manifest.error);
    return signal === 'SIGINT' ? 130 : 143;
}

async function cancelExpiredRun(manifest: RunManifest, store: RunStore, root: TaskHandle): Promise<number> {
    await root.cancel('Run duration exceeded');
    manifest.status = 'failed';
    manifest.error = 'Run duration exceeded';
    manifest.completedAt = Date.now();
    await store.save(manifest);
    return 1;
}

async function processInteractions(
    manifest: RunManifest,
    store: RunStore,
    runtime: CliRuntime,
    options: CommandOptions,
): Promise<number | undefined> {
    if (!manifest.pendingInteractions.length) return undefined;
    manifest.status = 'waiting';
    await store.save(manifest);
    // --json implies headless: never block on an interactive stdin prompt under a machine-readable
    // stream, or CI would hang. Surface the resume/respond commands instead.
    if (options.headless || options.json) {
        printInteractionHint(manifest, options);
        return 3;
    }
    await resolveInteractive(manifest, runtime, store);
    return undefined;
}

function printInteractionHint(manifest: RunManifest, options: CommandOptions): void {
    const requestIds = manifest.pendingInteractions.map(item => item.interactionId);
    const resume = `mindos resume ${manifest.id} --state-dir ${resolveStateDir(options)}`;
    if (options.json) {
        process.stderr.write(`${JSON.stringify({ type: 'run.waiting', runId: manifest.id, requestIds, resume })}\n`);
        return;
    }
    process.stderr.write(
        `等待人工输入 ${requestIds.join(', ')}。批准后继续：${resume}\n` +
        requestIds.map(id => `  mindos respond ${manifest.id} ${id} --approve\n`).join(''),
    );
}

async function collectEvents(
    manifest: RunManifest,
    store: RunStore,
    runtime: CliRuntime,
    options: CommandOptions,
): Promise<void> {
    const events = await runtime.kernel.eventList(manifest.sessionId, manifest.lastEventSequence);
    for (const event of events) {
        manifest.lastEventSequence = event.sequence;
        updateInteractionProjection(manifest, event);
        await store.appendEvent(manifest.id, event);
        renderEvent(manifest, event, options);
    }
}

function updateInteractionProjection(manifest: RunManifest, event: EventEnvelope): void {
    if (event.type === 'task.interaction.requested' && event.taskId) {
        const request = event.payload as Omit<PendingInteraction, 'taskId' | 'interactionId'> & { id?: string };
        if (!request.id || manifest.pendingInteractions.some(item => item.interactionId === request.id)) return;
        manifest.pendingInteractions.push({
            taskId: event.taskId,
            interactionId: request.id,
            kind: request.kind,
            prompt: request.prompt,
            payload: request.payload,
        });
    }
    if (event.type === 'task.interaction.resolved') {
        const id = (event.payload as { interactionId?: string })?.interactionId;
        manifest.pendingInteractions = manifest.pendingInteractions.filter(item => item.interactionId !== id);
    }
}

async function refreshTaskStatuses(
    workflow: CompiledWorkflow,
    manifest: RunManifest,
    runtime: CliRuntime,
): Promise<void> {
    for (const [nodeId, taskId] of Object.entries(manifest.nodeTaskIds)) {
        const task = (await runtime.kernel.inspectTask(taskId)).task;
        manifest.taskStatuses[nodeId] = task.status;
        if (task.attemptCount > 0) (manifest.taskStartedAt ??= {})[nodeId] ??= Date.now();
        await enforceTaskTimeout(workflow, manifest, runtime, nodeId, taskId, task.status);
    }
}

async function enforceTaskTimeout(
    workflow: CompiledWorkflow,
    manifest: RunManifest,
    runtime: CliRuntime,
    nodeId: string,
    taskId: string,
    status: string,
): Promise<void> {
    if (['succeeded', 'failed', 'cancelled', 'skipped'].includes(status)) return;
    const timeout = parseDuration(workflow.config.tasks.find(task => task.id === nodeId)?.timeout);
    const startedAt = manifest.taskStartedAt?.[nodeId];
    if (!timeout || !startedAt || Date.now() - startedAt <= timeout) return;
    await (await runtime.kernel.openTask(taskId)).cancel(`Task ${nodeId} duration exceeded`);
    manifest.taskStatuses[nodeId] = 'cancelled';
}

async function resolveInteractive(manifest: RunManifest, runtime: CliRuntime, store: RunStore): Promise<void> {
    const terminal = createInterface({ input: process.stdin, output: process.stdout });
    try {
        while (manifest.pendingInteractions.length) {
            const request = manifest.pendingInteractions[0];
            const detail = request.payload ? `\n${JSON.stringify(request.payload, null, 2)}` : '';
            const answer = await terminal.question(`${request.prompt}${detail}\n${request.kind === 'approval' ? '批准？[y/N] ' : '> '}`);
            const value = request.kind === 'approval' ? /^(y|yes)$/i.test(answer.trim()) : answer;
            await runtime.kernel.respondInteraction(manifest.sessionId, request.taskId, {
                interactionId: request.interactionId,
                value,
            });
            manifest.pendingInteractions.shift();
            manifest.status = 'running';
            await store.save(manifest);
        }
    } finally {
        terminal.close();
    }
}

async function finishRun(
    workflow: CompiledWorkflow,
    manifest: RunManifest,
    store: RunStore,
    exit: ExitRecord<unknown>,
    options: CommandOptions,
): Promise<number> {
    manifest.completedAt = Date.now();
    if (exit.status !== 'succeeded') {
        manifest.status = exit.status === 'cancelled' ? 'cancelled' : 'failed';
        manifest.error = exit.error?.message ?? `Run ${exit.status}`;
        await store.save(manifest);
        printError(options, manifest.error);
        return 1;
    }
    await store.writeArtifacts(manifest.id, exit.output);
    const selected = selectFinalResult(
        exit.output,
        workflow.config.result.task,
        workflow.config.result.output,
    );
    // result 任务失败或无输出（例如被 on_failure 容忍的失败仍指向该任务）→ run 失败。
    if (selected === undefined || selected === null) {
        manifest.status = 'failed';
        manifest.error = `Result task ${workflow.config.result.task} produced no output`;
        await store.save(manifest);
        printError(options, manifest.error);
        return 1;
    }
    manifest.resultPath = await store.writeResult(manifest.id, selected);
    manifest.status = 'succeeded';
    await store.save(manifest);
    print(options, { type: 'run.succeeded', runId: manifest.id, result: selected });
    return 0;
}

async function runtimeFor(workflow: CompiledWorkflow, manifest: RunManifest, store: RunStore): Promise<CliRuntime> {
    await stat(workflow.workspaceRoot);
    return createCliRuntime(workflow, manifest, async grants => {
        manifest.grants = grants;
        await store.save(manifest);
    });
}

function renderEvent(manifest: RunManifest, event: EventEnvelope, options: CommandOptions): void {
    if (options.json || options.headless) {
        process.stdout.write(`${JSON.stringify({ version: 1, runId: manifest.id, ...event })}\n`);
        return;
    }
    if (event.type === 'stream:content') {
        const payload = event.payload as { delta?: string } | string;
        process.stdout.write(typeof payload === 'string' ? payload : payload?.delta ?? '');
        return;
    }
    if (/^(task\.(created|succeeded|failed)|tool:|budget:)/.test(event.type)) {
        process.stdout.write(`[${event.sequence}] ${event.type}\n`);
    }
}

export function resolveRespondValue(options: CommandOptions): JsonValue {
    const modes = [options.approve, options.deny, options.value !== undefined].filter(Boolean);
    if (modes.length !== 1) {
        throw new Error('respond requires exactly one of --approve, --deny, or --value');
    }
    if (options.approve) return true;
    if (options.deny) return false;
    try { return JSON.parse(options.value!) as JsonValue; } catch { return options.value!; }
}

function resolveStateDir(options: CommandOptions): string {
    return path.resolve(options.stateDir ?? '.mindos');
}

function createRunId(): string {
    const timestamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
    return `${timestamp}-${randomUUID().slice(0, 8)}`;
}

function print(options: CommandOptions, value: unknown): void {
    if (options.json || options.headless) process.stdout.write(`${JSON.stringify(value)}\n`);
    else process.stdout.write(`${typeof value === 'string' ? value : JSON.stringify(value, null, 2)}\n`);
}

function printError(options: CommandOptions, message: string): void {
    if (options.json || options.headless) process.stderr.write(`${JSON.stringify({ type: 'error', message })}\n`);
    else process.stderr.write(`错误：${message}\n`);
}

function isTerminal(status: RunManifest['status']): boolean {
    return status === 'succeeded' || status === 'failed' || status === 'cancelled';
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}
