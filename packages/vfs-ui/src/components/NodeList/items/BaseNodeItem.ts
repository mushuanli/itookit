/**
 * @file vfs-ui/src/components/NodeList/items/BaseNodeItem.ts
 * @desc Abstract base class for FileItem and DirectoryItem, handling common logic.
 */
import { VFSNodeUI } from '../../../types/types';

export interface NodeItemCallbacks {
    onClick: (id: string, event: MouseEvent) => void;
    onContextMenu: (id: string, event: MouseEvent) => void;
}

export abstract class BaseNodeItem {
    public readonly element: HTMLElement;
    protected readonly item: VFSNodeUI;
    protected readonly callbacks: NodeItemCallbacks;
    protected readonly isReadOnly: boolean;

    constructor(item: VFSNodeUI, callbacks: NodeItemCallbacks, isReadOnly: boolean) {
        this.item = item;
        this.callbacks = callbacks;
        this.isReadOnly = isReadOnly;
        this.element = this.createRootElement();
        if (!this.isReadOnly) {
            this.element.draggable = true;
        }
    }

    protected abstract createRootElement(): HTMLElement;
    public abstract update(props: any): void;

    public bindEvents(): void {
        this.element.addEventListener('click', this.handleClick);
        if (!this.isReadOnly) {
            this.element.addEventListener('contextmenu', this.handleContextMenu);
        }
    }

    public unbindEvents(): void {
        this.element.removeEventListener('click', this.handleClick);
        if (!this.isReadOnly) {
            this.element.removeEventListener('contextmenu', this.handleContextMenu);
        }
    }

    private handleClick = (event: MouseEvent): void => {
        this.callbacks.onClick(this.item.id, event);
    };

    private handleContextMenu = (event: MouseEvent): void => {
        event.preventDefault();
        event.stopPropagation();
        this.callbacks.onContextMenu(this.item.id, event);
    };

    public destroy(): void {
        this.unbindEvents();
        this.element.remove();
    }
}
