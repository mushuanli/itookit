/**
 * @file vfs-ui/src/components/NodeList/items/FileItem.ts
 * @desc Component representing a single file in the list.
 */
import { BaseNodeItem, NodeItemCallbacks } from './BaseNodeItem';
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

    constructor(item: VFSNodeUI, callbacks: NodeItemCallbacks, isReadOnly: boolean, initialProps: FileItemProps) {
        super(item, callbacks, isReadOnly);
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
    
    if (this.element.parentNode) {
        this.element.parentNode.replaceChild(newElement, this.element);
        // Update the element reference properly
        Object.defineProperty(this, 'element', { value: newElement, writable: true });
    }
    }
}
