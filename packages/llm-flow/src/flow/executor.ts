import type { SchedulerCheckpoint } from './scheduler-checkpoint';
import { restoreFlowHandle } from './restore-handle';
import { acquireSchedulerLease, isSchedulerOwnershipLost, type SchedulerLease } from './scheduler-lease';
import { graphRetryKey, type FlowGraphRetryIntent } from './graph-retry';
import { beginWorkspaceFinalization, workspaceFinalizationKey, type WorkspaceFinalization } from './workspace-finalization';
import { createRunCatalog } from './run-catalog';
import type {
    DagEdgeDefinition,
    DagNodeDefinition,
    DagPluginCatalog,
    DagRunSpec,
    GraphEffect,
    JsonValue as CommonJsonValue,
    ToolDefinition,
} from '@itookit/common';
import {
    type Kernel,
    type JsonValue,
    type SessionHandle,
    type TaskHandle,
    type TaskSpec,
} from '@itookit/durable-kernel';
import type { FlowWorkspacePolicy, HarnessHookEvent, HarnessHookRunner } from '@itookit/common';

export interface FlowWorkspaceLease {
    directory: string;
    /**
     * JSON-serializable description of the lease. The executor persists it so a new
     * host can restore the same workspace after a crash instead of creating a second one.
     */
    record?: JsonValue;
    finish(status: 'succeeded' | 'failed' | 'cancelled'): Promise<void>;
}

export interface FlowWorkspaceManager {
    prepare(sessionId: string, policy: FlowWorkspacePolicy): Promise<FlowWorkspaceLease>;
    /** Re-attach to a workspace whose lease was persisted by `record` before a crash. */
    restore?(sessionId: string, policy: FlowWorkspacePolicy, record: JsonValue): Promise<FlowWorkspaceLease>;
}

/** Session shared key holding the durable workspace lease record of a Run. */
export const workspaceLeaseKey = (rootTaskId: string): string => `flow.run.${rootTaskId}.workspace-lease`;
import { findCycles } from './graph';
import { dataEdgeSchemaIssue, validateDataEdgeValue } from './port-contract';
import { patchIdentityConfig } from './patch-identity';
import { mergeAgentConfig } from './to-dag';
import { resolveNodeConnection } from './connections';
import { bindFlowTaskCapabilities } from './task-capabilities';
import { graphPatchFingerprint, validateGraphPatch } from './graph-patch';
import { resolveFlowParameters } from './parameters';
import {
    delegationPlan,
    materializeDelegation,
    subtaskToolDef,
    subtaskToolDescription,
    subtaskToolName,
    type DelegationGroup,
    type EdgeState,
} from './delegation-runtime';

export interface FlowExecutionHandle {
    /** Reattached records only; no scheduler continuation was restored. */
    attachedFromStorage?: boolean;
    sessionId: string;
    root: TaskHandle<JsonValue>;
    nodes: Map<string, TaskHandle>;
    /** 每个节点实际执行的实例数（Loop 节点会大于 1）。 */
    iterations: Map<string, number>;
    goal?: import('@itookit/common').FlowRunGoal;
    detachedNodes: Set<string>;
    taskIds: Set<string>;
    /** Host workspace finalization; rejection is observable without an unhandled background promise. */
    workspaceCompletion?: Promise<void>;
    workspaceFinalization?: WorkspaceFinalization;
    usage: { tokens: number; startedAt: number; elapsedMs: number };
}

export interface DurableFlowExecutorOptions {
    kernel: Kernel;
    plugins: DagPluginCatalog;
    /** Trusted run snapshot applied to every Agent instance, including dynamically added nodes. */
    sessionContext?: { projectInstructions: string; skillInstructions: string; skillIndex: string };
    /** Resolve once for a new run only; resume always uses its persisted snapshot. */
    resolveNewRunContext?(sessionId: string): Promise<NonNullable<DurableFlowExecutorOptions['sessionContext']>>;
    /** Resolve runtime identities without granting capabilities or changing graph structure. */
    bindPatchNode?(sessionId: string, node: DagNodeDefinition, defaults?: Record<string, unknown>): Promise<Partial<Pick<DagNodeDefinition, 'config' | 'inputs'>>>;
    resolveTools?(sessionId: string, allowedIds: string[]): Promise<{
        definitions: ToolDefinition[];
        externalIds: string[];
    }>;
    /** Trusted host hooks. Flow documents can trigger events but cannot install code. */
    hooks?: HarnessHookRunner;
    workspaceManager?: FlowWorkspaceManager;
    /** Run 级调度租约有效期（默认 30s）；到期后其他宿主可接管。 */
    schedulerLeaseTtlMs?: number;
    /** 测试或宿主指定的调度者身份。 */
    schedulerOwnerId?: string;
}

const MAX_LOOP_ITERATIONS = 100;

export class DurableFlowExecutor {
    private readonly active = new Set<Promise<unknown>>();

    /** Drain scheduler continuations before the host closes their storage. */
    async waitIdle(): Promise<void> {
        while (this.active.size) await Promise.allSettled([...this.active]);
    }

