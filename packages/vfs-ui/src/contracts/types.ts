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
}

export interface ParseResult {
  summary: string;
  searchableText: string;
  headings: Heading[];
  metadata: FileMetadata;
}

// --- Core UI Data Model ---

export interface VFSNodeUI {
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
    moduleId?: string;
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

export interface TagEditorOptions {
  container: HTMLElement;
  initialTags: string[];
  onSave: (tags: string[]) => void;
  onCancel: () => void;
}

export type TagEditorFactory = (options: TagEditorOptions) => any;

interface RegularMenuItem {
  id: string;
  label: string;
  iconHTML?: string;
  type?: 'item';
  hidden?: (item: VFSNodeUI) => boolean;
  /** Custom click handler. When provided, bypasses the command-bus dispatch. */
  onClick?: (item: VFSNodeUI) => void;
}

interface SeparatorMenuItem {
  type: 'separator';
}

export type MenuItem = RegularMenuItem | SeparatorMenuItem;

export type ContextMenuBuilder = (
  item: VFSNodeUI,
  defaultItems: MenuItem[]
) => MenuItem[];

export interface ContextMenuConfig {
  items?: ContextMenuBuilder;
}
