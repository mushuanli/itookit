# VFS-UI Extension Design Document

## Executive Summary

This document outlines the architectural design to extend VFS-UI from a minimal tree viewer to a full-featured file management system matching Sidebar's capabilities.

---

## 1. Architecture Overview

### 1.1 Current vs Target Architecture

```
CURRENT (VFS-UI):
VFSUIManager
├── VFSTreeView (basic tree)
├── EditorRegistry
└── EventBus

TARGET (Enhanced VFS-UI):
VFSUIManager
├── State Management Layer
│   ├── UIStore (Zustand/Immer)
│   ├── SelectionManager
│   └── SearchManager
├── Service Layer
│   ├── VFSUIService (business logic)
│   └── TagService
├── UI Components Layer
│   ├── VFSTreeView (enhanced)
│   ├── VFSOutlineView
│   ├── VFSContextMenu
│   ├── VFSModal
│   ├── VFSSearchBar
│   ├── VFSBulkActionBar
│   ├── VFSTagEditor
│   └── VFSSettingsPanel
└── Interaction Layer
    ├── DragDropManager
    ├── KeyboardHandler
    └── GestureManager
```

---

## 2. Core Systems Design

### 2.1 State Management System

**Technology Choice:** Immer + Custom Store (following Sidebar pattern)

```typescript
interface VFSUIState {
  // Selection
  selectedItemIds: Set<string>;
  activeItemId: string | null;
  lastSelectedId: string | null;

  // Expansion
  expandedFolderIds: Set<string>;
  expandedOutlineIds: Set<string>;

  // Search
  searchQuery: string;
  searchFilters: SearchFilters;
  searchResults: Set<string>;

  // UI State
  uiSettings: {
    density: 'comfortable' | 'compact';
    showOutlines: boolean;
    sortBy: 'name' | 'modified' | 'created';
    sortOrder: 'asc' | 'desc';
    groupByType: boolean;
  };

  // Drag & Drop
  dragState: {
    isDragging: boolean;
    draggedItemIds: string[];
    dropTargetId: string | null;
    dropPosition: 'before' | 'after' | 'into' | null;
  };

  // Tags
  tags: Map<string, TagInfo>;

  // Bulk Operations
  bulkMode: boolean;
}

interface SearchFilters {
  tags: string[];
  types: ('file' | 'dir')[];
  dateRange?: { start: Date; end: Date };
}

interface TagInfo {
  id: string;
  label: string;
  color: string;
  count: number;
}
```

### 2.2 Event System Enhancement

```typescript
interface VFSUIEvents {
  // Selection Events
  'selection:changed': { itemIds: string[] };
  'selection:cleared': void;

  // Drag & Drop Events
  'drag:start': { itemIds: string[] };
  'drag:over': { targetId: string; position: DropPosition };
  'drag:end': { success: boolean };
  'drop': { itemIds: string[]; targetId: string; position: DropPosition };

  // Search Events
  'search:query': { query: string };
  'search:results': { results: string[] };
  'search:clear': void;

  // Tag Events
  'tag:created': { tag: TagInfo };
  'tag:updated': { tag: TagInfo };
  'tag:deleted': { tagId: string };
  'tag:applied': { itemIds: string[]; tagIds: string[] };

  // UI Events
  'ui:settings:changed': { settings: Partial<UISettings> };
  'ui:modal:open': { modalType: string; data?: any };
  'ui:modal:close': { modalType: string };
  'ui:context-menu:open': { itemId: string; x: number; y: number };

  // Bulk Operations
  'bulk:mode:toggled': { enabled: boolean };
  'bulk:action': { action: BulkAction; itemIds: string[] };
}

type BulkAction = 'delete' | 'move' | 'tag' | 'export';
type DropPosition = 'before' | 'after' | 'into';
```

---

## 3. Component Design

### 3.1 Enhanced VFSTreeView

