/**
 * @file vfs-ui/ui/components/NodeList/items/BaseNodeItem.ts
 * @desc Abstract base for individual list items.
 */
import type { VFSNodeUI } from '../../../../contracts/types';

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

  destroy(): void {
    this.element.remove();
  }

  protected replaceElement(newHTML: string): void {
    const temp = document.createElement('div');
    temp.innerHTML = newHTML;
    const newEl = temp.firstElementChild as HTMLElement;
    this.element.parentNode?.replaceChild(newEl, this.element);
    this.element = newEl;
    const disabled = this.item.metadata.custom._disabled === true;
    this.element.classList.toggle('vfs-node-item--unavailable', disabled);
    this.element.setAttribute('aria-disabled', String(disabled));
    this.element.inert = disabled;
    if (disabled) this.element.draggable = false;
  }

  protected shouldRerender(oldItem: VFSNodeUI, newItem: VFSNodeUI): boolean {
    return (
      JSON.stringify(oldItem.metadata.tags) !==
        JSON.stringify(newItem.metadata.tags) ||
      oldItem.metadata.title !== newItem.metadata.title ||
      oldItem.icon !== newItem.icon ||
      oldItem.metadata.custom._disabled !== newItem.metadata.custom._disabled ||
      oldItem.metadata.size !== newItem.metadata.size ||
      oldItem.metadata.lastModified !== newItem.metadata.lastModified ||
      JSON.stringify(oldItem.presentation) !== JSON.stringify(newItem.presentation) ||
      oldItem.metadata.custom.navigationDescription !== newItem.metadata.custom.navigationDescription ||
      oldItem.content?.summary !== newItem.content?.summary ||
      JSON.stringify(oldItem.metadata.custom?.taskCount) !==
        JSON.stringify(newItem.metadata.custom?.taskCount)
    );
  }
}
