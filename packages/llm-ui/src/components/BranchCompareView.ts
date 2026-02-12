// @file: llm-ui/components/BranchCompareView.ts

import { SessionGroup } from '@itookit/llm-engine';
import { BranchTemplates } from './templates/BranchTemplates';

export interface BranchCompareViewOptions {
    onClose?: () => void;
    onSelectBranch?: (branchId: string) => void;
}

/**
 * 分支对比视图
 */
export class BranchCompareView {
    private container: HTMLElement;
    private panel: HTMLElement | null = null;
    private options: BranchCompareViewOptions;

    constructor(container: HTMLElement, options: BranchCompareViewOptions = {}) {
        this.container = container;
        this.options = options;
    }

    /**
     * 显示对比视图
     */
    show(branch1: SessionGroup, branch2: SessionGroup): void {
        if (this.panel) {
            this.panel.remove();
        }

        const content1 = this.extractContent(branch1);
        const content2 = this.extractContent(branch2);
        const diff = this.computeDiff(content1, content2);

        this.panel = document.createElement('div');
        this.panel.className = 'llm-branch-compare';
        this.panel.innerHTML = BranchTemplates.renderCompareViewStructure();

        const bodyEl = this.panel.querySelector('.llm-branch-compare__body');
        if (bodyEl) {
            const timestamp1 = new Date(branch1.timestamp).toLocaleString();
            const timestamp2 = new Date(branch2.timestamp).toLocaleString();

            const meta1 = BranchTemplates.renderBranchMeta(timestamp1, branch1.branchInfo?.name);
            const meta2 = BranchTemplates.renderBranchMeta(timestamp2, branch2.branchInfo?.name);

            const diffContent1 = this.renderDiffContent(content1, diff, 'left');
            const diffContent2 = this.renderDiffContent(content2, diff, 'right');

            const column1 = BranchTemplates.renderCompareColumn('Branch A', branch1.id, meta1, diffContent1);
            const column2 = BranchTemplates.renderCompareColumn('Branch B', branch2.id, meta2, diffContent2);

            bodyEl.innerHTML = `
                ${column1}
                <div class="llm-branch-compare__divider"></div>
                ${column2}
            `;
        }

        const footerEl = this.panel.querySelector('.llm-branch-compare__footer');
        if (footerEl) {
            footerEl.innerHTML = BranchTemplates.renderCompareStats(
                diff.addedLines,
                diff.removedLines,
                diff.similarity
            );
        }

        this.container.appendChild(this.panel);
        this.bindEvents();

        requestAnimationFrame(() => {
            this.panel?.classList.add('is-open');
        });
    }

    /**
     * 隐藏对比视图
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
     * 提取内容
     */
    private extractContent(session: SessionGroup): string {
        if (session.role === 'user') {
            return session.content || '';
        }
        return session.executionRoot?.data.output || '';
    }

    private computeDiff(content1: string, content2: string): DiffResult {
        const lines1 = content1.split('\n');
        const lines2 = content2.split('\n');

        // 简单的行级差异计算
        const set1 = new Set(lines1);
        const set2 = new Set(lines2);

        let addedLines = 0;
        let removedLines = 0;

        const diffLines1: DiffLine[] = lines1.map(line => {
            if (!set2.has(line)) {
                removedLines++;
                return { text: line, type: 'removed' };
            }
            return { text: line, type: 'unchanged' };
        });

        const diffLines2: DiffLine[] = lines2.map(line => {
            if (!set1.has(line)) {
                addedLines++;
                return { text: line, type: 'added' };
            }
            return { text: line, type: 'unchanged' };
        });

        // 计算相似度
        const totalLines = Math.max(lines1.length, lines2.length);
        const unchangedLines = totalLines - Math.max(addedLines, removedLines);
        const similarity = totalLines > 0
            ? Math.round((unchangedLines / totalLines) * 100)
            : 100;

        return {
            left: diffLines1,
            right: diffLines2,
            addedLines,
            removedLines,
            similarity
        };
    }

    /**
     * 渲染差异内容
     */
    private renderDiffContent(_content: string, diff: DiffResult, side: 'left' | 'right'): string {
        const lines = side === 'left' ? diff.left : diff.right;

        return lines.map((line, index) =>
            BranchTemplates.renderDiffLine(line, index)
        ).join('');
    }

    /**
     * 绑定事件
     */
    private bindEvents(): void {
        if (!this.panel) return;

        this.panel.querySelector('[data-action="close"]')?.addEventListener('click', () => {
            this.hide();
        });

        this.panel.querySelector('.llm-branch-compare__overlay')?.addEventListener('click', () => {
            this.hide();
        });

        this.panel.querySelectorAll('[data-action="select"]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const branchId = (e.currentTarget as HTMLElement).dataset.branchId;
                if (branchId) {
                    this.options.onSelectBranch?.(branchId);
                    this.hide();
                }
            });
        });
    }

    destroy(): void {
        this.panel?.remove();
        this.panel = null;
    }
}

interface DiffLine {
    text: string;
    type: 'added' | 'removed' | 'unchanged';
}

interface DiffResult {
    left: DiffLine[];
    right: DiffLine[];
    addedLines: number;
    removedLines: number;
    similarity: number;
}