    /** Wait until the persisted scheduler checkpoint contains the supplied Task identities. */
    async waitForCheckpoint(sessionId: string, rootTaskId: string, taskIds: string[], timeoutMs = 5_000): Promise<void> {
        const session = await this.options.kernel.openSession(sessionId);
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            const saved = await session.getShared(`flow.run.${rootTaskId}.scheduler`);
            const checkpoint = saved?.value as SchedulerCheckpoint | undefined;
            const ids = new Set<string>((checkpoint?.instances ?? []).flatMap(([, handles]) => handles));
            if (taskIds.every(id => ids.has(id))) return;
            await new Promise(resolve => setTimeout(resolve, 25));
        }
        throw new Error(`Flow scheduler checkpoint did not include tasks: ${taskIds.join(', ')}`);
    }

    private track(work: Promise<FlowExecutionHandle>): Promise<FlowExecutionHandle> {
        this.active.add(work);
        void work.then(() => this.active.delete(work), () => this.active.delete(work));
        return work;
    }

    constructor(private readonly options: DurableFlowExecutorOptions) {}

    submit(sessionId: string, spec: DagRunSpec, parameters?: Record<string, CommonJsonValue>): Promise<FlowExecutionHandle> {
        return new Promise((resolve, reject) => {
            void this.track(this.execute(sessionId, spec, parameters, resolve)).then(resolve, reject);
        });
    }

    async resume(sessionId: string, rootTaskId: string): Promise<FlowExecutionHandle> {
        const session = await this.options.kernel.openSession(sessionId);
        const handle = await restoreFlowHandle(session, rootTaskId);
        if (await handle.root.poll()) {
            // A crash during workspace finalization leaves the record pending; a new host
            // completes it instead of leaking the workspace.
            await this.resumeWorkspaceFinalization(session, handle.root, rootTaskId);
            return handle;
        }
        const root = (await handle.root.status()).task;
        if (!record(root.state ?? root.input).awaitingSchedule) return handle;
        const saved = await session.getShared(`flow.run.${rootTaskId}.scheduler`);
        if (!saved) throw new Error('Flow scheduler checkpoint is missing');
        const checkpoint = saved.value as unknown as SchedulerCheckpoint;
        if (checkpoint.version !== 1) throw new Error('Unsupported Flow scheduler checkpoint');
        handle.attachedFromStorage = false;
        return new Promise((resolve, reject) => {
            void this.track(this.execute(sessionId, checkpoint.spec, checkpoint.parameters, resolve,
                { checkpoint, handle })).then(resolve, reject);
        });
    }

    /** Finish a workspace finalization that a previous host started but did not complete. */
    private async resumeWorkspaceFinalization(
        session: SessionHandle,
        root: TaskHandle<JsonValue>,
        rootTaskId: string,
    ): Promise<void> {
        const state = (await session.getShared(workspaceFinalizationKey(rootTaskId)))?.value as
            WorkspaceFinalization | undefined;
        if (state?.status !== 'pending') return;
        const checkpoint = (await session.getShared(`flow.run.${rootTaskId}.scheduler`))?.value as
            SchedulerCheckpoint | undefined;
        const policy = checkpoint?.spec.runPolicy?.workspace;
        const leaseRecord = await session.getShared(workspaceLeaseKey(rootTaskId));
        if (!policy || policy.mode === 'shared' || !leaseRecord) return;
        const workspace = await this.restoreWorkspace(session, rootTaskId, policy);
        await (await beginWorkspaceFinalization(session, root, workspace)).completion;
    }

    private async restoreWorkspace(
        session: SessionHandle,
        rootTaskId: string,
        policy: FlowWorkspacePolicy,
    ): Promise<FlowWorkspaceLease> {
        if (!this.options.workspaceManager?.restore) {
            throw new Error(`Resuming an isolated Flow workspace requires a workspace manager that restores leases`);
        }
        const saved = await session.getShared(workspaceLeaseKey(rootTaskId));
        if (!saved) throw new Error('Flow workspace lease record is missing');
        return this.options.workspaceManager.restore(session.id, policy, saved.value);
    }

    private async execute(
        sessionId: string,
        spec: DagRunSpec,
        parameters: Record<string, CommonJsonValue> | undefined,
        publish: (handle: FlowExecutionHandle) => void,
        restored?: { checkpoint: SchedulerCheckpoint; handle: FlowExecutionHandle },
    ): Promise<FlowExecutionHandle> {
        const saved = restored?.checkpoint;
        spec = structuredClone(spec);
        parameters = structuredClone(parameters);
        const plugins = createRunCatalog(this.options.plugins, spec.nodes);
        const sessionContext = structuredClone(saved ? saved.sessionContext
            : this.options.resolveNewRunContext ? await this.options.resolveNewRunContext(sessionId) : this.options.sessionContext);
        const nodeDefaults = new Map(Object.entries(structuredClone(spec.nodeDefaults ?? {}))
            .map(([id, defaults]) => [id, parameters ? resolveFlowParameters(defaults, parameters) as Record<string, unknown> : defaults]));
        const nodeConnections = new Map(Object.entries(structuredClone(spec.nodeConnections ?? {})));
        const declaredNodes = new Map(spec.nodes.map(node => [node.id, node]));
        for (const edge of spec.edges) {
            const source = declaredNodes.get(edge.from), target = declaredNodes.get(edge.to);
            if (!source || !target) throw new Error(`Flow edge ${edge.id} references an unknown node`);
            const issue = dataEdgeSchemaIssue(edge, source, target, plugins);
            if (issue) throw new Error(`Flow edge ${edge.id}: ${issue}`);
        }
        const maxNodes = positiveInteger(spec.maxNodes ?? spec.runPolicy?.maxNodes) ?? 1_000;
        if (spec.nodes.length > maxNodes) throw new Error(`Flow node limit exceeded: ${spec.nodes.length}/${maxNodes}`);
        const session = await this.options.kernel.openSession(sessionId);
        if (!restored) await this.emitHook('run.started', sessionId, { nodeCount: spec.nodes.length });
        // A resumed Run claims scheduler ownership before touching the workspace or the
        // checkpoint, so a live owner is never overridden.
        let lease = restored ? await this.acquireLease(session, restored.handle.root.id) : undefined;
        const workspacePolicy = spec.runPolicy?.workspace;
        // A restored Run re-attaches the workspace lease recorded before the crash instead
        // of preparing a second isolated directory.
        const workspace = workspacePolicy && workspacePolicy.mode !== 'shared'
            ? restored
                ? await this.restoreWorkspace(session, restored.handle.root.id, workspacePolicy)
                : await this.prepareWorkspace(sessionId, workspacePolicy)
            : undefined;
        const instances = new Map<string, TaskHandle[]>();
        let published = restored?.handle;
        if (saved) for (const [id, taskIds] of saved.instances) {
            instances.set(id, await Promise.all(taskIds.map(taskId => session.attachTask(taskId))));
        }
        const completed = new Set<string>(saved?.completed);
        try {
            const maxConcurrency = positiveInteger(spec.maxConcurrency ?? spec.runPolicy?.maxConcurrency) ?? Number.MAX_SAFE_INTEGER;
            const timeoutMs = positiveInteger(spec.timeoutMs ?? spec.runPolicy?.timeoutMs);
            const maxTokens = positiveInteger(spec.maxTokens ?? spec.runPolicy?.maxTokens);
            const startedAt = saved?.startedAt ?? Date.now();
            const routeEdgeIds = collectRouteEdgeIds(spec);
            const { backEdges, loopNodes } = findCycles(spec.nodes, spec.edges);
            const nodes = saved?.nodes ?? (parameters
                ? spec.nodes.map(node => ({
                    ...node,
                    config: resolveFlowParameters(node.config, parameters) as DagNodeDefinition['config'],
                    inputs: resolveFlowParameters(node.inputs, parameters) as DagNodeDefinition['inputs'],
                }))
                : [...spec.nodes]).map(node => workspace && node.plugin === 'builtin.agent'
                    ? { ...node, config: { ...record(node.config), workingDirectory: record(node.config).workingDirectory ?? workspace.directory } }
                    : node);
            const edges = saved?.edges ?? [...spec.edges];
            const delegationDepth = new Map(saved?.delegationDepth ?? nodes.map(node => [String(node.id), 0] as [string, number]));
            const delegationGroups = new Map<string, DelegationGroup>(saved?.delegationGroups.map(([id, group]) =>
                [id, { ...group, children: new Set(group.children), completed: new Set(group.completed), succeeded: new Set(group.succeeded) }]));
            const delegationGroupByChild = new Map<string, string>(saved?.delegationGroupByChild);
            const skipped = new Set<string>(saved?.skipped);
            const detachedNodes = new Set<string>(saved?.detachedNodes);
            const appliedPatches = new Map<string, string>(saved?.appliedPatches);
            let consumedTokens = saved?.consumedTokens ?? 0;
            const completionOrder: string[] = saved?.completionOrder ?? [];
            // 已派发的节点（按派发顺序），用于 supervisor 的「每轮只等本轮派发的 worker」。
            const dispatchOrder: string[] = saved?.dispatchOrder ?? [];
            const nodeGenerations = new Map<string, number>(saved?.nodeGenerations ?? []);
            const edgeState = new Map<string, EdgeState>(
                saved?.edgeState ?? edges.map(edge => [edge.id, routeEdgeIds.has(edge.id) ? 'pending' : 'active']),
            );

            if (saved) {
                for (const [id, value] of saved.nodeDefaults) nodeDefaults.set(id, value);
                for (const [id, value] of saved.nodeConnections) nodeConnections.set(id, value);
            }
            const saveCheckpoint = async (): Promise<void> => {
                if (!published) return;
                const checkpoint: SchedulerCheckpoint = {
                    version: 1, spec, parameters, sessionContext,
                    instances: [...instances].map(([id, handles]) => [id, handles.map(handle => handle.id)]),
                    completed: [...completed], nodes, edges, edgeState: [...edgeState],
                    delegationDepth: [...delegationDepth], delegationGroupByChild: [...delegationGroupByChild],
                    delegationGroups: [...delegationGroups].map(([id, group]) => [id, { ...group,
                        children: [...group.children], completed: [...group.completed], succeeded: [...group.succeeded] }]),
                    skipped: [...skipped], detachedNodes: [...detachedNodes], appliedPatches: [...appliedPatches],
                    nodeDefaults: [...nodeDefaults], nodeConnections: [...nodeConnections],
                    consumedTokens, startedAt, completionOrder, dispatchOrder,
                    nodeGenerations: [...nodeGenerations],
                };
                await session.setShared(`flow.run.${published.root.id}.scheduler`, jsonValue(checkpoint));
            };

            const latestDone = (nodeId: string): boolean => {
                const handles = instances.get(nodeId);
                if (!handles?.length) return false;
                return completed.has(instanceKey(nodeId, handles.length));
            };
            const handleAt = (nodeId: string, iteration: number): TaskHandle => {
                const handle = instances.get(nodeId)?.[iteration - 1];
                if (!handle) throw new Error(`Flow node has no instance ${iteration}: ${nodeId}`);
                return handle;
            };
            const doneAt = (nodeId: string, iteration: number): boolean =>
                completed.has(instanceKey(nodeId, iteration));
            // 环上的节点共享同一个迭代上限（任一环上节点声明即可），非环节点单次执行。
            const loopMaxIterations = (): number => {
                for (const id of loopNodes) {
                    const config = nodes.find(n => n.id === id)?.config;
                    if (isRecord(config) && typeof config.maxIterations === 'number' && config.maxIterations > 0) {
                        return config.maxIterations;
                    }
                }
                return MAX_LOOP_ITERATIONS;
            };
            const maxIterations = (node: DagNodeDefinition): number => {
                const config = isRecord(node.config) ? node.config : {};
                if (typeof config.maxIterations === 'number' && config.maxIterations > 0) return config.maxIterations;
                return loopNodes.has(node.id) ? loopMaxIterations() : 1;
            };

            const readyNodes = (): DagNodeDefinition[] => nodes.filter(node => {
                const iteration = (instances.get(node.id)?.length ?? 0) + 1;
                if (iteration > maxIterations(node) || skipped.has(node.id)) return false;
                // Loop 节点的每一轮都必须等自身上一轮结束，避免 Human 未回应时提前创建后续实例。
                if (iteration > 1 && !doneAt(node.id, iteration - 1)) return false;
                const incoming = incomingOf(edges, node.id);
                if (!incoming.length) return true;
                const active = incoming.filter(e => !backEdges.has(e.id) && (edgeState.get(e.id) ?? 'active') === 'active');
                const pending = incoming.filter(e => !backEdges.has(e.id) && (edgeState.get(e.id) ?? 'active') === 'pending');
                const backActive = incoming.filter(e => backEdges.has(e.id) && (edgeState.get(e.id) ?? 'active') === 'active');
                const backPending = incoming.filter(e => backEdges.has(e.id) && (edgeState.get(e.id) ?? 'active') === 'pending');

                if (!active.length && !pending.length && !backActive.length && !backPending.length) {
                    // 环上节点不永久 skip（Loop 中 route 边会重新激活）；非环节点才标记跳过。
                    if (!loopNodes.has(node.id)) skipped.add(node.id);
                    return false;
                }
                // 回边在首次迭代时不阻塞（循环体入口先执行一次），之后才等待前置。
                if (pending.length || (iteration > 1 && backPending.length)) return false;
                const activeReady = active.every(e => {
                    if (skipped.has(e.from)) return true;
                    // 环内前向边必须绑定同一轮上游；环外/外部输入仍等最新已完成实例。
                    return loopNodes.has(node.id) && loopNodes.has(e.from)
                        ? doneAt(e.from, iteration)
                        : latestDone(e.from);
                });
                // 回边在首次迭代时不阻塞；无回边约束时恒为 true。
                // 有派发记录（supervisor）时按「上一轮派发的 worker」串行等待；
                // 否则（普通 Loop）严格等待上一轮回边来源。
                let backReady = true;
                if (iteration > 1 && backActive.length > 0) {
                    backReady = dispatchOrder.length > 0
                        ? (dispatchOrder.length < iteration - 1 ? false : latestDone(dispatchOrder[iteration - 2]))
                        : backActive.every(e => doneAt(e.from, iteration - 1));
                }
                return activeReady && backReady;
            });

            const submitNode = async (node: DagNodeDefinition): Promise<void> => {
                const iteration = (instances.get(node.id)?.length ?? 0) + 1;
                const incoming = incomingOf(edges, node.id)
                    .filter(edge => (edgeState.get(edge.id) ?? 'active') === 'active')
                    .filter(edge => !backEdges.has(edge.id) || iteration > 1)
                    // 回边绑定每个来源的最新已完成实例：普通 Loop 恰好等于上一轮，
                    // supervisor 循环则累积所有已派发 worker 的结果；环内前向边绑定同一轮上游。
                    .filter(edge => !backEdges.has(edge.id) || latestDone(edge.from))
                    .filter(edge => instances.has(edge.from) && !skipped.has(edge.from));
                const upstreamHandle = (edge: DagEdgeDefinition): TaskHandle => {
                    const upstreamIteration = backEdges.has(edge.id)
                        ? instances.get(edge.from)?.length ?? 0
                        : loopNodes.has(node.id) && loopNodes.has(edge.from)
                            ? iteration
                            : instances.get(edge.from)?.length ?? 1;
                    return handleAt(edge.from, upstreamIteration);
                };
                for (const edge of incoming) {
                    const upstream = (await upstreamHandle(edge).status()).task;
                    if (upstream.status === 'succeeded') validateDataEdgeValue(edge, node, plugins, upstream.output);
                }
                const dependencies = incoming.map(edge => ({
                    taskId: upstreamHandle(edge).id,
                    input: edge.input,
                    output: edge.output,
                    edgeId: edge.id,
                    onFailure: edge.onFailure,
                    injectOutput: edge.kind !== 'control',
                }));
                const runtime = await plugins.loadRuntime(node.plugin, node.pluginVersion);
                const task = runtime.createTask({
                    sessionId,
                    nodeRunId: iteration === 1 ? node.id : `${node.id}#${iteration}`,
                    config: node.plugin === 'builtin.agent' && sessionContext
                        ? { ...record(node.config), sessionContext } : node.config,
                    inputs: node.inputs,
                    dependencies,
                });
                await this.emitHook('task.started', sessionId, { nodeId: node.id, iteration });
                // The generation keeps re-submissions after a graph retry distinct, while a
                // crash-recovery re-submission (same generation) still deduplicates.
                const requestId = published
                    ? `flow:${published.root.id}:${node.id}#${iteration}@${nodeGenerations.get(node.id) ?? 0}`
                    : undefined;
                const handle = await session.submit(await this.taskSpec(sessionId, node, task, dependencies, parameters, requestId));
                if (!instances.has(node.id)) instances.set(node.id, []);
                instances.get(node.id)!.push(handle);
                if (published) {
                    published.nodes.set(node.id, handle);
                    published.iterations.set(node.id, iteration);
                    published.taskIds.add(handle.id);
                    await session.setShared(`flow.run.${published.root.id}.members`, jsonValue(runMembers(instances, nodes, detachedNodes)));
                }
                await bindFlowTaskCapabilities(session, handle, task.programKind, node.capabilities ?? [], node.budget);
                if (published) await saveCheckpoint();
            };

            const applyPatch = async (patch: import('@itookit/common').GraphPatch, parentId: string): Promise<void> => {
                const fingerprint = graphPatchFingerprint(patch);
                const previous = appliedPatches.get(patch.idempotencyKey);
                if (previous !== undefined) {
                    if (previous !== fingerprint) throw new Error(`Graph patch ${patch.idempotencyKey}: idempotency conflict`);
                    return;
                }
                const additions = validateGraphPatch(patch, nodes, edges, parentId, plugins);
                if (nodes.length + patch.nodes.length > maxNodes) {
                    throw new Error(`Flow node limit exceeded by patch ${patch.idempotencyKey}: ${nodes.length + patch.nodes.length}/${maxNodes}`);
                }
                const boundNodes: DagNodeDefinition[] = [];
                for (const node of patch.nodes) {
                    const defaults = node.plugin === 'builtin.agent' ? nodeDefaults.get(parentId) : undefined;
                    const bound = this.options.bindPatchNode
                        ? await this.options.bindPatchNode(sessionId, structuredClone(node), structuredClone(defaults))
                        : defaults ? { config: mergeAgentConfig(defaults, record(node.config) as never) } : undefined;
                    const config = bound?.config === undefined ? node.config
                        : patchIdentityConfig(node.config, bound.config, node.capabilities ?? []);
                    const connection = nodeConnections.get(parentId);
                    const resolvedConfig = structuredClone(config);
                    if (connection) resolveNodeConnection(resolvedConfig as CommonJsonValue,
                        connection.connections, connection.defaultConnection, connection.fallbackConnectionId);
                    boundNodes.push({ ...node, config: resolvedConfig, inputs: bound?.inputs ?? node.inputs });
                }
                validateGraphPatch({ ...patch, nodes: boundNodes }, nodes, edges, parentId, plugins);
                nodes.push(...boundNodes);
                const defaults = nodeDefaults.get(parentId);
                if (defaults) for (const node of boundNodes) nodeDefaults.set(node.id, defaults);
                const connection = nodeConnections.get(parentId);
                if (connection) for (const node of boundNodes) nodeConnections.set(node.id, connection);
                edges.push(...additions);
                for (const edge of additions) edgeState.set(edge.id, 'active');
                appliedPatches.set(patch.idempotencyKey, fingerprint);
            };

            const applyEffects = async (output: unknown, parentId: string): Promise<void> => {
                for (const effect of graphEffects(output)) {
                    if (effect.type === 'activate-edge') {
                        edgeState.set(String(effect.edgeId), 'active');
                        const activated = edges.find(edge => edge.id === String(effect.edgeId));
                        // Only record dispatch order for back-edge sources (supervisor
                        // workers); an ordinary loop's exit branch must not re-arm the
                        // loop head through dispatchOrder.
                        if (activated && isBackEdgeSource(activated.to, backEdges, edges)) {
                            dispatchOrder.push(activated.to);
                        }
                    } else if (effect.type === 'disable-edge') {
                        edgeState.set(String(effect.edgeId), 'inactive');
                    } else if (effect.type === 'patch-graph') {
                        await applyPatch(effect.patch, parentId);
                    }
                }
            };

            // Dynamic delegation: parse the declaration once, then materialize a
            // bounded child group with explicit runtime metadata and control edges.
            const applyDelegation = async (key: string, output: unknown): Promise<void> => {
                const { nodeId, iteration: parentIteration } = parseInstanceKey(key);
                const node = nodes.find(n => String(n.id) === nodeId);
                if (!node) return;
                const depth = delegationDepth.get(nodeId) ?? 0;
                const plan = delegationPlan(node, key, parentIteration, depth, output);
                if (!plan) return;
                if (plan.detached && !plan.waitTimeoutMs) {
                    throw new Error(`Detached delegation requires wait.timeoutMs: ${plan.groupId}`);
                }
                const additions = plan.payloads.filter((_, index) =>
                    !nodes.some(existing => existing.id === `${plan.parentId}:delegate:${plan.parentIteration}:${index}`));
                if (nodes.length + additions.length > maxNodes) {
                    throw new Error(`Flow node limit exceeded by delegation ${plan.groupId}: ${nodes.length + additions.length}/${maxNodes}`);
                }
                materializeDelegation(node, plan, {
                    nodes, edges, edgeState, depths: delegationDepth,
                    groups: delegationGroups, groupByChild: delegationGroupByChild,
                });
                await this.emitHook('agent.spawned', sessionId, { parentNodeId: node.id, groupId: plan.groupId, count: plan.payloads.length });
                const group = delegationGroups.get(plan.groupId);
                const defaults = nodeDefaults.get(node.id);
                if (defaults && group) for (const child of group.children) nodeDefaults.set(child, defaults);
                const connection = nodeConnections.get(node.id);
                if (connection && group) for (const child of nodes.filter(item => group.children.has(item.id))) {
                    nodeConnections.set(child.id, connection);
                    resolveNodeConnection(child.config as CommonJsonValue,
                        connection.connections, connection.defaultConnection, connection.fallbackConnectionId);
                }
                if (group?.detached) {
                    if (workspace && workspacePolicy?.cleanup !== 'keep') {
                        throw new Error('Detached delegation requires workspace.cleanup=keep when using an isolated workspace');
                    }
                    for (const child of group.children) detachedNodes.add(child);
                    armDetachedTimer(plan.groupId, group);
                }
            };

            const settleDelegationGroup = async (key: string, succeeded: boolean): Promise<void> => {
                const { nodeId } = parseInstanceKey(key);
                const groupId = delegationGroupByChild.get(nodeId);
                const group = groupId ? delegationGroups.get(groupId) : undefined;
                if (!group) return;
                group.completed.add(nodeId);
                if (succeeded) group.succeeded.add(nodeId);
                const satisfied = group.waitMode === 'all'
                    ? group.completed.size >= group.children.size
                    : group.waitMode === 'any'
                        ? group.completed.size >= 1
                        : group.succeeded.size >= group.quorum;
                if (!satisfied && group.completed.size >= group.children.size
                    && (group.waitMode === 'first-success' || group.waitMode === 'quorum')) {
                    throw new Error(`Delegation ${group.waitMode} condition could not be satisfied`);
                }
                if (!satisfied || group.waitMode === 'all') return;
                const cancellations: Promise<void>[] = [];
                for (const childId of group.children) {
                    if (group.completed.has(childId)) continue;
                    skipped.add(childId);
                    for (const handle of instances.get(childId) ?? []) {
                        cancellations.push(handle.cancel(`Delegation ${group.waitMode} condition satisfied`));
                    }
                }
                await Promise.allSettled(cancellations);
            };

            // Detached groups outlive their parent node, so their deadline timer lives in
            // the scheduler, not in the task. `armedTimers` keeps a restored group from
            // being armed twice (once at materialization, once at restore).
            const armedTimers = new Set<string>();
            const armDetachedTimer = (groupId: string, group: DelegationGroup): void => {
                if (!group.detached || !group.deadline || armedTimers.has(groupId)) return;
                armedTimers.add(groupId);
                const timer = setTimeout(() => {
                    if (delegationGroups.get(groupId) !== group) return;
                    void cancelGroup(group, instances, completed, skipped, `Detached delegation timeout: ${groupId}`);
                }, Math.max(0, group.deadline - Date.now()));
                (timer as unknown as { unref?: () => void }).unref?.();
            };

            const enforceDeadlines = async (): Promise<void> => {
                if (timeoutMs && Date.now() - startedAt >= timeoutMs) {
                    await cancelPending(instances, completed, 'Flow timeout exceeded');
                    throw new Error(`Flow timeout exceeded after ${timeoutMs}ms`);
                }
                for (const [groupId, group] of delegationGroups) {
                    if (group.detached || !group.deadline || Date.now() < group.deadline) continue;
                    await cancelGroup(group, instances, completed, skipped, `Delegation timeout: ${groupId}`);
                    throw new Error(`Delegation group timed out: ${groupId}`);
                }
            };

            const failDelegationGroup = async (key: string, message?: string): Promise<void> => {
                const { nodeId } = parseInstanceKey(key);
                const groupId = delegationGroupByChild.get(nodeId);
                const group = groupId ? delegationGroups.get(groupId) : undefined;
                if (!group || group.policy === 'continue') return;
                const cancellations: Promise<void>[] = [];
                for (const childId of group.children) {
                    if (childId === nodeId) continue;
                    skipped.add(childId);
                    for (const [index, handle] of (instances.get(childId) ?? []).entries()) {
                        if (!completed.has(instanceKey(childId, index + 1))) {
                            cancellations.push(handle.cancel(`Delegation sibling failed: ${nodeId}`));
                        }
                    }
                }
                await Promise.allSettled(cancellations);
                throw new Error(message ?? `Delegated task failed: ${nodeId}`);
            };

            // Saga 补偿链：节点失败时，先补偿失败节点自身，再沿依赖链反向补偿
            // 所有已成功的上游节点（最后成功的先补偿），对应 Compensate B → Compensate A。
            const compensateChain = async (key: string): Promise<void> => {
                const failedNodeId = parseInstanceKey(key).nodeId;
                const failedNode = nodes.find(item => item.id === failedNodeId);
                const compensations: string[] = [];
                if (failedNode?.compensate) compensations.push(failedNode.compensate);
                for (const upstreamId of upstreamOf(edges, failedNodeId)) {
                    const upstream = nodes.find(item => item.id === upstreamId);
                    if (upstream?.compensate) compensations.push(upstream.compensate);
                }
                for (const compensateId of compensations) {
                    const compensation = nodes.find(item => item.id === compensateId);
                    if (!compensation || instances.has(compensateId)) continue;
                    await submitNode(compensation);
                }
            };

            // A node failure is explicitly tolerated when an outgoing edge says
            // onFailure=continue, or when it belongs to a continue delegation group.
            const toleratedFailureNodes = (): Set<string> => {
                const tolerated = new Set<string>();
                for (const node of nodes) {
                    if (edges.some(edge => edge.from === node.id && edge.onFailure === 'continue')) {
                        tolerated.add(String(node.id));
                    }
                }
                for (const group of delegationGroups.values()) {
                    // continue 组保留兄弟失败；any/first-success/quorum 组会主动取消
                    // 未获胜兄弟，这些终态也不应让整个 Run 失败。
                    if (group.policy !== 'continue' && group.waitMode === 'all') continue;
                    for (const child of group.children) tolerated.add(child);
                }
                return tolerated;
            };

            // A restored host lost the old process's detached-delegation timers; re-arm
            // them from the persisted absolute deadline before scheduling resumes.
            for (const [groupId, group] of delegationGroups) armDetachedTimer(groupId, group);

            /**
             * Consume pending graph-retry intents: the retry becomes the node's newest
             * instance and every downstream node drops its committed work so the loop
             * recomputes it from the retry's output. Returns the number applied.
             */
            const applyGraphRetries = async (): Promise<number> => {
                if (!published) return 0;
                const key = graphRetryKey(published.root.id);
                let applied = 0;
                for (let attempt = 0; attempt < 5; attempt++) {
                    const saved = await session.getShared(key);
                    const intents = Array.isArray(saved?.value) ? saved!.value as unknown as FlowGraphRetryIntent[] : [];
                    const pending = intents.filter(intent => !intent.applied);
                    if (!pending.length) return applied;
                    for (const intent of pending) await applyGraphRetry(intent);
                    const next = intents.map(intent => intent.applied ? intent : { ...intent, applied: true });
                    try {
                        await session.setShared(key, next as unknown as JsonValue,
                            { expectedVersion: saved?.version ?? null });
                        applied += pending.length;
                        break;
                    } catch (error) { if (attempt === 4) throw error; }
                }
                if (applied) {
                    await session.setShared(`flow.run.${published.root.id}.members`,
                        jsonValue(runMembers(instances, nodes, detachedNodes)));
                    await saveCheckpoint();
                }
                return applied;
            };

            // Discard a delegation's materialized children so recomputing the parent
            // re-delegates from scratch instead of reusing stale children and edges.
            const discardDelegationGroups = async (parentNodeId: string, reason: string): Promise<void> => {
                for (const [groupId, group] of [...delegationGroups]) {
                    if (!groupId.startsWith(`${parentNodeId}#`)) continue;
                    for (const childId of group.children) {
                        await discardDelegationGroups(childId, reason);
                        for (const [index, handle] of (instances.get(childId) ?? []).entries()) {
                            const key = instanceKey(childId, index + 1);
                            if (completed.has(key)) {
                                const snapshot = await handle.status().catch(() => undefined);
                                if (snapshot) consumedTokens = Math.max(0, consumedTokens - outputTokens(snapshot.task.output));
                            } else {
                                await handle.cancel(reason).catch(() => undefined);
                            }
                            published?.taskIds.delete(handle.id);
                            completed.delete(key);
                        }
                        instances.delete(childId);
                        published?.nodes.delete(childId);
                        published?.iterations.delete(childId);
                        skipped.delete(childId);
                        detachedNodes.delete(childId);
                        delegationDepth.delete(childId);
                        delegationGroupByChild.delete(childId);
                        // Bump the generation so re-materialized children submit with a fresh
                        // requestId instead of replaying the discarded Task.
                        nodeGenerations.set(childId, (nodeGenerations.get(childId) ?? 0) + 1);
                        nodeDefaults.delete(childId);
                        nodeConnections.delete(childId);
                        const childIndex = nodes.findIndex(node => String(node.id) === childId);
                        if (childIndex >= 0) nodes.splice(childIndex, 1);
                    }
                    const removed = edges.filter(edge => group.children.has(String(edge.from)) || group.children.has(String(edge.to)));
                    for (const edge of removed) edgeState.delete(edge.id);
                    edges.splice(0, edges.length, ...edges.filter(edge => !removed.includes(edge)));
                    delegationGroups.delete(groupId);
                    armedTimers.delete(groupId);
                }
            };

            const applyGraphRetry = async (intent: FlowGraphRetryIntent): Promise<void> => {
                if (!published) return;
                const source = String(intent.sourceNodeId);
                // Retrying a delegation parent drops its group; its children are gone, so a
                // synthetic child can only be retried through its parent.
                await discardDelegationGroups(source, `Graph retry of ${source}`);
                const handles = instances.get(source) ?? [];
                if (!handles.some(handle => handle.id === intent.retryTaskId)) {
                    const retry = await session.attachTask(intent.retryTaskId);
                    handles.push(retry as TaskHandle);
                    instances.set(source, handles);
                    published.nodes.set(source, retry as TaskHandle);
                    published.iterations.set(source, handles.length);
                    published.taskIds.add(intent.retryTaskId);
                }
                for (const nodeId of intent.downstream) {
                    nodeGenerations.set(nodeId, (nodeGenerations.get(nodeId) ?? 0) + 1);
                    await discardDelegationGroups(nodeId, `Graph retry of ${source}`);
                    for (const [index, handle] of (instances.get(nodeId) ?? []).entries()) {
                        const key = instanceKey(nodeId, index + 1);
                        if (completed.has(key)) {
                            // A committed instance is discarded and will be recomputed: refund its
                            // measured token cost so the Run budget is not charged twice for it.
                            const snapshot = await handle.status().catch(() => undefined);
                            if (snapshot) consumedTokens = Math.max(0, consumedTokens - outputTokens(snapshot.task.output));
                        } else {
                            await handle.cancel(`Graph retry of ${source}`).catch(() => undefined);
                        }
                        completed.delete(key);
                    }
                    instances.delete(nodeId);
                    published.nodes.delete(nodeId);
                    published.iterations.delete(nodeId);
                    skipped.delete(nodeId);
                    // Route decisions are re-taken; ordinary data edges simply become active.
                    for (const edge of edges.filter(item => String(item.to) === nodeId)) {
                        edgeState.set(edge.id, routeEdgeIds.has(edge.id) ? 'pending' : 'active');
                    }
                }
            };

            // Persist the aggregate root before the first node is scheduled: it is the
            // Run's durable anchor, and the scheduler checkpoint is keyed by its id, so
            // creating it up front lets a crash at any later point resume from committed
            // state instead of restarting the whole graph.
            if (!published) {
                published = await this.finish(session, instances, nodes, detachedNodes, spec.goal, {
                    tokens: consumedTokens, startedAt, elapsedMs: Date.now() - startedAt,
                }, delegationGroups, completionOrder, undefined, true, toleratedFailureNodes());
                await saveCheckpoint();
                // The lease record is what lets a new host restore this workspace.
                if (workspace?.record !== undefined) {
                    await session.setShared(workspaceLeaseKey(published.root.id), workspace.record);
                }
                lease = await this.acquireLease(session, published.root.id);
            }
            if (restored) publish(published);
            // Graph retries accepted while no scheduler owned the Run are applied before the
            // next scheduling turn: attach the retry instance and drop stale downstream work.
            await applyGraphRetries();
            while (true) {
                // Fencing: a host that lost the Run's scheduler lease must stop before its
                // next step, even if its own event stream is still delivering. Stopping is
                // not a Run failure — the new owner continues the same Run.
                try { await lease?.assertOwned(); }
                catch (error) {
                    if (!isSchedulerOwnershipLost(error)) throw error;
                    return published;
                }
                if (published && this.options.kernel.isDisposed) return published;
                if (published && (await published.root.status()).task.status === 'cancelled') {
                    throw new Error('Flow run cancelled');
                }
                await enforceDeadlines();
                const activeCount = [...instances.entries()].reduce((count, [nodeId, handles]) =>
                    count + (detachedNodes.has(nodeId) ? 0 : handles.filter((_, index) =>
                        !completed.has(instanceKey(nodeId, index + 1))).length), 0);
                const capacity = Math.max(0, maxConcurrency - activeCount);
                for (const node of readyNodes().slice(0, capacity)) await submitNode(node);
                const pending = [...instances.entries()].flatMap(([nodeId, handles]) =>
                    detachedNodes.has(nodeId) ? [] :
                    handles.map((handle, index) => ({ key: instanceKey(nodeId, index + 1), handle }))
                        .filter(({ key }) => !completed.has(key)));
                if (!pending.length) {
                    if (readyNodes().length) continue;
                    break;
                }
                // Publish a waiting Run while keeping the scheduler alive for the response.
                const settled = await Promise.race(pending.map(async ({ key, handle }) => {
                    try {
                        const exit = await handle.wait({ timeoutMs: 100 });
                        return { key, exit };
                    } catch {
                        const snapshot = await handle.status();
                        if (Object.values(snapshot.task.interactions ?? {}).some(record => record.status === 'pending')) {
                            return { key, interaction: true as const };
                        }
                        return { key, tick: true as const };
                    }
                }));
                if (published && this.options.kernel.isDisposed) return published;
                if ('interaction' in settled) {
                    // The root already exists; publishing here releases `submit` for
                    // interactive Runs so the host can respond while the graph waits.
                    await saveCheckpoint();
                    publish(published);
                    continue;
                }
                if ('tick' in settled) continue;
                completed.add(settled.key);
                completionOrder.push(parseInstanceKey(settled.key).nodeId);
                consumedTokens += outputTokens(settled.exit.output);
                if (maxTokens && consumedTokens > maxTokens) {
                    await cancelPending(instances, completed, 'Flow token budget exceeded');
                    throw new Error(`Flow token budget exceeded: ${consumedTokens}/${maxTokens}`);
                }
                await settleDelegationGroup(settled.key, settled.exit.status === 'succeeded');
                await this.emitHook(settled.exit.status === 'failed' ? 'task.failed' : 'task.completed', sessionId, {
                    nodeId: parseInstanceKey(settled.key).nodeId,
                    taskId: pending.find(item => item.key === settled.key)?.handle.id,
                    status: settled.exit.status,
                });
                if (delegationGroupByChild.has(parseInstanceKey(settled.key).nodeId)) {
                    await this.emitHook('agent.stopped', sessionId, {
                        nodeId: parseInstanceKey(settled.key).nodeId,
                        status: settled.exit.status,
                    });
                }
                if (settled.exit.status === 'failed') {
                    await compensateChain(settled.key);
                    await failDelegationGroup(settled.key, settled.exit.error?.message);
                }
                await applyEffects(settled.exit.output, parseInstanceKey(settled.key).nodeId);
                await applyDelegation(settled.key, settled.exit.output);
                await saveCheckpoint();
            }

            const result = await this.finish(session, instances, nodes, detachedNodes, spec.goal, {
                tokens: consumedTokens, startedAt, elapsedMs: Date.now() - startedAt,
            }, delegationGroups, completionOrder, published, false, toleratedFailureNodes());
            if (workspace) {
                const finalization = await beginWorkspaceFinalization(session, result.root, workspace);
                result.workspaceCompletion = finalization.completion;
                result.workspaceFinalization = finalization.state;
            }
            void result.root.wait().then(exit => this.emitHook('run.completed', sessionId, {
                taskId: result.root.id, status: exit.status,
            })).catch(() => undefined);
            return result;
        } catch (error) {
            if (published && !this.options.kernel.isDisposed) await published.root.signal({ type: 'flow.schedule.failed', payload: String(error) });
            await cancelPending(instances, completed, 'Flow submission failed');
            try { await workspace?.finish('failed'); }
            catch (cleanupError) { throw new AggregateError([error, cleanupError], 'Flow failed and workspace cleanup failed'); }
            throw error;
        } finally {
            // Releasing lets the next host resume without waiting for the TTL; a crashed
            // host cannot run this, so its lease expires instead.
            await lease?.release();
        }
    }

    private acquireLease(session: SessionHandle, rootTaskId: string): Promise<SchedulerLease> {
        return acquireSchedulerLease(session, rootTaskId, {
            ...(this.options.schedulerLeaseTtlMs ? { ttlMs: this.options.schedulerLeaseTtlMs } : {}),
            ...(this.options.schedulerOwnerId ? { ownerId: this.options.schedulerOwnerId } : {}),
        });
    }

    private async finish(
        session: SessionHandle,
        instances: Map<string, TaskHandle[]>,
        nodes: DagNodeDefinition[],
        detachedNodes: Set<string> = new Set(),
        goal?: import('@itookit/common').FlowRunGoal,
        usage: FlowExecutionHandle['usage'] = { tokens: 0, startedAt: Date.now(), elapsedMs: 0 },
        delegationGroups: Map<string, DelegationGroup> = new Map(),
        completionOrder: string[] = [],
        existing?: FlowExecutionHandle,
        awaitingSchedule = false,
        toleratedFailures: Set<string> = new Set(),
    ): Promise<FlowExecutionHandle> {
        const root = await this.aggregate(session, instances, nodes, detachedNodes, delegationGroups, completionOrder, { goal, usage }, existing?.root, awaitingSchedule, toleratedFailures);
        if (existing) {
            // The handle is published before the graph finishes, so refresh the fields
            // that only become final here instead of leaving a stale snapshot.
            existing.usage = usage;
            existing.goal = goal;
            existing.detachedNodes = detachedNodes;
            return existing;
        }
        return {
            sessionId: session.id,
            root,
            nodes: new Map([...instances.entries()].map(([id, handles]) => [id, handles[handles.length - 1]])),
            iterations: new Map([...instances.entries()].map(([id, handles]) => [id, handles.length])),
            goal,
            detachedNodes,
            taskIds: new Set([...instances.values()].flatMap(handles => handles.map(handle => handle.id)).concat(root.id)),
            usage,
        };
    }

    private async taskSpec(
        sessionId: string,
        node: DagNodeDefinition,
        task: import('@itookit/common').DagTaskDefinition,
        dependencies: import('@itookit/common').DagTaskDependencyBinding[],
        parameters?: Record<string, CommonJsonValue>,
        requestId?: string,
    ): Promise<TaskSpec<unknown>> {
        const allowed = node.capabilities ?? [];
        const catalog = await this.options.resolveTools?.(sessionId, allowed)
            ?? { definitions: [], externalIds: [] };
        const subtaskTool = subtaskToolName(node.config);
        const subtaskDescription = subtaskToolDescription(node.config);
        const input = task.programKind === 'llm.agent'
            ? {
                ...record(task.input),
                tools: [...catalog.definitions, ...(subtaskTool ? [subtaskToolDef(subtaskTool, subtaskDescription)] : [])],
                externalToolIds: catalog.externalIds,
                allowedToolIds: allowed,
            }
            : task.programKind === 'flow.value'
                ? { ...record(task.input), parameters }
                : task.input;
        return {
            ...(requestId ? { requestId } : {}),
            program: { kind: task.programKind, version: task.programVersion },
            input: jsonValue(input),
            dependsOn: dependencies.map(binding => ({
                task: binding.taskId,
                ...(binding.onFailure ? { onFailure: binding.onFailure } : {}),
            })),
            retry: node.retry,
            priority: node.priority ?? task.priority,
            labels: { flowNodeId: node.id, plugin: node.plugin },
            deferStart: task.programKind === 'llm.agent' || task.programKind === 'llm.chat',
        };
    }

    private async emitHook(
        event: HarnessHookEvent,
        sessionId: string,
        payload: Record<string, unknown>,
    ): Promise<void> {
        if (!this.options.hooks) return;
        const hook = this.options.hooks;
        if (!hook.descriptor.trusted || !hook.descriptor.contentHash || !hook.descriptor.source) {
            throw new Error(`Harness hook is not trusted: ${hook.descriptor.source || 'unknown source'}`);
        }
        const result = await withTimeout(
            hook.emit({ event, sessionId, payload: jsonValue(payload) }),
            positiveInteger(hook.descriptor.timeoutMs) ?? 5_000,
            `Harness hook timed out: ${event}`,
        );
        if (result?.message && result.message.length > (positiveInteger(hook.descriptor.maxMessageLength) ?? 4_096)) {
            throw new Error(`Harness hook output is too large: ${event}`);
        }
        if (result?.action === 'deny') throw new Error(result.message ?? `Harness hook denied ${event}`);
    }

    private async prepareWorkspace(sessionId: string, policy: FlowWorkspacePolicy): Promise<FlowWorkspaceLease> {
        if (!this.options.workspaceManager) {
            throw new Error(`Flow workspace mode ${policy.mode} requires a configured workspace manager`);
        }
        return this.options.workspaceManager.prepare(sessionId, policy);
    }

    private async aggregate(
        session: SessionHandle,
        instances: Map<string, TaskHandle[]>,
        nodes: DagNodeDefinition[],
        detachedNodes: Set<string>,
        delegationGroups: Map<string, DelegationGroup>,
        completionOrder: string[],
        run: { goal?: import('@itookit/common').FlowRunGoal; usage: FlowExecutionHandle['usage'] },
        existing?: TaskHandle<JsonValue>,
        awaitingSchedule = false,
        toleratedFailures: Set<string> = new Set(),
    ): Promise<TaskHandle<JsonValue>> {
        // Nodes with persistOutput === false keep feeding downstream nodes via
        // dependencies but are excluded from the flow-root output map. They must
        // still participate in run success/failure judgment.
        const suppressed = new Set(nodes
            .filter(node => isRecord(node.config) && node.config.persistOutput === false)
            .map(node => String(node.id)));
        const dependencies = orderDelegationResults([...instances.entries()]
            .filter(([nodeId]) => !detachedNodes.has(nodeId))
            .map(([nodeId, handles]) => ({
                taskId: handles[handles.length - 1].id,
                nodeId,
                tolerated: toleratedFailures.has(nodeId),
                collectOutput: !suppressed.has(nodeId),
            })), delegationGroups, completionOrder);
        const input = { dependencies, awaitingSchedule, run: jsonValue({ version: 1, goal: run.goal ?? null, usage: run.usage }),
            runTasks: runMembers(instances, nodes, detachedNodes) };
        if (existing) {
            await session.setShared(`flow.run.${existing.id}.members`, jsonValue(input.runTasks));
            await session.setShared(`flow.run.${existing.id}.metadata`, input.run);
            await existing.signal({ type: 'flow.schedule.completed', payload: jsonValue(input) });
            return existing;
        }
        return session.submit({
            program: { kind: 'flow.aggregate', version: '1' }, input,
            // 汇聚节点在任一依赖终态后聚合；非容忍 failed 依赖由 FlowAggregateProgram
            // 使根失败，显式 on_failure: continue 或委派策略容忍的失败继续完成并记录。
            dependsOn: awaitingSchedule ? [] : dependencies.map(item => ({ task: item.taskId, condition: 'terminal' })),
            labels: { kind: 'flow-root' },
        });
    }
}


