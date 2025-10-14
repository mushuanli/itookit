// #sidebar/components/SessionList/templates.js

import { slugify, escapeHTML } from '../../../common/utils/utils.js';


function formatRelativeTime(timestamp) {
    if (!timestamp) return '';
    try {
        const now = new Date();
        const seconds = Math.floor((now - new Date(timestamp)) / 1000);
        if (seconds < 60) return "刚刚";
        const minutes = Math.floor(seconds / 60);
        if (minutes < 60) return `${minutes}分钟前`;
        const hours = Math.floor(minutes / 60);
        if (hours < 24) return `${hours}小时前`;
        const days = Math.floor(hours / 24);
        return `${days}天前`;
    } catch (e) {
        return '';
    }
}

/**
 * 创建项内大纲预览的 HTML
 */
function createOutlinePreviewHTML(headings) {
    if (!headings || headings.length === 0) return '';

    const createLinks = (items) => {
        return items.map(h => {
            const childrenHTML = h.children && h.children.length > 0 ? 
                // [修改] 递归调用时使用正确的类名
                `<ul class="mdx-session-item__outline-list">${createLinks(h.children)}</ul>` : '';
            return `
                <li class="mdx-session-item__outline-item mdx-session-item__outline-item--level-${h.level}">
                    <a href="#" data-action="navigate-to-heading" data-element-id="${escapeHTML(h.elementId)}">
                        <span class="mdx-session-item__outline-text">${escapeHTML(h.text)}</span>
                    </a>
                    ${childrenHTML}
                </li>`;
        }).join('');
    };

    // [修改] 更新列表的类名
    return `<ul class="mdx-session-item__outline-list">${createLinks(headings)}</ul>`;
}

/**
 * [OPTIMIZED] Highlights multiple, separate query words within a text.
 * @param {string} text - The original text.
 * @param {string|string[]} query - A single search string or an array of search words.
 * @returns {string} HTML string with matches highlighted.
 */
