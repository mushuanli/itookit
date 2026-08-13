import path from 'node:path';
import type { DagRunSpec, LLMConnection, LLMProvider, ToolDefinition } from '@itookit/common';
import { createCoreutilsRuntime } from '@itookit/coreutils';
import { LLMDeviceDriver } from '@itookit/device-llm';
import { NodeTTYDriver } from '@itookit/device-tty';
import {
    Harness,
    type ResolvedStorageBinding,
    type SessionStorageResolver,
    type StorageBindingRef,
} from '@itookit/harness';
import {
    createBuiltinDagPluginRegistry,
    DurableFlowExecutor,
    FlowAggregateProgram,
    FlowHumanProgram,
    FlowValueProgram,
} from '@itookit/llm-conversation';
import { DurableAgentProgram, DurableChatProgram, DurablePlanProgram } from '@itookit/llm-runtime';
import { createVFS, FS_MODULE_CHAT, MemoryBackend, type IModuleFS } from '@itookit/stdio';
import { createBashTool } from '@itookit/tools';
import { openLocalFSBackend } from '@itookit/vfsdriver-localfs';
import { taskOutputReference } from './config';
import { createShell } from './shell';
import type { AgentConfig, CompiledWorkflow, RunManifest, TaskConfig } from './types';
import { createWorkspaceAccessTool, createWorkspacePort, WorkspaceGrantRegistry } from './workspace';
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
    kernel: Harness;
    executor: DurableFlowExecutor;
    grants: WorkspaceGrantRegistry;
    dispose(): Promise<void>;
}

class CliStorageResolver implements SessionStorageResolver {
    readonly kind = STORAGE_KIND;
    constructor(private readonly fs: IModuleFS) {}

    async resolve(reference: StorageBindingRef): Promise<ResolvedStorageBinding> {
        const locator = reference.locator as { runId?: unknown };
        if (typeof locator?.runId !== 'string' || !locator.runId) throw new Error('CLI storage requires runId');
        return { fs: this.fs, rootPath: `/runs/${locator.runId}/.harness` };
    }
}

export function cliStorage(runId: string): StorageBindingRef {
    return { kind: STORAGE_KIND, locator: { runId } };
}

export async function createCliRuntime(
    workflow: CompiledWorkflow,
    manifest: RunManifest,
    onGrantChange: (grants: RunManifest['grants']) => Promise<void>,
): Promise<CliRuntime> {
    const vfsRoot = path.join(workflow.stateDir, 'runtime', 'vfs');
    const backend = await openLocalFSBackend({
        rootDir: vfsRoot,
        sidecarDir: path.join(workflow.stateDir, 'runtime', 'meta'),
        createDb: NodeSqliteSidecarDb.open,
    });
    const { manager: vfs } = await createVFS({
        rootBackend: backend,
        additionalMounts: [{ path: '/etc', backend: new MemoryBackend() }],
        modules: [{ name: FS_MODULE_CHAT }],
    });
    const llmDriver = new LLMDeviceDriver(vfs);
    await initializeLlmQuietly(llmDriver);
    await configureLlm(llmDriver, workflow);

    const grants = new WorkspaceGrantRegistry(
        workflow.workspaceRoot,
        workflow.stateDir,
        manifest.grants,
        onGrantChange,
    );
    const shell = await createShell(workflow, () => grants.list());
    const core = await createCoreutilsRuntime({
        llmDriver,
        ttyDriver: new NodeTTYDriver(),
        runMode: 'harness',
        vfsContext: createWorkspacePort(grants),
        nativeShell: shell,
        additionalTools: [createBashTool(shell), createWorkspaceAccessTool(grants)],
    });
    const kernel = new Harness({
        catalog: { fs: vfs.getEngine(FS_MODULE_CHAT) },
        maxConcurrent: workflow.config.runtime?.max_concurrency ?? 4,
    });
    kernel.registerStorageResolver(new CliStorageResolver(vfs.getEngine(FS_MODULE_CHAT)));
    await kernel.use(core.plugin);
    registerPrograms(kernel);
    await kernel.initialize();
    await kernel.recover();

    const plugins = createBuiltinDagPluginRegistry();
    const executor = new DurableFlowExecutor({
        harness: kernel,
        plugins,
        resolveTools: (sessionId, allowed) => resolveTools(core, sessionId, allowed),
    });
    return {
        kernel,
        executor,
        grants,
        async dispose() {
            kernel.dispose();
            await core.dispose();
            await backend.close();
        },
    };
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
    const nodes = workflow.config.tasks.map(task => compileTask(workflow, task, agents.get(task.agent)!));
    const edges = compileEdges(workflow.config.tasks);
    return { nodes, edges, maxNodes: nodes.length };
}

