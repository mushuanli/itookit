/**
 * @file vfs-ui/ui/components/MoveToModal/MoveToModal.ts
 * @desc Modal for moving items to a target folder.
 */
import { BaseComponent, BaseComponentDeps } from '../../core/BaseComponent';
import type { VFSNodeUI, VFSUIState } from '../../../contracts/types';

interface MoveToModalState {
  operation: { isMoving: boolean; itemIds: string[] } | null;
  availableTargets: VFSNodeUI[];
}

export class MoveToModal extends BaseComponent<MoveToModalState> {
  private selectedTargetId: string | null = null;
  /** Directories expanded in the modal (independent of main file tree). */
  private expandedIds = new Set<string>();

  constructor(deps: BaseComponentDeps) {
    super(deps);
    this.container.classList.add('vfs-move-modal-overlay');
  }

  protected transformState(global: VFSUIState): MoveToModalState {
    // Preserve children:undefined (not-yet-loaded) vs children:[] (empty dir)
    // so that loaded subdirectories inside unexpanded dirs are not silently dropped.
    const buildTree = (items: VFSNodeUI[]): VFSNodeUI[] =>
      items
        .filter(i => i.type === 'directory')
        .map(f => ({ ...f, children: f.children ? buildTree(f.children) : undefined }));

    return {
      operation: global.moveOperation,
      availableTargets: global.moveOperation ? buildTree(global.items) : [],
    };
  }

  protected bindEvents(): void {
    this.container.addEventListener('click', (e: MouseEvent) => {
      const target = e.target as Element;
      const action = target.closest<HTMLElement>('[data-action]')?.dataset.action;
      const folderId = target.closest<HTMLElement>('[data-folder-id]')?.dataset.folderId;

      if (action === 'confirm-move' && this.selectedTargetId && this.state.operation) {
        this.commandBus.execute('file:move', {
          itemIds: this.state.operation.itemIds,
          targetId: this.selectedTargetId === 'root' ? null : this.selectedTargetId,
          position: 'into',
        });
        this.commandBus.execute('move:end', undefined as any);
      } else if (action === 'cancel-move' || target === this.container) {
        this.expandedIds.clear();
        this.commandBus.execute('move:end', undefined as any);
      } else if (action === 'toggle-folder' && folderId) {
        // Toggle expansion; if children not loaded yet, trigger lazy load via nav command.
        if (this.expandedIds.has(folderId)) {
          this.expandedIds.delete(folderId);
        } else {
          this.expandedIds.add(folderId);
          const node = this.findInAvailableTargets(folderId);
          if (node?.children === undefined) {
            // nav:toggleFolder is intercepted by VFSUIShell → expandDirectory → FOLDER_CHILDREN_LOADED
            this.commandBus.execute('nav:toggleFolder', { folderId });
          }
        }
        this.render();
      } else if (folderId) {
        this.selectedTargetId = folderId;
        this.render();
      }
    });
  }

  private findInAvailableTargets(id: string): VFSNodeUI | undefined {
    const search = (dirs: VFSNodeUI[]): VFSNodeUI | undefined => {
      for (const dir of dirs) {
        if (dir.id === id) return dir;
        if (dir.children) {
          const found = search(dir.children);
          if (found) return found;
        }
      }
    };
    return search(this.state.availableTargets);
  }

  protected render(): void {
    if (!this.state.operation?.isMoving) {
      this.container.style.display = 'none';
      this.selectedTargetId = null;
      this.expandedIds.clear();
      return;
    }

    this.container.style.display = 'flex';

    const createTree = (folders: VFSNodeUI[], level = 0): string =>
      folders
        .map(f => {
          const isExpanded = this.expandedIds.has(f.id);
          // children===undefined: not yet loaded (may have children); []: loaded, empty
          const mayHaveChildren = f.children === undefined || f.children.length > 0;
          const toggleIcon = mayHaveChildren
            ? `<span class="vfs-move-modal__folder-toggle" data-action="toggle-folder" data-folder-id="${f.id}">${isExpanded ? '▼' : '▶'}</span>`
            : `<span class="vfs-move-modal__folder-toggle"></span>`;
          const childrenHTML =
            isExpanded && f.children && f.children.length > 0
              ? `<div class="vfs-move-modal__folder-children">${createTree(f.children, level + 1)}</div>`
              : '';
          return `
        <div class="vfs-move-modal__folder-wrapper">
          <div class="vfs-move-modal__folder" style="--level:${level};" data-folder-id="${f.id}">
            ${toggleIcon}
            <span class="vfs-move-modal__folder-icon">📁</span>
            <span class="vfs-move-modal__folder-title ${f.id === this.selectedTargetId ? 'is-selected' : ''}">${f.metadata.title}</span>
          </div>
          ${childrenHTML}
        </div>`;
        })
        .join('');

    this.container.innerHTML = `
      <div class="vfs-move-modal">
        <div class="vfs-move-modal__header">移动 ${this.state.operation.itemIds.length} 个项目到...</div>
        <div class="vfs-move-modal__body">
          <div class="vfs-move-modal__folder" data-folder-id="root">
            <span class="vfs-move-modal__folder-toggle"></span>
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
