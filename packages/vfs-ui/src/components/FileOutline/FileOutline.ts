/**
 * @file vfs-ui/components/FileOutline/FileOutline.ts
 */
import { BaseComponent } from '../../core/BaseComponent';
import { VFSUIState, Heading, VFSNodeUI } from '../../types/types';
import { createOutlineHTML } from './templates';

interface FileOutlineState {
    headings: Heading[];
    expandedH1Ids: Set<string>;
}

export class FileOutline extends BaseComponent<FileOutlineState> {
    constructor(params: any) {
        super(params);
        this.container.classList.add('vfs-file-outline');
    }

    protected _transformState(globalState: VFSUIState): FileOutlineState {
        const { activeId, items, expandedOutlineH1Ids = new Set() } = globalState;
        let activeHeadings: Heading[] = [];

        if (activeId) {
            const findActive = (itemList: VFSNodeUI[]): VFSNodeUI | null => {
                for (const item of itemList) {
                    if (item.id === activeId) return item;
                    if (item.type === 'directory' && item.children) {
                        const found = findActive(item.children);
                        if (found) return found;
                    }
                }
                return null;
            };
            const activeItem = findActive(items);
            
            if (activeItem?.type === 'file') {
                activeHeadings = activeItem.headings || [];
            }
        }
        
        return {
            headings: activeHeadings,
            expandedH1Ids: expandedOutlineH1Ids,
        };
    }

    protected _bindEvents(): void {
        this.container.addEventListener('click', (event: MouseEvent) => {
            const target = event.target as Element;
            const actionEl = target.closest<HTMLElement>('[data-action]');
            if (!actionEl) return;
            
            const liEl = target.closest<HTMLElement>('li[data-element-id]');
            if (!liEl) return;

            const elementId = liEl.dataset.elementId;
            const action = actionEl.dataset.action;
            
            if (elementId) {
                if (action === 'toggle-expand') {
                    event.preventDefault();
                    this.coordinator.publish('OUTLINE_H1_TOGGLE_REQUESTED', { elementId });
                } else if (action === 'navigate') {
                    event.preventDefault();
                    this.coordinator.publish('NAVIGATE_TO_HEADING_REQUESTED', { elementId });
                }
            }
        });
    }

    protected render(): void {
        this.container.innerHTML = createOutlineHTML(this.state);
    }
}
