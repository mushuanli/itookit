import path from 'node:path';
import type { DagRunSpec, LLMConnection, LLMProvider, ToolDefinition } from '@itookit/common';
import { parse } from 'yaml';
import { SessionFileSkillSource, resolveSessionSkillContext } from '@itookit/kernel-adapters';
import { LLMDeviceDriver } from '@itookit/device-llm';
import { NodePtyDriver } from '@itookit/device-tty';
import {
    Kernel,
    type ResolvedStorageBinding,
    type SessionStorageResolver,
    type StorageBindingRef,
} from '@itookit/durable-kernel';
import {
    compileWorkflow,
    DurableFlowExecutor,
    type WorkflowTaskSpec,
} from '@itookit/llm-flow';
import {
    acquireSessionProcessContext,
    createKernelRuntime,
    createSessionAttachmentMounts,
    DirectoryMountService,
    SessionFilesService,
    SessionLeaseStore,
    syncSkillsToKernel,
    type HeadlessKernelRuntime,
} from '@itookit/app-core';
import { SessionRepository } from '@itookit/llm-session';
import { createVFS, MemoryBackend, type IFileSystem } from '@itookit/vfs-core';
import { createBashTool } from '@itookit/tools';
import { openLocalFSBackend } from '@itookit/vfsdriver-localfs';
import { taskOutputReference } from './config';
import { CliDirectorySourceProvider } from './directories';
import { createShell, OciTtyDriver } from './shell';
import type { AgentConfig, CompiledWorkflow, RunManifest, TaskConfig, WorkspaceGrant } from './types';
import { createWorkspaceAccessTool, WorkspaceGrantRegistry } from './workspace';
import { NodeSqliteSidecarDb } from './sqlite-sidecar';

const STORAGE_KIND = 'cli-run';
const TOOL_ALIASES: Record<string, string> = {
    file_read: 'Read', read: 'Read',
    file_write: 'Write', write: 'Write',
    file_edit: 'Edit', edit: 'Edit',
    glob_search: 'Glob', glob: 'Glob',
    grep_search: 'Grep', grep: 'Grep',
    bash: 'Bash', shell: 'Bash',
    human_input: 'AskUserQuestion',
    request_workspace_access: 'RequestWorkspaceAccess',
};

export interface CliRuntime {
    kernel: Kernel;
    executor: DurableFlowExecutor;
    grants: WorkspaceGrantRegistry;
    waitForCheckpoint(taskIds: string[]): Promise<void>;
    dispose(): Promise<void>;
}

class CliStorageResolver implements SessionStorageResolver {
    readonly kind = STORAGE_KIND;
    constructor(private readonly fs: IFileSystem) {}
    async resolve(reference: StorageBindingRef): Promise<ResolvedStorageBinding> {
        const locator = reference.locator as { runId?: unknown };
        if (reference.kind !== this.kind || typeof locator?.runId !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(locator.runId)) {
            throw new Error('CLI storage requires a valid runId');
        }
        return { fs: this.fs, rootPath: `/var/lib/sessions/${locator.runId}/kernel` };
    }
}

export function cliStorage(runId: string): StorageBindingRef {
    return { kind: STORAGE_KIND, locator: { runId } };
}

export interface CliRuntimeOptions {
    /** Explicit session home; defaults to the workflow workspace root. */
    setHome?: string;
    /** Extra host directories mounted read-only by default. */
    addDir?: string[];
    /** Read providers/connections/skills from the shared profile instead of YAML. */
    useProfileConfig?: boolean;
}

