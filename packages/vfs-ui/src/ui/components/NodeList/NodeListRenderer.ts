import { defaultPresentation, type VFSPresentation } from '../../../contracts/presentation';
/**
 * @file vfs-ui/ui/components/NodeList/NodeListRenderer.ts
 * @desc Handles rendering of node items in the list.
 */
import type { FavoriteAction, VFSNodeUI } from '../../../contracts/types';
import type { NodeListState } from './NodeListState';
import type { SelectionHandler } from './handlers/SelectionHandler';
import { BaseNodeItem } from './items/BaseNodeItem';
import { FileItem, FileItemProps } from './items/FileItem';
import { DirectoryItem, DirectoryItemProps } from './items/DirectoryItem';
import { createItemInputHTML } from './templates';
import { resolveRowPolicy, type RowPolicy } from '../../../utils/row-policy';
import { DirectoryPreview } from './DirectoryPreview';

export interface RenderContext {
  rootPath?: string | null;
  confirmDeleteId: string | null;
  findItemById: (id: string) => VFSNodeUI | null;
  onPreviewChange?: () => void;
}

export interface NodeListRendererOptions {
  presentation?: VFSPresentation;
  selectionHandler: SelectionHandler;
  leafDirectory?: (node: VFSNodeUI) => boolean;
  cardDirectory?: (node: VFSNodeUI) => boolean;
  directoryPreview?: (node: VFSNodeUI) => number | undefined;
  /** Host-owned favorite state; undefined rows render no control. */
  favoriteAction?: FavoriteAction;
}

export class NodeListRenderer {
  private readonly ui: VFSPresentation;
  private itemInstances: Map<string, BaseNodeItem> = new Map();
  private readonly preview: DirectoryPreview;
  private readonly selectionHandler: SelectionHandler;
  private readonly leafDirectory?: (node: VFSNodeUI) => boolean;
  private readonly cardDirectory?: (node: VFSNodeUI) => boolean;
  private readonly favoriteAction?: FavoriteAction;
  private rerender?: (focusId: string) => void;

  constructor(options: NodeListRendererOptions) {
    this.ui = options.presentation ?? defaultPresentation;
    this.selectionHandler = options.selectionHandler;
    this.leafDirectory = options.leafDirectory;
    this.cardDirectory = options.cardDirectory;
    this.favoriteAction = options.favoriteAction;
    this.preview = new DirectoryPreview(options.directoryPreview, this.ui);
  }

  renderItems(
    container: HTMLElement,
    state: NodeListState,
    context: RenderContext
  ): void {
    this.rerender = focusId => {
      if (context.onPreviewChange) context.onPreviewChange(); else this.renderItems(container, state, context);
      for (const control of container.querySelectorAll<HTMLButtonElement>('[data-preview-id]')) {
        if (control.dataset.previewId === focusId) control.focus({ preventScroll: true });
      }
    };
    const newInstances: Map<string, BaseNodeItem> = new Map();
    const fragment = document.createDocumentFragment();

    this.traverseAndRender(
      state.items,
      fragment,
      context.rootPath ?? null,
      state,
      context,
      newInstances,
      new Set<string>()
    );

    container.innerHTML = '';
    container.appendChild(fragment);

    this.itemInstances.forEach((instance, id) => {
      if (!newInstances.has(id)) {
        instance.destroy();
      }
    });

    this.itemInstances = newInstances;
  }

