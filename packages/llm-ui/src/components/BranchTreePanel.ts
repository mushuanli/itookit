// @file: llm-ui/components/BranchTreePanel.ts

import { BranchTreeNode } from '@itookit/llm-engine';
import { BranchTemplates } from './templates/BranchTemplates';

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

    private readonly MAX_INDENT_LEVEL = 5;
    private readonly INDENT_SIZE = 16;

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
        this.panel.innerHTML = BranchTemplates.renderTreePanelStructure();

        const bodyEl = this.panel.querySelector('.llm-branch-tree-panel__body');
        if (bodyEl) {
            bodyEl.innerHTML = this.renderTree(tree, 0, []);
        }

        this.container.appendChild(this.panel);
        this.bindEvents();

        requestAnimationFrame(() => {
            this.panel?.classList.add('is-open');
        });
    }

    hide(): void {
        if (!this.panel) return;

        this.panel.classList.remove('is-open');
        setTimeout(() => {
            this.panel?.remove();
            this.panel = null;
        }, 300);

        this.options.onClose?.();
    }

    toggle(tree: BranchTreeNode): void {
        if (this.panel) {
            this.hide();
        } else {
            this.show(tree);
        }
    }

    private renderTree(node: BranchTreeNode, depth: number, ancestorLines: boolean[]): string {
        const visualDepth = Math.min(depth, this.MAX_INDENT_LEVEL);
        const indent = visualDepth * this.INDENT_SIZE;

        const isCollapsed = this.collapsedNodes.has(node.id);
        const hasChildren = node.children.length > 0;

        const treeLines = BranchTemplates.renderTreeLines(ancestorLines);

        const depthIndicator = depth > this.MAX_INDENT_LEVEL
            ? `<span class="llm-branch-node__depth-badge">+${depth - this.MAX_INDENT_LEVEL}</span>`
            : '';

        let html = BranchTemplates.renderTreeNode(
            node,
            depth,
            indent,
            isCollapsed,
            treeLines,
            depthIndicator
        );

        if (hasChildren && !isCollapsed) {
            for (let i = 0; i < node.children.length; i++) {
                const isLastChild = i === node.children.length - 1;
                const newAncestorLines = [...ancestorLines, !isLastChild];
                html += this.renderTree(node.children[i], depth + 1, newAncestorLines);
            }
        }

        return html;
    }

    private bindEvents(): void {
        if (!this.panel) return;

        this.panel.querySelector('[data-action="close"]')?.addEventListener('click', () => {
            this.hide();
        });

        this.panel.querySelector('.llm-branch-tree-panel__overlay')?.addEventListener('click', () => {
            this.hide();
        });

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

        this.panel.querySelector('[data-action="compare"]')?.addEventListener('click', () => {
            if (this.selectedNodes.size === 2) {
                const [node1, node2] = Array.from(this.selectedNodes);
                this.options.onCompare?.(node1, node2);
                this.hide();
            }
        });
    }

    private toggleCollapse(nodeId: string, nodeEl: HTMLElement): void {
        const shouldShow = this.collapsedNodes.has(nodeId);

        if (shouldShow) {
            this.collapsedNodes.delete(nodeId);
        } else {
            this.collapsedNodes.add(nodeId);
        }

        nodeEl.classList.toggle('is-collapsed', !shouldShow);

        const currentDepth = parseInt(nodeEl.dataset.depth || '0');
        let nextEl = nodeEl.nextElementSibling as HTMLElement;

        while (nextEl?.classList.contains('llm-branch-node')) {
            const nextDepth = parseInt(nextEl.dataset.depth || '0');
            if (nextDepth <= currentDepth) break;

            nextEl.style.display = shouldShow ? '' : 'none';
            nextEl = nextEl.nextElementSibling as HTMLElement;
        }

        const svg = nodeEl.querySelector('[data-action="toggle-collapse"] svg') as SVGElement;
        if (svg) {
            svg.style.transform = `rotate(${shouldShow ? 90 : 0}deg)`;
        }
    }

    private toggleSelection(nodeId: string, nodeEl: HTMLElement): void {
        if (this.selectedNodes.has(nodeId)) {
            this.selectedNodes.delete(nodeId);
            nodeEl.classList.remove('is-selected');
        } else {
            if (this.selectedNodes.size >= 2) {
                const firstSelected = Array.from(this.selectedNodes)[0];
                const firstEl = this.panel?.querySelector(`[data-node-id="${firstSelected}"]`);
                firstEl?.classList.remove('is-selected');
                this.selectedNodes.delete(firstSelected);
            }
            this.selectedNodes.add(nodeId);
            nodeEl.classList.add('is-selected');
        }

        const compareBtn = this.panel?.querySelector('[data-action="compare"]') as HTMLButtonElement;
        if (compareBtn) {
            compareBtn.disabled = this.selectedNodes.size !== 2;
        }
    }

    private showRenameDialog(nodeId: string, nodeEl: HTMLElement): void {
        const currentName = nodeEl.querySelector('.llm-branch-badge')?.textContent || '';

        const dialog = document.createElement('div');
        dialog.className = 'llm-branch-rename-dialog';
        dialog.innerHTML = BranchTemplates.renderRenameDialog(currentName);

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


