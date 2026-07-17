// @file: llm-engine/src/persistence/round-types.ts
// Round DAG persistence types — used by RoundLog.
//
// Design: each Round is stored as round-<roundId>.json inside the session's
// asset directory. The session manifest (RoundManifest) holds the DAG index.

import type { Round, RoundId, Ref } from '@itookit/common';

// ─── Re-export for consumers ──────────────────────────────────────────────
export type { Round, RoundId, Ref };

// ─── On-disk Round file ───────────────────────────────────────────────────

/**
 * Persisted Round file: round-<roundId>.json
 * Extends the in-memory Round with soft-delete marker.
 */
export interface PersistedRound extends Round {
    /** Soft-delete flag — fold() skips rounds where _deleted is true. */
    _deleted?: boolean;
}

// ─── RoundManifest ────────────────────────────────────────────────────────

/**
 * Manifest stored in the session's manifest.json.
 *
 * Uses a Round DAG index to track branch heads and children.
 */
export interface RoundManifest {
    /** RoundId of the root round (system prompt / conversation start). */
    rootRoundId: RoundId;

    /** Branch name → head RoundId. */
    branches: Record<string, RoundId>;

    /** The active branch name. */
    currentBranch: string;

    /** Head RoundId of the current branch. */
    currentHead: RoundId;

    /**
     * Reverse index: parentRoundId → childRoundIds.
     * Maintained incrementally on every append so sibling enumeration is O(1).
     * Self-healing: can be rebuilt from all Round.parents on startup.
     */
    children: Record<RoundId, RoundId[]>;
}

// ─── RoundProjection ──────────────────────────────────────────────────────

/**
 * In-memory projection of a persisted Round, consumed by SessionState.
 *
 * `kind` distinguishes system/chat/merge rounds.
 * `userMessage` is optional because system and merge rounds have no user part.
 */
export interface RoundProjection {
    roundId: RoundId;
    parents: RoundId[];

    /** Structural kind of this round. */
    kind: 'system' | 'chat' | 'merge';

    userMessage?: {
        content: string;
        files?: import('@itookit/common').ChatAttachment[];
        persistedNodeId: string;
    };

    assistantMessage?: {
        content: string;
        thinking?: string;
        status: import('../core/types').NodeStatus;
        persistedNodeId: string;
    };

    meta: import('@itookit/common').RoundMeta;
}
