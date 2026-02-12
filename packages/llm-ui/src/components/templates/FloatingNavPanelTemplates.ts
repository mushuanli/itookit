// @file: llm-ui/components/templates/FloatingNavPanelTemplates.ts

import { escapeHTML } from '@itookit/common';
import { ChatNavItem } from '../FloatingNavPanel';

export interface BranchItem {
    name: string;
    headNodeId: string;
    isCurrent: boolean;
}

export const FloatingNavPanelTemplates = {
    /**
     * 渲染面板主结构
     */
    renderPanel: (
        currentUserIdx: number,
        totalUsers: number,
        hasSelection: boolean,
        isAllSelected: boolean,
        selectedCount: number,
        viewMode: 'list' | 'tree',
        currentFilter: string,
        branches: BranchItem[],
        listContent: string
    ): string => `
        <div class="llm-nav-panel__header">
            <span class="llm-nav-panel__title">Chat Navigator</span>
            <span class="llm-nav-panel__counter">${currentUserIdx + 1} / ${totalUsers}</span>
            <button class="llm-nav-panel__close" title="Close (Esc)">×</button>
        </div>
        
        <div class="llm-nav-panel__toolbar">
            <!-- 左侧：分支过滤器 -->
            <div class="llm-nav-panel__toolbar-group">
                <select class="llm-nav-panel__branch-filter" data-action="change-filter">
                    <option value="current" ${currentFilter === 'current' ? 'selected' : ''}>
                        📍 Current Branch
                    </option>
                    <option value="all" ${currentFilter === 'all' ? 'selected' : ''}>
                        🌐 All Branches
                    </option>
                    ${branches.length > 1 ? '<option disabled>──────────</option>' : ''}
                    ${branches.map(b => `
                        <option value="${escapeHTML(b.headNodeId)}" ${currentFilter === b.headNodeId ? 'selected' : ''}>
                            ${b.isCurrent ? '✓ ' : ''}🌿 ${escapeHTML(b.name)}
                        </option>
                    `).join('')}
                </select>
            </div>

            <div class="llm-nav-panel__toolbar-sep"></div>

            <!-- 中间：选择相关 -->
            <div class="llm-nav-panel__toolbar-group">
                <button class="llm-nav-panel__btn llm-nav-panel__btn--checkbox ${isAllSelected ? 'checked' : ''}" 
                        data-action="toggle-select-all" 
                        title="${isAllSelected ? 'Deselect All' : 'Select All'}">
                    <span class="llm-nav-panel__checkbox-icon"></span>
                </button>
                ${hasSelection ? `
                    <span class="llm-nav-panel__selection-count">${selectedCount} selected</span>
                ` : ''}
            </div>

            <div class="llm-nav-panel__toolbar-sep"></div>

            <!-- 批量操作（选择时显示）-->
            <div class="llm-nav-panel__toolbar-group llm-nav-panel__toolbar-group--actions ${hasSelection ? 'visible' : ''}">
                <button class="llm-nav-panel__btn" data-action="batch-toggle" title="Toggle Fold Selected">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M9 18l6-6-6-6"/>
                    </svg>
                </button>
                <button class="llm-nav-panel__btn" data-action="batch-copy" title="Copy Selected">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                    </svg>
                </button>
                <button class="llm-nav-panel__btn llm-nav-panel__btn--danger" data-action="batch-delete" title="Delete Selected">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="3 6 5 6 21 6"></polyline>
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                    </svg>
                </button>
                <button class="llm-nav-panel__btn" data-action="clear-selection" title="Clear Selection">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                </button>
            </div>

            <!-- 右侧：视图控制 + 分支管理（无选择时显示）-->
            <div class="llm-nav-panel__toolbar-group llm-nav-panel__toolbar-group--view ${hasSelection ? 'hidden' : ''}">
                <!-- 视图切换按钮 -->
                <button class="llm-nav-panel__btn llm-nav-panel__view-btn ${viewMode === 'list' ? 'active' : ''}" 
                        data-view="list" 
                        title="List View">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="8" y1="6" x2="21" y2="6"></line>
                        <line x1="8" y1="12" x2="21" y2="12"></line>
                        <line x1="8" y1="18" x2="21" y2="18"></line>
                        <line x1="3" y1="6" x2="3.01" y2="6"></line>
                        <line x1="3" y1="12" x2="3.01" y2="12"></line>
                        <line x1="3" y1="18" x2="3.01" y2="18"></line>
                    </svg>
                </button>
                <button class="llm-nav-panel__btn llm-nav-panel__view-btn ${viewMode === 'tree' ? 'active' : ''}" 
                        data-view="tree" 
                        title="Tree View (Branches)">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="6" y1="3" x2="6" y2="15"></line>
                        <circle cx="18" cy="6" r="3"></circle>
                        <circle cx="6" cy="18" r="3"></circle>
                        <path d="M18 9a9 9 0 0 1-9 9"></path>
                    </svg>
                </button>
                
                <div class="llm-nav-panel__toolbar-sep"></div>
                
                <!-- 分支管理按钮 -->
                <button class="llm-nav-panel__btn" data-action="create-branch" title="Create Branch from Current (Shift+→)">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="12" y1="5" x2="12" y2="19"></line>
                        <line x1="5" y1="12" x2="19" y2="12"></line>
                    </svg>
                </button>
                
                <div class="llm-nav-panel__toolbar-sep"></div>
                
                <button class="llm-nav-panel__btn" data-action="fold-all" title="Fold All">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="4 14 10 14 10 20"></polyline>
                        <polyline points="20 10 14 10 14 4"></polyline>
                    </svg>
                </button>
                <button class="llm-nav-panel__btn" data-action="unfold-all" title="Unfold All">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="15 3 21 3 21 9"></polyline>
                        <polyline points="9 21 3 21 3 15"></polyline>
                    </svg>
                </button>
                <div class="llm-nav-panel__toolbar-sep"></div>
                <button class="llm-nav-panel__btn" data-action="prev" title="Previous (↑)">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="18 15 12 9 6 15"></polyline>
                    </svg>
                </button>
                <button class="llm-nav-panel__btn" data-action="next" title="Next (↓)">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="6 9 12 15 18 9"></polyline>
                    </svg>
                </button>
            </div>
        </div>
        
        <div class="llm-nav-panel__list">
            ${listContent}
        </div>
        
        <div class="llm-nav-panel__footer">
            <span class="llm-nav-panel__hint">
                <kbd>↑↓</kbd> Navigate &nbsp;
                <kbd>Shift+Click</kbd> Range Select &nbsp;
                ${viewMode === 'tree' ? '<kbd>←→</kbd> Switch Branch &nbsp; <kbd>Shift+→</kbd> Create Branch &nbsp;' : ''}
                <kbd>Ctrl+T</kbd> Toggle View &nbsp;
                <kbd>Esc</kbd> Close
            </span>
        </div>
    `,

    /**
     * 渲染空状态
     */
    renderEmpty: (): string => `
        <div class="llm-nav-panel__empty">No messages yet</div>
    `,

    /**
     * 渲染列表视图项
     */
    renderListItem: (
        item: ChatNavItem,
        idx: number,
        isActive: boolean,
        isSelected: boolean,
        timeStr: string,
        title: string
    ): string => {
        const icon = item.role === 'user' ? '👤' : '🤖';
        const foldIcon = item.isCollapsed ? '▶' : '▼';
        const activeClass = isActive ? 'llm-nav-item--active' : '';
        const collapsedClass = item.isCollapsed ? 'llm-nav-item--collapsed' : '';

        return `
            <div class="llm-nav-item ${activeClass} ${collapsedClass} ${isSelected ? 'selected' : ''}" 
                 data-id="${item.id}" 
                 data-index="${idx}">
                <div class="llm-nav-item__checkbox ${isSelected ? 'checked' : ''}" data-checkbox="true"></div>
                <span class="llm-nav-item__fold" data-fold="true">${foldIcon}</span>
                <span class="llm-nav-item__icon">${icon}</span>
                <div class="llm-nav-item__content">
                    <div class="llm-nav-item__header">
                        <span class="llm-nav-item__title">${escapeHTML(title)}</span>
                        <span class="llm-nav-item__time">${timeStr}</span>
                    </div>
                    <div class="llm-nav-item__preview">${escapeHTML(item.preview)}</div>
                </div>
                <span class="llm-nav-item__index">#${idx + 1}</span>
            </div>
        `;
    },

    /**
     * 渲染树形视图项
     */
    renderTreeItem: (
        item: ChatNavItem,
        idx: number,
        isActive: boolean,
        isSelected: boolean,
        timeStr: string,
        title: string,
        showBranchBadge: boolean
    ): string => {
        const icon = item.role === 'user' ? '👤' : '🤖';
        const activeClass = isActive ? 'llm-nav-item--active' : '';

        const hasBranches = (item.siblingCount || 0) > 1;
        const branchInfo = hasBranches
            ? `<span class="llm-nav-item__branch-badge">${item.siblingIndex! + 1}/${item.siblingCount}</span>`
            : '';

        // 仅在 "All Branches" 模式下显示分支名称
        const branchName = showBranchBadge && item.branchName
            ? `<span class="llm-nav-item__branch-name">🌿 ${escapeHTML(item.branchName)}</span>`
            : '';

        return `
            <div class="llm-nav-item llm-nav-item--tree ${activeClass} ${isSelected ? 'selected' : ''}"
                 data-id="${item.id}"
                 data-index="${idx}">
                <div class="llm-nav-item__checkbox ${isSelected ? 'checked' : ''}" data-checkbox="true"></div>
                <span class="llm-nav-item__icon">${icon}</span>
                <div class="llm-nav-item__content">
                    <div class="llm-nav-item__header">
                        <span class="llm-nav-item__title">${escapeHTML(title)}</span>
                        ${branchName}
                        ${branchInfo}
                        <span class="llm-nav-item__time">${timeStr}</span>
                    </div>
                    <div class="llm-nav-item__preview">${escapeHTML(item.preview)}</div>
                    
                    ${FloatingNavPanelTemplates.renderBranchActions(item)}
                </div>
                <span class="llm-nav-item__index">#${idx + 1}</span>
            </div>
        `;
    },

    /**
     * 渲染分支操作按钮
     */
    renderBranchActions: (item: ChatNavItem): string => {
        const hasBranches = (item.siblingCount || 0) > 1;

        if (!hasBranches && !item.hasChildren) {
            return `
                <div class="llm-nav-item__branch-actions">
                    <button class="llm-nav-item__branch-btn" 
                            data-action="create-branch" 
                            title="Create Branch (Shift+→)">
                        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2">
                            <line x1="12" y1="5" x2="12" y2="19"></line>
                            <line x1="5" y1="12" x2="19" y2="12"></line>
                        </svg>
                    </button>
                </div>
            `;
        }

        return `
            <div class="llm-nav-item__branch-actions">
                ${hasBranches ? `
                    <button class="llm-nav-item__branch-btn" 
                            data-action="prev-branch" 
                            title="Previous Branch (←)"
                            ${(item.siblingIndex || 0) === 0 ? 'disabled' : ''}>
                        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="15 18 9 12 15 6"></polyline>
                        </svg>
                    </button>
                    <button class="llm-nav-item__branch-btn" 
                            data-action="next-branch" 
                            title="Next Branch (→)"
                            ${(item.siblingIndex || 0) >= (item.siblingCount || 1) - 1 ? 'disabled' : ''}>
                        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="9 18 15 12 9 6"></polyline>
                        </svg>
                    </button>
                ` : ''}
                <button class="llm-nav-item__branch-btn" 
                        data-action="create-branch" 
                        title="Create Branch (Shift+→)">
                    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="12" y1="5" x2="12" y2="19"></line>
                        <line x1="5" y1="12" x2="19" y2="12"></line>
                    </svg>
                </button>
            </div>
        `;
    }
};