export async function createCliRuntime(
    workflow: CompiledWorkflow,
    manifest: RunManifest,
    onGrantChange: (grants: RunManifest['grants']) => Promise<void>,
    vfsRoot?: string,
    mode: 'execute' | 'control' = 'execute',
    hostOptions: CliRuntimeOptions = {},
): Promise<CliRuntime> {
    const root = vfsRoot ?? path.join(workflow.stateDir, 'runtime', 'vfs');
    const sidecarDir = vfsRoot ? path.join(vfsRoot, '_meta') : path.join(workflow.stateDir, 'runtime', 'meta');
    const backend = await openLocalFSBackend({
        rootDir: root,
        sidecarDir,
        createDb: NodeSqliteSidecarDb.open,
    });
    const additionalMounts = [{ path: '/run', backend: new MemoryBackend() }];
    if (!hostOptions.useProfileConfig) additionalMounts.unshift({ path: '/etc', backend: new MemoryBackend() });
    const { manager: vfs } = await createVFS({ rootBackend: backend, additionalMounts });
    const llmDriver = new LLMDeviceDriver(vfs);
    await initializeLlmQuietly(llmDriver);
    if (!hostOptions.useProfileConfig) await configureLlm(llmDriver, workflow);

    const systemFS = await vfs.openFileSystem('/');
    // Test/tuning knob: a crashed CLI keeps its Session lease until the TTL expires,
    // so crash-recovery tests shorten it instead of waiting the full minute.
    const leaseTtlMs = Number(process.env.MINDOS_SESSION_LEASE_TTL_MS) || undefined;
    const leases = new SessionLeaseStore(systemFS, { ttlMs: leaseTtlMs });
    const lease = await leases.acquire(manifest.sessionId, { id: `cli-${process.pid}-${crypto.randomUUID()}`, kind: 'cli' });
    if (!lease) {
        const current = await leases.inspect(manifest.sessionId);
        const until = current ? new Date(current.leaseUntil).toISOString() : 'unknown';
        const remaining = current ? Math.max(0, Math.ceil((current.leaseUntil - Date.now()) / 1000)) : 0;
        throw new Error(`Session ${manifest.sessionId} is owned by ${current?.ownerKind ?? 'another host'} until ${until} (${remaining}s); wait for the lease to expire or close the other host`);
    }
    const leaseHeartbeat = setInterval(() => { void leases.renew(lease).catch(() => {}); }, 10_000);
    leaseHeartbeat.unref?.();

    const sessionRepository = new SessionRepository(systemFS);
    await sessionRepository.init();
    await sessionRepository.ensureSession(manifest.sessionId, `CLI: ${workflow.config.name}`, 'cli');
    const systemMounts = createSessionAttachmentMounts(sessionRepository);
    const sessionFiles = new SessionFilesService(systemFS, id => systemMounts.forSession(id));
    await sessionFiles.initialize();
    const directorySource = new CliDirectorySourceProvider(root);
    const directoryMounts = new DirectoryMountService(systemFS, sessionFiles, directorySource);
    await directoryMounts.init();

    const sessionWorkspaceRoot = path.resolve(hostOptions.setHome ?? workflow.workspaceRoot);
    const grants = new WorkspaceGrantRegistry(
        sessionWorkspaceRoot,
        workflow.stateDir,
        manifest.grants,
        onGrantChange,
    );
    grants.setOnGrant(async grant => {
        await directoryMounts.addDirectory(manifest.sessionId, grant.path, grant.access === 'write' ? 'rw' : 'ro');
    });

    // Session mounts are the single source for both file tools and platform exec mounts.
    for (const grant of manifest.grants) {
        await directoryMounts.addDirectory(manifest.sessionId, grant.path, grant.access === 'write' ? 'rw' : 'ro');
    }
    await directoryMounts.addDirectory(manifest.sessionId, sessionWorkspaceRoot, 'rw', '/workspace', true);
    for (const raw of hostOptions.addDir ?? []) {
        const { directory, access } = parseAddDirectory(raw);
        await directoryMounts.addDirectory(manifest.sessionId, directory, access);
    }

    const executionMounts = async (): Promise<WorkspaceGrant[]> => {
        const mounts = await directoryMounts.processMounts(manifest.sessionId);
        return mounts.map((mount, index) => ({
            id: mount.at.replace(/[^a-zA-Z0-9_-]/g, '_') || `mount-${index}`,
            path: mount.directory,
            access: mount.access === 'ro' ? 'read' : 'write',
            mountAt: mount.at,
            createdAt: 0,
        }));
    };
    const { shell, engine } = await createShell(workflow, executionMounts);
    const sandboxMode = workflow.config.sandbox?.mode ?? 'oci';
    const ttyMounts = await executionMounts();
    // Native TTY uses a real PTY (node-pty); OCI TTY is wrapped in `engine run -i`
    // so the persistent session stays inside the sandbox instead of escaping it.
    const ttyDriver = sandboxMode === 'native'
        ? new NodePtyDriver()
        : engine ? new OciTtyDriver(engine, workflow, ttyMounts) : undefined;

    const core = await createKernelRuntime({
        systemFS,
        llmDriver,
        storageResolver: new CliStorageResolver(systemFS),
        maxConcurrent: mode === 'control' ? 0 : workflow.config.runtime?.max_concurrency ?? 4,
        maxConcurrentEffects: mode === 'control' ? 0 : undefined,
        skillSourceForSession: files => new SessionFileSkillSource(files.vfs, files.cwd, parse),
        fileContextForSession: id => acquireSessionProcessContext(
            sessionFiles,
            id,
            async () => ({ nativeShell: shell, ttyDriver, release: async () => {} }),
            () => directoryMounts.processMounts(id),
        ),
        additionalTools: [createBashTool(shell), createWorkspaceAccessTool(grants)],
        beforeRecover: async runtime => { await syncSkillsToKernel(llmDriver, runtime); },
        recover: true,
    });
    const { kernel } = core;

    const executor = new DurableFlowExecutor({
        kernel,
        plugins: core.dagPlugins,
        resolveNewRunContext: sessionId => resolveSessionSkillContext(kernel, core.sessions, sessionId, workflow.config.goal),
        resolveTools: (sessionId, allowed) => resolveTools(core, sessionId, allowed),
    });
    return {
        kernel,
        executor,
        grants,
        waitForCheckpoint: taskIds => {
            if (!manifest.rootTaskId) throw new Error('Run root task is missing');
            return executor.waitForCheckpoint(manifest.sessionId, manifest.rootTaskId, taskIds);
        },
        async dispose() {
            kernel.dispose();
            await executor.waitIdle();
            await kernel.waitIdle();
            await core.dispose();
            await directoryMounts.dispose();
            await sessionFiles.dispose();
            await systemMounts.dispose();
            await sessionRepository.dispose();
            await directorySource.dispose();
            clearInterval(leaseHeartbeat);
            await leases.release(lease).catch(() => false);
            await vfs.dispose();
        },
    };
}

