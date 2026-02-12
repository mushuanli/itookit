// @file: llm-ui/components/templates/BranchTemplates.ts

import { escapeHTML } from '@itookit/common';
import { BranchTreeNode } from '@itookit/llm-engine';

export class BranchTemplates {
    /**
     * 渲染分支树面板结构
     */
    static renderTreePanelStructure(): string {
        return `
            <div class="llm-branch-tree-panel__overlay"></div>
            <div class="llm-branch-tree-panel__content">
                <div class="llm-branch-tree-panel__header">
                    <h3>Conversation Branches</h3>
                    <div class="llm-branch-tree-panel__actions">
                        <button class="llm-icon-btn" data-action="compare" title="Compare Selected" disabled>
                            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M9 18l6-6-6-6"></path>
                            </svg>
                        </button>
                        <button class="llm-icon-btn" data-action="close" title="Close">
                            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                                <line x1="18" y1="6" x2="6" y2="18"></line>
                                <line x1="6" y1="6" x2="18" y2="18"></line>
                            </svg>
                        </button>
                    </div>
                </div>
                <div class="llm-branch-tree-panel__body"></div>
            </div>
        `;
    }

    /**
     * 渲染树节点
     */
    static renderTreeNode(
        node: BranchTreeNode,
        depth: number,
        indent: number,
        isCollapsed: boolean,
        treeLines: string,
        depthIndicator: string
    ): string {
        const isActive = node.isActive;
        const hasChildren = node.children.length > 0;
        const roleIcon = node.role === 'user' ? '👤' : '🤖';
        const preview = BranchTemplates.getPreview(node.content);
        const timestamp = new Date(node.timestamp).toLocaleString();

        const branchBadge = node.branchName
            ? `<span class="llm-branch-badge">${escapeHTML(node.branchName)}</span>`
            : '';

        const createdFromBadge = node.createdFrom
            ? `<span class="llm-branch-badge llm-branch-badge--${node.createdFrom}">${node.createdFrom}</span>`
            : '';

        const collapseBtn = hasChildren ? `
            <button class="llm-branch-node__collapse" data-action="toggle-collapse" title="${isCollapsed ? 'Expand' : 'Collapse'}">
                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" 
                     style="transform: rotate(${isCollapsed ? 0 : 90}deg); transition: transform 0.2s">
                    <polyline points="9 18 15 12 9 6"></polyline>
                </svg>
            </button>
        ` : '<span class="llm-branch-node__collapse-placeholder"></span>';

        return `
            <div class="llm-branch-node ${isActive ? 'is-active' : ''} ${isCollapsed ? 'is-collapsed' : ''}" 
                 data-node-id="${node.id}"
                 data-depth="${depth}"
                 style="padding-left: ${indent}px">
                
                ${treeLines}
                
                <div class="llm-branch-node__content">
                    ${collapseBtn}
                    
                    <div class="llm-branch-node__icon">${roleIcon}</div>
                    
                    <div class="llm-branch-node__info">
                        <div class="llm-branch-node__preview">
                            ${depthIndicator}
                            ${escapeHTML(preview)}
                        </div>
                        <div class="llm-branch-node__meta">
                            ${timestamp}
                            ${branchBadge}
                            ${createdFromBadge}
                        </div>
                    </div>
                    
                    <div class="llm-branch-node__actions">
                        ${BranchTemplates.renderNodeActions()}
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * 渲染节点操作按钮
     */
    static renderNodeActions(): string {
        return `
            <button class="llm-icon-btn" data-action="navigate" title="Go to">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="5" y1="12" x2="19" y2="12"></line>
                    <polyline points="12 5 19 12 12 19"></polyline>
                </svg>
            </button>
            <button class="llm-icon-btn" data-action="select" title="Select for Compare">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="20 6 9 17 4 12"></polyline>
                </svg>
            </button>
            <button class="llm-icon-btn" data-action="rename" title="Rename">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                </svg>
            </button>
            <button class="llm-icon-btn" data-action="delete" title="Delete">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="3 6 5 6 21 6"></polyline>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                </svg>
            </button>
        `;
    }

    /**
     * 渲染树形连接线
     */
    static renderTreeLines(ancestorLines: boolean[]): string {
        if (ancestorLines.length === 0) return '';

        let html = '<div class="llm-branch-node__tree-lines">';

        for (let i = 0; i < ancestorLines.length; i++) {
            const needsLine = ancestorLines[i];
            const isLast = i === ancestorLines.length - 1;

            if (isLast) {
                html += `<div class="llm-branch-node__tree-line llm-branch-node__tree-line--branch"></div>`;
            } else if (needsLine) {
                html += `<div class="llm-branch-node__tree-line llm-branch-node__tree-line--vertical"></div>`;
            } else {
                html += `<div class="llm-branch-node__tree-line"></div>`;
            }
        }

        html += '</div>';
        return html;
    }

    /**
     * 渲染重命名对话框
     */
    static renderRenameDialog(currentName: string): string {
        return `
            <div class="llm-branch-rename-dialog__overlay"></div>
            <div class="llm-branch-rename-dialog__content">
                <h4>Rename Branch</h4>
                <input type="text" class="llm-input" value="${escapeHTML(currentName)}" placeholder="Branch name">
                <div class="llm-branch-rename-dialog__actions">
                    <button class="llm-btn" data-action="cancel">Cancel</button>
                    <button class="llm-btn llm-btn--primary" data-action="confirm">Rename</button>
                </div>
            </div>
        `;
    }

    /**
     * 渲染对比视图结构
     */
    static renderCompareViewStructure(): string {
        return `
            <div class="llm-branch-compare__overlay"></div>
            <div class="llm-branch-compare__content">
                <div class="llm-branch-compare__header">
                    <h3>Compare Branches</h3>
                    <button class="llm-icon-btn" data-action="close" title="Close">
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                            <line x1="18" y1="6" x2="6" y2="18"></line>
                            <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                    </button>
                </div>
                <div class="llm-branch-compare__body"></div>
                <div class="llm-branch-compare__footer"></div>
            </div>
        `;
    }

    /**
     * 渲染对比列
     */
    static renderCompareColumn(
        label: string,
        branchId: string,
        meta: string,
        content: string
    ): string {
        return `
            <div class="llm-branch-compare__column">
                <div class="llm-branch-compare__column-header">
                    <span class="llm-branch-compare__label">${label}</span>
                    ${meta}
                    <button class="llm-btn llm-btn--sm" data-action="select" data-branch-id="${branchId}">
                        Use This
                    </button>
                </div>
                <div class="llm-branch-compare__column-content">
                    ${content}
                </div>
            </div>
        `;
    }

    /**
     * 渲染对比统计
     */
    static renderCompareStats(addedLines: number, removedLines: number, similarity: number): string {
        return `
            <div class="llm-branch-compare__stats">
                <span class="llm-branch-compare__stat llm-branch-compare__stat--added">
                    +${addedLines} lines
                </span>
                <span class="llm-branch-compare__stat llm-branch-compare__stat--removed">
                    -${removedLines} lines
                </span>
                <span class="llm-branch-compare__stat">
                    ${similarity}% similar
                </span>
            </div>
        `;
    }

    /**
     * 渲染差异行
     */
    static renderDiffLine(line: { text: string; type: string }, index: number): string {
        const lineClass = line.type === 'unchanged'
            ? ''
            : `llm-branch-compare__line--${line.type}`;

        return `
            <div class="llm-branch-compare__line ${lineClass}">
                <span class="llm-branch-compare__line-number">${index + 1}</span>
                <span class="llm-branch-compare__line-content">${escapeHTML(line.text) || '&nbsp;'}</span>
            </div>
        `;
    }

    /**
     * 渲染分支元数据
     */
    static renderBranchMeta(timestamp: string, branchName?: string): string {
        return `
            <div class="llm-branch-compare__meta">
                <span class="llm-branch-compare__time">${timestamp}</span>
                ${branchName ? `<span class="llm-branch-badge">${escapeHTML(branchName)}</span>` : ''}
            </div>
        `;
    }

    /**
     * 辅助方法：获取预览文本
     */
    private static getPreview(content: string, maxLength: number = 60): string {
        if (!content) return '(Empty)';
        const cleaned = content.replace(/\s+/g, ' ').trim();
        return cleaned.length > maxLength
            ? cleaned.substring(0, maxLength) + '...'
            : cleaned;
    }
}
