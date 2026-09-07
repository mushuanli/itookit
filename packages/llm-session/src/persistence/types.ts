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

export interface ConversationManifest extends RoundManifest {
    id: string;
    title: string;
    summary?: string;
    createdAt: number;
    updatedAt: number;
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

/** Domain storage. History and attachments belong to the Session identity. */
export interface ISessionRepository {
    init(): Promise<void>;
    dispose(): Promise<void>;
    subscribe(listener: () => void): () => void;
    createSession(title: string): Promise<string>;
    getManifest(sessionId: string): Promise<ConversationManifest>;
    list(): Promise<ConversationManifest[]>;
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
