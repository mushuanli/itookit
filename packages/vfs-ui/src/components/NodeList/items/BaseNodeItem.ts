/**
 * @file vfs-ui/components/NodeList/items/BaseNodeItem.ts
 * @desc Abstract base class for FileItem and DirectoryItem, handling common logic.
 */
import type { VFSNodeUI } from '../../../types/types';

export abstract class BaseNodeItem {
  public element: HTMLElement;
  protected item: VFSNodeUI;
  protected readonly isReadOnly: boolean;

  constructor(item: VFSNodeUI, isReadOnly: boolean) {
    this.item = item;
    this.isReadOnly = isReadOnly;
    this.element = document.createElement('div');
    if (!isReadOnly) this.element.draggable = true;
  }

  updateItem(newItem: VFSNodeUI): void {
    const needsRerender = this.shouldRerender(this.item, newItem);
    this.item = newItem;
    if (needsRerender) this.render();
  }

  abstract update(props: any): void;
  protected abstract render(): void;

  destroy(): void { this.element.remove(); }

  protected replaceElement(newHTML: string): void {
    const temp = document.createElement('div');
    temp.innerHTML = newHTML;
    const newEl = temp.firstElementChild as HTMLElement;
    this.element.parentNode?.replaceChild(newEl, this.element);
    this.element = newEl;
  }

  protected shouldRerender(oldItem: VFSNodeUI, newItem: VFSNodeUI): boolean {
    return JSON.stringify(oldItem.metadata.tags) !== JSON.stringify(newItem.metadata.tags) ||
           oldItem.metadata.title !== newItem.metadata.title ||
           JSON.stringify(oldItem.metadata.custom?.taskCount) !== JSON.stringify(newItem.metadata.custom?.taskCount);
  }
}
