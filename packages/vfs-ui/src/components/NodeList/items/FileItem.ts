/**
 * @file vfs-ui/components/NodeList/items/FileItem.ts
 * @desc Component representing a single file in the list.
 */
import { BaseNodeItem } from './BaseNodeItem';
import type { VFSNodeUI } from '../../../types/types';
import { createFileItemHTML, FileItemProps } from './itemTemplates';

export class FileItem extends BaseNodeItem {
  private props: FileItemProps;

  constructor(item: VFSNodeUI, isReadOnly: boolean, props: FileItemProps) {
    super(item, isReadOnly);
    this.props = props;
    this.render();
  }

  update(nextProps: FileItemProps): void {
    if (JSON.stringify(this.props) !== JSON.stringify(nextProps)) {
      this.props = nextProps;
      this.render();
    }
  }

  protected render(): void {
    this.replaceElement(createFileItemHTML(this.item, this.props, this.isReadOnly));
  }
}

export type { FileItemProps };
