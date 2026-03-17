/**
 * @file vfs-ui/ui/components/NodeList/items/FileItem.ts
 */
import { BaseNodeItem } from './BaseNodeItem';
import type { VFSNodeUI } from '../../../../contracts/types';
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
