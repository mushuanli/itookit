// @file: llm-ui/components/BranchTreePanel.ts

import { escapeHTML } from '@itookit/common';
import { BranchTreeNode } from '@itookit/llm-engine';

export interface BranchTreePanelOptions {
    onNavigate?: (nodeId: string) => void;
    onRename?: (nodeId: string, newName: string) => void;
    onDelete?: (nodeId: string) => void;
    onCompare?: (nodeId1: string, nodeId2: string) => void;
    onClose?: () => void;
}

/**
 * 分支树面板
 */
export class BranchTreePanel {
    private container: HTMLElement;
    private panel: HTMLElement | null = null;
    private options: BranchTreePanelOptions;
    private selectedNodes: Set<string> = new Set();
    private collapsedNodes: Set<string> = new Set();
    
    // 配置常量
    private readonly MAX_INDENT_LEVEL = 5; // 最大缩进层级
    private readonly INDENT_SIZE = 16; // 每层缩进像素

    constructor(container: HTMLElement, options: BranchTreePanelOptions = {}) {
        this.container = container;
        this.options = options;
    }

    /**
     * 显示面板
     */
    show(tree: BranchTreeNode): void {
        if (this.panel) {
            this.panel.remove();
        }

        this.panel = document.createElement('div');
        this.panel.className = 'llm-branch-tree-panel';
        this.panel.innerHTML = `
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
                <div class="llm-branch-tree-panel__body">
                    ${this.renderTree(tree, 0, [])}
                </div>
            </div>
        `;

        this.container.appendChild(this.panel);
        this.bindEvents();

        // 添加打开动画
        requestAnimationFrame(() => {
            this.panel?.classList.add('is-open');
        });
    }

    /**
     * 隐藏面板
     */
    hide(): void {
        if (!this.panel) return;

        this.panel.classList.remove('is-open');
        setTimeout(() => {
            this.panel?.remove();
            this.panel = null;
        }, 300);

        this.options.onClose?.();
    }

    /**
     * 切换显示
     */
    toggle(tree: BranchTreeNode): void {
        if (this.panel) {
            this.hide();
        } else {
            this.show(tree);
        }
    }

    /**
     * 渲染树 - 优化版本
     * @param node 当前节点
     * @param depth 当前深度
     * @param ancestorLines 祖先节点的连接线状态 [是否需要竖线]
     */
    private renderTree(node: BranchTreeNode, depth: number, ancestorLines: boolean[]): string {
        // 限制最大缩进
        const visualDepth = Math.min(depth, this.MAX_INDENT_LEVEL);
        const indent = visualDepth * this.INDENT_SIZE;
        
        const isActive = node.isActive;
        const hasChildren = node.children.length > 0;
        const isCollapsed = this.collapsedNodes.has(node.id);
        
        const roleIcon = node.role === 'user' ? '👤' : '🤖';
        const preview = this.getPreview(node.content);
        const timestamp = new Date(node.timestamp).toLocaleString();
        
        const branchBadge = node.branchName 
            ? `<span class="llm-branch-badge">${escapeHTML(node.branchName)}</span>`
            : '';
        
        const createdFromBadge = node.createdFrom
            ? `<span class="llm-branch-badge llm-branch-badge--${node.createdFrom}">${node.createdFrom}</span>`
            : '';

        // 渲染连接线
        const treeLines = this.renderTreeLines(ancestorLines, hasChildren);
        
        // 折叠按钮
        const collapseBtn = hasChildren ? `
            <button class="llm-branch-node__collapse" data-action="toggle-collapse" title="${isCollapsed ? 'Expand' : 'Collapse'}">
                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" 
                     style="transform: rotate(${isCollapsed ? 0 : 90}deg); transition: transform 0.2s">
                    <polyline points="9 18 15 12 9 6"></polyline>
                </svg>
            </button>
        ` : '<span class="llm-branch-node__collapse-placeholder"></span>';

        // 深度指示器 (当超过最大缩进时显示)
        const depthIndicator = depth > this.MAX_INDENT_LEVEL 
            ? `<span class="llm-branch-node__depth-badge">+${depth - this.MAX_INDENT_LEVEL}</span>`
            : '';

        let html = `
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
                    </div>
                </div>
            </div>
        `;

        // 递归渲染子节点 (如果未折叠)
        if (hasChildren && !isCollapsed) {
            for (let i = 0; i < node.children.length; i++) {
                const isLastChild = i === node.children.length - 1;
                const newAncestorLines = [...ancestorLines, !isLastChild];
                html += this.renderTree(node.children[i], depth + 1, newAncestorLines);
            }
        }

        return html;
    }

