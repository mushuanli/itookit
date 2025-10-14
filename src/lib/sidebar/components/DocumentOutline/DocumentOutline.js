// #sidebar/components/DocumentOutline/DocumentOutline.js

import { BaseComponent } from '../../core/BaseComponent.js';
import { createOutlineHTML } from './templates.js';

/**
 * The DocumentOutline component renders the headings of the active session.
 * It is a pure UI component that reacts to state changes.
 */
export class DocumentOutline extends BaseComponent {
    /**
     * Initializes the component.
     */
    constructor(params) {
        super(params);
        this.container.classList.add('mdx-document-outline');
    }

    /**
     * Transforms the global state to the local state needed for rendering the outline.
     * @override
     * @param {import('../../types/types.js')._SessionState} globalState
     * @returns {object} The component's local state.
     */
    _transformState(globalState) {
        const { activeId, items } = globalState;
        let activeHeadings = [];

        if (activeId) {
            // Find the active session to get its headings
            const findActive = (itemList) => {
                for (const item of itemList) {
                    if (item.id === activeId) return item;
                    if (item.type === 'folder' && item.children) {
                        const found = findActive(item.children);
                        if (found) return found;
                    }
                }
                return null;
            };
            const activeItem = findActive(items);
            
            // [MODIFIED] Check item type and access top-level 'headings' property. This is clean.
            if (activeItem && activeItem.type === 'item') {
                activeHeadings = activeItem.headings || [];
            }
        }
        
        // We need a new piece of state in our global store for expanded H1s
        const expandedH1Ids = globalState.expandedOutlineH1Ids || new Set();

        return {
            headings: activeHeadings,
            expandedH1Ids: expandedH1Ids,
        };
    }

    /**
     * Binds DOM event listeners and delegates actions to the coordinator.
     * @override
     */
    _bindEvents() {
        this.container.addEventListener('click', event => {
            const actionEl = event.target.closest('[data-action]');
            if (!actionEl) return;
            
            const liEl = event.target.closest('li[data-element-id]');
            if (!liEl) return;

            const elementId = liEl.dataset.elementId;
            const action = actionEl.dataset.action;
            
            // 只有当点击的是展开图标时，才阻止导航
            if (action === 'toggle-expand') {
                event.preventDefault();
                this.coordinator.publish('OUTLINE_H1_TOGGLE_REQUESTED', { elementId });
            } else if (action === 'navigate') {
                // 对于导航，我们允许默认行为（跳转锚点），同时发布事件
                // 让JS可以做更高级的操作（如平滑滚动）
                event.preventDefault();
                this.coordinator.publish('NAVIGATE_TO_HEADING_REQUESTED', { elementId });
            }
        });
    }

    /**
     * Renders the component based on its current state.
     * @override
     */
    render() {
        this.container.innerHTML = createOutlineHTML(this.state);
    }
}