```typescript
interface VFSTreeViewProps {
  // Data
  rootNodes: VFSNode[];

  // State
  selectedIds: Set<string>;
  expandedIds: Set<string>;
  searchResults?: Set<string>;

  // Settings
  density: 'comfortable' | 'compact';
  showOutlines: boolean;
  multiSelect: boolean;
  dragEnabled: boolean;

  // Callbacks
  onSelect: (id: string, mode: SelectMode) => void;
  onExpand: (id: string, expanded: boolean) => void;
  onRename: (id: string, newName: string) => void;
  onDelete: (ids: string[]) => void;
  onDrop: (draggedIds: string[], targetId: string, position: DropPosition) => void;
  onContextMenu: (id: string, event: MouseEvent) => void;

  // Render Props
  renderItemActions?: (node: VFSNode) => ReactNode;
  renderItemBadge?: (node: VFSNode) => ReactNode;
}

type SelectMode = 'single' | 'toggle' | 'range' | 'all';
```

### 3.2 VFSSearchBar Component

```typescript
interface VFSSearchBarProps {
  query: string;
  filters: SearchFilters;
  suggestions: string[];
  onQueryChange: (query: string) => void;
  onFilterChange: (filters: SearchFilters) => void;
  onClear: () => void;
}

// Features:
// - Free text search with debouncing
// - Tag autocomplete: "tag:important"
// - Type filters: "type:file" or "type:dir"
// - Combined filters: "tag:work type:file meeting notes"
// - Recent searches
// - Search syntax highlighting
```

### 3.3 VFSContextMenu Component

```typescript
interface VFSContextMenuProps {
  itemId: string | null;
  itemIds: string[]; // for multi-select
  position: { x: number; y: number };
  onClose: () => void;
}

interface ContextMenuItem {
  id: string;
  label: string;
  icon?: string;
  shortcut?: string;
  disabled?: boolean;
  divider?: boolean;
  submenu?: ContextMenuItem[];
  action: () => void;
}

// Menu Structure:
// - Open
// - Open in New Tab
// ---
// - Rename
// - Duplicate
// - Delete
// ---
// - Move to...
// - Add Tags...
// ---
// - Copy Path
// - Show in Finder
// ---
// - Properties
```

### 3.4 VFSModal Component

```typescript
interface VFSModalProps {
  isOpen: boolean;
  type: ModalType;
  title: string;
  data?: any;
  onClose: () => void;
  onConfirm?: (data: any) => void;
}

type ModalType = 
  | 'move-to'
  | 'rename'
  | 'delete-confirm'
  | 'tag-editor'
  | 'settings'
  | 'bulk-action';

// Modal Types:

// 1. Move To Modal
interface MoveToModalData {
  itemIds: string[];
  currentParentId: string;
  availableFolders: VFSNode[];
}

// 2. Tag Editor Modal
interface TagEditorModalData {
  itemIds: string[];
  existingTags: string[];
  allTags: TagInfo[];
  mode: 'add' | 'replace' | 'remove';
}

// 3. Bulk Action Modal
interface BulkActionModalData {
  action: BulkAction;
  itemIds: string[];
  itemNames: string[];
}
```

### 3.5 VFSBulkActionBar Component

```typescript
interface VFSBulkActionBarProps {
  selectedCount: number;
  totalCount: number;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onAction: (action: BulkAction) => void;
}

// Actions:
// - Select All (checkbox with indeterminate state)
// - "X items selected"
// - Delete (trash icon)
// - Move (folder icon)
// - Tag (tag icon)
// - Export (download icon)
// - Clear Selection (x icon)
```

### 3.6 VFSOutlineView Component

```typescript
interface VFSOutlineViewProps {
  fileId: string;
  headings: OutlineHeading[];
  expandedIds: Set<string>;
  onToggle: (id: string) => void;
  onNavigate: (id: string) => void;
}

interface OutlineHeading {
  id: string;
  level: number; // 1-6 (h1-h6)
  text: string;
  line: number;
  children: OutlineHeading[];
}

// Features:
// - Nested structure following heading hierarchy
// - Click to navigate to heading
// - Expand/collapse sections
// - Sticky positioning option
// - Inline mode (within tree item) + separate panel mode
```

### 3.7 VFSTagEditor Component

