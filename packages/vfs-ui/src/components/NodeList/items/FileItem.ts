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
        
        // ✨ [新增] 检查任务统计是否变化
        const oldTasks = JSON.stringify(this.item.metadata.custom?.taskCount);
        const newTasks = JSON.stringify(newItem.metadata.custom?.taskCount);
        
        super.updateItem(newItem);

        // 如果影响显示的元数据发生了变化，强制重绘
        if (oldTags !== newTags || oldTitle !== newTitle || oldTasks !== newTasks) {
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
        
        if (this.element.parentNode) {
            this.element.parentNode.replaceChild(newElement, this.element);
        }

        Object.defineProperty(this, 'element', { value: newElement, writable: true });
    }
}
