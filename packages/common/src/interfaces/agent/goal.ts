// Goal — control loop primitive for the LLM subsystem.
//
// Goal = desired-state nodes + dependency edges. A Controller repeatedly
// invokes Loop for each ready node until a Predicate returns a verdict.
//
// Existing 4 control loops (Mission / SessionGraph / AutoContinue /
// BackPressure) are configurations of this single primitive.

import type { ILoop, TurnResult } from './loop';
import type { PauseRequest } from './agent-event';

// ─── Goal definition ────────────────────────────────────────────────

export interface Goal {
    id: string;
    nodes: GoalNode[];
    /** Dependency edges: [from, to] means 'to' depends on 'from'. */
    edges?: Array<[from: string, to: string]>;
}

export interface GoalNode {
    id: string;
    /** What to run — prompt, loop mode, tool allowlist, etc. */
    task: TaskSpec;
    /** How to judge completion. */
    predicate: PredicateRef;
    /** Can run in parallel when dependencies allow. Default true. */
    canParallel?: boolean;
    /** Max retries on predicate=retry. Default 2. */
    maxRetries?: number;
}

/** What a GoalNode needs to execute. */
export interface TaskSpec {
    /** System/instruction prompt for the node. */
    prompt: string;
    /** Loop executor mode ('chat' | 'loop' | 'loop:full'). */
    mode?: string;
    /** Tool allowlist (empty = all tools). */
    tools?: string[];
    /** Additional context fed to the loop. */
    context?: Record<string, unknown>;
}

export type PredicateRef = string; // registered predicate name

// ─── Controller — the reconcile loop ─────────────────────────────────

export interface IController {
    /**
     * Repeatedly invoke loop for each ready node until the predicate
     * returns a verdict or all nodes are resolved.
     *
     * Mission / SessionGraph / AutoContinue / BackPressure are all
     * configurations of this single control loop.
     */
    reconcile(goal: Goal, loopFactory: (node: GoalNode) => ILoop): Promise<Verdict>;
}

// ─── Predicate — completion judgment ─────────────────────────────────

export type Predicate = (result: TurnResult, node: GoalNode) => Promise<Verdict>;

export type Verdict =
    | { status: 'done' }
    | { status: 'retry'; feedback: string }
    | { status: 'hitl'; request: PauseRequest }
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
