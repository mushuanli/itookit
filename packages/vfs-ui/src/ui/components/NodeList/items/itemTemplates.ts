import { ACTION_ICONS, FILE_ICONS, fileTypeIcon } from '@itookit/common';
import { formatFileSize } from '../../../../utils/file-size';
/**
 * @file vfs-ui/ui/components/NodeList/items/itemTemplates.ts
 * @desc HTML templates for file and directory items.
 */
import { Heading, escapeHTML, t } from '@itookit/common';
import type { VFSNodeUI, UISettings } from '../../../../contracts/types';
import type { RowPolicy } from '../../../../utils/row-policy';
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

/** Shared two-step deletion control for files and host-selected navigation entries. */
const createQuickDeleteHTML = (confirming = false): string => {
  const label = escapeHTML(t(confirming ? 'vfs.action.confirmQuickDelete' : 'action.delete'));
  return `<button type="button" class="vfs-node-item__action-btn vfs-node-item__delete-btn ${confirming ? 'is-confirming' : ''}" data-action="${confirming ? 'delete-direct' : 'delete-init'}" title="${label}" aria-label="${label}"><span aria-hidden="true">${confirming ? ACTION_ICONS.delete : ACTION_ICONS.close}</span></button>`;
};

/** Host-owned favorite control; the row hides it when the host reports no state. */
const createFavoriteHTML = (active?: boolean): string => {
  if (active === undefined) return '';
  const label = escapeHTML(t(active ? 'vfs.favorites.remove' : 'vfs.favorites.add'));
  return `<button type="button" class="vfs-node-item__action-btn vfs-node-item__favorite-btn" data-action="favorite-toggle" aria-pressed="${active}" title="${label}" aria-label="${label}">${ACTION_ICONS.favorite}</button>`;
};

export interface FileItemProps {
  favorite?: boolean;
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
  policy: RowPolicy
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
  const { isPinned = false } = custom;
  const { unread: hasUnreadUpdate, attention: hasWaitingInput } = file.presentation ?? {};
  const summary = content?.summary || '';
  const connLabel = file.presentation?.subtitle;
  const isReadOnly = policy.readOnly;

  const deleteBtnHTML = policy.inlineDelete ? createQuickDeleteHTML(isConfirmingDelete) : '';

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

  const badgesHTML = uiSettings.showBadges
    ? (file.presentation?.badges ?? []).map(label => `<span class="vfs-badge">${escapeHTML(label)}</span>`).join('') : '';

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

  const displayIcon = icon || fileTypeIcon(title);

  const menuHTML = custom.navigationMenu ? `<button type="button" class="vfs-node-item__action-btn" data-action="item-menu" aria-label="${escapeHTML(t('vfs.columns.more'))}">⋯</button>` : '';
  const favoriteHTML = createFavoriteHTML(props.favorite);
  const hasActions = deleteBtnHTML || outlineToggleHTML || menuHTML || favoriteHTML;
  const actionsHTML = hasActions
    ? `<div class="vfs-node-item__actions">
        ${menuHTML}
        ${favoriteHTML}
        ${deleteBtnHTML}
        ${outlineToggleHTML}
      </div>`
    : '';

