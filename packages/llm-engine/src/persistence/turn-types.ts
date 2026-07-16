// @file: llm-engine/src/persistence/turn-types.ts
// Turn DAG persistence types — used by TurnLog.
//
// Design: each Turn is stored as turns/<turnId>.json inside the session's
// asset directory. The session manifest (TurnManifest) holds the DAG index.

import type { Turn, TurnId, Ref } from '@itookit/common';

// ─── Re-export for consumers ──────────────────────────────────────────────
export type { Turn, TurnId, Ref };

// ─── On-disk Turn file ────────────────────────────────────────────────────

/**
 * Persisted Turn file: turns/<turnId>.json
 * Extends the in-memory Turn with soft-delete marker.
 */
export interface PersistedTurn extends Turn {
    /** Soft-delete flag — fold() skips turns where _deleted is true. */
    _deleted?: boolean;
}

// ─── TurnManifest ─────────────────────────────────────────────────────────

/**
 * Manifest stored in the session's manifest.json when format === 'turn'.
 *
 * Replaces the ChatNode-based branch map with a Turn DAG index.
 * Stored alongside the legacy ChatManifest fields (id, title, etc.) for
 * backward-compatible read access by old code paths.
 */
export interface TurnManifest {
    /** Identifies this as the Turn persistence format. */
    format: 'turn';

    /** TurnId of the root turn (system prompt / conversation start). */
    rootTurnId: TurnId;

    /** Branch name → head TurnId. */
    branches: Record<string, TurnId>;

    /** The active branch name. */
    currentBranch: string;

    /** Head TurnId of the current branch. */
    currentHead: TurnId;

    /**
     * Reverse index: parentTurnId → childTurnIds.
     * Maintained incrementally on every append so sibling enumeration is O(1).
     * Self-healing: can be rebuilt from all Turn.parents on startup.
     */
    children: Record<TurnId, TurnId[]>;
}

// ─── TurnProjection ───────────────────────────────────────────────────────

/**
 * In-memory projection of a persisted Turn, consumed by SessionState.
 *
 * §3.5 fix: explicit `kind` distinguishes system/chat/merge turns.
 * `userMessage` is optional because system and merge turns have no user part.
 */
export interface TurnProjection {
    turnId: TurnId;
    parents: TurnId[];

    /** Structural kind of this turn. */
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

    meta: import('@itookit/common').TurnMeta;
}
