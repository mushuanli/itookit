/**
 * @file vfs-ui/components/NodeList/NodeListState.ts
 * @desc Handles state transformation and filtering logic for NodeList
 */
import type { VFSNodeUI, UISettings, VFSUIState, SearchFilter } from '../../types/types';

export interface NodeListState {
  items: VFSNodeUI[];
  textSearchQueries: string[];
  searchQuery: string;
  activeId: string | null;
  expandedFolderIds: Set<string>;
  expandedOutlineIds: Set<string>;
  selectedItemIds: Set<string>;
  creatingItem: { type: 'file' | 'directory'; parentId: string | null } | null;
  selectionStatus: 'none' | 'partial' | 'all';
  visibleItemIds: string[];
  readOnly: boolean;
  status: 'idle' | 'loading' | 'success' | 'error';
  uiSettings: UISettings;
  createFileLabel: string;
}

export interface ParsedSearchQuery {
  textQueries: string[];
  tagQueries: string[];
  typeQueries: string[];
}

export class NodeListStateTransformer {
  constructor(
    private readonly searchFilter?: SearchFilter,
    private readonly createFileLabel: string = 'File'
  ) {}

  transform(globalState: VFSUIState): NodeListState {
    const {
      items, searchQuery, uiSettings, expandedFolderIds,
      expandedOutlineIds, selectedItemIds, activeId,
      creatingItem, status, readOnly
    } = globalState;

    const parsedQuery = this.parseSearchQuery(searchQuery);
    const filteredItems = this.filterAndSortItems(items, parsedQuery, uiSettings, readOnly);
    const visibleItemIds = this.getVisibleItemIds(
      filteredItems,
      new Set([...expandedFolderIds, ...items.map(i => i.id)])
    );

    const selectionStatus = this.calculateSelectionStatus(
      selectedItemIds, visibleItemIds, readOnly
    );

    return {
      items: filteredItems,
      textSearchQueries: parsedQuery.textQueries,
      searchQuery,
      activeId,
      expandedFolderIds,
      expandedOutlineIds,
      uiSettings,
      status,
      selectedItemIds,
      creatingItem,
      selectionStatus,
      visibleItemIds,
      readOnly,
      createFileLabel: this.createFileLabel
    };
  }

  parseSearchQuery(query: string): ParsedSearchQuery {
    const lowerCaseQuery = query.trim().toLowerCase();
    if (!lowerCaseQuery) {
      return { textQueries: [], tagQueries: [], typeQueries: [] };
    }

    const tokens = lowerCaseQuery.split(/\s+/).filter(Boolean);
    const textQueries: string[] = [];
    const tagQueries: string[] = [];
    const typeQueries: string[] = [];

    for (const token of tokens) {
      if (token.startsWith('tag:')) {
        tagQueries.push(token.substring(4));
      } else if (token.startsWith('type:')) {
        const type = token.substring(5);
        if (type === 'file' || type === 'dir') {
          typeQueries.push(type);
        }
      } else {
        textQueries.push(token);
      }
    }

    return { textQueries, tagQueries, typeQueries };
  }

  private filterAndSortItems(
    items: VFSNodeUI[],
    queries: ParsedSearchQuery,
    uiSettings: UISettings,
    isReadOnly: boolean
  ): VFSNodeUI[] {
    let processedItems: VFSNodeUI[] = JSON.parse(JSON.stringify(items));
    const hasQuery = queries.textQueries.length > 0 ||
                     queries.tagQueries.length > 0 ||
                     queries.typeQueries.length > 0;

    if (hasQuery) {
      processedItems = this.filterRecursively(processedItems, queries);
    }

    if (!isReadOnly) {
      this.sortRecursively(processedItems, uiSettings);
    }

    return processedItems;
  }

  private filterRecursively(
    itemList: VFSNodeUI[],
    queries: ParsedSearchQuery
  ): VFSNodeUI[] {
    return itemList
      .map(item => {
        if (item.type === 'directory') {
          const filteredChildren = this.filterRecursively(item.children || [], queries);
          if (this.itemMatches(item, queries) || filteredChildren.length > 0) {
            return { ...item, children: filteredChildren };
          }
          return null;
        }
        return this.itemMatches(item, queries) ? item : null;
      })
      .filter((item): item is VFSNodeUI => item !== null);
  }

  private itemMatches(item: VFSNodeUI, queries: ParsedSearchQuery): boolean {
    const { textQueries, tagQueries, typeQueries } = queries;

    // Type filter
    if (typeQueries.length > 0) {
      const itemType = item.type === 'directory' ? 'dir' : 'file';
      if (!typeQueries.includes(itemType)) return false;
    }

    // Tag filter
    if (tagQueries.length > 0) {
      const itemTags = (item.metadata?.tags || []).map(t => t.toLowerCase());
      if (!tagQueries.every(qTag => itemTags.includes(qTag))) return false;
    }

    // Text filter
    if (textQueries.length > 0) {
      if (this.searchFilter) {
        if (!this.searchFilter(item, textQueries)) return false;
      } else {
        const corpus = [
          item.metadata?.title || '',
          item.content?.summary || '',
          item.content?.searchableText || ''
        ].join(' ').toLowerCase();
        if (!textQueries.every(qText => corpus.includes(qText))) return false;
      }
    }

    return true;
  }

  private sortRecursively(itemList: VFSNodeUI[], uiSettings: UISettings): void {
    if (!itemList) return;

    itemList.sort((a, b) => {
      // Pinned items first
      const aIsPinned = a.metadata?.custom?.isPinned || false;
      const bIsPinned = b.metadata?.custom?.isPinned || false;
      if (aIsPinned !== bIsPinned) return aIsPinned ? -1 : 1;

      // Sort by setting
      if (uiSettings.sortBy === 'title') {
        return (a.metadata?.title || '').localeCompare(b.metadata?.title || '', 'zh-CN');
      }

      // Default: sort by modification time
      const aDate = new Date(a.metadata?.lastModified || 0).getTime();
      const bDate = new Date(b.metadata?.lastModified || 0).getTime();
      return bDate - aDate;
    });

    for (const item of itemList) {
      if (item.type === 'directory' && item.children) {
        this.sortRecursively(item.children, uiSettings);
      }
    }
  }

  private getVisibleItemIds(
    items: VFSNodeUI[],
    expandedFolderIds: Set<string>
  ): string[] {
    const ids: string[] = [];

    const traverse = (itemList: VFSNodeUI[]) => {
      for (const item of itemList) {
        ids.push(item.id);
        if (item.type === 'directory' && item.children && expandedFolderIds.has(item.id)) {
          traverse(item.children);
        }
      }
    };

    traverse(items);
    return ids;
  }

  private calculateSelectionStatus(
    selectedItemIds: Set<string>,
    visibleItemIds: string[],
    readOnly: boolean
  ): 'none' | 'partial' | 'all' {
    const selectedCount = selectedItemIds.size;
    if (readOnly || selectedCount <= 1 || visibleItemIds.length === 0) {
      return 'none';
    }

    const allVisibleSelected = visibleItemIds.every(id => selectedItemIds.has(id));
    return allVisibleSelected && selectedCount === visibleItemIds.length ? 'all' : 'partial';
  }
}
