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

    // [修正] 构造函数不再接收 callbacks
    constructor(item: VFSNodeUI, isReadOnly: boolean, initialProps: FileItemProps) {
        super(item, isReadOnly);
        this.currentProps = initialProps;
        this.render();
    }

    protected createRootElement(): HTMLElement {
        // Create a temporary wrapper to parse the HTML string
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = '<div></div>'; // Placeholder
        return tempDiv.firstElementChild as HTMLElement;
    }

    public update(nextProps: FileItemProps): void {
        // Simple dirty check to avoid unnecessary re-renders
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
