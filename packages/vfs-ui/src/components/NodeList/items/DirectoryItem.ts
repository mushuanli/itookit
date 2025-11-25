/**
 * @file vfs-ui/components/NodeList/items/DirectoryItem.ts
 * @desc Component representing a single directory in the list.
 */
import { BaseNodeItem } from './BaseNodeItem';
import { VFSNodeUI } from '../../../types/types';
import { createDirectoryItemHTML } from './itemTemplates';

export interface DirectoryItemProps {
    isExpanded: boolean;
    dirSelectionState: 'none' | 'partial' | 'all';
    isSelected: boolean;
    isSelectionMode: boolean;
    searchQueries: string[];
}

export class DirectoryItem extends BaseNodeItem {
    public childrenContainer: HTMLElement;
    private currentProps: DirectoryItemProps;

    // [修正] 构造函数不再接收 callbacks
    constructor(item: VFSNodeUI, isReadOnly: boolean, initialProps: DirectoryItemProps) {
        super(item, isReadOnly);
        this.currentProps = initialProps;
        this.render();
        this.childrenContainer = this.element.querySelector('.vfs-directory-item__children')!;
    }

    /**
     * [新增] 更新数据对象并检查是否需要重绘
     */
    public updateItem(newItem: VFSNodeUI): void {
        const oldTags = JSON.stringify(this.item.metadata.tags);
        const newTags = JSON.stringify(newItem.metadata.tags);
        const oldTitle = this.item.metadata.title;
        const newTitle = newItem.metadata.title;
        
        super.updateItem(newItem);

        if (oldTags !== newTags || oldTitle !== newTitle) {
            this.render();
        }
    }

    protected createRootElement(): HTMLElement {
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = '<div></div>';
        return tempDiv.firstElementChild as HTMLElement;
    }

    public update(nextProps: DirectoryItemProps): void {
        if (JSON.stringify(this.currentProps) !== JSON.stringify(nextProps)) {
            this.currentProps = nextProps;
            this.render();
            this.childrenContainer = this.element.querySelector('.vfs-directory-item__children')!;
        }
    }

    private render(): void {
        const newHTML = createDirectoryItemHTML(
            this.item,
            this.currentProps.isExpanded,
            this.currentProps.dirSelectionState,
            this.currentProps.isSelected,
            this.currentProps.isSelectionMode,
            this.currentProps.searchQueries,
            this.isReadOnly
        );

        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = newHTML;
        const newElement = tempDiv.firstElementChild as HTMLElement;
        
        const oldChildrenContainer = this.element.querySelector('.vfs-directory-item__children');
        const newChildrenContainer = newElement.querySelector('.vfs-directory-item__children');
        if (oldChildrenContainer && newChildrenContainer) {
            while (oldChildrenContainer.firstChild) {
                newChildrenContainer.appendChild(oldChildrenContainer.firstChild);
            }
        }

        if (this.element.parentNode) {
            this.element.parentNode.replaceChild(newElement, this.element);
        }

        Object.defineProperty(this, 'element', { value: newElement, writable: true });
        this.childrenContainer = newChildrenContainer as HTMLElement;
    }
}
