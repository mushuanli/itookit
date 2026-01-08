/**
 * @file vfs-ui/components/NodeList/items/FileItem.ts
 * @desc Component representing a single file in the list.
 */
import { BaseNodeItem } from './BaseNodeItem';
import type { VFSNodeUI, UISettings } from '../../../types/types';
import { createFileItemHTML } from './itemTemplates';

export interface FileItemProps {
    isActive: boolean;
    isSelected: boolean;
    isOutlineExpanded: boolean;
    isSelectionMode: boolean;
    searchQueries: string[];
    uiSettings: UISettings;
    isConfirmingDelete: boolean;
}

export class FileItem extends BaseNodeItem {
    private props: FileItemProps;

    constructor(item: VFSNodeUI, isReadOnly: boolean, initialProps: FileItemProps) {
        super(item, isReadOnly);
        this.props = initialProps;
        this.render();
    }

    updateItem(newItem: VFSNodeUI): void {
        if (this.shouldRerender(this.item, newItem)) {
            super.updateItem(newItem);
            this.render();
        } else {
            super.updateItem(newItem);
        }
    }

    update(nextProps: FileItemProps): void {
        if (JSON.stringify(this.props) !== JSON.stringify(nextProps)) {
            this.props = nextProps;
            this.render();
        }
    }

    private render(): void {
        this.replaceElement(createFileItemHTML(this.item, this.props, this.isReadOnly));
    }
}