function parseAddDirectory(raw: string): { directory: string; access: 'ro' | 'rw' } {
    const match = /^(.*?)(?::(ro|rw))?$/.exec(raw.trim());
    const directory = match?.[1]?.trim();
    if (!directory) throw new Error('--add-dir requires a directory path');
    return { directory, access: match?.[2] === 'rw' ? 'rw' : 'ro' };
}

async function initializeLlmQuietly(driver: LLMDeviceDriver): Promise<void> {
    const log = console.log;
    const info = console.info;
    console.log = () => {};
    console.info = () => {};
    try {
        await driver.init();
    } finally {
        console.log = log;
        console.info = info;
    }
}

export function compileDag(workflow: CompiledWorkflow): DagRunSpec {
    const agents = new Map(workflow.config.agents.map(agent => [agent.id, agent]));
    const agentFactory = (task: WorkflowTaskSpec, role?: 'agent' | 'supervisor' | 'worker'): DagRunSpec['nodes'][number] =>
        compileTask(workflow, task as TaskConfig, agents.get((task as TaskConfig).agent!)!, role);
    const { nodes, edges } = compileWorkflow(
        workflow.config.tasks as WorkflowTaskSpec[],
        agentFactory,
        taskOutputReference,
    );
    return { nodes, edges };
}