function instanceKey(nodeId: string, iteration: number): string {
    return `${nodeId}#${iteration}`;
}

function parseInstanceKey(key: string): { nodeId: string; iteration: number } {
    const separator = key.lastIndexOf('#');
    if (separator < 0) return { nodeId: key, iteration: 1 };
    const iteration = Number(key.slice(separator + 1));
    return {
        nodeId: key.slice(0, separator),
        iteration: Number.isInteger(iteration) && iteration > 0 ? iteration : 1,
    };
}


/** True when `nodeId` is the source of a back edge (a loop re-entry worker). */
function isBackEdgeSource(
    nodeId: string,
    backEdges: Set<string>,
    edges: DagEdgeDefinition[],
): boolean {
    for (const edgeId of backEdges) {
        if (edges.find(edge => edge.id === edgeId)?.from === nodeId) return true;
    }
    return false;
}

/** 收集 route 节点声明的出边 id（含默认边；这些边默认 pending，等 route 决定激活/禁用）。 */
function collectRouteEdgeIds(spec: DagRunSpec): Set<string> {
    const ids = new Set<string>();
    for (const node of spec.nodes) {
        if (node.plugin !== 'builtin.route' || !isRecord(node.config)) continue;
        const rules = Array.isArray(node.config.rules) ? node.config.rules : [];
        for (const rule of rules.filter(isRecord)) {
            const edgeId = String(rule.edgeId ?? '').trim();
            if (edgeId) ids.add(edgeId);
        }
        if (typeof node.config.defaultEdgeId === 'string' && node.config.defaultEdgeId.trim()) {
            ids.add(node.config.defaultEdgeId.trim());
        }
    }
    return ids;
}

