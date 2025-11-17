/**
 * @file vfs-ui/components/MoveToModal/MoveToModal.ts
 */
import { BaseComponent } from '../../core/BaseComponent';
import { VFSNodeUI, VFSUIState } from '../../types/types';

interface MoveToModalState {
    operation: { isMoving: boolean; itemIds: string[] } | null;
    availableTargets: VFSNodeUI[];
}

function createFolderTreeHTML(folders: VFSNodeUI[], selectedTargetId: string | null, level = 0): string {
    if (!folders || folders.length === 0) return '';
    return folders.map(folder => {
        // [修复] 明确检查 children 是否存在
        const hasChildren = folder.children && folder.children.length > 0;
        return `
            <div class="vfs-move-modal__folder-wrapper">
                <div class="vfs-move-modal__folder" style="--level: ${level};" data-folder-id="${folder.id}">
                    <span class="vfs-move-modal__folder-toggle">${hasChildren ? '▶' : ''}</span>
                    <span class="vfs-move-modal__folder-icon">📁</span>
                    <span class="vfs-move-modal__folder-title ${folder.id === selectedTargetId ? 'is-selected' : ''}">${folder.metadata.title}</span>
                </div>
                ${hasChildren ? `<div class="vfs-move-modal__folder-children">${createFolderTreeHTML(folder.children!, selectedTargetId, level + 1)}</div>` : ''}
            </div>
        `;
    }).join('');
}

export class MoveToModal extends BaseComponent<MoveToModalState> {
    private selectedTargetId: string | null = null;

    constructor(params: any) {
        super(params);
        this.container.classList.add('vfs-move-modal-overlay');
    }

    protected _transformState(globalState: VFSUIState): MoveToModalState {
        const buildFolderTree = (items: VFSNodeUI[]): VFSNodeUI[] => {
            return items
                .filter(item => item.type === 'directory')
                .map(folder => ({
                    ...folder,
                    children: folder.children ? buildFolderTree(folder.children) : []
                }));
        };
        
        return {
            operation: globalState.moveOperation, 
            availableTargets: globalState.moveOperation ? buildFolderTree(globalState.items) : []
        };
    }

    protected _bindEvents(): void {
        this.container.addEventListener('click', (event: MouseEvent) => {
            const target = event.target as Element;
            const actionEl = target.closest<HTMLElement>('[data-action]');
            const folderEl = target.closest<HTMLElement>('[data-folder-id]');

            if (actionEl) {
                event.preventDefault();
                const action = actionEl.dataset.action;
                if (action === 'confirm-move' && this.selectedTargetId !== null && this.state.operation) {
                    this.coordinator.publish('ITEMS_MOVE_REQUESTED', {
                        itemIds: this.state.operation.itemIds,
                        targetId: this.selectedTargetId === 'root' ? null : this.selectedTargetId,
                        position: 'into'
                    });
                    this.coordinator.publish('MOVE_OPERATION_END_REQUESTED', {});
                } else if (action === 'cancel-move') {
                    this.coordinator.publish('MOVE_OPERATION_END_REQUESTED', {});
                }
            } else if (folderEl) {
                this.selectedTargetId = folderEl.dataset.folderId || null;
                this.render();
            } else if (target === this.container) {
                this.coordinator.publish('MOVE_OPERATION_END_REQUESTED', {});
            }
        });
    }

    protected render(): void {
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
                    <div class="vfs-move-modal__folder" data-folder-id="root">
                         <span class="vfs-move-modal__folder-icon">🗂️</span>
                         <span class="vfs-move-modal__folder-title ${this.selectedTargetId === 'root' ? 'is-selected' : ''}">根目录</span>
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
