// Flow definitions connect user-facing ChatInput sends to Agent/Group runs.
// A Flow is an algorithm definition; it never contains a concrete branch head.

import type { RunEdge } from './agent-run-types';
import type { GoalInputBinding } from './goal';

export type FlowDefinitionId = string;
export type FlowNodeId = string;
export type FlowRunId = string;
export type AgentGroupId = string;

export type FlowStrategy =
    | 'parallel'
    | 'sequential'
    | 'supervisor'
    | 'selector'
    | 'handoff'
    | 'debate';

export interface AgentGroupDefinition {
    id: AgentGroupId;
    name: string;
    members: Array<
        | { kind: 'agent'; agentId: string; version: string }
        | { kind: 'flow'; flowId: FlowDefinitionId; revision: number }
    >;
    strategy: FlowStrategy;
    contextMode: 'isolated' | 'shared-transcript' | 'artifact-only';
    aggregation:
        | { kind: 'agent'; agentId: string; version: string }
        | { kind: 'reduce'; reducerId: string }
        | { kind: 'collect-artifacts' };
    termination: {
        maxTurns?: number;
        maxTokens?: number;
        timeoutMs?: number;
        predicateId?: string;
    };
}

export type FlowNodeDefinition =
    | {
        id: FlowNodeId;
        kind: 'input';
        name: string;
        inputType: 'conversation' | 'text' | 'artifact' | 'round';
    }
    | {
        id: FlowNodeId;
        kind: 'agent';
        name: string;
        agent: { id: string; version: string };
        prompt: string;
        inputs: GoalInputBinding[];
    }
    | {
        id: FlowNodeId;
        kind: 'group';
        name: string;
        group: AgentGroupDefinition;
        inputs: GoalInputBinding[];
    }
    | {
        id: FlowNodeId;
        kind: 'router' | 'join' | 'human' | 'output';
        name: string;
        config?: Record<string, unknown>;
    };

export interface FlowEdge extends Omit<RunEdge, 'from' | 'to'> {
    id: string;
    from: FlowNodeId;
    to: FlowNodeId;
}

export interface FlowDefinition {
    id: FlowDefinitionId;
    revision: number;
    name: string;
    nodes: FlowNodeDefinition[];
    edges: FlowEdge[];
    digest: string;
}

/** The branch/context is frozen only when a FlowRun starts. */
export interface FlowRunBinding {
    flowId: FlowDefinitionId;
    flowRevision: number;
    branchRef: string;
    branchHead: string | null;
    contextProfileRevision?: number;
    explicitRoundIds?: string[];
    pendingUserMessage: string;
}

export interface SendIntent {
    branch: {
        mode: 'continue' | 'fork';
        baseRoundId?: string;
        newBranchName?: string;
    };
    retention: {
        mode: 'persistent' | 'temporary';
    };
    execution:
        | { kind: 'agent'; agentId: string }
        | { kind: 'flow'; flowId: FlowDefinitionId; revision?: number };
}

export function createFlowRunBinding(
    flow: FlowDefinition,
    intent: Extract<SendIntent['execution'], { kind: 'flow' }>,
    branchRef: string,
    branchHead: string | null,
    pendingUserMessage: string,
    contextProfileRevision?: number,
): FlowRunBinding {
    if (intent.flowId !== flow.id) throw new Error(`Flow intent ${intent.flowId} does not match ${flow.id}`);
    if (intent.revision !== undefined && intent.revision !== flow.revision) {
        throw new Error(`Flow revision mismatch: expected ${intent.revision}, got ${flow.revision}`);
    }
    return {
        flowId: flow.id,
        flowRevision: flow.revision,
        branchRef,
        branchHead,
        contextProfileRevision,
        pendingUserMessage,
    };
}

/** Validate the algorithm plane before publishing a Flow revision. */
export function validateFlowDefinition(flow: FlowDefinition): string[] {
    const errors: string[] = [];
    const ids = new Set<string>();
    for (const node of flow.nodes) {
        if (ids.has(node.id)) errors.push(`duplicate node: ${node.id}`);
        ids.add(node.id);
    }
    const outgoing = new Map<string, string[]>();
    for (const edge of flow.edges) {
        if (!ids.has(edge.from) || !ids.has(edge.to)) errors.push(`edge references missing node: ${edge.id}`);
        const list = outgoing.get(edge.from) ?? [];
        list.push(edge.to);
        outgoing.set(edge.from, list);
    }
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const visit = (id: string): void => {
        if (visiting.has(id)) { errors.push(`cycle detected at node: ${id}`); return; }
        if (visited.has(id)) return;
        visiting.add(id);
        for (const next of outgoing.get(id) ?? []) visit(next);
        visiting.delete(id);
        visited.add(id);
    };
    for (const id of ids) visit(id);
    return [...new Set(errors)];
}

/** Normalize the existing direct-agent ChatInput path to a one-agent intent. */
export function createAgentSendIntent(agentId: string): SendIntent {
    return {
        branch: { mode: 'continue' },
        retention: { mode: 'persistent' },
        execution: { kind: 'agent', agentId },
    };
}