function incomingOf(edges: DagEdgeDefinition[], nodeId: string): DagEdgeDefinition[] {
    return edges.filter(edge => edge.to === nodeId);
}

/** 反向 BFS：返回 nodeId 的所有祖先（入边可达），距离近的在前。 */
export function upstreamOf(edges: DagEdgeDefinition[], nodeId: string): string[] {
    const result: string[] = [];
    const visited = new Set<string>([nodeId]);
    const queue = [nodeId];
    while (queue.length) {
        const current = queue.shift()!;
        for (const edge of edges) {
            if (edge.to !== current || visited.has(edge.from)) continue;
            visited.add(edge.from);
            result.push(edge.from);
            queue.push(edge.from);
        }
    }
    return result;
}

function graphEffects(output: unknown): GraphEffect[] {
    if (!isRecord(output) || !Array.isArray(output.effects)) return [];
    return output.effects.filter(isRecord).map(effect => effect as unknown as GraphEffect);
}

function jsonValue(value: unknown): JsonValue {
    return JSON.parse(JSON.stringify(value ?? null)) as JsonValue;
}

function record(value: unknown): Record<string, CommonJsonValue> {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, CommonJsonValue>
        : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function positiveInteger(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
}

function outputTokens(output: unknown): number {
    if (!isRecord(output) || !isRecord(output.usage)) return 0;
    const total = output.usage.totalTokens ?? output.usage.total_tokens;
    return typeof total === 'number' && Number.isFinite(total) && total > 0 ? total : 0;
}

async function cancelPending(
    instances: Map<string, TaskHandle[]>,
    completed: Set<string>,
    reason: string,
): Promise<void> {
    const cancellations: Promise<void>[] = [];
    for (const [nodeId, handles] of instances) {
        for (const [index, handle] of handles.entries()) {
            if (!completed.has(instanceKey(nodeId, index + 1))) cancellations.push(handle.cancel(reason));
        }
    }
    await Promise.allSettled(cancellations);
}

async function cancelGroup(
    group: DelegationGroup,
    instances: Map<string, TaskHandle[]>,
    completed: Set<string>,
    skipped: Set<string>,
    reason: string,
): Promise<void> {
    const cancellations: Promise<void>[] = [];
    for (const childId of group.children) {
        skipped.add(childId);
        for (const [index, handle] of (instances.get(childId) ?? []).entries()) {
            if (!completed.has(instanceKey(childId, index + 1))) cancellations.push(handle.cancel(reason));
        }
    }
    await Promise.allSettled(cancellations);
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            promise,
            new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(message)), timeoutMs); }),
        ]);
    } finally {
        if (timer !== undefined) clearTimeout(timer);
    }
}

function orderDelegationResults<T extends { nodeId: string }>(
    values: T[],
    groups: Map<string, DelegationGroup>,
    completionOrder: string[],
): T[] {
    const result = [...values];
    const rank = new Map(completionOrder.map((nodeId, index) => [nodeId, index]));
    for (const group of groups.values()) {
        if (group.resultOrder !== 'completion') continue;
        const positions = result.map((value, index) => group.children.has(value.nodeId) ? index : -1).filter(index => index >= 0);
        const ordered = positions.map(index => result[index])
            .sort((left, right) => (rank.get(left.nodeId) ?? Number.MAX_SAFE_INTEGER) - (rank.get(right.nodeId) ?? Number.MAX_SAFE_INTEGER));
        positions.forEach((position, index) => { result[position] = ordered[index]; });
    }
    return result;
}

function runMembers(instances: Map<string, TaskHandle[]>, nodes: DagNodeDefinition[], detached: Set<string>) {
    return [...instances.entries()].flatMap(([nodeId, handles]) => handles.map((handle, index) => ({
        nodeId, taskId: handle.id, iteration: index + 1, detached: detached.has(nodeId),
        budget: jsonValue(nodes.find(node => node.id === nodeId)?.budget ?? {}),
    })));
}
