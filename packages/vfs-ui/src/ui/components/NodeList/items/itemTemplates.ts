/**
 * @file vfs-ui/ui/components/NodeList/items/itemTemplates.ts
 * @desc HTML templates for file and directory items.
 */
import { Heading, escapeHTML } from '@itookit/common';
import type { VFSNodeUI, UISettings } from '../../../../contracts/types';
import { formatRelativeTime } from '../../../../utils/helpers';

const highlight = (text: string | undefined, queries: string[]): string => {
  const q = queries.map(s => s.trim()).filter(Boolean);
  if (!q.length || !text) return escapeHTML(text || '');
  const regex = new RegExp(
    `(${q.map(s => s.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')).join('|')})`,
    'gi'
  );
  return escapeHTML(text).replace(
    regex,
    '<mark class="vfs-search-highlight">$1</mark>'
  );
};

const createOutlineHTML = (headings: Heading[]): string => {
  if (!headings?.length) return '';

  const renderItems = (items: Heading[]): string =>
    items
      .map(h => {
        const hasChildren = h.children.length > 0;
        return `
    <li class="vfs-node-item__outline-item vfs-node-item__outline-item--level-${h.level}">
      <a href="javascript:void(0)" data-action="navigate-to-heading" data-element-id="${escapeHTML(h.id)}">
        <span class="vfs-node-item__outline-text">${escapeHTML(h.text)}</span>
      </a>
      ${hasChildren ? `<ul class="vfs-node-item__outline-list">${renderItems(h.children)}</ul>` : ''}
    </li>`;
      })
      .join('');

  return `<ul class="vfs-node-item__outline-list">${renderItems(headings)}</ul>`;
};

export interface FileItemProps {
  isActive: boolean;
  isSelected: boolean;
  isOutlineExpanded: boolean;
  isSelectionMode: boolean;
  isConfirmingDelete: boolean;
  searchQueries: string[];
  uiSettings: UISettings;
}

export const createFileItemHTML = (
  file: VFSNodeUI,
  props: FileItemProps,
  isReadOnly = false
): string => {
  const { id, metadata, content, headings = [], icon } = file;
  const { title, lastModified, tags = [], custom = {} } = metadata;
  const {
    isActive,
    isSelected,
    isOutlineExpanded,
    isSelectionMode,
    isConfirmingDelete,
    searchQueries,
    uiSettings,
  } = props;
  const { isPinned = false, hasUnreadUpdate = false, hasWaitingInput = false } = custom;
  const summary = content?.summary || '';

  let deleteBtnHTML = '';
  if (!isReadOnly) {
    const action = isConfirmingDelete ? 'delete-direct' : 'delete-init';
    const iconHtml = isConfirmingDelete
      ? '<i class="fas fa-trash"></i>'
      : '×';
    const className = isConfirmingDelete
      ? 'vfs-node-item__action-btn vfs-node-item__delete-btn is-confirming'
      : 'vfs-node-item__action-btn vfs-node-item__delete-btn';
    const titleText = isConfirmingDelete ? '点击立即删除' : '移除';
    deleteBtnHTML = `<button class="${className}" data-action="${action}" title="${titleText}">${iconHtml}</button>`;
  }

  const hasOutline = headings?.length > 0;
  const outlineToggleHTML = hasOutline
    ? `<button class="vfs-node-item__action-btn vfs-node-item__outline-toggle" data-action="toggle-outline" title="显示/隐藏大纲">
        <span class="vfs-node-item__outline-toggle-icon ${isOutlineExpanded ? 'is-expanded' : ''}"></span>
      </button>`
    : '';

  const checkboxHTML =
    !isReadOnly && isSelectionMode
      ? `<div class="vfs-node-item__checkbox-wrapper"><input type="checkbox" class="vfs-node-item__checkbox" data-item-id="${id}" ${isSelected ? 'checked' : ''} data-action="toggle-selection"></div>`
      : '';

  const badgesHTML =
    uiSettings.showBadges && custom.taskCount && custom.taskCount.total > 0
      ? `<span class="vfs-badge">✅ ${custom.taskCount.completed}/${custom.taskCount.total}</span>`
      : '';

  const tagsHTML =
    uiSettings.showTags && tags.length > 0
      ? tags.map(tag => `<span class="vfs-tag-pill">${escapeHTML(tag)}</span>`).join('')
      : '';

  const summaryHTML =
    uiSettings.showSummary && summary
      ?
      `<span class="vfs-node-item__summary">${highlight(summary, searchQueries)}</span>`
      : '';

  const outlinePreviewHTML =
    hasOutline && isOutlineExpanded
      ? `<div class="vfs-node-item__outline is-expanded">${createOutlineHTML(headings)}</div>`
      : '';

  let displayIcon = icon || '📄';
  if (isPinned) displayIcon = '📌';

  const hasActions = deleteBtnHTML || outlineToggleHTML;
  const actionsHTML = hasActions
    ? `<div class="vfs-node-item__actions">
        ${deleteBtnHTML}
        ${outlineToggleHTML}
      </div>`
    : '';

  return `
    <div class="vfs-node-item" data-item-id="${id}" data-item-type="file">
      <div class="vfs-node-item__main-row ${isSelectionMode ? 'is-selection-mode' : ''}">
        ${checkboxHTML}
        <div class="vfs-node-item__content ${isActive ? 'is-active' : ''} ${isSelected ? 'is-selected' : ''}" data-action="select-and-open">
          <span class="vfs-node-item__icon" data-action="select-only" title="仅选中">${displayIcon}</span>
          
          <div class="vfs-node-item__body">
            <div class="vfs-node-item__row-primary">
              <span class="vfs-node-item__title">${highlight(title, searchQueries)}</span>
              ${hasWaitingInput ? '<span class="vfs-node-item__indicator vfs-node-item__indicator--waiting" title="等待用户输入"></span>' : ''}
              ${hasUnreadUpdate && !hasWaitingInput ? '<span class="vfs-node-item__indicator"></span>' : ''}
            </div>
            
            <div class="vfs-node-item__row-secondary">
              <div class="vfs-node-item__secondary-left">
                ${summaryHTML}
                ${tagsHTML ? `<div class="vfs-node-item__tags">${tagsHTML}</div>` : ''}
              </div>
              <div class="vfs-node-item__secondary-right">
                <span class="vfs-node-item__timestamp" title="${new Date(lastModified).toLocaleString()}">${formatRelativeTime(lastModified)}</span>
                ${badgesHTML}
              </div>
            </div>
          </div>
          
          ${actionsHTML}
        </div>
      </div>
      ${outlinePreviewHTML}
    </div>`;
};