    /**
     * 渲染树形连接线
     */
    private renderTreeLines(ancestorLines: boolean[], hasChildren: boolean): string {
        if (ancestorLines.length === 0) return '';

        let html = '<div class="llm-branch-node__tree-lines">';
        
        for (let i = 0; i < ancestorLines.length; i++) {
            const needsLine = ancestorLines[i];
            const isLast = i === ancestorLines.length - 1;
            
            if (isLast) {
                // 最后一层: L 形或 T 形连接
                html += `<div class="llm-branch-node__tree-line llm-branch-node__tree-line--branch"></div>`;
            } else if (needsLine) {
                // 中间层: 竖线
                html += `<div class="llm-branch-node__tree-line llm-branch-node__tree-line--vertical"></div>`;
            } else {
                // 空白
                html += `<div class="llm-branch-node__tree-line"></div>`;
            }
        }
        
        html += '</div>';
        return html;
    }

    private getPreview(content: string, maxLength: number = 60): string {
        if (!content) return '(Empty)';
        const cleaned = content.replace(/\s+/g, ' ').trim();
        return cleaned.length > maxLength 
            ? cleaned.substring(0, maxLength) + '...' 
            : cleaned;
    }

    /**
     * 绑定事件
     */
    private bindEvents(): void {
        if (!this.panel) return;

        // 关闭按钮
        this.panel.querySelector('[data-action="close"]')?.addEventListener('click', () => {
            this.hide();
        });

        // 点击遮罩关闭
        this.panel.querySelector('.llm-branch-tree-panel__overlay')?.addEventListener('click', () => {
            this.hide();
        });

        // 节点操作
        this.panel.addEventListener('click', (e) => {
            const target = e.target as HTMLElement;
            const btn = target.closest('[data-action]') as HTMLElement;
            if (!btn) return;

            const action = btn.dataset.action;
            const nodeEl = btn.closest('.llm-branch-node') as HTMLElement;
            const nodeId = nodeEl?.dataset.nodeId;

            if (!nodeId) return;

            switch (action) {
                case 'navigate':
                    this.options.onNavigate?.(nodeId);
                    this.hide();
                    break;

                case 'select':
                    this.toggleSelection(nodeId, nodeEl);
                    break;

                case 'rename':
                    this.showRenameDialog(nodeId, nodeEl);
                    break;

                case 'delete':
                    this.confirmDelete(nodeId);
                    break;
                    
                case 'toggle-collapse':
                    this.toggleCollapse(nodeId, nodeEl);
                    break;
            }
        });

        // 比较按钮
        this.panel.querySelector('[data-action="compare"]')?.addEventListener('click', () => {
            if (this.selectedNodes.size === 2) {
                const [node1, node2] = Array.from(this.selectedNodes);
                this.options.onCompare?.(node1, node2);
                this.hide();
            }
        });
    }

