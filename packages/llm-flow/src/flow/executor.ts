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
    bindCapabilities,
    type CapabilityBinding,
    type Kernel,
    type JsonValue,
    type SessionHandle,
    type TaskHandle,
    type TaskSpec,
} from '@itookit/durable-kernel';
import { findCycles } from './graph';
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
    root: TaskHandle<JsonValue>;
    nodes: Map<string, TaskHandle>;
    /** 每个节点实际执行的实例数（Loop 节点会大于 1）。 */
    iterations: Map<string, number>;
}

export interface DurableFlowExecutorOptions {
    kernel: Kernel;
    plugins: DagPluginCatalog;
    resolveTools?(sessionId: string, allowedIds: string[]): Promise<{
        definitions: ToolDefinition[];
        externalIds: string[];
    }>;
}

const MAX_LOOP_ITERATIONS = 100;

export class DurableFlowExecutor {
    constructor(private readonly options: DurableFlowExecutorOptions) {}

    async submit(
        sessionId: string,
        spec: DagRunSpec,
        parameters?: Record<string, CommonJsonValue>,
    ): Promise<FlowExecutionHandle> {
        const session = await this.options.kernel.openSession(sessionId);
        const routeEdgeIds = collectRouteEdgeIds(spec);
        const { backEdges, loopNodes } = findCycles(spec.nodes, spec.edges);
        const nodes = parameters
            ? spec.nodes.map(node => ({
                ...node,
                config: resolveFlowParameters(node.config, parameters) as DagNodeDefinition['config'],
                inputs: resolveFlowParameters(node.inputs, parameters) as DagNodeDefinition['inputs'],
            }))
            : [...spec.nodes];
        const edges = [...spec.edges];
        const instances = new Map<string, TaskHandle[]>();
        const delegationDepth = new Map(nodes.map(node => [String(node.id), 0]));
        const delegationGroups = new Map<string, DelegationGroup>();
        const delegationGroupByChild = new Map<string, string>();
        const completed = new Set<string>();
        const skipped = new Set<string>();
        // 已派发的节点（按派发顺序），用于 supervisor 的「每轮只等本轮派发的 worker」。
        const dispatchOrder: string[] = [];
        const edgeState = new Map<string, EdgeState>(
            edges.map(edge => [edge.id, routeEdgeIds.has(edge.id) ? 'pending' : 'active']),
        );

        const latestHandle = (nodeId: string): TaskHandle => {
            const handles = instances.get(nodeId);
            if (!handles?.length) throw new Error(`Flow node has no instance: ${nodeId}`);
            return handles[handles.length - 1];
        };
        const latestDone = (nodeId: string): boolean => {
            const handles = instances.get(nodeId);
            if (!handles?.length) return false;
            return completed.has(instanceKey(nodeId, handles.length));
        };
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
            const activeReady = active.every(e => latestDone(e.from) || skipped.has(e.from));
            // 回边在首次迭代时不阻塞；无回边约束时恒为 true。
            // 有派发记录（supervisor）时按「上一轮派发的 worker」串行等待；
            // 否则（普通 Loop）等所有回边完成。
            let backReady = true;
            if (iteration > 1 && backActive.length > 0) {
                backReady = dispatchOrder.length > 0
                    ? (dispatchOrder.length < iteration - 1 ? false : latestDone(dispatchOrder[iteration - 2]))
                    : backActive.every(e => latestDone(e.from));
            }
            return activeReady && backReady;
        });

        const submitNode = async (node: DagNodeDefinition): Promise<void> => {
            const iteration = (instances.get(node.id)?.length ?? 0) + 1;
            const incoming = incomingOf(edges, node.id)
                .filter(edge => (edgeState.get(edge.id) ?? 'active') === 'active')
                .filter(edge => !backEdges.has(edge.id) || iteration > 1)
                // 回边只绑定已完成的 worker（supervisor 每次只等刚派发的那个）。
                .filter(edge => !backEdges.has(edge.id) || latestDone(edge.from))
                .filter(edge => instances.has(edge.from) && !skipped.has(edge.from));
            const dependencies = incoming.map(edge => ({
                taskId: latestHandle(edge.from).id,
                input: edge.input,
                output: edge.output,
                edgeId: edge.id,
                onFailure: edge.onFailure,
                injectOutput: edge.kind !== 'control',
            }));
            const runtime = await this.options.plugins.loadRuntime(node.plugin, node.pluginVersion);
            const task = runtime.createTask({
                sessionId,
                nodeRunId: iteration === 1 ? node.id : `${node.id}#${iteration}`,
                config: node.config,
                inputs: node.inputs,
                dependencies,
            });
            const handle = await session.submit(await this.taskSpec(sessionId, node, task, dependencies, parameters));
            if (!instances.has(node.id)) instances.set(node.id, []);
            instances.get(node.id)!.push(handle);
            await this.bindCapabilities(session, handle, task.programKind, node.capabilities ?? [], node.budget);
        };

        const applyPatch = (patch: import('@itookit/common').GraphPatch): void => {
            for (const node of patch.nodes) {
                if (!nodes.some(existing => existing.id === node.id)) nodes.push(node);
            }
            for (const edge of patch.edges) {
                const id = edge.id ?? `${edge.from}->${edge.to}`;
                if (!edges.some(existing => existing.id === id)) {
                    edges.push({
                        id,
                        from: edge.from,
                        to: edge.to,
                        output: edge.output ?? 'result',
                        input: edge.input ?? 'input',
                        kind: edge.kind,
                    });
                    edgeState.set(id, 'active');
                }
            }
        };

        const applyEffects = (output: unknown): void => {
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
                    applyPatch(effect.patch);
                }
            }
        };

        // Dynamic delegation: parse the declaration once, then materialize a
        // bounded child group with explicit runtime metadata and control edges.
        const applyDelegation = (key: string, output: unknown): void => {
            const { nodeId, iteration: parentIteration } = parseInstanceKey(key);
            const node = nodes.find(n => String(n.id) === nodeId);
            if (!node) return;
            const depth = delegationDepth.get(nodeId) ?? 0;
            const plan = delegationPlan(node, key, parentIteration, depth, output);
            if (!plan) return;
            materializeDelegation(node, plan, {
                nodes, edges, edgeState, depths: delegationDepth,
                groups: delegationGroups, groupByChild: delegationGroupByChild,
            });
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

        while (true) {
            for (const node of readyNodes()) await submitNode(node);
            const pending = [...instances.entries()].flatMap(([nodeId, handles]) =>
                handles.map((handle, index) => ({ key: instanceKey(nodeId, index + 1), handle }))
                    .filter(({ key }) => !completed.has(key)));
            if (!pending.length) break;
            // 事件驱动等待任一未完成节点：终态则继续调度；超时则检查是否进入 pending
            // interaction，是则让出控制权，交由调用方 respond 后通过 resume 继续驱动。
            const settled = await Promise.race(pending.map(async ({ key, handle }) => {
                while (true) {
                    try {
                        const exit = await handle.wait({ timeoutMs: 100 });
                        return { key, exit };
                    } catch {
                        const snapshot = await handle.status();
                        if (Object.values(snapshot.task.interactions ?? {}).some(record => record.status === 'pending')) {
                            return { key, interaction: true as const };
                        }
                    }
                }
            }));
            if ('interaction' in settled) return this.finish(session, instances, nodes);
            completed.add(settled.key);
            if (settled.exit.status === 'failed') {
                await compensateChain(settled.key);
                await failDelegationGroup(settled.key, settled.exit.error?.message);
            }
            applyEffects(settled.exit.output);
            applyDelegation(settled.key, settled.exit.output);
        }

        return this.finish(session, instances, nodes);
    }

    private async finish(
        session: SessionHandle,
        instances: Map<string, TaskHandle[]>,
        nodes: DagNodeDefinition[],
    ): Promise<FlowExecutionHandle> {
        const root = await this.aggregate(session, instances, nodes);
        return {
            root,
            nodes: new Map([...instances.entries()].map(([id, handles]) => [id, handles[handles.length - 1]])),
            iterations: new Map([...instances.entries()].map(([id, handles]) => [id, handles.length])),
        };
    }

    private async taskSpec(
        sessionId: string,
        node: DagNodeDefinition,
        task: import('@itookit/common').DagTaskDefinition,
        dependencies: import('@itookit/common').DagTaskDependencyBinding[],
        parameters?: Record<string, CommonJsonValue>,
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
            }
            : task.programKind === 'flow.value'
                ? { ...record(task.input), parameters }
                : task.input;
        return {
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

    private async bindCapabilities(
        session: SessionHandle,
        task: TaskHandle,
        programKind: string,
        toolIds: string[],
        budget?: Record<string, number>,
    ): Promise<void> {
        if (programKind !== 'llm.agent' && programKind !== 'llm.chat') return;
        await bindCapabilities(task, [
            { kind: 'llm', uri: 'llm://flow', rights: ['execute', 'admin'], signalKey: 'llmHandleId' },
            ...(toolIds.length ? [{ kind: 'tool', uri: 'tool://flow', rights: ['execute'], signalKey: 'toolHandleId' } satisfies CapabilityBinding] : []),
        ] satisfies CapabilityBinding[], async (binding, handleId) => {
            if (binding.kind === 'llm') {
                for (const [dimension, limit] of Object.entries(budget ?? {})) {
                    await session.setBudget(handleId, dimension, limit);
                }
            }
        });
    }

    private async aggregate(
        session: SessionHandle,
        instances: Map<string, TaskHandle[]>,
        nodes: DagNodeDefinition[],
    ): Promise<TaskHandle<JsonValue>> {
        // Nodes with persistOutput === false keep feeding downstream nodes via
        // dependencies but are excluded from the flow-root aggregation that
        // becomes the conversation history.
        const suppressed = new Set(nodes
            .filter(node => isRecord(node.config) && node.config.persistOutput === false)
            .map(node => String(node.id)));
        const dependencies = [...instances.entries()]
            .filter(([nodeId]) => !suppressed.has(nodeId))
            .map(([nodeId, handles]) => ({
                taskId: handles[handles.length - 1].id,
                nodeId,
            }));
        return session.submit({
            program: { kind: 'flow.aggregate', version: '1' },
            input: { dependencies },
            // 汇聚节点在任一依赖结束（成功或失败）后即可聚合；run 的成败由 result 任务的
            // 输出决定（见 selectFinalResult / finishRun）。这样 on_failure: continue 容忍
            // 的失败不会让整个 run 失败。
            dependsOn: dependencies.map(item => ({ task: item.taskId, condition: 'terminal' })),
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
