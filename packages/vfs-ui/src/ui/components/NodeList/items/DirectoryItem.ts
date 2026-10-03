/**
 * @file vfs-ui/ui/components/NodeList/items/DirectoryItem.ts
 */
import { BaseNodeItem } from './BaseNodeItem';
import type { VFSNodeUI } from '../../../../contracts/types';
import type { RowPolicy } from '../../../../utils/row-policy';
import { createDirectoryItemHTML, DirectoryItemProps } from './itemTemplates';

export class DirectoryItem extends BaseNodeItem {
  public childrenContainer!: HTMLElement;
  private props: DirectoryItemProps;

  constructor(item: VFSNodeUI, policy: RowPolicy, props: DirectoryItemProps) {
    super(item, policy);
    this.props = props;
    this.render();
  }

  update(nextProps: DirectoryItemProps): void {
    if (JSON.stringify(this.props) !== JSON.stringify(nextProps)) {
      const selectionKeys = new Set(['dirSelectionState', 'isSelected', 'isSelectionMode']);
      const onlySelection = Object.keys({ ...this.props, ...nextProps }).every(key => selectionKeys.has(key)
        || JSON.stringify(this.props[key as keyof DirectoryItemProps]) === JSON.stringify(nextProps[key as keyof DirectoryItemProps]));
      this.props = nextProps;
      if (onlySelection) this.updateSelection(); else this.render();
    }
  }

  /** Preserve the click target while selection changes so native double-click still fires. */
  private updateSelection(): void {
    const template = document.createElement('template');
    template.innerHTML = createDirectoryItemHTML(this.item, this.props, this.policy);
    const row = this.element.querySelector<HTMLElement>('.vfs-node-item__main-row')!;
    row.classList.toggle('is-selection-mode', this.props.isSelectionMode);
    this.element.querySelector('.vfs-directory-item__header')!.classList.toggle('is-selected', this.props.isSelected);
    row.querySelector(':scope > .vfs-node-item__checkbox-wrapper')?.remove();
    const checkbox = template.content.querySelector('.vfs-node-item__checkbox-wrapper');
    if (checkbox) row.prepend(checkbox);
    const input = row.querySelector<HTMLInputElement>('input[data-indeterminate]');
    if (input) input.indeterminate = true;
  }

  protected render(): void {
    const oldChildren = this.childrenContainer;
    this.replaceElement(
      createDirectoryItemHTML(this.item, this.props, this.policy)
    );
    this.childrenContainer = this.element.querySelector(
      '.vfs-directory-item__children'
    )!;

    if (oldChildren) {
      while (oldChildren.firstChild) {
        this.childrenContainer.appendChild(oldChildren.firstChild);
      }
    }
  }
}

export type { DirectoryItemProps };
