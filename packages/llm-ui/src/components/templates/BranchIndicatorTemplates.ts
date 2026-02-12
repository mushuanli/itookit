// @file: llm-ui/components/templates/BranchIndicatorTemplates.ts

import { escapeHTML } from '@itookit/common';

export interface BranchItem {
    name: string;
    headNodeId: string;
    isCurrent: boolean;
}

export class BranchIndicatorTemplates {
    /**
     * 渲染简化指示器（仅显示当前分支）
     */
    static renderIndicator(name: string, count: number): string {
        const displayName = escapeHTML(name);
        const title = `Branch: ${displayName}${count > 1 ? ` (${count} total)` : ''} - Click to manage branches`;

        return `
            <button class="llm-branch-indicator-btn" 
                    data-action="open-navigator"
                    title="${title}">
                <svg class="llm-branch-indicator-icon" viewBox="0 0 24 24" 
                     width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="6" y1="3" x2="6" y2="15"></line>
                    <circle cx="18" cy="6" r="3"></circle>
                    <circle cx="6" cy="18" r="3"></circle>
                    <path d="M18 9a9 9 0 0 1-9 9"></path>
                </svg>
                <span class="llm-branch-indicator-name">${displayName}</span>
                ${count > 1 ? `<span class="llm-branch-indicator-count">${count}</span>` : ''}
            </button>
        `;
    }
}
