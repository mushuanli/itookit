/**
 * @file vfs-ui/components/FileOutline/FileOutline.ts
 */
import { Heading } from '@itookit/common';
import { BaseComponent } from '../../core/BaseComponent';
import type { VFSUIState } from '../../types/types';
import { findNodeById } from '../../utils/helpers';

interface FileOutlineState {
  headings: Heading[];
  expandedH1Ids: Set<string>;
}

export class FileOutline extends BaseComponent<FileOutlineState> {
  constructor(params: any) {
    super(params);
    this.container.classList.add('vfs-file-outline');
  }

  protected transformState(global: VFSUIState): FileOutlineState {
    const { activeId, items, expandedOutlineH1Ids = new Set() } = global;
    let headings: Heading[] = [];

    if (activeId) {
      const active = findNodeById(items, activeId);
      if (active?.type === 'file') headings = active.headings || [];
    }

    return { headings, expandedH1Ids: expandedOutlineH1Ids };
  }

  protected bindEvents(): void {
    this.container.addEventListener('click', (e: MouseEvent) => {
      const actionEl = (e.target as Element).closest<HTMLElement>('[data-action]');
      const liEl = (e.target as Element).closest<HTMLElement>('li[data-element-id]');
      if (!actionEl || !liEl) return;

      const elementId = liEl.dataset.elementId;
      if (!elementId) return;

      e.preventDefault();
      const action = actionEl.dataset.action;

      if (action === 'toggle-expand') {
        this.coordinator.publish('OUTLINE_H1_TOGGLE_REQUESTED', { elementId });
      } else if (action === 'navigate') {
        this.coordinator.publish('NAVIGATE_TO_HEADING_REQUESTED', { elementId });
      }
    });
  }

  protected render(): void {
    const { headings, expandedH1Ids } = this.state;

    if (!headings?.length) {
      this.container.innerHTML = `
        <h3 class="vfs-file-outline__title">大纲</h3>
        <div class="vfs-file-outline__placeholder">文档中暂无标题</div>`;
      return;
    }

    const createItem = (h: Heading): string => {
      const hasChildren = (h.children?.length ?? 0) > 0;
      const isExpanded = expandedH1Ids.has(h.id);

      const toggle = h.level === 1 && hasChildren
        ? `<span class="vfs-file-outline__toggle ${isExpanded ? 'is-expanded' : ''}" data-action="toggle-expand"></span>`
        : '<span class="vfs-file-outline__toggle is-placeholder"></span>';

      const children = h.level === 1 && hasChildren && isExpanded
        ? `<ul class="vfs-file-outline__list">${h.children!.map(createItem).join('')}</ul>`
        : '';

      return `
        <li class="vfs-file-outline__item vfs-file-outline__item--level-${h.level}" data-element-id="${h.id}">
          <a href="#${h.id}" class="vfs-file-outline__link" data-action="navigate">
            ${toggle}
            <span class="vfs-file-outline__text">${h.text}</span>
          </a>
          ${children}
        </li>`;
    };

    this.container.innerHTML = `
      <h3 class="vfs-file-outline__title">大纲</h3>
      <ul class="vfs-file-outline__list">${headings.map(createItem).join('')}</ul>`;
  }
}
