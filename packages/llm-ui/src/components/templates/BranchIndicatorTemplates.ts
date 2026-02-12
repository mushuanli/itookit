// @file: llm-ui/components/templates/BranchIndicatorTemplates.ts

import { escapeHTML } from '@itookit/common';

export interface BranchItem {
    name: string;
    headNodeId: string;
    isCurrent: boolean;
}

export class BranchIndicatorTemplates {
    /**
     * 渲染最小化指示器
     */
    static renderMinimalIndicator(name: string): string {
        return `
            <button class="llm-branch-indicator-btn llm-branch-indicator-btn--minimal"
                    data-action="show-branch-tree"
                    title="Branch: ${escapeHTML(name)}">
                <svg class="llm-branch-indicator-icon" viewBox="0 0 24 24" 
                     width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="6" y1="3" x2="6" y2="15"></line>
                    <circle cx="18" cy="6" r="3"></circle>
                    <circle cx="6" cy="18" r="3"></circle>
                    <path d="M18 9a9 9 0 0 1-9 9"></path>
                </svg>
                <span class="llm-branch-indicator-name">${escapeHTML(name)}</span>
            </button>
        `;
    }

    /**
     * 渲染完整指示器
     */
    static renderFullIndicator(name: string, count: number): string {
        return `
            <button class="llm-branch-indicator-btn"
                    data-action="toggle-branch-dropdown"
                    title="Current branch: ${escapeHTML(name)} (${count} branches)">
                <svg class="llm-branch-indicator-icon" viewBox="0 0 24 24" 
                     width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="6" y1="3" x2="6" y2="15"></line>
                    <circle cx="18" cy="6" r="3"></circle>
                    <circle cx="6" cy="18" r="3"></circle>
                    <path d="M18 9a9 9 0 0 1-9 9"></path>
                </svg>
                <span class="llm-branch-indicator-name">${escapeHTML(name)}</span>
                <span class="llm-branch-indicator-count">${count}</span>
                <svg class="llm-branch-indicator-chevron" viewBox="0 0 24 24"
                     width="12" height="12" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="6 9 12 15 18 9"></polyline>
                </svg>
            </button>
            <div class="llm-branch-dropdown" style="display:none"></div>
        `;
    }

    /**
     * 渲染下拉菜单内容
     */
    static renderDropdownContent(branches: BranchItem[]): string {
        const branchItems = branches.map(branch => 
            BranchIndicatorTemplates.renderBranchItem(branch)
        ).join('');

        return `
            <div class="llm-branch-dropdown-header">
                <span class="llm-branch-dropdown-title">Branches</span>
            </div>
            <div class="llm-branch-dropdown-list">
                ${branchItems}
            </div>
            <div class="llm-branch-dropdown-footer">
                ${BranchIndicatorTemplates.renderDropdownActions()}
            </div>
        `;
    }

    /**
     * 渲染分支项
     */
    private static renderBranchItem(branch: BranchItem): string {
        const isActive = branch.isCurrent ? 'is-active' : '';
        const checkmark = branch.isCurrent
            ? `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" 
                   stroke="currentColor" stroke-width="2">
                   <polyline points="20 6 9 17 4 12"></polyline>
               </svg>`
            : '<span style="width:14px;display:inline-block"></span>';

        return `
            <button class="llm-branch-dropdown-item ${isActive}"
                    data-action="switch-branch"
                    data-branch-id="${escapeHTML(branch.headNodeId)}"
                    ${branch.isCurrent ? 'disabled' : ''}>
                ${checkmark}
                <span class="llm-branch-dropdown-item-name">${escapeHTML(branch.name)}</span>
            </button>
        `;
    }

    /**
     * 渲染下拉菜单操作按钮
     */
    private static renderDropdownActions(): string {
        return `
            <button class="llm-branch-dropdown-action" data-action="create-branch">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" 
                     stroke="currentColor" stroke-width="2">
                    <line x1="12" y1="5" x2="12" y2="19"></line>
                    <line x1="5" y1="12" x2="19" y2="12"></line>
                </svg>
                <span>New Branch</span>
            </button>
            <button class="llm-branch-dropdown-action" data-action="show-branch-tree">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" 
                     stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="2" y1="12" x2="22" y2="12"></line>
                    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 
                             15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
                </svg>
                <span>View Tree</span>
            </button>
        `;
    }
}

