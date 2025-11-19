/**
 * @file vfs-ui/src/components/NodeList/items/DirectoryItem.ts
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

    protected createRootElement(): HTMLElement {
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = '<div></div>'; // Placeholder
        return tempDiv.firstElementChild as HTMLElement;
    }

    public update(nextProps: DirectoryItemProps): void {
        if (JSON.stringify(this.currentProps) !== JSON.stringify(nextProps)) {
            this.currentProps = nextProps;
            this.render();
            // Re-assign childrenContainer as the element was replaced
            this.childrenContainer = this.element.querySelector('.vfs-directory-item__children')!;
        }
    }

    private render(): void {
        const newHTML = createDirectoryItemHTML(
            this.item,
            this.currentProps.isExpanded,
            this.currentProps.dirSelectionState,
            this.currentProps.isSelected, // [修改] 传入新增的 isSelected 参数
            this.currentProps.isSelectionMode,
            this.currentProps.searchQueries,
            this.isReadOnly
        );

        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = newHTML;
        const newElement = tempDiv.firstElementChild as HTMLElement;
        
        // Preserve children by moving them to the new element before replacing
        const oldChildrenContainer = this.element.querySelector('.vfs-directory-item__children');
        const newChildrenContainer = newElement.querySelector('.vfs-directory-item__children');
        if (oldChildrenContainer && newChildrenContainer) {
            while (oldChildrenContainer.firstChild) {
                newChildrenContainer.appendChild(oldChildrenContainer.firstChild);
            }
        }

        // 如果旧元素已经在 DOM 中，则用新元素替换它
        if (this.element.parentNode) {
            this.element.parentNode.replaceChild(newElement, this.element);
        }

        // [核心修复] 始终更新 element 引用
        Object.defineProperty(this, 'element', { value: newElement, writable: true });
        
        // 更新 childrenContainer 引用，指向新元素的容器
        this.childrenContainer = newChildrenContainer as HTMLElement;
    }
}
