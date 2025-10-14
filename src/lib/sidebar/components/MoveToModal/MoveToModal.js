// #sidebar/components/MoveToModal/MoveToModal.js

import { BaseComponent } from '../../core/BaseComponent.js';

/**
 * Renders a recursive tree of folders for the move destination selector.
 * @private
 */
function createFolderTreeHTML(folders, selectedTargetId, level = 0) {
    if (!folders || folders.length === 0) return '';
    
    return folders.map(folder => {
        const isSelected = folder.id === selectedTargetId;
        const hasChildren = folder.children && folder.children.length > 0;
        
        return `
            <div class="mdx-move-modal__folder-wrapper">
                <div class="mdx-move-modal__folder" style="--level: ${level};" data-folder-id="${folder.id}">
                    <span class="mdx-move-modal__folder-toggle">${hasChildren ? '▶' : ''}</span>
                    <span class="mdx-move-modal__folder-icon">📁</span>
                    <span class="mdx-move-modal__folder-title ${isSelected ? 'is-selected' : ''}">${folder.title}</span>
                </div>
                ${hasChildren ? `<div class="mdx-move-modal__folder-children">${createFolderTreeHTML(folder.children, selectedTargetId, level + 1)}</div>` : ''}
            </div>
        `;
    }).join('');
}

/**
 * The MoveToModal component for selecting a destination folder.
 */
export class MoveToModal extends BaseComponent {
    constructor(params) {
        super(params);
        this.container.classList.add('mdx-move-modal-overlay');
        this.selectedTargetId = null;
    }

    _transformState(globalState) {
        // Helper function to build a tree of folders only
        const buildFolderTree = (items) => {
            return items
                .filter(item => item.type === 'folder')
                .map(folder => ({
                    id: folder.id,
                    title: folder.title,
                    children: folder.children ? buildFolderTree(folder.children) : []
                }));
        };
        
        return {
            operation: globalState.moveOperation, 
            availableTargets: globalState.moveOperation ? buildFolderTree(globalState.items) : []
        };
    }

    _bindEvents() {
        this.container.addEventListener('click', (event) => {
            const target = event.target;
            const actionEl = target.closest('[data-action]');
            const folderEl = target.closest('[data-folder-id]');

            if (actionEl) {
                event.preventDefault(); // Prevent any default button behavior
                const action = actionEl.dataset.action;
                if (action === 'confirm-move' && this.selectedTargetId !== null) {
                    this.coordinator.publish('ITEMS_MOVE_REQUESTED', {
                        itemIds: this.state.operation.itemIds,
                        // Convert the string "null" back to a real null for root directory
                        targetId: this.selectedTargetId === 'null' ? null : this.selectedTargetId,
                        position: 'into'
                    });
                    // After confirming, request to close the modal
                    this.coordinator.publish('MOVE_OPERATION_END_REQUESTED');
                } else if (action === 'cancel-move') {
                    this.coordinator.publish('MOVE_OPERATION_END_REQUESTED');
                }
            } else if (folderEl) {
                this.selectedTargetId = folderEl.dataset.folderId;
                this.render(); // Re-render to show selection
            } else if (target === this.container) {
                // Click on overlay background
                this.coordinator.publish('MOVE_OPERATION_END_REQUESTED');
            }
        });
    }

    render() {
        if (!this.state.operation || !this.state.operation.isMoving) {
            this.container.style.display = 'none';
            this.selectedTargetId = null; // Reset selection when hiding
            return;
        }

        this.container.style.display = 'flex';
        
        // Destructure variables from the correct parts of the component's state
        const { itemIds } = this.state.operation;
        const { availableTargets } = this.state;

        this.container.innerHTML = `
            <div class="mdx-move-modal">
                <div class="mdx-move-modal__header">移动 ${itemIds.length} 个项目到...</div>
                <div class="mdx-move-modal__body">
                    <div class="mdx-move-modal__folder" data-folder-id="null">
                         <span class="mdx-move-modal__folder-icon">🗂️</span>
                         <span class="mdx-move-modal__folder-title ${this.selectedTargetId === 'null' ? 'is-selected' : ''}">根目录</span>
                    </div>
                    ${createFolderTreeHTML(availableTargets, this.selectedTargetId)}
                </div>
                <div class="mdx-move-modal__footer">
                    <button class="mdx-move-modal__btn" data-action="cancel-move">取消</button>
                    <button class="mdx-move-modal__btn mdx-move-modal__btn--primary" data-action="confirm-move" ${this.selectedTargetId === null ? 'disabled' : ''}>移动</button>
                </div>
            </div>
        `;
    }
}
