// vfs-ui/index.d.ts

import type { VFSCore, VNode } from '@itookit/vfs-core';
import type { IAutocompleteProvider, IMentionProvider, Suggestion } from '@itookit/common';

// --- Core Data Structures (UI Representation) ---

/**
 * Represents a single heading extracted from a file's content.
 */
export interface Heading {
    level: number;
    text: string;
    elementId: string;
    children?: Heading[];
}

/**
 * The UI's internal representation of a VFS node, adapted for rendering.
 */
export interface VFSNodeUI {
    id: string;
    type: 'file' | 'directory';
    version: string;
    metadata: {
        title: string;
        tags: string[];
        createdAt?: string;
        lastModified?: string;
        parentId: string | null;
        path: string;
        moduleName: string;
        /** 用于存储非标准或从内容解析的元数据，例如 isPinned, taskCount 等 */
        custom?: Record<string, any>;
    };
    content?: {
        format: string;
        summary: string;
        searchableText: string;
        data?: any; // Content is often lazy-loaded
    };
    headings?: Heading[];
    children?: VFSNodeUI[];
}

// --- Configuration Types ---

/**
 * Defines the structure for UI display settings.
 */
export interface UISettings {
    sortBy: 'lastModified' | 'title';
    density: 'comfortable' | 'compact';
    showSummary: boolean;
    showTags: boolean;
    showBadges: boolean;
}

/**
 * Defines a single context menu item.
 */
export interface MenuItem {
    id: string;
    label: string;
    iconHTML?: string;
    type?: 'item' | 'separator';
    hidden?: (item: VFSNodeUI) => boolean;
}

/**
 * A function that generates context menu items for a given node.
 */
export type ContextMenuBuilder = (item: VFSNodeUI, defaultItems: MenuItem[]) => MenuItem[];

/**
 * Configuration object for the context menu.
 */
export interface ContextMenuConfig {
    items?: ContextMenuBuilder;
}

/**
 * Options for creating a Tag Editor component instance.
 */
export interface TagEditorFactoryOptions {
    container: HTMLElement;
    initialTags: string[];
    onSave: (newTags: string[]) => void;
    onCancel: () => void;
}

/**
 * A factory function that creates and returns a tag editor instance.
 */
export type TagEditorFactory = (options: TagEditorFactoryOptions) => any;

/**
 * The complete set of options for initializing the VFS-UI manager.
 */
export interface VFSUIOptions {
    /** The DOM element where the main node list will be rendered. */
    sessionListContainer: HTMLElement;
    /** The DOM element where the file outline will be rendered (optional). */
    documentOutlineContainer?: HTMLElement;
    /** Initial state to hydrate the UI, useful for SSR or static data (optional). */
    initialState?: Partial<VFSUIState>;
    /** Initial collapsed state of the sidebar (optional). */
    initialSidebarCollapsed?: boolean;
    /** If true, disables all write operations in the UI (e.g., create, rename, delete) (optional). */
    readOnly?: boolean;
    /** Whether to load data from vfs-core on start (defaults to true). */
    loadDataOnStart?: boolean;
    /** Default content for newly created files (optional). */
    newSessionContent?: string;
    /** The main title displayed at the top of the sidebar (optional). */
    title?: string;
    /** Placeholder text for the search input (optional). */
    searchPlaceholder?: string;
    /** Configuration for the right-click context menu (optional). */
    contextMenu?: ContextMenuConfig;
    /** Overrides for default UI components (optional). */
    components?: {
        tagEditor?: TagEditorFactory;
    };
}

// --- State & Service Interfaces ---

/**
 * 描述一个标签的元数据。
 */
export interface TagInfo {
    name: string;
    color: string | null;
    itemIds: Set<string>;
}

/**
 * 描述正在内联创建的项目。
 */
export interface CreatingItemState {
    type: 'file' | 'folder';
    parentId: string | null;
}

/**
 * 描述正在进行的移动操作。
 */
export interface MoveOperationState {
    isMoving: boolean;
    itemIds: string[];
}

/**
 * 代表由 VFS-UI 内部 store 管理的整个状态。
 */
export interface VFSUIState {
    items: VFSNodeUI[];
    activeId: string | null;
    expandedFolderIds: Set<string>;
    expandedOutlineIds: Set<string>;
    expandedOutlineH1Ids: Set<string>;
    selectedItemIds: Set<string>;
    creatingItem: CreatingItemState | null;
    moveOperation: MoveOperationState | null;
    searchQuery: string;
    uiSettings: UISettings;
    tags: Map<string, TagInfo>;
    isSidebarCollapsed: boolean;
    readOnly: boolean;
    status: 'idle' | 'loading' | 'success' | 'error';
    error: Error | null;
}

/**
 * 定义了与 vfs-core 通信的服务层的公共接口。
 */
