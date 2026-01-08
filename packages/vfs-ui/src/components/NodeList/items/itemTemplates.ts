/**
 * @file vfs-ui/components/NodeList/items/itemTemplates.ts
 * @desc HTML template generation functions for FileItem and DirectoryItem components.
 */
import { escapeHTML } from '@itookit/common';
import type { VFSNodeUI, UISettings, Heading } from '../../../types/types';
import { formatRelativeTime } from '../../../utils/helpers';

const highlightText = (text: string | undefined, queries: string[]): string => {
    const filtered = queries.map(q => q.trim()).filter(Boolean);
    if (!filtered.length || !text) return escapeHTML(text || '');
    const regex = new RegExp(`(${filtered.map(q => q.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')).join('|')})`, 'gi');
    return escapeHTML(text).replace(regex, '<mark class="vfs-search-highlight">$1</mark>');
};

const createOutlineHTML = (headings: Heading[]): string => {
    if (!headings?.length) return '';
    const createLinks = (items: Heading[]): string => items.map(h => `
        <li class="vfs-node-item__outline-item vfs-node-item__outline-item--level-${h.level}">
            <a href="javascript:void(0)" data-action="navigate-to-heading" data-element-id="${escapeHTML(h.elementId)}">
                <span class="vfs-node-item__outline-text">${escapeHTML(h.text)}</span>
            </a>
            ${h.children?.length ? `<ul class="vfs-node-item__outline-list">${createLinks(h.children)}</ul>` : ''}
        </li>`).join('');
    return `<ul class="vfs-node-item__outline-list">${createLinks(headings)}</ul>`;
};

export const createFileItemHTML = (
    file: VFSNodeUI, 
    { isActive, isSelected, isOutlineExpanded, isSelectionMode, isConfirmingDelete, searchQueries = [], uiSettings }: {
        isActive: boolean;
        isSelected: boolean;
        isOutlineExpanded: boolean;
        isSelectionMode: boolean;
        isConfirmingDelete: boolean;
        searchQueries: string[];
        uiSettings: UISettings;
    },
    isReadOnly = false
): string => {
    const { id, metadata, content, headings = [], icon } = file;
    const { title, lastModified, tags = [], custom = {} } = metadata;
    const { isPinned = false, hasUnreadUpdate = false } = custom;

    const deleteBtnHTML = isReadOnly ? '' : (() => {
        const action = isConfirmingDelete ? 'delete-direct' : 'delete-init';
        const iconHtml = isConfirmingDelete ? '<i class="fas fa-trash"></i>' : '×';
        const className = `vfs-node-item__delete-btn${isConfirmingDelete ? ' is-confirming' : ''}`;
        return `<button class="${className}" data-action="${action}" title="${isConfirmingDelete ? '点击立即删除' : '移除'}">${iconHtml}</button>`;
    })();

    const checkboxHTML = !isReadOnly && isSelectionMode
        ? `<div class="vfs-node-item__checkbox-wrapper"><input type="checkbox" class="vfs-node-item__checkbox" data-item-id="${id}" ${isSelected ? 'checked' : ''} data-action="toggle-selection"></div>`
        : '';

    const badgesHTML = uiSettings.showBadges && custom.taskCount && custom.taskCount.total > 0
        ? `<div class="vfs-node-item__badges"><span class="vfs-badge">✅ ${custom.taskCount.completed}/${custom.taskCount.total}</span></div>` 
        : '';

    const tagsHTML = uiSettings.showTags && tags.length
        ? `<div class="vfs-node-item__tags">${tags.map(t => `<span class="vfs-tag-pill">${escapeHTML(t)}</span>`).join('')}</div>` 
        : '';

    const summaryHTML = uiSettings.showSummary 
        ? `<div class="vfs-node-item__summary">${highlightText(content?.summary, searchQueries)}</div>` 
        : '';

    const hasOutline = headings?.length > 0;
    const outlineToggleHTML = hasOutline 
        ? `<button class="vfs-node-item__outline-toggle" data-action="toggle-outline" title="显示/隐藏大纲"><span class="vfs-node-item__outline-toggle-icon ${isOutlineExpanded ? 'is-expanded' : ''}"></span></button>` 
        : '';

    const outlinePreviewHTML = hasOutline && isOutlineExpanded 
        ? `<div class="vfs-node-item__outline is-expanded">${createOutlineHTML(headings)}</div>` 
        : '';

    const displayIcon = isPinned ? '📌' : (icon || '📄');

    return `
        <div class="vfs-node-item" data-item-id="${id}" data-item-type="file">
            <div class="vfs-node-item__main-row ${isSelectionMode ? 'is-selection-mode' : ''}">
                ${checkboxHTML}
                <div class="vfs-node-item__content ${isActive ? 'is-active' : ''} ${isSelected ? 'is-selected' : ''}" data-action="select-and-open">
                    <span class="vfs-node-item__icon" data-action="select-only" title="仅选中">${displayIcon}</span>
                    <div class="vfs-node-item__main">
                        <div class="vfs-node-item__title-wrapper">
                            <span class="vfs-node-item__title">${highlightText(title, searchQueries)}</span>
                            ${hasUnreadUpdate ? '<span class="vfs-node-item__indicator"></span>' : ''}
                        </div>
                        ${summaryHTML}
                        ${tagsHTML}
                    </div>
                    <div class="vfs-node-item__meta">
                        <span class="vfs-node-item__timestamp" title="${new Date(lastModified).toLocaleString()}">${formatRelativeTime(lastModified)}</span>
                        ${badgesHTML}
                    </div>
                    <div class="vfs-node-item__actions">
                        ${outlineToggleHTML}
                        ${deleteBtnHTML}
                    </div>
                </div>
            </div>
            ${outlinePreviewHTML}
        </div>`;
};