function compileTask(workflow: CompiledWorkflow, task: TaskConfig, agent: AgentConfig): DagRunSpec['nodes'][number] {
    const connection = workflow.config.connections.find(item => item.id === agent.connection)!;
    const model = agent.model ?? connection.tiers[agent.model_tier ?? 'standard'];
    const staticInputs = Object.fromEntries(Object.entries(task.inputs ?? {})
        .filter(([, value]) => !taskOutputReference(value)));
    const system = [
        agent.system_prompt,
        `Overall goal: ${workflow.config.goal}`,
        `Workspace: ${workflow.workspaceRoot}`,
        'Only access paths inside the workspace unless RequestWorkspaceAccess has been approved.',
    ].filter(Boolean).join('\n\n');
    return {
        id: task.id,
        name: task.description,
        plugin: 'builtin.agent',
        pluginVersion: '1.0.0',
        config: {
            messages: [
                { role: 'system', content: system },
                { role: 'user', content: task.description },
            ],
            connectionId: agent.connection,
            ...(model ? { model } : {}),
            maxExchanges: agent.max_exchanges ?? 50,
            workingDirectory: workflow.workspaceRoot,
            approval: 'external',
        },
        inputs: staticInputs,
        capabilities: normalizeTools(agent.tools ?? [], task.workspace_access ?? 'read'),
        retry: task.retry ? {
            maxAttempts: task.retry.max_attempts,
            ...(task.retry.backoff_ms !== undefined ? { backoffMs: task.retry.backoff_ms } : {}),
        } : undefined,
    };
}

function compileEdges(tasks: TaskConfig[]): DagRunSpec['edges'] {
    const edges = new Map<string, DagRunSpec['edges'][number]>();
    for (const task of tasks) {
        for (const [input, value] of Object.entries(task.inputs ?? {})) {
            const ref = taskOutputReference(value);
            if (ref) addEdge(edges, ref.taskId, task.id, ref.output, input);
        }
        for (const dependency of task.depends_on ?? []) {
            const alreadyMapped = [...edges.values()].some(edge => edge.from === dependency && edge.to === task.id);
            if (!alreadyMapped) addEdge(edges, dependency, task.id, 'result', dependency);
        }
    }
    return [...edges.values()];
}

function addEdge(
    edges: Map<string, DagRunSpec['edges'][number]>,
    from: string,
    to: string,
    output: string,
    input: string,
): void {
    const id = `${from}:${output}->${to}:${input}`;
    edges.set(id, { id, from, to, output, input });
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
    core: Awaited<ReturnType<typeof createCoreutilsRuntime>>,
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
            enabled: true,
        };
        await driver.saveConnection(connection);
    }
}

function registerPrograms(kernel: Harness): void {
    const programs = [
        new DurableChatProgram(), new DurableAgentProgram(), new DurablePlanProgram(),
        new FlowValueProgram(), new FlowHumanProgram(), new FlowAggregateProgram(),
    ];
    for (const program of programs) {
        if (!kernel.programs.has(program.manifest.kind, program.manifest.version)) kernel.registerProgram(program);
    }
}
