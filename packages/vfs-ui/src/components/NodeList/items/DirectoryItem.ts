/**
 * @file vfs-ui/components/NodeList/items/DirectoryItem.ts
 * @desc Component representing a single directory in the list.
 */
import { BaseNodeItem } from './BaseNodeItem';
import type { VFSNodeUI } from '../../../types/types';
import { createDirectoryItemHTML } from './itemTemplates';

export interface DirectoryItemProps {
    isExpanded: boolean;
    dirSelectionState: 'none' | 'partial' | 'all';
    isSelected: boolean;
    isSelectionMode: boolean;
    searchQueries: string[];
}

export class DirectoryItem extends BaseNodeItem {
    public childrenContainer!: HTMLElement;
    private props: DirectoryItemProps;

    constructor(item: VFSNodeUI, isReadOnly: boolean, initialProps: DirectoryItemProps) {
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

    update(nextProps: DirectoryItemProps): void {
        if (JSON.stringify(this.props) !== JSON.stringify(nextProps)) {
            this.props = nextProps;
            this.render();
        }
    }

    private render(): void {
        const oldChildren = this.childrenContainer;
        this.replaceElement(createDirectoryItemHTML(this.item, this.props, this.isReadOnly));
        this.childrenContainer = this.element.querySelector('.vfs-directory-item__children')!;
        
        // Preserve children
        if (oldChildren) {
            while (oldChildren.firstChild) {
                this.childrenContainer.appendChild(oldChildren.firstChild);
            }
        }
    }
}