```typescript
interface VFSTagEditorProps {
  selectedTags: string[];
  availableTags: TagInfo[];
  onTagsChange: (tags: string[]) => void;
  onCreateTag: (label: string, color: string) => void;
}

// Features:
// - Tag pill display
// - Tag autocomplete/search
// - Create new tags inline
// - Color picker for new tags
// - Tag usage count
// - Recently used tags
```

---

## 4. Service Layer Design

### 4.1 VFSUIService

```typescript
class VFSUIService {
  constructor(
    private vfsCore: VFSCore,
    private store: VFSUIStore,
    private eventBus: EventBus
  ) {}

  // Node Operations
  async createFile(parentId: string, name: string): Promise<VFSNode>
  async createFolder(parentId: string, name: string): Promise<VFSNode>
  async renameNode(id: string, newName: string): Promise<void>
  async deleteNodes(ids: string[]): Promise<void>
  async moveNodes(ids: string[], targetId: string, position: DropPosition): Promise<void>
  async duplicateNode(id: string): Promise<VFSNode>

  // Metadata Operations
  async updateNodeMetadata(id: string, metadata: Partial<NodeMetadata>): Promise<void>
  async bulkUpdateMetadata(ids: string[], metadata: Partial<NodeMetadata>): Promise<void>

  // Search Operations
  async search(query: string, filters: SearchFilters): Promise<VFSNode[]>
  async getSearchSuggestions(partial: string): Promise<string[]>

  // Tag Operations
  async getTags(): Promise<TagInfo[]>
  async createTag(label: string, color: string): Promise<TagInfo>
  async updateTag(id: string, updates: Partial<TagInfo>): Promise<void>
  async deleteTag(id: string): Promise<void>
  async applyTags(itemIds: string[], tagIds: string[]): Promise<void>
  async removeTags(itemIds: string[], tagIds: string[]): Promise<void>

  // Utility Operations
  async getNodePath(id: string): Promise<VFSNode[]>
  async getAllFolders(): Promise<VFSNode[]>
  async getNodesByIds(ids: string[]): Promise<VFSNode[]>
  async validateMove(sourceIds: string[], targetId: string): Promise<boolean>
}
```

### 4.2 TagService

```typescript
class TagService {
  private tags: Map<string, TagInfo> = new Map();
  private nodeTags: Map<string, Set<string>> = new Map(); // nodeId -> tagIds

  // CRUD Operations
  createTag(label: string, color: string): TagInfo
  updateTag(id: string, updates: Partial<TagInfo>): void
  deleteTag(id: string): void
  getTag(id: string): TagInfo | undefined
  getAllTags(): TagInfo[]

  // Tag Assignment
  applyTags(nodeIds: string[], tagIds: string[]): void
  removeTags(nodeIds: string[], tagIds: string[]): void
  getNodeTags(nodeId: string): TagInfo[]
  getNodesWithTag(tagId: string): string[]

  // Search & Suggestions
  searchTags(query: string): TagInfo[]
  getSuggestedTags(nodeId: string): TagInfo[]
  getRecentlyUsedTags(limit: number): TagInfo[]

  // Persistence
  serialize(): string
  deserialize(data: string): void
}
```

---

## 5. Interaction Systems

### 5.1 Selection Manager

```typescript
class SelectionManager {
  constructor(
    private store: VFSUIStore,
    private eventBus: EventBus
  ) {}

  // Single Selection
  selectSingle(id: string): void

  // Multi-Selection
  toggleSelection(id: string): void
  selectRange(fromId: string, toId: string): void
  selectAll(): void
  clearSelection(): void

  // Utilities
  isSelected(id: string): boolean
  getSelectedIds(): string[]
  getSelectedCount(): number

  // Keyboard Shortcuts
  handleKeyDown(event: KeyboardEvent): void
  // Ctrl/Cmd + A: Select All
  // Escape: Clear Selection
  // Shift + Click: Range Select
  // Ctrl/Cmd + Click: Toggle Select
}
```

### 5.2 Drag & Drop Manager

