/**
 * @file common/interfaces/chat.ts
 * @desc Core chat data types shared across vfslib, llm-engine, and tools.
 *
 * These are plain data structures (no runtime logic, no external package deps)
 * that describe the on-disk format of .chat session files.
 */

// ═══════════════════════════════════════════════════════════════
// File attachment
// ═══════════════════════════════════════════════════════════════

/** A file attachment associated with a chat message. */
export interface ChatAttachment {
    name: string;
    type: string;
    /** Storage path (relative `./xxx` or protocol `@asset/xxx`) */
    path?: string;
    size?: number;
    /** Runtime file reference — not persisted */
    fileRef?: File | Blob;
}

// ═══════════════════════════════════════════════════════════════
// Message metadata
// ═══════════════════════════════════════════════════════════════

/** Metadata appended when creating a new message node. */
export interface AppendMessageMeta {
    // -- User message fields --
    files?: ChatAttachment[];
    executorId?: string;

    // -- Assistant message fields --
    agentId?: string;
    agentName?: string;
    agentIcon?: string;
    status?: 'running' | 'success' | 'failed' | 'aborted';
    thinking?: string;
    error?: string;
    endTime?: number;

    // -- Branch fields --
    siblingIndex?: number;
    siblingCount?: number;
    parentAssistantId?: string;
    parentUserNodeId?: string;
    branchCreatedFrom?: 'regenerate' | 'edit' | 'manual';
    branchCreatedAt?: string;

    // -- Message origin & history policy --
    origin?: 'user' | 'agent' | 'system';
    historyPolicy?: 'include' | 'exclude';
}

/** Metadata used when updating an existing message node. */
export interface UpdateMessageMeta {
    thinking?: string;
    status?: 'running' | 'success' | 'failed' | 'aborted';
    error?: string;
    endTime?: number;
    siblingIndex?: number;
    siblingCount?: number;
    inputTokens?: number;
    outputTokens?: number;
    cacheReadTokens?: number;
    costUsd?: number;
    durationMs?: number;
    isEstimated?: boolean;
}

/** Combined metadata stored on a persisted ChatNode. */
export interface ChatNodeMeta extends AppendMessageMeta {
    model?: string;
    tokens?: number;
    finish_reason?: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [key: string]: any;
}

// ═══════════════════════════════════════════════════════════════
// ChatNode — one message in the conversation tree
// ═══════════════════════════════════════════════════════════════

export interface ChatNode {
    id: string;
    type: 'message' | 'tool_call' | 'tool_result';
    role: 'system' | 'user' | 'assistant' | 'tool';
    created_at: string;

    parent_id: string | null;
    children_ids: string[];

    content: string;
    meta?: ChatNodeMeta;

    status: 'active' | 'deleted';
}

/** A node + its depth in the context chain (used by session context queries). */
export interface ChatContextItem {
    node: ChatNode;
    depth?: number;
}

// ═══════════════════════════════════════════════════════════════
// ChatManifest — the .chat file's main JSON payload
// ═══════════════════════════════════════════════════════════════

export interface ChatManifest {
    version: '1.0';
    id: string;
    title: string;
    summary?: string;
    created_at: string;
    updated_at: string;

    settings: {
        model: string;
        temperature?: number;
        system_prompt?: string;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        [key: string]: any;
    };

    branches: Record<string, string>;
    current_branch: string;
    current_head: string;
    root_id: string;

    /** VFS node ID of the .chat file itself */
    chat_node_id: string;
    /** Next global sequence number (starts at 1) */
    next_sn: number;
    /** Next branch number to assign (starts at 1) */
    next_branch_num: number;
    /** branchName → branchNum (main = 0) */
    branch_nums: Record<string, number>;
    /** Immutable named save points (tag name → turn node ID) */
    tags?: Record<string, string>;

    /**
     * Persistence format for this session.
     * - 'legacy' (default when absent): ChatNode tree stored inline in the manifest.
     * - 'round': Round DAG stored as individual round-<id>.json files; RoundManifest header.
     */
    format?: 'legacy' | 'round';

    ui_state?: {
        collapse_states?: Record<string, boolean>;
        scroll_position?: number;
        /** Pure workspace preference; does not affect model context/historyPolicy. */
        history_visibility?: 'visible' | 'hidden';
    };
}

// ═══════════════════════════════════════════════════════════════
// BranchTreeNode — branch visualization
// ═══════════════════════════════════════════════════════════════

export interface BranchTreeNode {
    id: string;
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string;
    timestamp: number;
    isOnActivePath: boolean;
    memberOfBranches: string[];
    branchHead?: string;
    createdFrom?: 'regenerate' | 'edit' | 'manual';
    children: BranchTreeNode[];
}

// ═══════════════════════════════════════════════════════════════
// ChatSessionSettings — per-session YAML config
// ═══════════════════════════════════════════════════════════════

export interface ChatSessionSettings {
    version: '1.0';
    modelId?: string;
    historyLength: number;
    temperature?: number;
    streamMode: boolean;
    useHarness?: boolean;
    workingDirectory?: string;
    updatedAt?: string;
}

export const DEFAULT_SESSION_SETTINGS: ChatSessionSettings = {
    version: '1.0',
    modelId: undefined,
    historyLength: -1,
    temperature: undefined,
    streamMode: true,
};
