// Context types — BranchContextProfile, ContextPlan, ContextBlock, ContextSnapshot.
//
// Phase 2 (WP-03): Defines the data model for per-branch context rules and
// the frozen ContextSnapshot that represents what an AgentTask actually sees.
// These types live in common because they are consumed by both llm-runtime
// (ContextAssembler) and UI layers (Context Drawer).

import type { RoundId, RefName } from './conversation';
import type { ChatMessage } from '../llm/message';

// ─── Brand aliases (Phase 2: string-based; branded IDs deferred to Phase 3) ─

export type ContextProfileId = string;
export type ContextSnapshotId = string;

// ─── BranchContextProfile ──────────────────────────────────────────────────

/** Per-branch context profile — immutable versioned object. */
export interface BranchContextProfile {
    id: ContextProfileId;
    revision: number;
    createdAt: number;

    /** Per-round context rules. Missing key → fall back to default. */
    rules: Record<RoundId, ContextRule>;
}

export type ContextRule =
    | { mode: 'include'; scope?: 'node' | 'subtree' }
    | { mode: 'exclude'; scope?: 'node' | 'subtree' }
    | { mode: 'summary'; artifactId: string; scope?: 'node' | 'subtree' };

// ─── ContextPlan (assembler input) ─────────────────────────────────────────

export interface ContextPlan {
    branchRef: RefName;
    branchHead: RoundId | null;
    profile: { id: ContextProfileId; revision: number };

    pendingUserMessage: ChatMessage;
    explicitInputs: InputBinding[];
    tokenBudget?: number;
}

export type InputBinding =
    | { kind: 'artifact'; artifactId: string; label: string; order: number }
    | { kind: 'upstream-output'; taskRunId: string; outputPort: string; inputLabel: string; order: number }
    | { kind: 'round'; roundId: RoundId; label: string; order: number }
    | { kind: 'text'; content: string; label: string; order: number };

// ─── ContextBlock (internal assembler representation) ──────────────────────

export type ContextBlock =
    | { kind: 'round'; roundId: RoundId; messages: ChatMessage[] }
    | { kind: 'summary'; sourceRoundIds: RoundId[]; artifactId: string }
    | { kind: 'artifact'; artifactId: string; label: string }
    | { kind: 'memory'; entryId: string; namespaceId: string; contentHash: string; content?: string }
    | { kind: 'system'; source: 'agent' | 'skill' | 'runtime'; content: string };

// ─── ContextSnapshot (frozen output) ───────────────────────────────────────

export interface ContextSnapshot {
    id: ContextSnapshotId;
    taskRunId: string;
    createdAt: number;

    branchRef: RefName;
    branchHead: RoundId | null;
    profile: { id: ContextProfileId; revision: number };
    agent: { id: string; version: string };

    blocks: ContextBlock[];
    canonicalMessages: ChatMessage[];
    tokenCount: number;
    digest: string;
    explanation?: ContextExplanation;
}

export interface ContextDecision {
    source: string;
    reason: string;
    priority: number;
    required: boolean;
    tokenCount: number;
}

export interface ContextExplanation {
    included: ContextDecision[];
    excluded: ContextDecision[];
    summarized: ContextDecision[];
    tokenCount: number;
    digest: string;
}
