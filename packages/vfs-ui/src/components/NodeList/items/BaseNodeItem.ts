/**
 * @file vfs-ui/src/components/NodeList/items/BaseNodeItem.ts
 * @desc Abstract base class for FileItem and DirectoryItem, handling common logic.
 */
import { VFSNodeUI } from '../../../types/types';

// [修正] NodeItemCallbacks 接口不再需要，可以删除
// export interface NodeItemCallbacks {
//     onClick: (id: string, event: MouseEvent) => void;
//     onContextMenu: (id: string, event: MouseEvent) => void;
// }

export abstract class BaseNodeItem {
    public readonly element: HTMLElement;
    protected readonly item: VFSNodeUI;
    // [修正] callbacks 属性已移除
    // protected readonly callbacks: NodeItemCallbacks;
    protected readonly isReadOnly: boolean;

    // [修正] 构造函数不再接收 callbacks
    constructor(item: VFSNodeUI, isReadOnly: boolean) {
        this.item = item;
        // this.callbacks = callbacks;
        this.isReadOnly = isReadOnly;
        this.element = this.createRootElement();
        if (!this.isReadOnly) {
            this.element.draggable = true;
        }
    }

    protected abstract createRootElement(): HTMLElement;
    public abstract update(props: any): void;



    public destroy(): void {
        // [修正] unbindEvents 不再需要调用
        // this.unbindEvents();
        this.element.remove();
    }
}
