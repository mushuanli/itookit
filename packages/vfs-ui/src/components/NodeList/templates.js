/**
 * @file vfs-ui/components/NodeList/templates.js
 */
import { slugify, escapeHTML } from '@itookit/common';

function formatRelativeTime(timestamp) {
    if (!timestamp) return '';
    try {
        // Correction: Use .getTime() to convert Date object to number before subtraction.
        const seconds = Math.floor((Date.now() - new Date(timestamp).getTime()) / 1000);
        if (seconds < 60) return "刚刚";
        const minutes = Math.floor(seconds / 60);
        if (minutes < 60) return `${minutes}分钟前`;
        const hours = Math.floor(minutes / 60);
        if (hours < 24) return `${hours}小时前`;
        return `${Math.floor(hours / 24)}天前`;
    } catch (e) { return ''; }
}

function createOutlinePreviewHTML(headings) {
    if (!headings || headings.length === 0) return '';
    const createLinks = (items) => items.map(h => `
        <li class="vfs-node-item__outline-item vfs-node-item__outline-item--level-${h.level}">
            <a href="#" data-action="navigate-to-heading" data-element-id="${escapeHTML(h.elementId)}">
                <span class="vfs-node-item__outline-text">${escapeHTML(h.text)}</span>
            </a>
            ${h.children?.length > 0 ? `<ul class="vfs-node-item__outline-list">${createLinks(h.children)}</ul>` : ''}
        </li>`
    ).join('');
    return `<ul class="vfs-node-item__outline-list">${createLinks(headings)}</ul>`;
}

function highlightText(text, query) {
    const queries = Array.isArray(query) ? query : [query];
    const filteredQueries = queries.map(q => q.trim()).filter(Boolean);
    if (filteredQueries.length === 0 || !text) return escapeHTML(text || '');
    const regex = new RegExp(`(${filteredQueries.map(q => q.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')).join('|')})`, 'gi');
    return escapeHTML(text).replace(regex, '<mark class="vfs-search-highlight">$1</mark>');
}

export function createFileItemHTML(file, isActive, isSelected, uiSettings, isOutlineExpanded, isSelectionMode, searchQueries = [], isReadOnly = false) {
    const { id, metadata, content, headings = [] } = file;
    const { title, lastModified, tags = [], custom = {} } = metadata;
    const summary = content?.summary || '';
    const { isPinned = false, hasUnreadUpdate = false, taskCount } = custom;

    const checkboxHTML = !isReadOnly && isSelectionMode
        ? `<div class="vfs-node-item__checkbox-wrapper"><input type="checkbox" class="vfs-node-item__checkbox" data-item-id="${id}" ${isSelected ? 'checked' : ''} data-action="toggle-selection"></div>`
        : '';

    const badgesHTML = uiSettings.showBadges && taskCount?.total > 0
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
        <div class="vfs-node-item" data-item-id="${id}" data-item-type="file" draggable="${!isReadOnly}">
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

export function createDirectoryItemHTML(directory, isExpanded, dirSelectionState, childrenHTML, isSelectionMode, searchQueries = [], isReadOnly = false) {
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
        <div class="vfs-node-item vfs-directory-item" data-item-id="${id}" data-item-type="directory" draggable="${!isReadOnly}">
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
            <div class="vfs-directory-item__children" style="${!isExpanded ? 'display: none;' : ''}">${childrenHTML}</div>
        </div>`;
}

export function createItemInputHTML({ type }) {
    const icon = type === 'folder' ? '📁' : '📄';
    const placeholder = type === 'folder' ? '新目录名称...' : '新文件名称...';
    return `
        <div class="vfs-node-list__item-creator" data-type="${type}">
            <span class="vfs-node-list__item-creator-icon">${icon}</span>
            <input type="text" class="vfs-node-list__item-creator-input" placeholder="${placeholder}" data-action="create-input" />
        </div>`;
}

export function createContextMenuHTML(items) {
    if (!items || items.length === 0) return '';
    return `<div class="vfs-context-menu"><ul>${items.map(item => {
        if (item.type === 'separator') return '<li class="vfs-context-menu__separator"></li>';
        return `<li><button data-action="${escapeHTML(item.id)}">${item.iconHTML || ''}<span>${escapeHTML(item.label)}</span></button></li>`;
    }).join('')}</ul></div>`;
}

export function createFooterHTML({ selectionStatus, selectedCount, isReadOnly = false }) {
    const isSelectionMode = !isReadOnly && selectedCount > 0;
    const checkboxHTML = isReadOnly ? '' : `
        <input type="checkbox" class="vfs-node-list__footer-checkbox" data-action="toggle-select-all" 
            title="${selectionStatus === 'all' ? '全部取消' : '全选'}"
            ${selectionStatus === 'all' ? 'checked' : ''}
            ${selectionStatus === 'partial' ? 'data-indeterminate="true"' : ''}>`;

    if (isSelectionMode) {
        return `
            <div class="vfs-node-list__bulk-bar">
                <div class="vfs-node-list__bulk-bar-info">
                    ${checkboxHTML}
                    <span>已选择 ${selectedCount} 项</span>
                    <button data-action="deselect-all" class="vfs-node-list__bulk-bar-btn--text" title="全部取消">取消</button>
                </div>
                <div class="vfs-node-list__bulk-bar-actions">
                    <button class="vfs-node-list__bulk-bar-btn" data-action="bulk-move" title="移动..."><i class="fas fa-folder-open"></i></button>
                    <button class="vfs-node-list__bulk-bar-btn vfs-node-list__bulk-bar-btn--danger" data-action="bulk-delete" title="删除"><i class="fas fa-trash"></i></button>
                </div>
            </div>`;
    } else {
        return `
            <div class="vfs-node-list__footer-content">
                <div class="vfs-node-list__footer-selection-controls">${checkboxHTML}</div>
                <div class="vfs-node-list__footer-actions-right">
                    <button data-action="settings" title="设置"><i class="fas fa-cog"></i></button>
                </div>
            </div>`;
    }
}

export function createSettingsPopoverHTML(settings) {
    const btn = (group, value, label) => `<button data-value="${value}" class="vfs-settings-popover__option-btn ${settings[group] === value ? 'is-active' : ''}">${label}</button>`;
    const chk = (key, label) => `<label class="vfs-settings-popover__checkbox-label"><input type="checkbox" data-key="${key}" ${settings[`show${key.charAt(0).toUpperCase() + key.slice(1)}`] ? 'checked' : ''}> ${label}</label>`;
    return `
        <div class="vfs-settings-popover">
            <div class="vfs-settings-popover__title">排序方式</div>
            <div class="vfs-settings-popover__group" data-setting="sortBy">${btn('sortBy', 'lastModified', '修改时间')}${btn('sortBy', 'title', '标题')}</div>
            <div class="vfs-settings-popover__title">显示密度</div>
            <div class="vfs-settings-popover__group" data-setting="density">${btn('density', 'comfortable', '舒适')}${btn('density', 'compact', '紧凑')}</div>
            <div class="vfs-settings-popover__title">显示内容</div>
            <div class="vfs-settings-popover__checkbox-group" data-setting="show">${chk('summary', '显示摘要')}${chk('tags', '显示标签')}${chk('badges', '显示元数据')}</div>
        </div>`;
}