export interface IVFSService {
    findItemById(nodeId: string): VFSNodeUI | undefined;
    getAllFolders(): Promise<VFSNodeUI[]>;
    getAllFiles(): Promise<VFSNodeUI[]>;
    getActiveSession(): VFSNodeUI | undefined;
    selectSession(nodeId: string): void;
    createSession(options: { title?: string; content?: string; parentId?: string | null }): Promise<VNode>;
    createDirectory(options: { title?: string; parentId?: string | null }): Promise<VNode>;
    renameItem(nodeId: string, newTitle: string): Promise<VNode>;
    deleteItems(nodeIds: string[]): Promise<void>;
    // --- FIX 2: Allow targetId to be null for moving to root ---
    moveItems(options: { itemIds: string[]; targetId: string | null }): Promise<void>;
    updateItemMetadata(itemId: string, metadataUpdates: Record<string, any>): Promise<void>;
}

/**
 * VFS-UI 管理器实例的公共接口。
 */
export interface IVSUIManager {
    /** The service layer instance for direct data interaction. */
    readonly sessionService: IVFSService;
    
    /** Initializes all components and loads initial data. */
    start(): Promise<VFSNodeUI | undefined>;
    
    /** Returns the currently active file node. */
    getActiveSession(): VFSNodeUI | undefined;
    
    /**
     * Updates the content of a specific file node in vfs-core.
     * --- FIX 1: Changed return type from Promise<VNode> to Promise<void> to match implementation ---
     */
    updateSessionContent(nodeId: string, newContent: string): Promise<void>;
    
    /** Toggles the collapsed state of the sidebar. */
    toggleSidebar(): void;
    
    /** Sets the main title of the sidebar. */
    setTitle(newTitle: string): void;

    /**
     * Subscribes to high-level events from the UI.
     * @param eventName The name of the event to listen for.
     * @param callback The function to call when the event is fired.
     * @returns An unsubscribe function.
     */
    on(eventName: 'sessionSelected', callback: (payload: { item: VFSNodeUI | undefined }) => void): () => void;
    on(eventName: 'navigateToHeading', callback: (payload: { elementId: string }) => void): () => void;
    on(eventName: 'importRequested', callback: (payload: { parentId: string | null }) => void): () => void;
    on(eventName: 'sidebarStateChanged', callback: (payload: { isCollapsed: boolean }) => void): () => void;
    on(eventName: 'menuItemClicked', callback: (payload: { actionId: string; item: VFSNodeUI }) => void): () => void;

    /** Cleans up all components, listeners, and resources. */
    destroy(): void;
}

// --- Exported Classes and Functions ---

/**
 * The main class that manages the entire VFS-UI lifecycle and interactions.
 */
export declare class VFSUIManager implements IVSUIManager {
    readonly sessionService: IVFSService;
    constructor(options: VFSUIOptions, vfsCore: VFSCore, moduleName: string);
    start(): Promise<VFSNodeUI | undefined>;
    getActiveSession(): VFSNodeUI | undefined;
    // --- FIX 1 Applied Here ---
    updateSessionContent(nodeId: string, newContent: string): Promise<void>;
    toggleSidebar(): void;
    setTitle(newTitle: string): void;
    on(eventName: any, callback: (payload: any) => void): () => void;
    destroy(): void;
}

/**
 * Provides autocompletion for directories.
 */
export declare class DirectoryProvider implements IMentionProvider {
    readonly key: 'dir';
    triggerChar: '@';
    constructor(options: { vfsService: IVFSService });
    getSuggestions(query: string): Promise<Suggestion[]>;
    getHoverPreview(targetURL: URL): Promise<{ title: string; contentHTML: string; icon: string; } | null>;
    handleClick(targetURL: URL): Promise<void>;
}

/**
 * Provides autocompletion for files.
 */
export declare class FileProvider implements IMentionProvider {
    readonly key: 'file';
    triggerChar: '@';
    constructor(options: { vfsService: IVFSService });
    getSuggestions(query: string): Promise<Suggestion[]>;
    getHoverPreview(targetURL: URL): Promise<{ title: string; contentHTML: string; icon: string; } | null>;
    handleClick(targetURL: URL): Promise<void>;
    getContentForTransclusion(targetURL: URL): Promise<string | null>;
    getDataForProcess(targetURL: URL): Promise<object | null>;
}

/**
 * Provides autocompletion for tags.
 */
export declare class TagProvider implements IAutocompleteProvider {
    constructor(store: any); // VFSStore is internal, so 'any' is acceptable here for the public interface
    getSuggestions(query: string): Promise<Suggestion[]>;
}

/**
 * Creates a new VFS-UI instance to manage a specific module from vfs-core.
 * This is the primary entry point for using the library.
 */
export declare function createVFSUI(
    options: VFSUIOptions,
    vfsCore: VFSCore,
    moduleName: string
): IVSUIManager;