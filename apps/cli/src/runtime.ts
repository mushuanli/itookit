import { leaseSkewConfig } from './lease-config';
import { mkdir } from 'node:fs/promises';
import { memoryPolicyForAgent } from './memory-policy';
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
    GitWorktreeFlowWorkspaceManager,
    type FlowWorkspaceManager,
    type WorkspaceCommandRunner,
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
    withWorkspaceScopeCleanup,
    type HeadlessKernelRuntime,
} from '@itookit/app-core';
import { SessionRepository } from '@itookit/llm-session';
import { createVFS, MemoryBackend, type IFileSystem, type VFSFactoryOptions } from '@itookit/vfs-core';
import { createBashTool, type INativeShell } from '@itookit/tools';
import { openLocalFSBackend } from '@itookit/vfsdriver-localfs';
import { taskOutputReference } from './config';
import { CliDirectorySourceProvider } from './directories';
import { createShell, OciTtyDriver, NodeNativeShell } from './shell';
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
    /** Session workspace the file tools and shell see (the isolated copy in worktree mode). */
    workspaceRoot: string;
    waitForCheckpoint(taskIds: string[]): Promise<void>;
    dispose(): Promise<void>;
}

export class CliStorageResolver implements SessionStorageResolver {
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

type AdditionalMounts = NonNullable<VFSFactoryOptions['additionalMounts']>;

/** Mount the CLI VFS at a data root. Shared by the host runtime and read-only state inspection. */
async function openCliVfs(rootDir: string, sidecarDir: string, additionalMounts: AdditionalMounts = []) {
    const backend = await openLocalFSBackend({
        rootDir,
        sidecarDir,
        createDb: NodeSqliteSidecarDb.open,
    });
    // Extra mounts first, then `/run`, matching the order the host runtime has always used.
    return createVFS({ rootBackend: backend, additionalMounts: [...additionalMounts, { path: '/run', backend: new MemoryBackend() }] });
}

/**
 * Open the CLI data root for read-only inspection (no Session, kernel or LLM wiring).
 * Used by guards that must read persisted Session state without taking a Session lease.
 */
export async function openProfileInspectionFs(vfsRoot: string): Promise<{ fs: IFileSystem; dispose: () => Promise<void> }> {
    const { manager } = await openCliVfs(vfsRoot, path.join(vfsRoot, '_meta'));
    return { fs: await manager.openFileSystem('/'), dispose: () => manager.dispose() };
}

export async function createCliRuntime(
    workflow: CompiledWorkflow,
    manifest: RunManifest,
    onGrantChange: (grants: RunManifest['grants']) => Promise<void>,
    vfsRoot?: string,
    mode: 'execute' | 'control' = 'execute',
    hostOptions: CliRuntimeOptions = {},
): Promise<CliRuntime> {
    const skew = leaseSkewConfig(process.env);
    const readOnly = workflow.config.runtime?.workspace?.mode === 'read-only';
    if (readOnly && hostOptions.setHome) throw new Error('read-only workspace cannot be combined with --set-home');
    if (readOnly && (workflow.config.sandbox?.mode ?? 'oci') !== 'oci') throw new Error('read-only workspace requires OCI isolation');
    const root = vfsRoot ?? path.join(workflow.stateDir, 'runtime', 'vfs');
    const sidecarDir = vfsRoot ? path.join(vfsRoot, '_meta') : path.join(workflow.stateDir, 'runtime', 'meta');
    const additionalMounts = hostOptions.useProfileConfig ? [] : [{ path: '/etc', backend: new MemoryBackend() }];
    const { manager: vfs } = await openCliVfs(root, sidecarDir, additionalMounts);
    const llmDriver = new LLMDeviceDriver(vfs);
    await initializeLlmQuietly(llmDriver);
    if (!hostOptions.useProfileConfig) await configureLlm(llmDriver, workflow);

    const systemFS = await vfs.openFileSystem('/');
    // Test/tuning knob: a crashed CLI keeps its Session lease until the TTL expires,
    // so crash-recovery tests shorten it instead of waiting the full minute.
    const leaseTtlMs = Number(process.env.MINDOS_SESSION_LEASE_TTL_MS) || undefined;
    // The skew budget is the explicit cross-host clock-error constraint for shared roots.
    const leases = new SessionLeaseStore(systemFS, { ttlMs: leaseTtlMs,
        skewMs: skew.sessionSkewMs });
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

    // In worktree mode the whole Session workspace is the isolated copy, so the VFS file
    // tools, the session cwd and the access grants agree with the shell's working
    // directory instead of silently editing the base repository.
    // Control-mode runtimes (cancel/respond/export) never dispatch nodes, so they keep
    // the plain workspace and avoid creating an empty worktree directory as a side effect.
    const worktree = mode !== 'control' && isolatedWorkspace(workflow) && !hostOptions.setHome
        ? cliWorktreeDirectory(workflow.stateDir, manifest.sessionId)
        : undefined;
    if (worktree) {
        // `git worktree add` accepts an existing empty directory; the mount must exist
        // before the executor prepares the workspace.
        await mkdir(worktree, { recursive: true });
        process.stderr.write(`[worktree] isolated workspace: ${worktree}\n`);
    } else if (hostOptions.setHome && isolatedWorkspace(workflow)) {
        process.stderr.write('[worktree] --set-home keeps the host directory as the Session workspace;'
            + ' the isolated copy is only the agent shell working directory\n');
    }
    const sessionWorkspaceRoot = path.resolve(hostOptions.setHome ?? worktree ?? workflow.workspaceRoot);
    const grants = new WorkspaceGrantRegistry(
        sessionWorkspaceRoot,
        workflow.stateDir,
        manifest.grants,
        onGrantChange,
        readOnly,
    );
    grants.setOnGrant(async grant => {
        if (readOnly && grant.access === 'write') throw new Error('Read-only workspace cannot acquire writable mounts');
        await directoryMounts.addDirectory(manifest.sessionId, grant.path, grant.access === 'write' ? 'rw' : 'ro');
    });

    // Session mounts are the single source for both file tools and platform exec mounts.
    for (const grant of manifest.grants) {
        await directoryMounts.addDirectory(manifest.sessionId, grant.path, !readOnly && grant.access === 'write' ? 'rw' : 'ro');
    }
    await directoryMounts.addDirectory(manifest.sessionId, sessionWorkspaceRoot, readOnly ? 'ro' : 'rw', '/workspace', true);
    for (const raw of hostOptions.addDir ?? []) {
        const { directory, access } = parseAddDirectory(raw);
        await directoryMounts.addDirectory(manifest.sessionId, directory, readOnly ? 'ro' : access);
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

    const acquireFiles = (id: string) => acquireSessionProcessContext(
        sessionFiles, id,
        async () => ({ nativeShell: shell, ttyDriver, release: async () => {} }),
        () => directoryMounts.processMounts(id),
    );
    const core = await createKernelRuntime({
        systemFS,
        llmDriver,
        storageResolver: new CliStorageResolver(systemFS),
        maxConcurrent: mode === 'control' ? 0 : workflow.config.runtime?.max_concurrency ?? 4,
        maxConcurrentEffects: mode === 'control' ? 0 : undefined,
        skillSourceForSession: files => new SessionFileSkillSource(files.vfs, files.cwd, parse),
        fileContextForSession: acquireFiles,
        fileContextForScope: acquireFiles,
        additionalTools: [createBashTool(shell), createWorkspaceAccessTool(grants)],
        beforeRecover: async runtime => { await syncSkillsToKernel(llmDriver, runtime); },
        recover: true,
    });
    const { kernel } = core;
    const workspaceManager = cliWorkspaceManager(workflow, shell);

    const executor = new DurableFlowExecutor({
        kernel,
        plugins: core.dagPlugins,
        resolveNewRunContext: sessionId => resolveSessionSkillContext(kernel, core.sessions, sessionId, workflow.config.goal),
        resolveTools: (sessionId, allowed) => resolveTools(core, sessionId, allowed),
        // A crashed host keeps the Run's scheduler lease until the TTL expires; tests
        // shorten it the same way they shorten the Session lease. The skew budget is the
        // explicit cross-host clock-error constraint for shared-storage deployments.
        schedulerLeaseTtlMs: Number(process.env.MINDOS_SCHEDULER_LEASE_TTL_MS) || undefined,
        schedulerLeaseSkewMs: skew.schedulerSkewMs,
        ...(workspaceManager ? { workspaceManager: withWorkspaceScopeCleanup(workspaceManager, core) } : {}),
    });
    return {
        kernel,
        executor,
        grants,
        workspaceRoot: sessionWorkspaceRoot,
        waitForCheckpoint: taskIds => {
            if (!manifest.rootTaskId) throw new Error('Run root task is missing');
            return executor.waitForCheckpoint(manifest.sessionId, manifest.rootTaskId, taskIds);
        },
        async dispose() {
            kernel.dispose();
            const notice = setTimeout(() => { void reportPendingWorkspace(kernel, manifest); }, 5_000);
            try { await executor.waitIdle(); } finally { clearTimeout(notice); }
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

export function compileDag(workflow: CompiledWorkflow, sessionWorkspace?: string): DagRunSpec {
    const agents = new Map(workflow.config.agents.map(agent => [agent.id, agent]));
    const agentFactory = (task: WorkflowTaskSpec, role?: 'agent' | 'supervisor' | 'worker'): DagRunSpec['nodes'][number] =>
        compileTask(workflow, task as TaskConfig, agents.get((task as TaskConfig).agent!)!, role, sessionWorkspace);
    const { nodes, edges } = compileWorkflow(
        workflow.config.tasks as WorkflowTaskSpec[],
        agentFactory,
        taskOutputReference,
    );
    const contracts = new Map(workflow.config.tasks.map(task => [task.id, task.port_schemas]));
    return { nodes: nodes.map(node => contracts.get(node.id)
        ? { ...node, portSchemas: structuredClone(contracts.get(node.id)) } : node), edges };
}

function compileTask(
    workflow: CompiledWorkflow,
    task: TaskConfig,
    agent: AgentConfig,
    role?: 'agent' | 'supervisor' | 'worker',
    sessionWorkspace?: string,
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
            `Workspace: ${sessionWorkspace ?? workflow.workspaceRoot}`,
            'Only access paths inside the workspace unless RequestWorkspaceAccess has been approved.',
        ].filter(Boolean).join('\n\n');
    return {
        id: task.id,
        name: task.description ?? task.id,
        plugin: 'builtin.agent',
        pluginVersion: '1.0.0',
        ...(task.port_schemas ? { portSchemas: structuredClone(task.port_schemas) } : {}),
        config: {
            ...(task.delegation ? { delegation: compileDelegation(workflow, task, agent, sessionWorkspace) } : {}),
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
            ...(agent.response_format ? { responseFormat: agent.response_format } : {}),
            ...(agent.output_validation ? { outputValidation: { onInvalid: agent.output_validation.on_invalid,
                retries: agent.output_validation.retries } } : {}),
            ...(agent.memory_policy ? { memoryPolicy: memoryPolicyForAgent(agent) } : {}),
            // An isolated Run lets the executor place every agent node in the workspace it
            // prepared; pinning the node to the base repository here would silently win.
            ...(isolatedWorkspace(workflow) ? {} : { workingDirectory: workflow.workspaceRoot }),
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

function compileDelegation(workflow: CompiledWorkflow, task: TaskConfig, parent: AgentConfig, workspace?: string) {
    const declaration = task.delegation!;
    const agent = workflow.config.agents.find(item => item.id === declaration.agent);
    if (!agent) throw new Error(`Unknown delegation agent: ${declaration.agent}`);
    const child = compileTask(workflow, { id: `${task.id}.child`, agent: agent.id,
        description: declaration.instruction ?? 'Handle one payload', workspace_access: task.workspace_access }, agent, 'worker', workspace);
    const parentTools = new Set(normalizeTools(parent.tools ?? [], task.workspace_access ?? 'read'));
    return { enabled: true, toolName: 'delegate_tasks',
        resolvedTemplate: { plugin: child.plugin, pluginVersion: child.pluginVersion, config: child.config,
            capabilities: (child.capabilities ?? []).filter(id => parentTools.has(id)) },
        fanout: { maxTasks: declaration.max_tasks ?? 8, maxConcurrency: declaration.max_concurrency ?? 1,
            maxDepth: 1, order: 'sequential' },
        failure: { policy: declaration.failure_policy ?? 'fail-fast' },
    };
}

/** True when the Run policy asks the host to prepare a per-Run workspace. */
function isolatedWorkspace(workflow: CompiledWorkflow): boolean {
    const mode = workflow.config.runtime?.workspace?.mode;
    return mode !== undefined && mode !== 'shared';
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

/**
 * Assemble the host-side workspace manager; OCI read-only runs use host Git management
 * while their file and process capabilities remain read-only inside the container.
 * Worktrees live under the CLI state dir, never inside the repository working tree.
 */
function cliWorkspaceManager(workflow: CompiledWorkflow, shell: INativeShell): FlowWorkspaceManager | undefined {
    if (!isolatedWorkspace(workflow)) return undefined;
    const readOnly = workflow.config.runtime?.workspace?.mode === 'read-only';
    const manager = new GitWorktreeFlowWorkspaceManager({
        repository: workflow.workspaceRoot,
        directoryFor: sessionId => cliWorktreeDirectory(workflow.stateDir, sessionId),
        commands: gitRunner(readOnly ? new NodeNativeShell() : shell),
    });
    if (!readOnly) return manager;
    return {
        prepare: (id, policy) => manager.prepare(id, { ...policy, mode: 'worktree', merge: 'discard' }),
        restore: (id, policy, record, options) => manager.restore(id, { ...policy, mode: 'worktree', merge: 'discard' }, record, options),
    };
}

/** Isolated copy of the repository for one Session; shared by the host and the executor. */
export function cliWorktreeDirectory(stateDir: string, sessionId: string): string {
    return path.join(stateDir, 'worktrees', sessionId);
}

/** argv-safe git runner (never a shell string) so the host sandbox policy still applies. */
function gitRunner(shell: INativeShell): WorkspaceCommandRunner {
    return {
        run: async (program, args, options) => {
            const result = await shell.exec(program, args, { cwd: options.cwd, timeoutMs: 30_000 });
            if (result.code !== 0) {
                throw new Error(`${program} ${args.join(' ')} exited with ${result.code}:`
                    + ` ${(result.stderr || result.stdout).trim()}`);
            }
            return { stdout: result.stdout };
        },
    };
}

async function reportPendingWorkspace(kernel: Kernel, manifest: RunManifest): Promise<void> {
    if (!manifest.rootTaskId) return;
    const saved = await kernel.getShared(manifest.sessionId, `flow.run.${manifest.rootTaskId}.workspace`).catch(() => undefined);
    const state = saved?.value as { status?: string; message?: string } | undefined;
    if (state?.status === 'pending') console.error(state.message
        ?? 'Workspace cleanup is still pending; files and ownership are retained until physical shutdown is confirmed.');
}
