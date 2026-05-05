// @file: llm-engine/src/persistence/types.ts
// Core chat types have been moved to @itookit/common.
// Re-exported here for backward compatibility.

import type { ISessionEngine as IBaseSessionEngine } from '@itookit/common';

export type {
    ChatFile,
    AppendMessageMeta,
    UpdateMessageMeta,
    ChatNodeMeta,
    ChatNode,
    ChatContextItem,
    ChatManifest,
    BranchTreeNode,
    ChatSessionSettings,
} from '@itookit/common';
export { DEFAULT_SESSION_SETTINGS } from '@itookit/common';

// Local re-import for use in ILLMSessionEngine signatures
import type {
    ChatManifest,
    ChatNode,
    ChatContextItem,
    BranchTreeNode,
    ChatSessionSettings,
    AppendMessageMeta,
    UpdateMessageMeta,
} from '@itookit/common';

/**
 * LLM session engine — extends the base ISessionEngine with
 * chat-specific operations (session creation, message management, branches).
 */
export interface ILLMSessionEngine extends IBaseSessionEngine {
    createSession(title: string, systemPrompt?: string): Promise<string>;
    initializeExistingFile(nodeId: string, title: string, systemPrompt?: string): Promise<string>;

    getSessionContext(nodeId: string, sessionId: string): Promise<ChatContextItem[]>;
    getSessionContextFromHead(nodeId: string, sessionId: string, headNodeId: string): Promise<ChatContextItem[]>;
    getManifest(nodeId: string): Promise<ChatManifest>;

    appendMessage(nodeId: string, sessionId: string, role: ChatNode['role'], content: string, meta?: AppendMessageMeta): Promise<string>;
    updateNode(sessionId: string, messageId: string, updates: { content?: string; meta?: UpdateMessageMeta; status?: ChatNode['status'] }): Promise<void>;
    deleteMessage(nodeId: string, sessionId: string, messageNodeId: string): Promise<void>;
    deleteMessages(nodeId: string, sessionId: string, messageNodeIds: string[]): Promise<void>;
    editMessage(nodeId: string, sessionId: string, originalMessageId: string, newContent: string): Promise<string>;

    switchBranch(nodeId: string, sessionId: string, branchName: string): Promise<void>;
    createBranch(nodeId: string, sessionId: string, sourceMessageId: string, options?: {
        name?: string;
        copyContent?: boolean;
        createdFrom?: 'regenerate' | 'edit' | 'manual';
    }): Promise<string>;
    findBranchForNode(nodeId: string, sessionId: string, targetNodeId: string): Promise<string | null>;
    registerPathAsBranch(nodeId: string, sessionId: string, targetNodeId: string, branchName?: string): Promise<string>;
    getBranchTree(sessionId: string, nodeId: string, rootNodeId?: string): Promise<BranchTreeNode>;
    renameBranch(nodeId: string, sessionId: string, oldName: string, newName: string): Promise<void>;
    deleteBranch(nodeId: string, sessionId: string, branchName: string, options?: { cascade?: boolean }): Promise<string[]>;

    getNodeSiblings(sessionId: string, messageId: string): Promise<ChatNode[]>;
    getSessionIdFromNodeId(nodeId: string): Promise<string | null>;
    readSessionAsset(sessionId: string, assetPath: string): Promise<Blob | null>;

    getUIState(nodeId: string): Promise<ChatManifest['ui_state'] | null>;
    updateUIState(nodeId: string, updates: Partial<NonNullable<ChatManifest['ui_state']>>): Promise<void>;

    getSessionSettings(sessionId: string): Promise<ChatSessionSettings>;
    saveSessionSettings(sessionId: string, settings: Partial<ChatSessionSettings>): Promise<void>;

    validateManifest(nodeId: string, sessionId: string): Promise<boolean>;
    updateManifestHead(nodeId: string, sessionId: string, targetNodeId: string): Promise<void>;
}
