/**
 * @file vfs-ui/ui/components/NodeList/NodeListRenderer.ts
 * @desc Handles rendering of node items in the list.
 */
import type { VFSNodeUI } from '../../../contracts/types';
import type { NodeListState } from './NodeListState';
import type { SelectionHandler } from './handlers/SelectionHandler';
import { BaseNodeItem } from './items/BaseNodeItem';
import { FileItem, FileItemProps } from './items/FileItem';
import { DirectoryItem, DirectoryItemProps } from './items/DirectoryItem';
import { createItemInputHTML } from './templates';

export interface RenderContext {
  confirmDeleteId: string | null;
  findItemById: (id: string) => VFSNodeUI | null;
}

export class NodeListRenderer {
  private itemInstances: Map<string, BaseNodeItem> = new Map();

  constructor(private readonly selectionHandler: SelectionHandler) {}

  renderItems(
    container: HTMLElement,
    state: NodeListState,
    context: RenderContext
  ): void {
    const newInstances: Map<string, BaseNodeItem> = new Map();
    const fragment = document.createDocumentFragment();

    this.traverseAndRender(
      state.items,
      fragment,
      null,
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
      creatorDiv.innerHTML = createItemInputHTML(state.creatingItem);
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

      let itemInstance = this.itemInstances.get(item.id);

      if (!itemInstance) {
        if (item.type === 'file') {
          const props = this.getFileItemProps(item, state, context.confirmDeleteId);
          itemInstance = new FileItem(item, state.readOnly, props);
        } else {
          const props = this.getDirectoryItemProps(item, state);
          itemInstance = new DirectoryItem(item, state.readOnly, props);
        }
      } else {
        itemInstance.updateItem(item);
      }

      if (item.type === 'file') {
        const props = this.getFileItemProps(item, state, context.confirmDeleteId);
        (itemInstance as FileItem).update(props);
      } else {
        const props = this.getDirectoryItemProps(item, state);
        (itemInstance as DirectoryItem).update(props);
      }

      parentEl.appendChild(itemInstance.element);
      newInstances.set(item.id, itemInstance);

      if (item.type === 'directory') {
        const isExpanded =
          state.expandedFolderIds.has(item.id) || !!state.searchQuery;

        if (isExpanded) {
          const childrenContainer = (itemInstance as DirectoryItem)
            .childrenContainer;
          childrenContainer.innerHTML = '';
          this.traverseAndRender(
            item.children || [],
            childrenContainer,
            item.id,
            state,
            context,
            newInstances,
            visitedIds
          );
        }
      }
    }
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
      isConfirmingDelete: confirmDeleteId === item.id,
    };
  }

  private getDirectoryItemProps(
    item: VFSNodeUI,
    state: NodeListState
  ): DirectoryItemProps {
    return {
      isExpanded: state.expandedFolderIds.has(item.id) || !!state.searchQuery,
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
    this.itemInstances.forEach(instance => instance.destroy());
    this.itemInstances.clear();
  }
}