export interface DirectoryItemProps {
  isExpanded: boolean;
  dirSelectionState: 'none' | 'partial' | 'all';
  isSelected: boolean;
  isSelectionMode: boolean;
  searchQueries: string[];
}

export const createDirectoryItemHTML = (
  dir: VFSNodeUI,
  props: DirectoryItemProps,
  isReadOnly = false
): string => {
  const { id, metadata, icon } = dir;
  const { title, tags = [] } = metadata;
  const {
    isExpanded,
    dirSelectionState,
    isSelected,
    isSelectionMode,
    searchQueries,
  } = props;

  const checkbox =
    !isReadOnly && isSelectionMode
      ? `<div class="vfs-node-item__checkbox-wrapper"><input type="checkbox" class="vfs-node-item__checkbox" data-item-id="${id}" ${dirSelectionState === 'all' ? 'checked' : ''} ${dirSelectionState === 'partial' ? 'data-indeterminate="true"' : ''} data-action="toggle-selection"></div>`
      : '';

  const tagsHtml = tags.length
    ? `<div class="vfs-directory-item__tags">${tags.map(t => `<span class="vfs-tag-pill">${escapeHTML(t)}</span>`).join('')}</div>`
    : '';

  return `
    <div class="vfs-node-item vfs-directory-item" data-item-id="${id}" data-item-type="directory">
      <div class="vfs-node-item__main-row ${isSelectionMode ? 'is-selection-mode' : ''}">
        ${checkbox}
        <div class="vfs-directory-item__header ${isSelected ? 'is-selected' : ''}" data-action="select-item">
          <span class="vfs-directory-item__toggle ${isExpanded ? 'is-expanded' : ''}" data-action="toggle-folder"></span>
          <span class="vfs-directory-item__icon">${icon || '📁'}</span>
          <div class="vfs-directory-item__title-container">
            <span class="vfs-directory-item__title">${highlight(title, searchQueries)}</span>
            ${tagsHtml}
          </div>
        </div>
      </div>
      <div class="vfs-directory-item__children" style="${isExpanded ? '' : 'display:none;'}"></div>
    </div>`;
};
