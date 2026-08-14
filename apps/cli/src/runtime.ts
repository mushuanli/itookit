import path from 'node:path';
import type { DagRunSpec, JsonValue, LLMConnection, LLMProvider, SerializableExpression, ToolDefinition } from '@itookit/common';
import { createCoreutilsRuntime } from '@itookit/coreutils';
import { LLMDeviceDriver } from '@itookit/device-llm';
import { NodePtyDriver } from '@itookit/device-tty';
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
} from '@itookit/llm-flow';
import { DurableAgentProgram, DurableChatProgram, DurablePlanProgram } from '@itookit/llm-programs';
import { createVFS, FS_MODULE_CHAT, MemoryBackend, type IModuleFS } from '@itookit/stdio';
import { createBashTool } from '@itookit/tools';
import { openLocalFSBackend } from '@itookit/vfsdriver-localfs';
import { taskOutputReference } from './config';
import { createShell, OciTtyDriver } from './shell';
import type { AgentConfig, CompiledWorkflow, RouteCondition, RunManifest, TaskConfig } from './types';
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
    const { shell, engine } = await createShell(workflow, () => grants.list());
    const sandboxMode = workflow.config.sandbox?.mode ?? 'oci';
    // Native TTY uses a real PTY (node-pty); OCI TTY is wrapped in `engine run -i`
    // so the persistent session stays inside the sandbox instead of escaping it.
    const ttyDriver = sandboxMode === 'native'
        ? new NodePtyDriver()
        : engine ? new OciTtyDriver(engine, workflow, () => grants.list()) : undefined;
    const core = await createCoreutilsRuntime({
        llmDriver,
        ttyDriver,
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
    // supervisor 的 worker 每次派发只执行一次，不随循环体重复。
    const supervisorWorkers = new Set<string>();
    for (const task of workflow.config.tasks) {
        for (const worker of task.supervisor?.workers ?? []) supervisorWorkers.add(worker);
    }
    const nodes: DagRunSpec['nodes'] = [];
    const extraEdges: DagRunSpec['edges'] = [];
    for (const task of workflow.config.tasks) {
        if (task.supervisor !== undefined) {
            const sub = compileSupervisor(workflow, task, agents);
            nodes.push(...sub.nodes);
            extraEdges.push(...sub.edges);
        } else if (task.route !== undefined) {
            nodes.push(compileRouteTask(task));
        } else if (task.spawn !== undefined) {
            nodes.push(compileSpawnTask(workflow, task, agents));
        } else {
            nodes.push(compileTask(
                workflow,
                supervisorWorkers.has(task.id) ? { ...task, max_iterations: 1 } : task,
                agents.get(task.agent!)!,
            ));
        }
    }
    const edges = [...compileEdges(workflow.config.tasks), ...extraEdges];
    return { nodes, edges, maxNodes: nodes.length };
}

/** 把 supervisor 任务展开成「supervisor agent + route + worker 回边」循环子图。 */
function compileSupervisor(
    workflow: CompiledWorkflow,
    task: TaskConfig,
    agents: Map<string, AgentConfig>,
): { nodes: DagRunSpec['nodes']; edges: DagRunSpec['edges'] } {
    const sup = task.supervisor!;
    const agent = agents.get(task.agent!)!;
    const routerId = `${task.id}__router`;

    // supervisor agent 节点（复用 compileTask，附加 supervisor 指令与循环上限）。
    const lead = compileTask(workflow, { ...task, max_iterations: sup.max_rounds ?? 10 }, agent);
    lead.config = {
        ...(lead.config as Record<string, unknown>),
        messages: [
            {
                role: 'system',
                content: [
                    agent.system_prompt,
                    `You are a supervisor coordinating these workers: ${sup.workers.join(', ')}.`,
                    'Each round, output EXACTLY one worker name to dispatch it, or output your final answer when done.',
                    `Overall goal: ${workflow.config.goal}`,
                ].filter(Boolean).join('\n\n'),
            },
            { role: 'user', content: task.description ?? task.id },
        ],
    };

    const router: DagRunSpec['nodes'][number] = {
        id: routerId,
        name: 'Supervisor Router',
        plugin: 'builtin.route',
        pluginVersion: '1.0.0',
        config: {
            mode: 'exclusive',
            rules: sup.workers.map(worker => ({
                edgeId: supEdgeId(task.id, worker),
                expression: { kind: 'eq', args: [{ kind: 'path', path: ['input'] }, { kind: 'literal', value: worker }] },
            })),
        },
        inputs: {},
        capabilities: [],
    };

    const edges: DagRunSpec['edges'] = [
        { id: `${task.id}->${routerId}`, from: task.id, to: routerId, output: 'result', input: 'input' },
        ...sup.workers.map(worker => ({
            id: supEdgeId(task.id, worker),
            from: routerId,
            to: worker,
            output: 'result',
            input: 'input',
        })),
        // worker → supervisor 回边（重新决策，构成循环）。
        ...sup.workers.map(worker => ({
            id: `${worker}->${task.id}`,
            from: worker,
            to: task.id,
            output: 'result',
            input: 'input',
        })),
    ];

    return { nodes: [lead, router], edges };
}

function supEdgeId(leadId: string, worker: string): string {
    return `${leadId}->${worker}`;
}

function compileSpawnTask(
    workflow: CompiledWorkflow,
    task: TaskConfig,
    agents: Map<string, AgentConfig>,
): DagRunSpec['nodes'][number] {
    const spawn = task.spawn!;
    const staticInputs = Object.fromEntries(Object.entries(task.inputs ?? {})
        .filter(([, value]) => !taskOutputReference(value)));
    return {
        id: task.id,
        name: task.description ?? task.id,
        plugin: 'builtin.spawn',
        pluginVersion: '1.0.0',
        config: {
            ...(task.description !== undefined ? { value: task.description } : {}),
            outputName: 'result',
            type: 'text',
            spawn: {
                nodes: spawn.tasks.map(subTask => compileTask(workflow, subTask, agents.get(subTask.agent!)!)),
                edges: spawn.edges.map(edge => ({
                    id: `${edge.from}->${edge.to}`,
                    from: edge.from,
                    to: edge.to,
                    ...(edge.input !== undefined ? { input: edge.input } : {}),
                    ...(edge.output !== undefined ? { output: edge.output } : {}),
                })),
            },
        },
        inputs: staticInputs,
        capabilities: [],
    };
}

function compileRouteTask(task: TaskConfig): DagRunSpec['nodes'][number] {
    const route = task.route!;
    const staticInputs = Object.fromEntries(Object.entries(task.inputs ?? {})
        .filter(([, value]) => !taskOutputReference(value)));
    return {
        id: task.id,
        name: 'Route',
        plugin: 'builtin.route',
        pluginVersion: '1.0.0',
        config: {
            mode: route.mode ?? 'exclusive',
            rules: route.rules.map(rule => ({
                edgeId: routeEdgeId(task.id, rule.then),
                expression: compileRouteCondition(rule.when),
            })),
            ...(route.default !== undefined ? { defaultEdgeId: routeEdgeId(task.id, route.default) } : {}),
        },
        inputs: staticInputs,
        capabilities: [],
    };
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

function compileEdges(tasks: TaskConfig[]): DagRunSpec['edges'] {
    const edges = new Map<string, DagRunSpec['edges'][number]>();
    // route 分支目标 → route task 的映射，用于跳过目标 task 对 route 的 depends_on 依赖。
    const routeTargets = new Map<string, string>();
    for (const task of tasks) {
        if (task.route === undefined) continue;
        for (const rule of task.route.rules) {
            routeTargets.set(rule.then, task.id);
            addEdge(edges, task.id, rule.then, 'result', 'input', routeEdgeId(task.id, rule.then));
        }
        if (task.route.default !== undefined) {
            routeTargets.set(task.route.default, task.id);
            addEdge(edges, task.id, task.route.default, 'result', 'input', routeEdgeId(task.id, task.route.default));
        }
    }
    for (const task of tasks) {
        for (const [input, value] of Object.entries(task.inputs ?? {})) {
            const ref = taskOutputReference(value);
            if (ref) addEdge(edges, ref.taskId, task.id, ref.output, input);
        }
        for (const dependency of task.depends_on ?? []) {
            const depId = typeof dependency === 'string' ? dependency : dependency.task;
            const onFailure = typeof dependency === 'string' ? undefined : dependency.on_failure;
            if (routeTargets.get(task.id) === depId) continue;
            const alreadyMapped = [...edges.values()].some(edge => edge.from === depId && edge.to === task.id);
            if (!alreadyMapped) addEdge(edges, depId, task.id, 'result', depId, undefined, onFailure);
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
    id?: string,
    onFailure?: 'fail' | 'skip' | 'continue',
): void {
    const edgeId = id ?? `${from}:${output}->${to}:${input}`;
    edges.set(edgeId, { id: edgeId, from, to, output, input, ...(onFailure ? { onFailure } : {}) });
}

function routeEdgeId(from: string, to: string): string {
    return `${from}->${to}`;
}

/** 把 YAML 的路由条件编译成可序列化表达式（以 route 节点的 input 为基准）。 */
function compileRouteCondition(condition: RouteCondition): SerializableExpression {
    const input = (): SerializableExpression => ({ kind: 'path', path: ['input'] });
    if (typeof condition === 'string') {
        return { kind: 'eq', args: [input(), { kind: 'literal', value: condition }] };
    }
    if (condition.eq !== undefined) return { kind: 'eq', args: [input(), { kind: 'literal', value: condition.eq as JsonValue }] };
    if (condition.neq !== undefined) return { kind: 'neq', args: [input(), { kind: 'literal', value: condition.neq as JsonValue }] };
    if (condition.in !== undefined) return { kind: 'in', args: [input()], value: condition.in as JsonValue };
    if (condition.exists !== undefined) {
        const exists: SerializableExpression = { kind: 'exists', args: [input()] };
        return condition.exists ? exists : { kind: 'not', args: [exists] };
    }
    if (condition.and !== undefined) return { kind: 'and', args: condition.and.map(compileRouteCondition) };
    if (condition.or !== undefined) return { kind: 'or', args: condition.or.map(compileRouteCondition) };
    if (condition.not !== undefined) return { kind: 'not', args: [compileRouteCondition(condition.not)] };
    throw new Error('Route condition has no operator');
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
