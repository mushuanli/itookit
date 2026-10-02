/**
 * @file vfs-ui/contracts/types.ts
 * @desc Core domain types. Public display data independent of host packages.
 *       ALL other layers depend on this file. This file depends on NOTHING internal.
 */
export interface Heading { level: number; text: string; id: string; children: Heading[]; }
export interface TaskCounts { total: number; completed: number; }
// --- Parsed Metadata ---

export interface FileMetadata {
  taskCount?: TaskCounts;
  clozeCount?: number;
  mermaidCount?: number;
  mentions?: Record<string, string[]>;
}

export interface ParseResult {
  summary: string;
  searchableText: string;
  headings: Heading[];
  metadata: FileMetadata;
}

// --- Core UI Data Model ---

export interface NodePresentation {
  /** Opt a virtual directory into the standard two-step delete control. */
  quickDelete?: boolean;
  fileDetails?: boolean;
  subtitle?: string;
  badges?: readonly string[];
  attention?: string;
  unread?: boolean;
}
export interface VFSNodeUI {
  presentation?: NodePresentation;
  resource?: import('./source').ResourceRef;
  kind?: 'file' | 'directory' | 'group';
  parentId?: string | null;
  id: string;
  type: 'file' | 'directory';
  version: string;
  icon?: string;
  metadata: {
    title: string;
    size?: number;
    tags: string[];
    createdAt: string;
    lastModified: string;
    parentPath: string | null;
    path: string;
    viewId?: string;
    custom: Record<string, any> & Partial<FileMetadata>;
  };
  content?: {
    format: string;
    summary: string;
    searchableText: string;
    data: any;
  };
  headings?: Heading[];
  children?: VFSNodeUI[];
}

// --- UI State & Settings ---

/** Host-controlled ordering, independent of persisted user display preferences. */
export interface VFSListSort {
  by: 'title' | 'lastModified' | 'createdAt';
  /** Defaults to ascending for title, descending for dates. */
  direction?: 'asc' | 'desc';
  directoriesFirst?: boolean;
  pinnedFirst?: boolean;
  /** Defaults to zh-CN; names use natural numeric ordering. */
  locale?: string;
}

export interface UISettings {
  sortBy: 'lastModified' | 'title';
  density: 'comfortable' | 'compact';
  showSummary: boolean;
  showTags: boolean;
  showBadges: boolean;
}

export interface TagInfo {
  name: string;
  color: string | null;
  itemIds: Set<string>;
}

export interface VFSUIState {
  items: VFSNodeUI[];
  activeId: string | null;
  expandedFolderIds: Set<string>;
  expandedOutlineIds: Set<string>;
  expandedOutlineH1Ids: Set<string>;
  selectedItemIds: Set<string>;
  creatingItem: { type: 'file' | 'directory'; parentPath: string | null; prevSelectedIds?: string[] } | null;
  moveOperation: { isMoving: boolean; itemIds: string[] } | null;
  searchQuery: string;
  uiSettings: UISettings;
  tags: Map<string, TagInfo>;
  isSidebarCollapsed: boolean;
  readOnly: boolean;
  status: 'idle' | 'loading' | 'success' | 'error';
  error: Error | null;
  _forceUpdateTimestamp?: number;
}

export type SearchFilter = (item: VFSNodeUI, queryTokens: string[]) => boolean;

// --- Component Configuration ---

export type { TagEditorOptions, TagEditorFactory } from './components';
export type MenuItem = import('./components').MenuItem<VFSNodeUI>;
export type ContextMenuBuilder = import('./components').ContextMenuBuilder<VFSNodeUI>;
export type ContextMenuConfig = import('./components').ContextMenuConfig<VFSNodeUI>;

/**
 * Host-owned favorites. The browser only renders the state and dispatches the
 * toggle, so hosts stay the single owner of favorite persistence.
 */
export interface FavoriteAction {
  /** Render-time state; `undefined` hides the control for this row. Must stay pure. */
  state(node: VFSNodeUI): boolean | undefined;
  /** Toggle the favorite after the user activates the control. */
  toggle(node: VFSNodeUI): Promise<void>;
}
