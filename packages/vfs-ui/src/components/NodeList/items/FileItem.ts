/**
 * @file vfs-ui/components/NodeList/items/FileItem.ts
 * @desc Component representing a single file in the list.
 */
import { BaseNodeItem } from './BaseNodeItem';
import { VFSNodeUI, UISettings } from '../../../types/types';
import { createFileItemHTML } from './itemTemplates';

export interface FileItemProps {
    isActive: boolean;
    isSelected: boolean;
    isOutlineExpanded: boolean;
    isSelectionMode: boolean;
    searchQueries: string[];
    uiSettings: UISettings;
}

export class FileItem extends BaseNodeItem {
    private currentProps: FileItemProps;

    constructor(item: VFSNodeUI, isReadOnly: boolean, initialProps: FileItemProps) {
        super(item, isReadOnly);
        this.currentProps = initialProps;
        this.render();
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

        // 如果影响显示的元数据发生了变化，强制重绘
        if (oldTags !== newTags || oldTitle !== newTitle) {
            this.render();
        }
    }

    protected createRootElement(): HTMLElement {
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = '<div></div>'; 
        return tempDiv.firstElementChild as HTMLElement;
    }

    public update(nextProps: FileItemProps): void {
        if (JSON.stringify(this.currentProps) !== JSON.stringify(nextProps)) {
            this.currentProps = nextProps;
            this.render();
        }
    }

    private render(): void {
        const newHTML = createFileItemHTML(
            this.item,
            this.currentProps.isActive,
            this.currentProps.isSelected,
            this.currentProps.uiSettings,
            this.currentProps.isOutlineExpanded,
            this.currentProps.isSelectionMode,
            this.currentProps.searchQueries,
            this.isReadOnly
        );

        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = newHTML;
        const newElement = tempDiv.firstElementChild as HTMLElement;
        
        // 如果旧元素在 DOM 中，执行替换以保持位置
        if (this.element.parentNode) {
            this.element.parentNode.replaceChild(newElement, this.element);
        }

        // [核心修复] 无论是否执行了 replaceChild，必须始终更新实例引用的 element
        // 这样当 NodeList 稍后执行 appendChild(instance.element) 时，添加的是最新的元素
        Object.defineProperty(this, 'element', { value: newElement, writable: true });
    }
}
