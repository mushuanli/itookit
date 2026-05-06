/**
 * @file common/interfaces/IChatFile.ts
 * @desc Chat (.chat) file handle.
 *
 * Extends IFile with chat-specific storage operations.
 * Placed in common so that vfslib, llm-engine, and tools can reference it
 * without creating circular dependencies.
 *
 * read() override: assembles all active messages into a markdown document,
 * hiding the manifest + per-message node storage from callers.
 * Use readRaw() to access the underlying manifest JSON directly.
 *
 * Create via factory: createChatFile(engine: IFSEngine, nodeId: string): IChatFile
 */
import type { IFile } from './IFile';
import type {
    ChatManifest,
    ChatNode,
    BranchTreeNode,
    ChatSessionSettings,
} from './chat';

export interface IChatFile extends IFile {
    // ========== Manifest ==========

    getManifest(): Promise<ChatManifest>;
    updateManifest(patch: Partial<ChatManifest>): Promise<void>;

    // ========== Messages ==========

    writeMessage(nodeId: string, node: ChatNode): Promise<void>;
    readMessage(nodeId: string): Promise<ChatNode | null>;
    deleteMessage(nodeId: string): Promise<void>;
    updateMessage(nodeId: string, updates: Partial<ChatNode>): Promise<void>;

    /**
     * Walk parent_id chain from fromNodeId to root.
     * @returns Ordered array root → fromNodeId (active nodes only)
     */
    walkMessageChain(fromNodeId: string): Promise<ChatNode[]>;

    /** Return active siblings of nodeId (all active children of its parent). */
    getSiblings(nodeId: string): Promise<ChatNode[]>;

    // ========== Branches ==========

    createBranch(name: string, fromNodeId: string): Promise<void>;
    switchBranch(name: string): Promise<void>;
    getBranchTree(): Promise<BranchTreeNode>;
    getCurrentBranch(): Promise<string>;

    // ========== User assets ==========

    /**
     * Upload a user attachment. Returns "@asset/<name>".
     * Excludes internal .chat message files and settings.yaml.
     */
    putUserAsset(name: string, content: ArrayBuffer): Promise<string>;
    listUserAssets(): Promise<string[]>;

    // ========== Settings ==========

    getSettings(): Promise<ChatSessionSettings>;
    saveSettings(settings: Partial<ChatSessionSettings>): Promise<void>;
}
