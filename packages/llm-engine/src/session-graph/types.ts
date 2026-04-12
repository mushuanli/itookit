// @file: llm-engine/session-graph/types.ts
// File-based session dependency graph types.
//
// Design: each file in the VFS is a "session" — the file content is the
// task description/prompt. Metadata (dependencies, status, result) lives
// in the file's VFS assetdir (_filename/session-meta.json).
//
// Directory reference in dependencies → all sessions in that directory.
// Execution is bottom-up: deepest dependency-free sessions run first.

export type SessionType = 'standard' | 'advance';

/**
 * standard: mark completed when the agent finishes.
 * advance:  LLM analyses the output to verify the task was truly accomplished;
 *           retries up to maxRetries times if not.
 */

export type SessionStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

/** Stored as _filename/session-meta.json in each session file's assetdir. */
export interface SessionMeta {
    version: '1.0';
    /** Session execution mode. */
    type: SessionType;
    status: SessionStatus;
    /**
     * Dependency paths relative to this session file.
     * - "./other.md"    → single session
     * - "./subdir/"     → all sessions in that directory (non-recursive)
     * - "../shared.md"  → parent-level session
     */
    dependencies: string[];
    /** advance mode: custom LLM prompt for completion verification. */
    advancePrompt?: string;
    /** Maximum retry attempts for advance mode (default: 3). */
    maxRetries: number;
    /** Number of times this session has been executed. */
    runCount: number;
    completedAt?: number;
    lastError?: string;
}

export const DEFAULT_SESSION_META: SessionMeta = {
    version:  '1.0',
    type:     'standard',
    status:   'pending',
    dependencies: [],
    maxRetries: 3,
    runCount: 0,
};

/** Result of executing a single session. */
export interface SessionExecutionResult {
    sessionPath: string;
    moduleName:  string;
    status:      SessionStatus;
    output?:     string;   // agent's final response
    error?:      string;
}

/** Event emitted during graph execution for progress tracking. */
export type GraphEvent =
    | { type: 'session:queued';    path: string; deps: string[] }
    | { type: 'session:start';     path: string }
    | { type: 'session:complete';  path: string; output: string }
    | { type: 'session:retry';     path: string; attempt: number; reason: string }
    | { type: 'session:failed';    path: string; error: string }
    | { type: 'session:skipped';   path: string; reason: string }
    | { type: 'graph:cycle';       cycle: string[] };

export interface GraphExecutionOptions {
    /** Agent runtime for executing sessions. */
    runtime: import('@itookit/common').IAgentRuntime;
    /** LLM service — required for advance-mode completion analysis. */
    llm?: import('@itookit/common').ILLMService;
    onProgress?: (event: GraphEvent) => void;
    signal?: AbortSignal;
    /** Hard limit on recursion depth to guard against deep graphs (default: 30). */
    maxDepth?: number;
    /** Override session type for all sessions in this run. */
    typeOverride?: SessionType;
}

/** Advance-mode completion verdict. */
export interface CompletionVerdict {
    completed: boolean;
    reason:    string;
}
