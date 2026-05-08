/**
 * @file: llm-engine/src/persistence/types.ts
 * Core chat types — re-exported from @itookit/common for backward compatibility.
 *
 * v3.3: IChatEngine no longer extends IFSEngine (deprecated).
 *       Use fs: IModuleFS for file operations instead.
 */

import type { FSNode } from '@itookit/common';

export type {
    ChatAttachment,
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
 * Chat engine — chat-specific session operations.
 * No longer extends IFSEngine (deprecated v3.3).
 * File CRUD operations go through the underlying IModuleFS (accessible via
 * the engine's .module or via WorkspaceStrategy.getEngine()).
 */
export interface IChatEngine {
    /** v3.3: 底层模块文件系统，供 UI 层文件树操作使用 */
    readonly engine: import('@itookit/common').IModuleFS;

    // ── IModuleFS 兼容层（委托给 this.engine） ──

    /** 文件操作驱动（POSIX CRUD + 搜索 + 事件） */
    readonly driver: import('@itookit/common').IFSDriver;
    /** 扩展元信息驱动（assetdir / tags / seqfile / refs） */
    readonly meta: import('@itookit/common').IFSMetaDriver;
    readonly moduleId: string;
    readonly capabilities: import('@itookit/common').FSCapabilities;
    openFile(nodeId: string): import('@itookit/common').IFile;

    // ── Chat-specific operations ──

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

    // ── Convenience CRUD (delegates to underlying IModuleFS) ──
    createFile(name: string, parentId: string | null, content?: string | ArrayBuffer): Promise<FSNode>;
    createDirectory(name: string, parentId: string | null): Promise<FSNode>;
    rename(id: string, newName: string): Promise<void>;
    delete(ids: string[]): Promise<void>;
    getNode(id: string): Promise<FSNode | null>;
    readContent(id: string): Promise<string | ArrayBuffer>;
    getChildren(parentId: string): Promise<FSNode[]>;
    search(query: { type?: string; text?: string; tags?: string[]; limit?: number; scope?: string[] }): Promise<FSNode[]>;
    updateMetadata(id: string, metadata: Record<string, unknown>): Promise<void>;
    setTags(id: string, tags: string[]): Promise<void>;
    createAsset(ownerNodeId: string, filename: string, content: string | ArrayBuffer): Promise<FSNode>;
    getAssetDirectoryId(ownerNodeId: string): Promise<string | null>;
    getAssets(ownerNodeId: string): Promise<FSNode[]>;

    init(): Promise<void>;
    dispose(): Promise<void>;
    on(event: string, callback: (event: any) => void): () => void;
}