function compileTask(
    workflow: CompiledWorkflow,
    task: TaskConfig,
    agent: AgentConfig,
    role?: 'agent' | 'supervisor' | 'worker',
): DagRunSpec['nodes'][number] {
    const connection = workflow.config.connections.find(item => item.id === agent.connection)!;
    const model = agent.model ?? connection.tiers[agent.model_tier ?? 'standard'];
    const staticInputs = Object.fromEntries(Object.entries(task.inputs ?? {})
        .filter(([, value]) => !taskOutputReference(value)));
    // supervisor 节点注入协调指令；普通 agent 节点带 workspace 边界提示。
    const system = role === 'supervisor'
        ? [
            agent.system_prompt,
            `You are a supervisor coordinating these workers: ${task.supervisor?.workers.join(', ')}.`,
            'Each round, output EXACTLY one worker name to dispatch it, or output your final answer when done.',
            `Overall goal: ${workflow.config.goal}`,
        ].filter(Boolean).join('\n\n')
        : [
            agent.system_prompt,
            `Overall goal: ${workflow.config.goal}`,
            `Workspace: ${workflow.workspaceRoot}`,
            'Only access paths inside the workspace unless RequestWorkspaceAccess has been approved.',
        ].filter(Boolean).join('\n\n');
    return {
        id: task.id,
        name: task.description ?? task.id,
        plugin: 'builtin.agent',
        pluginVersion: '1.0.0',
        config: {
            messages: [
                { role: 'system', content: system },
                { role: 'user', content: task.description ?? task.id },
            ],
            connectionId: agent.connection,
            ...(model ? { model } : {}),
            ...(agent.temperature !== undefined ? { temperature: agent.temperature } : {}),
            ...(agent.max_tokens !== undefined ? { maxTokens: agent.max_tokens } : {}),
            ...(agent.thinking !== undefined ? { thinking: agent.thinking } : {}),
            ...(agent.reasoning_effort !== undefined ? { reasoningEffort: agent.reasoning_effort } : {}),
            ...(agent.web_search !== undefined ? { webSearch: agent.web_search } : {}),
            ...(agent.stream !== undefined ? { stream: agent.stream } : {}),
            maxExchanges: agent.max_exchanges ?? 50,
            workingDirectory: workflow.workspaceRoot,
            approval: agent.approval ?? 'external',
            ...(task.max_iterations !== undefined ? { maxIterations: task.max_iterations } : {}),
        },
        inputs: staticInputs,
        capabilities: normalizeTools(agent.tools ?? [], task.workspace_access ?? 'read'),
        ...(task.priority !== undefined ? { priority: task.priority } : {}),
        ...(task.budget ? { budget: task.budget } : {}),
        ...(task.compensate !== undefined ? { compensate: task.compensate } : {}),
        retry: task.retry ? {
            maxAttempts: task.retry.max_attempts,
            ...(task.retry.backoff_ms !== undefined ? { backoffMs: task.retry.backoff_ms } : {}),
        } : undefined,
    };
}

function normalizeTools(tools: string[], access: TaskConfig['workspace_access']): string[] {
    const normalized = tools.map(tool => TOOL_ALIASES[tool.toLowerCase()] ?? tool);
    const allowed = access === 'write'
        ? normalized
        : normalized.filter(tool => !['Write', 'Edit', 'Bash'].includes(tool));
    if (allowed.length && !allowed.includes('RequestWorkspaceAccess')) allowed.push('RequestWorkspaceAccess');
    return [...new Set(allowed)];
}

async function resolveTools(
    core: HeadlessKernelRuntime,
    sessionId: string,
    allowedIds: string[],
): Promise<{ definitions: ToolDefinition[]; externalIds: string[] }> {
    const service = (await core.sessions.get(sessionId)).toolService;
    const allowed = new Set(allowedIds);
    const definitions = service.getToolDefinitions().filter(definition =>
        typeof definition.name === 'string' && allowed.has(definition.name));
    const externalIds = allowedIds.filter(id => service.getToolMeta(id)?.sideEffect !== 'none');
    return { definitions, externalIds };
}

async function configureLlm(driver: LLMDeviceDriver, workflow: CompiledWorkflow): Promise<void> {
    for (const source of workflow.config.providers) {
        const provider: LLMProvider = {
            id: source.id,
            name: source.name ?? source.id,
            implementation: source.implementation,
            baseURL: source.base_url,
            defaultPath: source.default_path,
            responsesPath: source.responses_path,
            apiKey: process.env[source.api_key_env],
            enabled: true,
            models: source.models.map(model => ({
                id: model.id,
                name: model.name ?? model.id,
                contextWindow: model.context_window,
                maxOutput: model.max_output,
                supportsTools: model.supports_tools,
                supportsThinking: model.supports_thinking,
            })),
        };
        await driver.saveProvider(provider);
    }
    for (const source of workflow.config.connections) {
        const connection: LLMConnection = {
            id: source.id,
            name: source.name ?? source.id,
            providerId: source.provider,
            tiers: source.tiers,
            protocol: source.protocol,
            enabled: true,
        };
        await driver.saveConnection(connection);
    }
}