```typescript
class DragDropManager {
  constructor(
    private store: VFSUIStore,
    private service: VFSUIService,
    private eventBus: EventBus
  ) {}

  // Drag Operations
  handleDragStart(itemIds: string[], event: DragEvent): void
  handleDragOver(targetId: string, event: DragEvent): DropPosition | null
  handleDragEnd(): void

  // Drop Operations
  handleDrop(targetId: string, position: DropPosition): Promise<void>

  // Validation
  canDrop(draggedIds: string[], targetId: string): boolean
  getDropPosition(targetElement: HTMLElement, clientY: number): DropPosition

  // Visual Feedback
  updateDropIndicator(targetId: string, position: DropPosition): void
  clearDropIndicator(): void

  // Auto-expand
  startHoverTimer(targetId: string): void
  cancelHoverTimer(): void
}
```

### 5.3 Keyboard Handler

```typescript
class KeyboardHandler {
  constructor(
    private store: VFSUIStore,
    private service: VFSUIService,
    private eventBus: EventBus
  ) {}

  handleKeyDown(event: KeyboardEvent): void

  // Navigation
  // Arrow Up/Down: Navigate items
  // Arrow Left/Right: Collapse/Expand folders
  // Home/End: First/Last item
  // Page Up/Down: Scroll page

  // Actions
  // Enter: Open item
  // F2: Rename
  // Delete/Backspace: Delete
  // Ctrl/Cmd + C: Copy
  // Ctrl/Cmd + X: Cut
  // Ctrl/Cmd + V: Paste
  // Ctrl/Cmd + A: Select All
  // Ctrl/Cmd + F: Focus search
  // Escape: Clear selection / Close modals

  // Bulk
  // Shift + Delete: Bulk delete
  // Ctrl/Cmd + Shift + M: Bulk move
}
```

---

## 6. CSS Architecture

### 6.1 BEM Structure

```scss
// Base Component
.vfs-tree {
  &__container { }
  &__header { }
  &__search { }
  &__actions { }
  &__list { }
  &__empty-state { }

  // Modifiers
  &--compact { }
  &--comfortable { }
  &--bulk-mode { }
}

// Tree Item
.vfs-item {
  &__container { }
  &__icon { }
  &__label { }
  &__badge { }
  &__tags { }
  &__actions { }
  &__outline { }

  // States
  &.is-selected { }
  &.is-active { }
  &.is-dragging { }
  &.is-drop-target { }
  &.is-expanded { }
  &.is-highlighted { } // search match

  // Modifiers
  &--file { }
  &--folder { }
}

// Context Menu
.vfs-context-menu {
  &__container { }
  &__item { }
  &__divider { }
  &__submenu { }
  &__shortcut { }

  &__item {
    &:hover { }
    &--disabled { }
  }
}

// Modal
.vfs-modal {
  &__overlay { }
  &__container { }
  &__header { }
  &__body { }
  &__footer { }
  &__close { }
}

// Bulk Action Bar
.vfs-bulk-bar {
  &__container { }
  &__selection-info { }
  &__actions { }
  &__action-button { }
}

// Tags
.vfs-tag {
  &__pill { }
  &__label { }
  &__remove { }

  // Colors (data attribute)
  &[data-color="red"] { }
  &[data-color="blue"] { }
  // ... etc
}

// Search
.vfs-search {
  &__input { }
  &__icon { }
  &__clear { }
  &__suggestions { }
  &__filter-pills { }
}

// Drag & Drop
.vfs-drop {
  &-indicator {
    &--before { }
    &--after { }
    &--into { }
  }

  &-ghost { }
}
```

### 6.2 Theme Variables

