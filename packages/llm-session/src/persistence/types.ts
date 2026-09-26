import type {
    JsonValue,
} from '@itookit/common';
import type { RoundManifest } from './round-types';

export type { ChatSessionSettings } from '@itookit/common';
export { DEFAULT_SESSION_SETTINGS } from '@itookit/common';

export interface ConversationUIState {
    branchDrafts?: Record<string, { inputText?: string; inputAgentId?: string }>;
    collapseStates?: Record<string, boolean>;
    scrollPosition?: number;
    historyVisibility?: 'visible' | 'hidden';
}

export type SessionOrigin = 'cli' | 'tauri' | 'web';

export interface ConversationManifest extends RoundManifest {
    id: string;
    title: string;
    summary?: string;
    origin?: SessionOrigin;
    createdAt: number;
    updatedAt: number;
    /** Virtual sidebar folder path, normalized as /A/B; null/undefined means root. */
    folder?: string | null;
    /** Organizational parent; history, drafts and executions remain independent. */
    parentSessionId?: string | null;
    uiState?: ConversationUIState;
    /** Workflow instance source: set when the session is created from a workflow run. */
    flow?: {
        flowId: string;
        revision: number;
        parameters?: Record<string, JsonValue>;
    };
}

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

export interface SessionFolder {
    path: string;
    name: string;
    parentPath: string | null;
    updatedAt: number;
    /** A project root owns a file directory; descendants organize its Sessions. */
    project?: { id: string; directory: string };
}

/** A fresh, single-transaction snapshot for one editor load; never a persistent cache. */
export interface SessionLoadState {
    manifest: ConversationManifest;
    settings: import('@itookit/common').ChatSessionSettings;
}

/** Editor load projection plus the selected history chain, read in the same transaction. */
export interface SessionView extends SessionLoadState {
    chain: import('./history-chain').SessionHistoryChain;
}

export interface SessionRepositoryChange { kind: 'session' | 'ui-state'; sessionId?: string }

/** Required for recoverable structural changes; implementations cannot silently skip these steps. */
export interface SessionDeletionStore {
    assertStructuralWritable(ids: string[]): Promise<void>;
    prepareSessionDeletion(sessionId: string): Promise<void>;
    pendingSessionDeletions(): Promise<Array<{ id: string }>>;
}

/** Domain storage. History and attachments belong to the Session identity. */
export interface ISessionRepository extends SessionDeletionStore {
    init(): Promise<void>;
    dispose(): Promise<void>;
    subscribe(listener: (change?: SessionRepositoryChange) => void): () => void;
    createSession(title: string, folder?: string | null, parentSessionId?: string | null): Promise<string>;
    /** Idempotently create a Session with a host-supplied durable identity. */
    ensureSession(id: string, title: string, origin?: SessionOrigin, folder?: string | null): Promise<string>;
    getManifest(sessionId: string): Promise<ConversationManifest>;
    getLoadState?(sessionId: string): Promise<SessionLoadState>;
    /** Read the projection and the selected history chain together, when supported. */
    loadView?(sessionId: string): Promise<SessionView>;
    /** Read the selected history chain in one storage snapshot when supported. */
    readHistoryChain?(sessionId: string): Promise<import('./history-chain').SessionHistoryChain>;
    list(): Promise<ConversationManifest[]>;
    /** Delete a Session and its owned storage. */
    deleteSession(sessionId: string): Promise<void>;
    listFolders(): Promise<SessionFolder[]>;
    createFolder(path: string, project?: SessionFolder['project']): Promise<SessionFolder>;
    deleteFolder(path: string, recursive?: boolean): Promise<void>;
    renameFolder(from: string, to: string): Promise<void>;
    updateManifest(sessionId: string, patch: Partial<ConversationManifest>): Promise<void>;
    getUIState(sessionId: string): Promise<ConversationUIState | null>;
    updateUIState(sessionId: string, patch: Partial<ConversationUIState>): Promise<void>;
    getSessionSettings(sessionId: string): Promise<import('@itookit/common').ChatSessionSettings>;
    saveSessionSettings(sessionId: string, patch: Partial<import('@itookit/common').ChatSessionSettings>): Promise<void>;
    readDocument(sessionId: string, name: string): Promise<string | null>;
    writeDocument(sessionId: string, name: string, content: string): Promise<void>;
    listHistory(sessionId: string): Promise<string[]>;
    writeAttachment(sessionId: string, name: string, content: ArrayBuffer): Promise<void>;
    openAttachments(sessionId: string): Promise<import('@itookit/vfs-core').FileSystemView>;
    readSessionAsset(sessionId: string, name: string): Promise<Blob | null>;
}
