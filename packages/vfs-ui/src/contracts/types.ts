/**
 * @file vfs-ui/contracts/types.ts
 * @desc Core domain types. Zero external dependencies except @itookit/common shared types.
 *       ALL other layers depend on this file. This file depends on NOTHING internal.
 */
import type { Heading, TaskCounts } from '@itookit/common';
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

export type { TagEditorOptions, TagEditorFactory } from '@itookit/ui-common';
export type MenuItem = import('@itookit/ui-common').MenuItem<VFSNodeUI>;
export type ContextMenuBuilder = import('@itookit/ui-common').ContextMenuBuilder<VFSNodeUI>;
export type ContextMenuConfig = import('@itookit/ui-common').ContextMenuConfig<VFSNodeUI>;