```scss
:root {
  // Colors
  --vfs-primary: #007bff;
  --vfs-danger: #dc3545;
  --vfs-success: #28a745;
  --vfs-warning: #ffc107;

  --vfs-bg-base: #ffffff;
  --vfs-bg-hover: #f5f5f5;
  --vfs-bg-selected: #e3f2fd;
  --vfs-bg-active: #bbdefb;

  --vfs-text-primary: #212529;
  --vfs-text-secondary: #6c757d;
  --vfs-text-muted: #adb5bd;

  --vfs-border: #dee2e6;
  --vfs-border-hover: #adb5bd;

  // Spacing
  --vfs-spacing-xs: 4px;
  --vfs-spacing-sm: 8px;
  --vfs-spacing-md: 16px;
  --vfs-spacing-lg: 24px;
  --vfs-spacing-xl: 32px;

  // Density
  --vfs-item-height-comfortable: 36px;
  --vfs-item-height-compact: 28px;
  --vfs-indent-size: 20px;

  // Typography
  --vfs-font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  --vfs-font-size-sm: 12px;
  --vfs-font-size-base: 14px;
  --vfs-font-size-lg: 16px;

  // Transitions
  --vfs-transition-fast: 150ms ease;
  --vfs-transition-base: 250ms ease;
  --vfs-transition-slow: 350ms ease;

  // Shadows
  --vfs-shadow-sm: 0 1px 2px rgba(0,0,0,0.05);
  --vfs-shadow-md: 0 4px 6px rgba(0,0,0,0.1);
  --vfs-shadow-lg: 0 10px 15px rgba(0,0,0,0.1);

  // Z-index
  --vfs-z-dropdown: 1000;
  --vfs-z-modal: 1050;
  --vfs-z-tooltip: 1060;
}

// Dark Mode
[data-theme="dark"] {
  --vfs-bg-base: #1e1e1e;
  --vfs-bg-hover: #2d2d2d;
  --vfs-bg-selected: #37373d;
  --vfs-bg-active: #094771;

  --vfs-text-primary: #cccccc;
  --vfs-text-secondary: #858585;
  --vfs-text-muted: #5c5c5c;

  --vfs-border: #3e3e42;
  --vfs-border-hover: #5c5c5c;
}
```

---

## 7. Data Structures

### 7.1 Extended Node Metadata

```typescript
interface VFSNodeMetadata {
  // Existing
  name: string;
  type: 'file' | 'dir';
  size?: number;
  created: Date;
  modified: Date;

  // Extensions
  tags?: string[];
  color?: string;
  icon?: string;
  description?: string;
  favorite?: boolean;
  archived?: boolean;

  // Editor State
  scrollPosition?: number;
  cursorPosition?: { line: number; column: number };
  foldedSections?: number[];

  // Outline Cache
  outline?: OutlineHeading[];
  outlineUpdated?: Date;
}
```

### 7.2 Search Index

```typescript
interface SearchIndex {
  // Full-text index
  tokens: Map<string, Set<string>>; // token -> nodeIds

  // Tag index
  tagIndex: Map<string, Set<string>>; // tagId -> nodeIds

  // Type index
  typeIndex: Map<'file' | 'dir', Set<string>>;

  // Date index
  dateIndex: {
    created: Map<string, Date>; // nodeId -> date
    modified: Map<string, Date>;
  };

  // Methods
  buildIndex(nodes: VFSNode[]): void
  updateNode(node: VFSNode): void
  removeNode(id: string): void
  search(query: string, filters: SearchFilters): string[]
}
```

---

## 8. Implementation Plan

### Phase 1: Foundation (Week 1)
**Goal:** Set up core infrastructure

**Tasks:**
1. Create UIStore with Immer integration
2. Implement SelectionManager
3. Enhance EventBus with new event types
4. Set up VFSUIService skeleton
5. Create base CSS architecture

**Deliverables:**
- `vfs-ui-store.ts` (state management)
- `selection-manager.ts`
- `vfs-ui-service.ts`
- `vfs-ui-events.ts`
- `styles/base.scss`

### Phase 2: Core Components (Week 2)
**Goal:** Build essential UI components

**Tasks:**
1. Enhance VFSTreeView with multi-select
2. Build VFSContextMenu
3. Build VFSModal system
4. Build VFSSearchBar
5. Implement basic styling

**Deliverables:**
- `components/vfs-tree-view.tsx` (enhanced)
- `components/vfs-context-menu.tsx`
- `components/vfs-modal.tsx`
- `components/vfs-search-bar.tsx`
- `styles/components.scss`

### Phase 3: Advanced Features (Week 3)
**Goal:** Implement interaction systems

**Tasks:**
1. Implement DragDropManager
2. Build KeyboardHandler
3. Build VFSBulkActionBar
4. Create TagService
5. Build VFSTagEditor

