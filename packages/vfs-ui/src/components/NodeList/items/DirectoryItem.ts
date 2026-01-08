/**
 * @file vfs-ui/components/NodeList/items/DirectoryItem.ts
 * @desc Component representing a single directory in the list.
 */
import { BaseNodeItem } from './BaseNodeItem';
import type { VFSNodeUI } from '../../../types/types';
import { createDirectoryItemHTML, DirectoryItemProps } from './itemTemplates';

export class DirectoryItem extends BaseNodeItem {
  public childrenContainer!: HTMLElement;
  private props: DirectoryItemProps;

  constructor(item: VFSNodeUI, isReadOnly: boolean, props: DirectoryItemProps) {
    super(item, isReadOnly);
    this.props = props;
    this.render();
  }

  update(nextProps: DirectoryItemProps): void {
    if (JSON.stringify(this.props) !== JSON.stringify(nextProps)) {
      this.props = nextProps;
      this.render();
    }
  }

  protected render(): void {
    const oldChildren = this.childrenContainer;
    this.replaceElement(createDirectoryItemHTML(this.item, this.props, this.isReadOnly));
    this.childrenContainer = this.element.querySelector('.vfs-directory-item__children')!;
    
    if (oldChildren) {
      while (oldChildren.firstChild) {
        this.childrenContainer.appendChild(oldChildren.firstChild);
      }
    }
  }
}

export type { DirectoryItemProps };