export const createDirectoryItemHTML = (
    directory: VFSNodeUI,
    { isExpanded, dirSelectionState, isSelected, isSelectionMode, searchQueries = [] }: {
        isExpanded: boolean;
        dirSelectionState: 'none' | 'partial' | 'all';
        isSelected: boolean;
        isSelectionMode: boolean;
        searchQueries: string[];
    },
    isReadOnly = false
): string => {
    const { id, metadata, icon } = directory;
    const { title, tags = [] } = metadata;

    const checkboxHTML = !isReadOnly && isSelectionMode
        ? `<div class="vfs-node-item__checkbox-wrapper"><input type="checkbox" class="vfs-node-item__checkbox" data-item-id="${id}" ${dirSelectionState === 'all' ? 'checked' : ''} ${dirSelectionState === 'partial' ? 'data-indeterminate="true"' : ''} data-action="toggle-selection"></div>`
        : '';

    const tagsHTML = tags.length
        ? `<div class="vfs-directory-item__tags">${tags.map(t => `<span class="vfs-tag-pill">${escapeHTML(t)}</span>`).join('')}</div>`
        : '';

    return `
        <div class="vfs-node-item vfs-directory-item" data-item-id="${id}" data-item-type="directory">
            <div class="vfs-node-item__main-row ${isSelectionMode ? 'is-selection-mode' : ''}">
                ${checkboxHTML}
                <div class="vfs-directory-item__header ${isSelected ? 'is-selected' : ''}" data-action="select-item">
                    <span class="vfs-directory-item__toggle ${isExpanded ? 'is-expanded' : ''}" data-action="toggle-folder"></span>
                    <span class="vfs-directory-item__icon">${icon || '📁'}</span>
                    <div class="vfs-directory-item__title-container">
                        <span class="vfs-directory-item__title">${highlightText(title, searchQueries)}</span>
                        ${tagsHTML}
                    </div>
                </div>
            </div>
            <div class="vfs-directory-item__children" style="${isExpanded ? '' : 'display:none;'}"></div>
        </div>`;
};