function highlightText(text, query) {
    const queries = Array.isArray(query) ? query : [query];
    if (!queries || queries.length === 0 || !text) {
        return escapeHTML(text || '');
    }

    const filteredQueries = queries.map(q => q.trim()).filter(Boolean);
    if (filteredQueries.length === 0) {
        return escapeHTML(text || '');
    }
    
    // Escape special regex characters in each query term
    const escapedQueries = filteredQueries.map(q => q.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'));
    const regex = new RegExp(`(${escapedQueries.join('|')})`, 'gi');
    
    return escapeHTML(text).replace(regex, '<mark class="mdx-search-highlight">$1</mark>');
}

/**
 * [MIGRATION & FEATURE] Creates the HTML for a single item, now with highlighting.
 * @param {import('../../types/types.js')._WorkspaceItem} item
 * @param {boolean} isActive
 * @param {boolean} isSelected
 * @param {import('../../types/types.js')._UISettings} uiSettings
 * @param {boolean} isOutlineExpanded
 * @param {boolean} isSelectionMode
 * @param {string|string[]} [searchQueries=[]]
 * @param {boolean} [isReadOnly=false] - [修改]
 * @returns {string}
 */
export function createSessionItemHTML(session, isActive, isSelected, uiSettings, isOutlineExpanded, isSelectionMode, searchQueries = [], isReadOnly = false) {
    const { id, metadata, content, headings = [] } = session;
    const title = metadata?.title || session.title || 'Untitled';
    const lastModified = metadata?.lastModified || session.lastModified;
    const tags = metadata?.tags || session.tags || [];
    const summary = content?.summary || '';
    const customMeta = metadata?.custom || {};
    const isPinned = customMeta.isPinned || false;
    const hasUnreadUpdate = customMeta.hasUnreadUpdate || false;

    // [修改] 在非只读且处于选择模式时才显示复选框
    const checkboxHTML = !isReadOnly && isSelectionMode
        ? `<div class="mdx-session-item__checkbox-wrapper"><input type="checkbox" class="mdx-session-item__checkbox" data-item-id="${id}" ${isSelected ? 'checked' : ''} data-action="toggle-selection"></div>`
        : '';

    let badgesHTML = '';
    if (uiSettings.showBadges && customMeta.taskCount?.total > 0) {
        badgesHTML = `<div class="mdx-session-item__badges"><span class="mdx-badge">✅ ${customMeta.taskCount.completed}/${customMeta.taskCount.total}</span></div>`;
    }

    const tagsHTML = uiSettings.showTags && tags.length > 0
        ? `<div class="mdx-session-item__tags">${tags.map(tag => `<span class="mdx-tag-pill">${escapeHTML(tag)}</span>`).join('')}</div>`
        : '';
    
    const titleHTML = highlightText(title, searchQueries);
    const summaryHTML = uiSettings.showSummary ? `<div class="mdx-session-item__summary">${highlightText(summary, searchQueries)}</div>` : '';

    // 新增：大纲切换按钮
    const hasOutline = headings && headings.length > 0;
    const outlineToggleHTML = hasOutline ? `
        <button class="mdx-session-item__outline-toggle" data-action="toggle-outline" title="显示/隐藏大纲">
            <span class="mdx-session-item__outline-toggle-icon ${isOutlineExpanded ? 'mdx-session-item__outline-toggle-icon--is-expanded' : ''}"></span>
        </button>` : '';

    const outlinePreviewHTML = hasOutline && isOutlineExpanded ? `
        <div class="mdx-session-item__outline mdx-session-item__outline--is-expanded">
            ${createOutlinePreviewHTML(headings)}
        </div>` : '';

    // [修改] 如果是只读模式，则禁用拖拽
    const draggable = isReadOnly ? 'false' : 'true';

    return `
        <div class="mdx-session-item" data-item-id="${id}" data-item-type="item" draggable="${draggable}">
            <div class="mdx-session-item__main-row ${isSelectionMode ? 'is-selection-mode' : ''}">
                ${checkboxHTML}
                <div class="mdx-session-item__content ${isActive ? 'is-active' : ''} ${isSelected ? 'is-selected' : ''}" data-action="select-and-open">
                    <span class="mdx-session-item__icon" data-action="select-only" title="仅选中">${isPinned ? '📌' : '📄'}</span>
                    <div class="mdx-session-item__main">
                        <div class="mdx-session-item__title-wrapper">
                            <span class="mdx-session-item__title">${titleHTML}</span>
                            ${hasUnreadUpdate ? '<span class="mdx-session-item__indicator"></span>' : ''}
                        </div>
                        ${summaryHTML}
                        ${tagsHTML}
                    </div>
                    <div class="mdx-session-item__meta">
                        <span class="mdx-session-item__timestamp" title="${new Date(lastModified).toLocaleString()}">
                            ${formatRelativeTime(lastModified)}
                        </span>
                        ${badgesHTML}
                    </div>
                    ${outlineToggleHTML}
                </div>
            </div>
            ${outlinePreviewHTML}
        </div>`;
}

/**
 * [MIGRATION] Creates the HTML for a folder item.
 * @param {import('../../types/types.js')._WorkspaceItem} folder
 * @param {boolean} isExpanded
 * @param {'none'|'partial'|'all'} folderSelectionState - [修改] 文件夹选择状态
 * @param {string} childrenHTML
 * @param {boolean} isSelectionMode
 * @param {string|string[]} [searchQueries=[]]
 * @param {boolean} [isReadOnly=false]
 * @returns {string}
 */
export function createFolderItemHTML(folder, isExpanded, folderSelectionState, childrenHTML, isSelectionMode, searchQueries = [], isReadOnly = false) {
    const { id, metadata } = folder;
    const title = metadata?.title || folder.title || 'New Folder';
    const tags = metadata?.tags || folder.tags || [];
    
    // --- [修改] 根据三态状态渲染复选框 ---
    const isSelected = folderSelectionState === 'all' || folderSelectionState === 'partial';
    const checkedAttr = folderSelectionState === 'all' ? 'checked' : '';
    const indeterminateAttr = folderSelectionState === 'partial' ? 'data-indeterminate="true"' : '';
    
    const checkboxHTML = !isReadOnly && isSelectionMode
        ? `<div class="mdx-session-item__checkbox-wrapper"><input type="checkbox" class="mdx-session-item__checkbox" data-item-id="${id}" ${checkedAttr} ${indeterminateAttr} data-action="toggle-selection"></div>`
        : '';
        
    // [TAGS-FEATURE] Generate HTML for folder tags.
    const folderTagsHTML = tags.length > 0
        ? `<div class="mdx-session-folder__tags">${tags.map(tag => `<span class="mdx-tag-pill">${escapeHTML(tag)}</span>`).join('')}</div>`
        : '';

    const titleHTML = highlightText(title, searchQueries);

    // [修改] 如果是只读模式，则禁用拖拽
    const draggable = isReadOnly ? 'false' : 'true';

    return `
        <div class="mdx-session-item mdx-session-folder" data-item-id="${id}" data-item-type="folder" draggable="${draggable}">
            <div class="mdx-session-item__main-row ${isSelectionMode ? 'is-selection-mode' : ''}">
                ${checkboxHTML}
                <div class="mdx-session-folder__header ${isSelected ? 'is-selected' : ''}" data-action="select-item">
                    <span class="mdx-session-folder__toggle ${isExpanded ? 'mdx-session-folder--is-expanded' : ''}" data-action="toggle-folder"></span>
                    <span class="mdx-session-folder__icon">📁</span>
                    <div class="mdx-session-folder__title-container">
                        <span class="mdx-session-folder__title">${titleHTML}</span>
                        ${folderTagsHTML}
                    </div>
                </div>
            </div>
            <div class="mdx-session-folder__children" style="${!isExpanded ? 'display: none;' : ''}">
                ${childrenHTML}
            </div>
        </div>`;
}

// [NEW] Template for the "creating" input
export function createItemInputHTML({ type }) {
    const icon = type === 'folder' ? '📁' : '📄';
    const placeholder = type === 'folder' ? '新文件夹名称...' : '新会话名称...';
    return `
        <div class="mdx-session-list__item-creator" data-type="${type}">
            <span class="mdx-session-list__item-creator-icon">${icon}</span>
            <input type="text" class="mdx-session-list__item-creator-input" placeholder="${placeholder}" data-action="create-input" />
        </div>
    `;
}


/**
 * [重构] Creates the HTML for the context menu from a list of menu items.
 * @param {import('../../types/types.js')._MenuItem[]} items - The menu items to render.
 * @returns {string}
 */
export function createContextMenuHTML(items) {
    if (!items || items.length === 0) return '';

    const menuItemsHTML = items.map(item => {
        if (item.type === 'separator') {
            return '<li class="mdx-context-menu__separator"></li>';
        }

        // Default type is 'item'
        const iconHTML = item.iconHTML || '';
        return `
            <li>
                <button data-action="${escapeHTML(item.id)}">
                    ${iconHTML}
                    <span>${escapeHTML(item.label)}</span>
                </button>
            </li>
        `;
    }).join('');
    return `<div class="mdx-context-menu"><ul>${menuItemsHTML}</ul></div>`;
}

// [DELETED] createBulkActionBarHTML(...)
// [DELETED] createNormalFooterHTML(...)

/**
 * [REFACTOR] Creates the unified, state-driven footer HTML.
 * @param {object} params
 * @param {'none' | 'partial' | 'all'} params.selectionStatus
 * @param {number} params.selectedCount
 * @param {boolean} [params.isReadOnly=false] - [修改]
 * @returns {string}
 */
export function createFooterHTML({ selectionStatus, selectedCount, isReadOnly = false }) {
    // [修改] 如果是只读模式，则强制 isSelectionMode 为 false
    const isSelectionMode = !isReadOnly && selectedCount > 0;

    // Determine checkbox attributes based on state
    const checkboxChecked = selectionStatus === 'all' ? 'checked' : '';
    // The `indeterminate` state is set via JS property, but we use a data attribute as a marker.
    const checkboxIndeterminate = selectionStatus === 'partial' ? 'data-indeterminate="true"' : '';
    
    // [修改] 只读模式下不显示复选框
    const checkboxHTML = isReadOnly ? '' : `
        <input 
            type="checkbox" 
            class="mdx-session-list__footer-checkbox" 
            data-action="toggle-select-all" 
            title="${selectionStatus === 'all' ? '全部取消' : '全选'}"
            ${checkboxChecked}
            ${checkboxIndeterminate}
        >`;

    if (isSelectionMode) {
        // [FIX] When in selection mode, render a structure almost identical to the old createBulkActionBarHTML
        // to ensure CSS styles are applied correctly.
        return `
            <div class="mdx-session-list__bulk-bar">
                <div class="mdx-session-list__bulk-bar-info">
                    ${checkboxHTML}
                    <span>已选择 ${selectedCount} 项</span>
                    <button data-action="deselect-all" class="mdx-session-list__bulk-bar-btn mdx-session-list__bulk-bar-btn--text" title="全部取消">取消</button>
                </div>
                <div class="mdx-session-list__bulk-bar-actions">
                    <button class="mdx-session-list__bulk-bar-btn" data-action="bulk-move" title="移动..."><i class="fas fa-folder-open"></i></button>
                    <button class="mdx-session-list__bulk-bar-btn mdx-session-list__bulk-bar-btn--danger" data-action="bulk-delete" title="删除"><i class="fas fa-trash"></i></button>
                </div>
            </div>`;
    } else {
        // When not in selection mode, render the normal footer structure.
        return `
            <div class="mdx-session-list__footer-content">
                <div class="mdx-session-list__footer-selection-controls">${checkboxHTML}</div>
                <div class="mdx-session-list__footer-actions-right">
                    <button data-action="settings" title="设置"><i class="fas fa-cog"></i></button>
                </div>
            </div>`;
    }
}

/**
 * Creates the HTML for the settings popover.
 * @param {import('../../types/types.js')._UISettings} settings - The current UI settings.
 * @returns {string}
 */
export function createSettingsPopoverHTML(settings) {
    return `
        <div class="mdx-settings-popover">
            <div class="mdx-settings-popover__title">排序方式</div>
            <div class="mdx-settings-popover__group" data-setting="sortBy">
                <button data-value="lastModified" class="mdx-settings-popover__option-btn ${settings.sortBy === 'lastModified' ? 'mdx-settings-popover__option-btn--is-active' : ''}">修改时间</button>
                <button data-value="title" class="mdx-settings-popover__option-btn ${settings.sortBy === 'title' ? 'mdx-settings-popover__option-btn--is-active' : ''}">标题</button>
            </div>
            <div class="mdx-settings-popover__title">显示密度</div>
            <div class="mdx-settings-popover__group" data-setting="density">
                <button data-value="comfortable" class="mdx-settings-popover__option-btn ${settings.density === 'comfortable' ? 'mdx-settings-popover__option-btn--is-active' : ''}">舒适</button>
                <button data-value="compact" class="mdx-settings-popover__option-btn ${settings.density === 'compact' ? 'mdx-settings-popover__option-btn--is-active' : ''}">紧凑</button>
            </div>
            <div class="mdx-settings-popover__title">显示内容</div>
            <div class="mdx-settings-popover__checkbox-group" data-setting="show">
                <label class="mdx-settings-popover__checkbox-label"><input type="checkbox" data-key="summary" ${settings.showSummary ? 'checked' : ''}> 显示摘要</label>
                <label class="mdx-settings-popover__checkbox-label"><input type="checkbox" data-key="tags" ${settings.showTags ? 'checked' : ''}> 显示标签</label>
                <label class="mdx-settings-popover__checkbox-label"><input type="checkbox" data-key="badges" ${settings.showBadges ? 'checked' : ''}> 显示元数据</label>
            </div>
        </div>
    `;
}