**Deliverables:**
- `drag-drop-manager.ts`
- `keyboard-handler.ts`
- `components/vfs-bulk-bar.tsx`
- `tag-service.ts`
- `components/vfs-tag-editor.tsx`

### Phase 4: Search & Outline (Week 4)
**Goal:** Complete advanced features

**Tasks:**
1. Build SearchIndex
2. Implement search functionality
3. Build VFSOutlineView
4. Implement outline extraction
5. Add inline outline support

**Deliverables:**
- `search-index.ts`
- `search-manager.ts`
- `components/vfs-outline-view.tsx`
- `outline-extractor.ts`

### Phase 5: Polish & Integration (Ongoing)
**Goal:** Refinement and optimization

**Tasks:**
1. Performance optimization
2. Accessibility improvements
3. Animation polish
4. Documentation
5. Testing

---

## 9. Testing Strategy

### 9.1 Unit Tests
- SelectionManager: All selection modes
- DragDropManager: Validation logic
- TagService: CRUD operations
- SearchIndex: Query parsing and results

### 9.2 Integration Tests
- Multi-select + bulk operations
- Drag & drop full flow
- Search with filters
- Tag application and filtering

### 9.3 E2E Tests
- Complete user workflows:
  - Create, rename, delete files
  - Multi-select and bulk delete
  - Search and filter
  - Drag files to folders
  - Apply tags and filter by tags

---

## 10. Performance Considerations

### 10.1 Virtualization
```typescript
// Use react-window for large trees
import { VariableSizeList } from 'react-window';

// Only render visible items
// Calculate item heights dynamically (compact vs comfortable)
// Handle nested items with proper positioning
```

### 10.2 Memoization
```typescript
// Memo-ize expensive components
const VFSTreeItem = React.memo(VFSTreeItemComponent, (prev, next) => {
  return (
    prev.node.id === next.node.id &&
    prev.isSelected === next.isSelected &&
    prev.isExpanded === next.isExpanded &&
    prev.dragState === next.dragState
  );
});

// Use useMemo for derived state
const filteredNodes = useMemo(() => {
  return nodes.filter(node => matchesSearch(node, searchQuery));
}, [nodes, searchQuery]);
```

### 10.3 Debouncing & Throttling
```typescript
// Debounce search queries
const debouncedSearch = useDebouncedCallback(
  (query: string) => performSearch(query),
  300
);

// Throttle drag over events
const throttledDragOver = useThrottledCallback(
  (event: DragEvent) => handleDragOver(event),
  16 // ~60fps
);
```

---

## 11. Migration Path

### For Existing VFS-UI Users:

1. **Backward Compatible:** All existing VFS-UI APIs remain functional
2. **Opt-in Features:** New features enabled via configuration
3. **Gradual Adoption:** Can use new components incrementally

```typescript
// Old API still works
const manager = new VFSUIManager(vfsCore);

// New API adds capabilities
const enhancedManager = new VFSUIManager(vfsCore, {
  enableMultiSelect: true,
  enableDragDrop: true,
  enableSearch: true,
  enableTags: true,
  // etc.
});
```

---

## 12. Success Criteria

### Feature Parity with Sidebar:
- ✅ Multi-selection with keyboard shortcuts
- ✅ Drag & drop with visual feedback
- ✅ Advanced search with filters
- ✅ Tag system with autocomplete
- ✅ Context menus
- ✅ Bulk operations
- ✅ Inline outlines
- ✅ Settings panel
- ✅ Keyboard navigation

### Performance:
- Tree rendering: < 16ms per frame (60fps)
- Search results: < 200ms for 1000 items
- Drag feedback: < 16ms (60fps)

### Code Quality:
- TypeScript: 100% type coverage
- Tests: >80% code coverage
- Documentation: All public APIs documented
- Accessibility: WCAG 2.1 AA compliant

---

## Next Steps

1. **Review & Approve Design:** Stakeholder sign-off
2. **Set Up Project Structure:** Initialize directories and base files
3. **Begin Phase 1:** Start with foundation implementation
4. **Weekly Reviews:** Progress check-ins and adjustments

---

**Document Version:** 1.0
**Last Updated:** 2025-11-09
**Author:** Design Team
**Status:** Awaiting Approval