  return `
    <div class="vfs-node-item ${file.presentation?.fileDetails ? 'vfs-node-item--file-details' : ''}" data-item-id="${id}" data-item-type="file">
      <div class="vfs-node-item__main-row ${isSelectionMode ? 'is-selection-mode' : ''}">
        ${checkboxHTML}
        <div class="vfs-node-item__content ${isActive ? 'is-active' : ''} ${isSelected ? 'is-selected' : ''}" data-action="select-and-open">
          <span class="vfs-node-item__icon" aria-hidden="true">${displayIcon}</span>
          
          <div class="vfs-node-item__body">
            <div class="vfs-node-item__row-primary">
              <span class="vfs-node-item__title" title="${escapeHTML(title)}">${highlight(title, searchQueries)}</span>
              ${isPinned ? `<span class="vfs-node-item__pin" aria-hidden="true">${FILE_ICONS.pin}</span>` : ''}
              ${hasWaitingInput ? `<span class="vfs-node-item__indicator vfs-node-item__indicator--waiting" title="${escapeHTML(hasWaitingInput)}"></span>` : ''}
              ${hasUnreadUpdate && !hasWaitingInput ? '<span class="vfs-node-item__indicator"></span>' : ''}
            </div>
            ${connLabel ? `<div class="vfs-node-item__conn-label">${escapeHTML(connLabel)}</div>` : ''}
            <div class="vfs-node-item__row-secondary">
              <div class="vfs-node-item__secondary-left">
                ${summaryHTML}
                ${tagsHTML ? `<div class="vfs-node-item__tags">${tagsHTML}</div>` : ''}
              </div>
              <div class="vfs-node-item__secondary-right">
                ${file.presentation?.fileDetails ? `<span class="vfs-node-item__size" title="${file.metadata.size === undefined ? '—' : `${file.metadata.size} B`}">${formatFileSize(file.metadata.size)}</span>` : ''}
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
  favorite?: boolean;
  isConfirmingDelete?: boolean;
  isLeaf?: boolean;
  isCard?: boolean;
  isActive?: boolean;
  isExpanded: boolean;
  dirSelectionState: 'none' | 'partial' | 'all';
  isSelected: boolean;
  isSelectionMode: boolean;
  searchQueries: string[];
}

export const createDirectoryItemHTML = (
  dir: VFSNodeUI,
  props: DirectoryItemProps,
  policy: RowPolicy
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
  const isReadOnly = policy.readOnly;

  const checkbox =
    !isReadOnly && isSelectionMode
      ? `<div class="vfs-node-item__checkbox-wrapper"><input type="checkbox" class="vfs-node-item__checkbox" data-item-id="${id}" ${dirSelectionState === 'all' ? 'checked' : ''} ${dirSelectionState === 'partial' ? 'data-indeterminate="true"' : ''} data-action="toggle-selection"></div>`
      : '';

  const tagsHtml = tags.length
    ? `<div class="vfs-directory-item__tags">${tags.map(t => `<span class="vfs-tag-pill">${escapeHTML(t)}</span>`).join('')}</div>`
    : '';

  return `
    <div class="vfs-node-item vfs-directory-item ${props.isCard ? 'vfs-directory-item--card' : ''}" data-item-id="${id}" data-item-type="directory">
      <div class="vfs-node-item__main-row ${isSelectionMode ? 'is-selection-mode' : ''}">
        ${checkbox}
        <div class="vfs-directory-item__header ${props.isActive ? 'is-active' : ''} ${isSelected ? 'is-selected' : ''}" role="button" tabindex="0" ${props.isLeaf ? `aria-pressed="${!!props.isActive}"` : `aria-expanded="${isExpanded}"`} data-action="${props.isCard ? 'toggle-folder' : 'select-item'}">
          ${props.isLeaf ? '' : `<span class="vfs-directory-item__toggle ${isExpanded ? 'is-expanded' : ''}" data-action="toggle-folder"></span>`}
          <span class="vfs-directory-item__icon">${icon || FILE_ICONS.folder}</span>
          <div class="vfs-directory-item__title-container">
            <span class="vfs-directory-item__title" title="${escapeHTML(title)}">${highlight(title, searchQueries)}</span>
            ${typeof metadata.custom.navigationDescription === 'string' ? `<span class="vfs-directory-item__description">${escapeHTML(metadata.custom.navigationDescription)}</span>` : ''}
            ${tagsHtml}
          </div>
        </div>
        ${createFavoriteHTML(props.favorite)}
        ${policy.inlineDelete ? createQuickDeleteHTML(props.isConfirmingDelete) : ''}
        ${metadata.custom.navigationMenu ? `<button type="button" class="vfs-directory-item__menu" data-action="item-menu" aria-label="${escapeHTML(t('vfs.columns.more'))}">⋯</button>` : ''}
      </div>
      <div class="vfs-directory-item__children" style="${isExpanded ? '' : 'display:none;'}"></div>
    </div>`;
};
