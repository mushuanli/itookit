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
      this.props = nextProps;
      this.render();
    }
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
