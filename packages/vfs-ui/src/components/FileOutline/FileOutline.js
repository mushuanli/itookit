/**
 * @file vfs-ui/components/FileOutline/FileOutline.js
 */
import { BaseComponent } from '../../core/BaseComponent.js';
import { createOutlineHTML } from './templates.js';

export class FileOutline extends BaseComponent {
    constructor(params) {
        super(params);
        this.container.classList.add('vfs-file-outline');
    }

    _transformState(globalState) {
        const { activeId, items, expandedOutlineH1Ids = new Set() } = globalState;
        let activeHeadings = [];

        if (activeId) {
            const findActive = (itemList) => {
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

    _bindEvents() {
        this.container.addEventListener('click', event => {
            // JSDOC Correction: Cast event.target from EventTarget to Element to use .closest()
            const target = /** @type {Element} */ (event.target);
            const actionEl = /** @type {HTMLElement | null} */ (target.closest('[data-action]'));
            if (!actionEl) return;
            
            const liEl = /** @type {HTMLElement | null} */ (target.closest('li[data-element-id]'));
            if (!liEl) return;

            const elementId = liEl.dataset.elementId;
            const action = actionEl.dataset.action;
            
            if (action === 'toggle-expand') {
                event.preventDefault();
                this.coordinator.publish('OUTLINE_H1_TOGGLE_REQUESTED', { elementId });
            } else if (action === 'navigate') {
                event.preventDefault();
                this.coordinator.publish('NAVIGATE_TO_HEADING_REQUESTED', { elementId });
            }
        });
    }

    render() {
        this.container.innerHTML = createOutlineHTML(this.state);
    }
}
