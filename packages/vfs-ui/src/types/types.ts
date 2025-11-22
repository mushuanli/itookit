/**
 * @file vfs-ui/types/types.ts
 * @desc Centralized TypeScript type definitions for the VFS-UI library.
 */

// --- Parsed Metadata Types ---

/**
 * Represents structured metadata that can be parsed from a file's content.
 */
export interface FileMetadata {
  taskCount?: { total: number; completed: number };
  clozeCount?: number;
  mermaidCount?: number;
}

/**
 * Represents a single heading within a document's outline.
 * This is a recursive structure to support nested headings (e.g., H2 under H1).
 */
export interface Heading {
  level: 1 | 2 | 3 | 4 | 5 | 6;
  text: string;
  elementId: string;
  children?: Heading[];
}

// --- Core UI Data Model ---

/**
 * The UI's internal representation of a VFS node.
 * This is the primary view model derived from a vfs-core VNode.
 */
export interface VFSNodeUI {
  id: string;
  type: 'file' | 'directory';
  version: string;
  
  /** [新增] 图标 */
  icon?: string;

  metadata: {
    title: string;
    tags: string[];
    createdAt: string; // ISO 8601 timestamp
    lastModified: string; // ISO 8601 timestamp
    parentId: string | null;
    path: string;
    // [新增] 模块 ID
    moduleId?: string;
    custom: Record<string, any> & Partial<FileMetadata>;
  };
  content?: {
    format: string;
    summary: string;
    searchableText: string;
    data: any; // The raw content, treated as a black box by the UI list
  };
  headings?: any[]; // simplified type
  children?: VFSNodeUI[];
}

// --- UI State & Settings ---

/**
 * Defines the structure for the user-configurable UI display settings.
 */
export interface UISettings {
  sortBy: 'lastModified' | 'title';
  density: 'comfortable' | 'compact';
  showSummary: boolean;
  showTags: boolean;
  showBadges: boolean;
}

/**
 * Represents metadata for a single tag in the global tag registry.
 */
export interface TagInfo {
  name: string;
  color: string | null;
  itemIds: Set<string>;
}

/**
 * Represents the entire state of the VFS-UI application. This is the
 * single source of truth managed by the VFSStore.
 */
export interface VFSUIState {
  items: VFSNodeUI[];
  activeId: string | null;
  expandedFolderIds: Set<string>;
  expandedOutlineIds: Set<string>;
  expandedOutlineH1Ids: Set<string>;
  selectedItemIds: Set<string>;
  creatingItem: { type: 'file' | 'directory'; parentId: string | null } | null;
  moveOperation: { isMoving: boolean; itemIds: string[] } | null;
  searchQuery: string;
  uiSettings: UISettings;
  tags: Map<string, TagInfo>;
  isSidebarCollapsed: boolean;
  readOnly: boolean;
  status: 'idle' | 'loading' | 'success' | 'error';
  error: Error | null;
  _forceUpdateTimestamp?: number; // 🔧 FIX: Internal timestamp to force updates
}

// --- Component Configuration Types ---

/**
 * [新增] 为 Tag Editor Factory 的参数定义一个明确的类型
 */
export interface TagEditorOptions {
  container: HTMLElement;
  initialTags: string[];
  onSave: (tags: string[]) => void;
  onCancel: () => void;
}

/**
 * [修改] 使用新的 TagEditorOptions 类型别名
 */
export type TagEditorFactory = (options: TagEditorOptions) => any; // 返回值可以是组件实例或 void


/**
 * Represents a standard, clickable menu item.
 */
interface RegularMenuItem {
  id: string;
  label: string;
  iconHTML?: string;
  type?: 'item';
  hidden?: (item: VFSNodeUI) => boolean;
}

/**
 * Represents a visual separator in the menu.
 */
interface SeparatorMenuItem {
  type: 'separator'; 
}

/**
 * Defines the structure for a single context menu item, which can be
 * either a regular item or a separator.
 */
export type MenuItem = RegularMenuItem | SeparatorMenuItem;


/**
 * A function type that generates context menu items dynamically.
 */
export type ContextMenuBuilder = (
  item: VFSNodeUI,
  defaultItems: MenuItem[]
) => MenuItem[];

/**
 * Configuration object for the context menu.
 */
export interface ContextMenuConfig {
  items?: ContextMenuBuilder;
}