    /**
     * 切换折叠状态
     */
    private toggleCollapse(nodeId: string, nodeEl: HTMLElement): void {
        if (this.collapsedNodes.has(nodeId)) {
            this.collapsedNodes.delete(nodeId);
            nodeEl.classList.remove('is-collapsed');
            
            // 显示子节点
            let nextEl = nodeEl.nextElementSibling as HTMLElement;
            const currentDepth = parseInt(nodeEl.dataset.depth || '0');
            
            while (nextEl && nextEl.classList.contains('llm-branch-node')) {
                const nextDepth = parseInt(nextEl.dataset.depth || '0');
                if (nextDepth <= currentDepth) break;
                
                nextEl.style.display = '';
                nextEl = nextEl.nextElementSibling as HTMLElement;
            }
        } else {
            this.collapsedNodes.add(nodeId);
            nodeEl.classList.add('is-collapsed');
            
            // 隐藏子节点
            let nextEl = nodeEl.nextElementSibling as HTMLElement;
            const currentDepth = parseInt(nodeEl.dataset.depth || '0');
            
            while (nextEl && nextEl.classList.contains('llm-branch-node')) {
                const nextDepth = parseInt(nextEl.dataset.depth || '0');
                if (nextDepth <= currentDepth) break;
                
                nextEl.style.display = 'none';
                nextEl = nextEl.nextElementSibling as HTMLElement;
            }
        }
        
        // 更新折叠按钮图标
        const collapseBtn = nodeEl.querySelector('[data-action="toggle-collapse"] svg') as SVGElement;
        if (collapseBtn) {
            const isCollapsed = this.collapsedNodes.has(nodeId);
            collapseBtn.style.transform = `rotate(${isCollapsed ? 0 : 90}deg)`;
        }
    }

    private toggleSelection(nodeId: string, nodeEl: HTMLElement): void {
        if (this.selectedNodes.has(nodeId)) {
            this.selectedNodes.delete(nodeId);
            nodeEl.classList.remove('is-selected');
        } else {
            // 最多选择 2 个
            if (this.selectedNodes.size >= 2) {
                const firstSelected = Array.from(this.selectedNodes)[0];
                const firstEl = this.panel?.querySelector(`[data-node-id="${firstSelected}"]`);
                firstEl?.classList.remove('is-selected');
                this.selectedNodes.delete(firstSelected);
            }
            this.selectedNodes.add(nodeId);
            nodeEl.classList.add('is-selected');
        }

        // 更新比较按钮状态
        const compareBtn = this.panel?.querySelector('[data-action="compare"]') as HTMLButtonElement;
        if (compareBtn) {
            compareBtn.disabled = this.selectedNodes.size !== 2;
        }
    }

    /**
     * 显示重命名对话框
     */
    private showRenameDialog(nodeId: string, nodeEl: HTMLElement): void {
        const currentName = nodeEl.querySelector('.llm-branch-badge')?.textContent || '';
        
        const dialog = document.createElement('div');
        dialog.className = 'llm-branch-rename-dialog';
        dialog.innerHTML = `
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

        this.panel?.appendChild(dialog);

        const input = dialog.querySelector('input') as HTMLInputElement;
        input.focus();
        input.select();

        const confirm = () => {
            const newName = input.value.trim();
            if (newName) {
                this.options.onRename?.(nodeId, newName);
                
                // 更新 UI
                const badge = nodeEl.querySelector('.llm-branch-badge');
                if (badge) {
                    badge.textContent = newName;
                } else {
                    const metaEl = nodeEl.querySelector('.llm-branch-node__meta');
                    if (metaEl) {
                        const newBadge = document.createElement('span');
                        newBadge.className = 'llm-branch-badge';
                        newBadge.textContent = newName;
                        metaEl.insertBefore(newBadge, metaEl.firstChild);
                    }
                }
            }
            dialog.remove();
        };

        dialog.querySelector('[data-action="confirm"]')?.addEventListener('click', confirm);
        dialog.querySelector('[data-action="cancel"]')?.addEventListener('click', () => {
            dialog.remove();
        });

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                confirm();
            } else if (e.key === 'Escape') {
                dialog.remove();
            }
        });
    }

    /**
     * 确认删除
     */
    private async confirmDelete(nodeId: string): Promise<void> {
        const confirmed = confirm('Delete this branch and all its children?');
        if (confirmed) {
            this.options.onDelete?.(nodeId);
            
            // 从 UI 中移除
            const nodeEl = this.panel?.querySelector(`[data-node-id="${nodeId}"]`);
            if (nodeEl) {
                nodeEl.classList.add('is-deleting');
                setTimeout(() => nodeEl.remove(), 300);
            }
        }
    }

    /**
     * 销毁
     */
    destroy(): void {
        this.panel?.remove();
        this.panel = null;
        this.selectedNodes.clear();
        this.collapsedNodes.clear();
    }
}


