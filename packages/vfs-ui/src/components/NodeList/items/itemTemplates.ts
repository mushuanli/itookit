/**
 * @file vfs-ui/components/NodeList/items/itemTemplates.ts
 * @desc HTML template generation functions for FileItem and DirectoryItem components.
 */
import { escapeHTML } from '@itookit/common';
import type { VFSNodeUI, UISettings, Heading } from '../../../types/types';
import { formatRelativeTime } from '../../../utils/helpers';

const highlight = (text: string | undefined, queries: string[]): string => {
  const q = queries.map(s => s.trim()).filter(Boolean);
  if (!q.length || !text) return escapeHTML(text || '');
  const regex = new RegExp(`(${q.map(s => s.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')).join('|')})`, 'gi');
  return escapeHTML(text).replace(regex, '<mark class="vfs-search-highlight">$1</mark>');
};

const createOutlineHTML = (headings: Heading[]): string => {
  if (!headings?.length) return '';
  const renderItems = (items: Heading[]): string => items.map(h => `
    <li class="vfs-node-item__outline-item vfs-node-item__outline-item--level-${h.level}">
      <a href="javascript:void(0)" data-action="navigate-to-heading" data-element-id="${escapeHTML(h.elementId)}">
        <span class="vfs-node-item__outline-text">${escapeHTML(h.text)}</span>
      </a>
      ${h.children?.length ? `<ul class="vfs-node-item__outline-list">${renderItems(h.children)}</ul>` : ''}
    </li>`).join('');
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

export const createFileItemHTML = (file: VFSNodeUI, props: FileItemProps, isReadOnly = false): string => {
  const { id, metadata, content, headings = [], icon } = file;
  const { title, lastModified, tags = [], custom = {} } = metadata;
  const { isActive, isSelected, isOutlineExpanded, isSelectionMode, isConfirmingDelete, searchQueries, uiSettings } = props;
  const { isPinned = false, hasUnreadUpdate = false, taskCount } = custom;

  const deleteBtn = isReadOnly ? '' : (() => {
    const action = isConfirmingDelete ? 'delete-direct' : 'delete-init';
    const iconHtml = isConfirmingDelete ? '<i class="fas fa-trash"></i>' : '×';
    return `<button class="vfs-node-item__delete-btn${isConfirmingDelete ? ' is-confirming' : ''}" data-action="${action}" title="${isConfirmingDelete ? '点击立即删除' : '移除'}">${iconHtml}</button>`;
  })();

  const checkbox = !isReadOnly && isSelectionMode
    ? `<div class="vfs-node-item__checkbox-wrapper"><input type="checkbox" class="vfs-node-item__checkbox" data-item-id="${id}" ${isSelected ? 'checked' : ''} data-action="toggle-selection"></div>`
    : '';

  // ✅ 修复：安全地检查 taskCount
  const badges = uiSettings.showBadges && taskCount && typeof taskCount.total === 'number' && taskCount.total > 0
    ? `<div class="vfs-node-item__badges"><span class="vfs-badge">✅ ${taskCount.completed ?? 0}/${taskCount.total}</span></div>`
    : '';

  const tagsHtml = uiSettings.showTags && tags.length
    ? `<div class="vfs-node-item__tags">${tags.map(t => `<span class="vfs-tag-pill">${escapeHTML(t)}</span>`).join('')}</div>`
    : '';

  const summary = uiSettings.showSummary
    ? `<div class="vfs-node-item__summary">${highlight(content?.summary, searchQueries)}</div>`
    : '';

  const hasOutline = headings.length > 0;
  const outlineToggle = hasOutline
    ? `<button class="vfs-node-item__outline-toggle" data-action="toggle-outline" title="显示/隐藏大纲"><span class="vfs-node-item__outline-toggle-icon ${isOutlineExpanded ? 'is-expanded' : ''}"></span></button>`
    : '';

  const outline = hasOutline && isOutlineExpanded
    ? `<div class="vfs-node-item__outline is-expanded">${createOutlineHTML(headings)}</div>`
    : '';

  return `
    <div class="vfs-node-item" data-item-id="${id}" data-item-type="file">
      <div class="vfs-node-item__main-row ${isSelectionMode ? 'is-selection-mode' : ''}">
        ${checkbox}
        <div class="vfs-node-item__content ${isActive ? 'is-active' : ''} ${isSelected ? 'is-selected' : ''}" data-action="select-and-open">
          <span class="vfs-node-item__icon" data-action="select-only" title="仅选中">${isPinned ? '📌' : (icon || '📄')}</span>
          <div class="vfs-node-item__main">
            <div class="vfs-node-item__title-wrapper">
              <span class="vfs-node-item__title">${highlight(title, searchQueries)}</span>
              ${hasUnreadUpdate ? '<span class="vfs-node-item__indicator"></span>' : ''}
            </div>
            ${summary}${tagsHtml}
          </div>
          <div class="vfs-node-item__meta">
            <span class="vfs-node-item__timestamp" title="${new Date(lastModified).toLocaleString()}">${formatRelativeTime(lastModified)}</span>
            ${badges}
          </div>
          <div class="vfs-node-item__actions">${outlineToggle}${deleteBtn}</div>
        </div>
      </div>
      ${outline}
    </div>`;
};

export interface DirectoryItemProps {
  isExpanded: boolean;
  dirSelectionState: 'none' | 'partial' | 'all';
  isSelected: boolean;
  isSelectionMode: boolean;
  searchQueries: string[];
}

export const createDirectoryItemHTML = (dir: VFSNodeUI, props: DirectoryItemProps, isReadOnly = false): string => {
  const { id, metadata, icon } = dir;
  const { title, tags = [] } = metadata;
  const { isExpanded, dirSelectionState, isSelected, isSelectionMode, searchQueries } = props;

  const checkbox = !isReadOnly && isSelectionMode
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
