/**
 * @file vfs-ui/components/MoveToModal/MoveToModal.js
 */
import { BaseComponent } from '../../core/BaseComponent.js';

function createFolderTreeHTML(folders, selectedTargetId, level = 0) {
    if (!folders || folders.length === 0) return '';
    return folders.map(folder => {
        const isSelected = folder.id === selectedTargetId;
        const hasChildren = folder.children?.length > 0;
        return `
            <div class="vfs-move-modal__folder-wrapper">
                <div class="vfs-move-modal__folder" style="--level: ${level};" data-folder-id="${folder.id}">
                    <span class="vfs-move-modal__folder-toggle">${hasChildren ? '▶' : ''}</span>
                    <span class="vfs-move-modal__folder-icon">📁</span>
                    <span class="vfs-move-modal__folder-title ${isSelected ? 'is-selected' : ''}">${folder.metadata.title}</span>
                </div>
                ${hasChildren ? `<div class="vfs-move-modal__folder-children">${createFolderTreeHTML(folder.children, selectedTargetId, level + 1)}</div>` : ''}
            </div>
        `;
    }).join('');
}

export class MoveToModal extends BaseComponent {
    constructor(params) {
        super(params);
        this.container.classList.add('vfs-move-modal-overlay');
        this.selectedTargetId = null;
    }

    _transformState(globalState) {
        const buildFolderTree = (items) => {
            return items
                .filter(item => item.type === 'directory')
                .map(folder => ({
                    ...folder, // Pass the whole item
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
            // JSDOC Correction: Cast event.target from EventTarget to Element to use .closest() and other properties
            const target = /** @type {Element} */ (event.target);
            const actionEl = /** @type {HTMLElement | null} */ (target.closest('[data-action]'));
            const folderEl = /** @type {HTMLElement | null} */ (target.closest('[data-folder-id]'));

            if (actionEl) {
                event.preventDefault();
                const action = actionEl.dataset.action;
                if (action === 'confirm-move' && this.selectedTargetId !== null) {
                    this.coordinator.publish('ITEMS_MOVE_REQUESTED', {
                        itemIds: this.state.operation.itemIds,
                        targetId: this.selectedTargetId === 'null' ? null : this.selectedTargetId,
                        position: 'into'
                    });
                    this.coordinator.publish('MOVE_OPERATION_END_REQUESTED');
                } else if (action === 'cancel-move') {
                    this.coordinator.publish('MOVE_OPERATION_END_REQUESTED');
                }
            } else if (folderEl) {
                this.selectedTargetId = folderEl.dataset.folderId;
                this.render();
            } else if (target === this.container) {
                this.coordinator.publish('MOVE_OPERATION_END_REQUESTED');
            }
        });
    }

    render() {
        if (!this.state.operation || !this.state.operation.isMoving) {
            this.container.style.display = 'none';
            this.selectedTargetId = null;
            return;
        }

        this.container.style.display = 'flex';
        
        const { itemIds } = this.state.operation;
        const { availableTargets } = this.state;

        this.container.innerHTML = `
            <div class="vfs-move-modal">
                <div class="vfs-move-modal__header">移动 ${itemIds.length} 个项目到...</div>
                <div class="vfs-move-modal__body">
                    <div class="vfs-move-modal__folder" data-folder-id="null">
                         <span class="vfs-move-modal__folder-icon">🗂️</span>
                         <span class="vfs-move-modal__folder-title ${this.selectedTargetId === 'null' ? 'is-selected' : ''}">根目录</span>
                    </div>
                    ${createFolderTreeHTML(availableTargets, this.selectedTargetId)}
                </div>
                <div class="vfs-move-modal__footer">
                    <button class="vfs-move-modal__btn" data-action="cancel-move">取消</button>
                    <button class="vfs-move-modal__btn vfs-move-modal__btn--primary" data-action="confirm-move" ${this.selectedTargetId === null ? 'disabled' : ''}>移动</button>
                </div>
            </div>
        `;
    }
}
