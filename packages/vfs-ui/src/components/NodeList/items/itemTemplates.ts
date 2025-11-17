/**
 * @file vfs-ui/components/NodeList/items/itemTemplates.ts
 * @desc HTML template generation functions for FileItem and DirectoryItem components.
 */
import { escapeHTML } from '@itookit/common';
import { VFSNodeUI, UISettings, Heading } from '../../../types/types';

function formatRelativeTime(timestamp: string | undefined): string {
    if (!timestamp) return '';
    try {
        const seconds = Math.floor((Date.now() - new Date(timestamp).getTime()) / 1000);
        if (seconds < 60) return "刚刚";
        const minutes = Math.floor(seconds / 60);
        if (minutes < 60) return `${minutes}分钟前`;
        const hours = Math.floor(minutes / 60);
        if (hours < 24) return `${hours}小时前`;
        return `${Math.floor(hours / 24)}天前`;
    } catch (e) { return ''; }
}

function createOutlinePreviewHTML(headings: Heading[]): string {
    if (!headings || headings.length === 0) return '';
    const createLinks = (items: Heading[]): string => items.map(h => {
        // [修复] 明确检查 h.children 是否存在
        const hasChildren = h.children && h.children.length > 0;
        return `
        <li class="vfs-node-item__outline-item vfs-node-item__outline-item--level-${h.level}">
            <a href="#" data-action="navigate-to-heading" data-element-id="${escapeHTML(h.elementId)}">
                <span class="vfs-node-item__outline-text">${escapeHTML(h.text)}</span>
            </a>
            ${hasChildren ? `<ul class="vfs-node-item__outline-list">${createLinks(h.children!)}</ul>` : ''}
        </li>`
    }).join('');
    return `<ul class="vfs-node-item__outline-list">${createLinks(headings)}</ul>`;
}

function highlightText(text: string | undefined, queries: string[]): string {
    const filteredQueries = queries.map(q => q.trim()).filter(Boolean);
    if (filteredQueries.length === 0 || !text) return escapeHTML(text || '');
    const regex = new RegExp(`(${filteredQueries.map(q => q.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')).join('|')})`, 'gi');
    return escapeHTML(text).replace(regex, '<mark class="vfs-search-highlight">$1</mark>');
}

export function createFileItemHTML(
    file: VFSNodeUI, isActive: boolean, isSelected: boolean, uiSettings: UISettings,
    isOutlineExpanded: boolean, isSelectionMode: boolean, searchQueries: string[] = [], isReadOnly: boolean = false
): string {
    const { id, metadata, content, headings = [] } = file;
    const { title, lastModified, tags = [], custom = {} } = metadata;
    const summary = content?.summary || '';
    const { isPinned = false, hasUnreadUpdate = false, taskCount } = custom;

    const checkboxHTML = !isReadOnly && isSelectionMode
        ? `<div class="vfs-node-item__checkbox-wrapper"><input type="checkbox" class="vfs-node-item__checkbox" data-item-id="${id}" ${isSelected ? 'checked' : ''} data-action="toggle-selection"></div>`
        : '';

    // [修复] 明确检查 taskCount 及其属性
    const badgesHTML = uiSettings.showBadges && taskCount && taskCount.total > 0
        ? `<div class="vfs-node-item__badges"><span class="vfs-badge">✅ ${taskCount.completed}/${taskCount.total}</span></div>` : '';

    const tagsHTML = uiSettings.showTags && tags.length > 0
        ? `<div class="vfs-node-item__tags">${tags.map(tag => `<span class="vfs-tag-pill">${escapeHTML(tag)}</span>`).join('')}</div>` : '';
    
    const summaryHTML = uiSettings.showSummary ? `<div class="vfs-node-item__summary">${highlightText(summary, searchQueries)}</div>` : '';
    
    const hasOutline = headings?.length > 0;
    const outlineToggleHTML = hasOutline ? `
        <button class="vfs-node-item__outline-toggle" data-action="toggle-outline" title="显示/隐藏大纲">
            <span class="vfs-node-item__outline-toggle-icon ${isOutlineExpanded ? 'is-expanded' : ''}"></span>
        </button>` : '';

    const outlinePreviewHTML = hasOutline && isOutlineExpanded ? `<div class="vfs-node-item__outline is-expanded">${createOutlinePreviewHTML(headings)}</div>` : '';

    return `
        <div class="vfs-node-item" data-item-id="${id}" data-item-type="file">
            <div class="vfs-node-item__main-row ${isSelectionMode ? 'is-selection-mode' : ''}">
                ${checkboxHTML}
                <div class="vfs-node-item__content ${isActive ? 'is-active' : ''} ${isSelected ? 'is-selected' : ''}" data-action="select-and-open">
                    <span class="vfs-node-item__icon" data-action="select-only" title="仅选中">${isPinned ? '📌' : '📄'}</span>
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
                    ${outlineToggleHTML}
                </div>
            </div>
            ${outlinePreviewHTML}
        </div>`;
}

export function createDirectoryItemHTML(
    directory: VFSNodeUI, isExpanded: boolean, dirSelectionState: 'none' | 'partial' | 'all',
    isSelectionMode: boolean, searchQueries: string[] = [], isReadOnly: boolean = false
): string {
    const { id, metadata } = directory;
    const { title, tags = [] } = metadata;
    const isSelected = dirSelectionState === 'all' || dirSelectionState === 'partial';
    
    const checkboxHTML = !isReadOnly && isSelectionMode
        ? `<div class="vfs-node-item__checkbox-wrapper"><input type="checkbox" class="vfs-node-item__checkbox" data-item-id="${id}" ${dirSelectionState === 'all' ? 'checked' : ''} ${dirSelectionState === 'partial' ? 'data-indeterminate="true"' : ''} data-action="toggle-selection"></div>`
        : '';
        
    const dirTagsHTML = tags.length > 0
        ? `<div class="vfs-directory-item__tags">${tags.map(tag => `<span class="vfs-tag-pill">${escapeHTML(tag)}</span>`).join('')}</div>`
        : '';

    return `
        <div class="vfs-node-item vfs-directory-item" data-item-id="${id}" data-item-type="directory">
            <div class="vfs-node-item__main-row ${isSelectionMode ? 'is-selection-mode' : ''}">
                ${checkboxHTML}
                <div class="vfs-directory-item__header ${isSelected ? 'is-selected' : ''}" data-action="select-item">
                    <span class="vfs-directory-item__toggle ${isExpanded ? 'is-expanded' : ''}" data-action="toggle-folder"></span>
                    <span class="vfs-directory-item__icon">📁</span>
                    <div class="vfs-directory-item__title-container">
                        <span class="vfs-directory-item__title">${highlightText(title, searchQueries)}</span>
                        ${dirTagsHTML}
                    </div>
                </div>
            </div>
            <div class="vfs-directory-item__children" style="${!isExpanded ? 'display: none;' : ''}"></div>
        </div>`;
}
