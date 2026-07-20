// @file: common/interfaces/agent/agent-run-types.ts
// AgentRun — execution unit types for the AgentRun DAG.
//
// Phase 3 (WP-05/WP-06): AgentRun is the runtime execution of an
// AgentDefinition. Multiple AgentRuns form a Goal DAG. Each AgentRun
// gets an independent ContextSnapshot, tool scope, and memory scope.

import type { RoundId, RefName } from './loop';
import type { ContextProfileId, ContextSnapshotId, InputBinding } from './context-types';

// ─── AgentRunSpec ───────────────────────────────────────────────────────────

export interface AgentRunSpec {
    id: AgentRunId;
    agent: { id: string; version: string };
    prompt: string;
    mode?: string;
    inputs: InputBinding[];
    predicate?: string; // PredicateRef
    joinPolicy?: 'all-success' | 'all-settled' | 'any-success';
    maxRetries?: number;
    canParallel?: boolean;
}

// ─── RunEdge ────────────────────────────────────────────────────────────────

export interface RunEdge {
    from: AgentRunId;
    to: AgentRunId;
    kind: 'control' | 'data';
    outputPort?: string;
    inputPort?: string;
    order?: number;
}

// ─── AgentRun ──────────────────────────────────────────────────────────────

export type AgentRunStatus =
    | 'pending'
    | 'ready'
    | 'running'
    | 'awaiting_signal'
    | 'succeeded'
    | 'failed'
    | 'interrupted'
    | 'cancelled'
    | 'skipped';

export interface AgentRun {
    id: AgentRunId;
    goalId?: string;
    spec: AgentRunSpec;

    status: AgentRunStatus;

    branchRef?: RefName;
    branchHead?: RoundId | null;
    contextProfile?: { id: ContextProfileId; revision: number };
    contextSnapshotId?: ContextSnapshotId;

    attempts: AgentRunAttempt[];
    finalRoundId?: RoundId;
    outputArtifactIds: string[];
}

// ─── AgentRunAttempt ────────────────────────────────────────────────────────

export interface AgentRunAttempt {
    attempt: number;
    startedAt: number;
    completedAt?: number;
    status: 'running' | 'succeeded' | 'failed' | 'cancelled';
    feedback?: string;
    error?: SerializedError;
}

// ─── Artifact ───────────────────────────────────────────────────────────────

export type ArtifactType = 'final-answer' | 'summary' | 'file' | 'json' | 'text';

export interface Artifact {
    id: string;
    runId: AgentRunId;
    type: ArtifactType;
    content: string | Record<string, unknown>;
    contentHash: string;
    createdAt: number;
    metadata?: Record<string, unknown>;
}

// ─── SerializedError ────────────────────────────────────────────────────────

export interface SerializedError {
    message: string;
    code?: string;
    stack?: string;
}

// ─── Brand aliases (full branded types deferred) ────────────────────────────

export type AgentRunId = string;
