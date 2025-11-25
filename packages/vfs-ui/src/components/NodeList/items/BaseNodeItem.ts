/**
 * @file vfs-ui/components/NodeList/items/BaseNodeItem.ts
 * @desc Abstract base class for FileItem and DirectoryItem, handling common logic.
 */
import { VFSNodeUI } from '../../../types/types';

export abstract class BaseNodeItem {
    public readonly element: HTMLElement;
    protected item: VFSNodeUI; // [修改] 去掉 readonly，允许更新
    protected readonly isReadOnly: boolean;

    constructor(item: VFSNodeUI, isReadOnly: boolean) {
        this.item = item;
        this.isReadOnly = isReadOnly;
        this.element = this.createRootElement();
        if (!this.isReadOnly) {
            this.element.draggable = true;
        }
    }

    /**
     * [新增] 更新组件持有的数据对象
     * 当 Store 中的数据发生变化（如 tag 更新）时调用
     */
    public updateItem(newItem: VFSNodeUI): void {
        this.item = newItem;
    }

    protected abstract createRootElement(): HTMLElement;
    public abstract update(props: any): void;

    public destroy(): void {
        this.element.remove();
    }
}