  private traverseAndRender(
    itemList: VFSNodeUI[],
    parentEl: DocumentFragment | HTMLElement,
    currentParentId: string | null,
    state: NodeListState,
    context: RenderContext,
    newInstances: Map<string, BaseNodeItem>,
    visitedIds: Set<string>
  ): void {
    if (!state.readOnly && state.creatingItem?.parentPath === currentParentId) {
      const creatorDiv = document.createElement('div');
      creatorDiv.innerHTML = createItemInputHTML(state.creatingItem, this.ui);
      parentEl.appendChild(creatorDiv.firstElementChild!);
    }

    if (itemList.length === 0 && currentParentId !== null) {
      if (state.creatingItem?.parentPath !== currentParentId) {
        (parentEl as HTMLElement).innerHTML =
          '<div class="vfs-directory-item__empty-placeholder">(空)</div>';
      }
      return;
    }

    for (const item of itemList) {
      // Guard against tree cycles (e.g. a node appearing as its own descendant).
      // Rendering a cycle would cause HierarchyRequestError in appendChild.
      if (visitedIds.has(item.id)) continue;
      visitedIds.add(item.id);

      const policy = resolveRowPolicy(state.readOnly, item);
      let itemInstance = this.itemInstances.get(item.id);

      // Policy is baked into item markup; any policy change must rebuild the row.
      if (itemInstance && (itemInstance.policy.readOnly !== policy.readOnly
        || itemInstance.policy.fixed !== policy.fixed || itemInstance.policy.inlineDelete !== policy.inlineDelete
        || itemInstance.policy.hostOwnedDelete !== policy.hostOwnedDelete
        || (itemInstance instanceof FileItem) !== (item.type === 'file'))) {
        itemInstance.destroy(); itemInstance = undefined;
      }
      if (itemInstance) {
        itemInstance.updateItem(item);
        this.updateItemProps(itemInstance, item, state, context.confirmDeleteId);
      } else {
        itemInstance = this.createItem(item, policy, state, context.confirmDeleteId);
      }

      parentEl.appendChild(itemInstance.element);
      newInstances.set(item.id, itemInstance);

      if (item.type === 'directory' && !this.leafDirectory?.(item)) {
        const isExpanded =
          state.expandedFolderIds.has(item.id) || !!state.searchQuery;

        if (isExpanded) {
          const childrenContainer = (itemInstance as DirectoryItem)
            .childrenContainer;
          const scrollTop = childrenContainer.scrollTop;
          childrenContainer.innerHTML = '';
          const preview = this.preview.project(item, state);
          childrenContainer.classList.toggle('vfs-directory-item__children--preview-expanded', preview.expanded === true);
          this.traverseAndRender(
            preview.children,
            childrenContainer,
            item.id,
            state,
            context,
            newInstances,
            visitedIds
          );
          if (preview.expanded !== undefined) childrenContainer.append(this.preview.control(item.id, preview.expanded, preview.hidden!, () => {
            this.rerender?.(item.id);
          }));
          if (preview.expanded) childrenContainer.scrollTop = scrollTop;
        }
      }
    }
  }

  private createItem(item: VFSNodeUI, policy: RowPolicy, state: NodeListState, confirmDeleteId: string | null): BaseNodeItem {
    return item.type === 'file'
      ? new FileItem(item, policy, this.getFileItemProps(item, state, confirmDeleteId))
      : new DirectoryItem(item, policy, this.getDirectoryItemProps(item, state, confirmDeleteId));
  }

  private updateItemProps(instance: BaseNodeItem, item: VFSNodeUI, state: NodeListState, confirmDeleteId: string | null): void {
    if (item.type === 'file') (instance as FileItem).update(this.getFileItemProps(item, state, confirmDeleteId));
    else (instance as DirectoryItem).update(this.getDirectoryItemProps(item, state, confirmDeleteId));
  }

  private getFileItemProps(
    item: VFSNodeUI,
    state: NodeListState,
    confirmDeleteId: string | null
  ): FileItemProps {
    return {
      isActive: item.id === state.activeId,
      isSelected: state.selectedItemIds.has(item.id),
      isSelectionMode: !state.readOnly && state.selectedItemIds.size > 1,
      isOutlineExpanded: state.expandedOutlineIds.has(item.id),
      searchQueries: state.textSearchQueries,
      uiSettings: state.uiSettings,
      presentation: this.ui,
      isConfirmingDelete: confirmDeleteId === item.id,
      favorite: this.favoriteAction?.state(item),
    };
  }

  private getDirectoryItemProps(
    item: VFSNodeUI,
    state: NodeListState,
    confirmDeleteId: string | null
  ): DirectoryItemProps {
    return {
      presentation: this.ui,
      isConfirmingDelete: confirmDeleteId === item.id,
      favorite: this.favoriteAction?.state(item),
      isLeaf: this.leafDirectory?.(item),
      isCard: this.cardDirectory?.(item),
      isActive: item.id === state.activeId,
      isExpanded: !this.leafDirectory?.(item) && (state.expandedFolderIds.has(item.id) || !!state.searchQuery),
      dirSelectionState: this.selectionHandler.getFolderSelectionState(
        item,
        state.selectedItemIds
      ),
      isSelected: state.selectedItemIds.has(item.id),
      isSelectionMode: !state.readOnly && state.selectedItemIds.size > 1,
      searchQueries: state.textSearchQueries,
    };
  }

  destroy(): void {
    this.rerender = undefined; this.preview.clear();
    this.itemInstances.forEach(instance => instance.destroy());
    this.itemInstances.clear();
  }
}
