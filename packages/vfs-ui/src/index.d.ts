// vfs-ui/index.d.ts

import type { VFSCore, VNode } from '@itookit/vfs-core';
import type { IAutocompleteProvider, IMentionProvider } from '@itookit/common';

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

// --- Service & Manager Interfaces ---

/**
 * Represents the entire state managed by the VFS-UI's internal store.
 */
export interface VFSUIState {
    items: VFSNodeUI[];
    activeId: string | null;
    expandedFolderIds: Set<string>;
    selectedItemIds: Set<string>;
    uiSettings: UISettings;
    // ... and other internal state properties
}

/**
 * Defines the public interface for the service layer that communicates with vfs-core.
 */
export interface IVFSService {
    findItemById(nodeId: string): VFSNodeUI | undefined;
    getAllFolders(): Promise<VFSNodeUI[]>;
    getAllFiles(): Promise<VFSNodeUI[]>;
    getActiveSession(): VFSNodeUI | undefined;
    selectSession(nodeId: string): void;
    // ... other methods for CRUD operations
}

/**
 * The public interface for the VFS-UI manager instance.
 */
export interface IVSUIManager {
    /** The service layer instance for direct data interaction. */
    readonly sessionService: IVFSService;
    
    /** Initializes all components and loads initial data. */
    start(): Promise<VFSNodeUI | undefined>;
    
    /** Returns the currently active file node. */
    getActiveSession(): VFSNodeUI | undefined;
    
    /** Updates the content of a specific file node in vfs-core. */
    updateSessionContent(nodeId: string, newContent: string): Promise<VNode>;
    
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
    updateSessionContent(nodeId: string, newContent: string): Promise<VNode>;
    toggleSidebar(): void;
    setTitle(newTitle: string): void;
    on(eventName: any, callback: (payload: any) => void): () => void;
    destroy(): void;
}

/**
 * Provides autocompletion for directories.
 */
export declare class DirectoryProvider implements IMentionProvider {
    constructor(options: { vfsService: IVFSService });
    // ... IMentionProvider methods
}

/**
 * Provides autocompletion for files.
 */
export declare class FileProvider implements IMentionProvider {
    constructor(options: { vfsService: IVFSService });
    // ... IMentionProvider methods
}

/**
 * Provides autocompletion for tags.
 */
export declare class TagProvider implements IAutocompleteProvider {
    constructor(store: any); // VFSStore is internal, so 'any' is acceptable here for the public interface
    // ... IAutocompleteProvider methods
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