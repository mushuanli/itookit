import type {
    ChatSessionSettings,
    JsonValue,
} from '@itookit/common';
import type {
    FSNode,
    IVFSManager,
} from '@itookit/vfs-core';
import type { RoundManifest } from './round-types';

export type { ChatSessionSettings } from '@itookit/common';
export { DEFAULT_SESSION_SETTINGS } from '@itookit/common';

export interface ConversationUIState {
    collapseStates?: Record<string, boolean>;
    scrollPosition?: number;
    historyVisibility?: 'visible' | 'hidden';
    inputText?: string;
    inputAgentId?: string;
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

export interface IChatEngine {
    readonly vfs: IVFSManager;

    init(): Promise<void>;
    dispose(): Promise<void>;

    createSession(title: string): Promise<string>;
    initializeExistingFile(nodeId: string, title: string): Promise<string>;
    getSessionIdFromNodeId(nodeId: string): Promise<string | null>;
    getSessionNodeId(sessionId: string): Promise<string | null>;
    getManifest(nodeId: string): Promise<ConversationManifest>;
    updateManifest(
        nodeId: string,
        updates: Partial<ConversationManifest>,
    ): Promise<void>;
    validateManifest(nodeId: string, sessionId: string): Promise<boolean>;

    getUIState(nodeId: string): Promise<ConversationUIState | null>;
    updateUIState(nodeId: string, updates: Partial<ConversationUIState>): Promise<void>;
    getSessionSettings(sessionId: string): Promise<ChatSessionSettings>;
    saveSessionSettings(
        sessionId: string,
        settings: Partial<ChatSessionSettings>,
    ): Promise<void>;
    readSessionAsset(sessionId: string, assetPath: string): Promise<Blob | null>;

    createFile(
        name: string,
        parentId: string | null,
    ): Promise<FSNode>;
    createDirectory(name: string, parentId: string | null): Promise<FSNode>;
    rename(id: string, newName: string): Promise<void>;
    delete(ids: string[]): Promise<void>;
    getNode(id: string): Promise<FSNode | null>;
    readContent(id: string): Promise<string | ArrayBuffer>;
    getChildren(parentId: string): Promise<FSNode[]>;
    search(query: {
        type?: string;
        text?: string;
        tags?: string[];
        limit?: number;
        scope?: string[];
    }): Promise<FSNode[]>;
    updateMetadata(id: string, metadata: Record<string, unknown>): Promise<void>;
    setTags(id: string, tags: string[]): Promise<void>;
    createAsset(
        ownerNodeId: string,
        filename: string,
        content: string | ArrayBuffer,
    ): Promise<FSNode>;
    readAsset(
        ownerNodeId: string,
        filename: string,
    ): Promise<string | ArrayBuffer | null>;
    getAssetDirectoryId(ownerNodeId: string): Promise<string | null>;
    getAssets(ownerNodeId: string): Promise<FSNode[]>;
}
