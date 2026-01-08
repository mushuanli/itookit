/**
 * @file vfs-ui/components/MoveToModal/MoveToModal.ts
 */
import { BaseComponent } from '../../core/BaseComponent';
import type { VFSNodeUI, VFSUIState } from '../../types/types';

interface MoveToModalState {
  operation: { isMoving: boolean; itemIds: string[] } | null;
  availableTargets: VFSNodeUI[];
}

export class MoveToModal extends BaseComponent<MoveToModalState> {
  private selectedTargetId: string | null = null;

  constructor(params: any) {
    super(params);
    this.container.classList.add('vfs-move-modal-overlay');
  }

  protected transformState(global: VFSUIState): MoveToModalState {
    const buildTree = (items: VFSNodeUI[]): VFSNodeUI[] =>
      items.filter(i => i.type === 'directory').map(f => ({ ...f, children: f.children ? buildTree(f.children) : [] }));

    return {
      operation: global.moveOperation,
      availableTargets: global.moveOperation ? buildTree(global.items) : []
    };
  }

  protected bindEvents(): void {
    this.container.addEventListener('click', (e: MouseEvent) => {
      const target = e.target as Element;
      const action = target.closest<HTMLElement>('[data-action]')?.dataset.action;
      const folderId = target.closest<HTMLElement>('[data-folder-id]')?.dataset.folderId;

      if (action === 'confirm-move' && this.selectedTargetId && this.state.operation) {
        this.coordinator.publish('ITEMS_MOVE_REQUESTED', {
          itemIds: this.state.operation.itemIds,
          targetId: this.selectedTargetId === 'root' ? null : this.selectedTargetId,
          position: 'into'
        });
        this.coordinator.publish('MOVE_OPERATION_END_REQUESTED', {});
      } else if (action === 'cancel-move' || target === this.container) {
        this.coordinator.publish('MOVE_OPERATION_END_REQUESTED', {});
      } else if (folderId) {
        this.selectedTargetId = folderId;
        this.render();
      }
    });
  }

  protected render(): void {
    if (!this.state.operation?.isMoving) {
      this.container.style.display = 'none';
      this.selectedTargetId = null;
      return;
    }

    this.container.style.display = 'flex';

    const createTree = (folders: VFSNodeUI[], level = 0): string =>
      folders.map(f => `
        <div class="vfs-move-modal__folder-wrapper">
          <div class="vfs-move-modal__folder" style="--level:${level};" data-folder-id="${f.id}">
            <span class="vfs-move-modal__folder-toggle">${f.children?.length ? '▶' : ''}</span>
            <span class="vfs-move-modal__folder-icon">📁</span>
            <span class="vfs-move-modal__folder-title ${f.id === this.selectedTargetId ? 'is-selected' : ''}">${f.metadata.title}</span>
          </div>
          ${f.children?.length ? `<div class="vfs-move-modal__folder-children">${createTree(f.children, level + 1)}</div>` : ''}
        </div>`).join('');

    this.container.innerHTML = `
      <div class="vfs-move-modal">
        <div class="vfs-move-modal__header">移动 ${this.state.operation.itemIds.length} 个项目到...</div>
        <div class="vfs-move-modal__body">
          <div class="vfs-move-modal__folder" data-folder-id="root">
            <span class="vfs-move-modal__folder-icon">🗂️</span>
            <span class="vfs-move-modal__folder-title ${this.selectedTargetId === 'root' ? 'is-selected' : ''}">根目录</span>
          </div>
          ${createTree(this.state.availableTargets)}
        </div>
        <div class="vfs-move-modal__footer">
          <button class="vfs-move-modal__btn" data-action="cancel-move">取消</button>
          <button class="vfs-move-modal__btn vfs-move-modal__btn--primary" data-action="confirm-move" ${!this.selectedTargetId ? 'disabled' : ''}>移动</button>
        </div>
      </div>`;
  }
}
