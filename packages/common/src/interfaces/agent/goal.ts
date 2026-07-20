// Goal — control loop primitive for the LLM subsystem.
//
// Goal = AgentRunSpec nodes + typed RunEdges. A Controller repeatedly
// invokes Loop for each ready node until a Predicate returns a verdict.
//
// Phase 4 (WP-07): GoalNode replaced by AgentRunSpec; edges use RunEdge
// (separating control vs data dependencies); Predicate no longer returns hitl.

import type { ILoop, RoundResult } from './loop';
import type { AgentRunSpec, RunEdge } from './agent-run-types';
import type { InputBinding } from './context-types';

// ─── Goal definition ────────────────────────────────────────────────

export interface Goal {
    id: string;
    /** Present for goals instantiated from an immutable design revision. */
    definition?: { id: GoalDefinitionId; revision: number; digest: string };
    nodes: AgentRunSpec[];
    /** Typed dependency edges. Control edges gate execution; data edges feed InputBindings. */
    edges?: RunEdge[];
    /** Stable design node → this execution's AgentRun mapping. */
    nodeRuns?: Record<GoalNodeId, string>;
}

export type GoalDefinitionId = string;
export type GoalNodeId = string;

export type GoalInputBinding =
    | Exclude<InputBinding, { kind: 'upstream-output' }>
    | {
        kind: 'upstream-output';
        nodeId: GoalNodeId;
        outputPort: string;
        inputLabel: string;
        order: number;
    };

export interface GoalNodeDefinition {
    id: GoalNodeId;
    label: string;
    agent: { id: string; version?: string };
    prompt: string;
    mode?: string;
    inputs: GoalInputBinding[];
    outputPorts?: string[];
    joinPolicy?: AgentRunSpec['joinPolicy'];
    maxRetries?: number;
    canParallel?: boolean;
    position?: { x: number; y: number };
}

export interface GoalDefinitionEdge {
    id: string;
    from: GoalNodeId;
    to: GoalNodeId;
    kind: 'control' | 'data';
    outputPort?: string;
    inputPort?: string;
    order?: number;
}

export interface GoalDraft {
    id: GoalDefinitionId;
    draftVersion: number;
    baseRevision?: number;
    name: string;
    nodes: GoalNodeDefinition[];
    edges: GoalDefinitionEdge[];
    updatedAt: number;
}

export interface GoalRevision {
    id: GoalDefinitionId;
    revision: number;
    name: string;
    nodes: GoalNodeDefinition[];
    edges: GoalDefinitionEdge[];
    createdAt: number;
    digest: string;
}

export interface GoalValidationIssue {
    code: string;
    message: string;
    severity: 'error' | 'warning';
    nodeId?: GoalNodeId;
    edgeId?: string;
}

/** @deprecated — replaced by AgentRunSpec. Kept for reference. */
export interface GoalNode {
    id: string;
    task: TaskSpec;
    predicate: PredicateRef;
    canParallel?: boolean;
    maxRetries?: number;
}

/** @deprecated — replaced by fields on AgentRunSpec. */
export interface TaskSpec {
    prompt: string;
    mode?: string;
    tools?: string[];
    context?: Record<string, unknown>;
}

export type PredicateRef = string;

// ─── Controller — the reconcile loop ─────────────────────────────────

export interface IController {
    reconcile(goal: Goal, loopFactory: (spec: AgentRunSpec) => ILoop): Promise<Verdict>;
}

// ─── Predicate — completion judgment (Phase 4: hitl removed) ─────────

export type Predicate = (result: RoundResult, spec: AgentRunSpec) => Promise<Verdict>;

export type Verdict =
    | { status: 'done' }
    | { status: 'retry'; feedback: string }
    | { status: 'failed'; reason: string };

// ─── Node status (replaces NodeStatus in kernel) ─────────────────────

export type GoalNodeStatus =
    | 'pending'
    | 'ready'
    | 'running'
    | 'done'
    | 'retrying'
    | 'awaiting_signal'
    | 'failed'
    | 'skipped';
