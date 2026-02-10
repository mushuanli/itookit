
// @file: llm-ui/helpers/BranchManager.ts

import { BranchService } from '../services';
import { HistoryView, BranchAction } from '../components/HistoryView';
import { Toast, showConfirmDialog } from '@itookit/common';
import { ContentService } from '../services';

export class BranchManager {
    constructor(
        private branchService: BranchService,
        private contentService: ContentService,
        private historyView: HistoryView,
        private scrollToSession: (sessionId: string) => void
    ) {}

    /**
     * 处理分支操作
     */
    async handleBranchAction(
        action: BranchAction,
        nodeId: string,
        options?: { newName?: string; compareWith?: string }
    ): Promise<void> {
        try {
            switch (action) {
                case 'show-tree':
                    await this.showBranchTree();
                    break;

                case 'create':
                    await this.createBranch(nodeId);
                    break;

                case 'navigate':
                    await this.navigateToBranch(nodeId);
                    break;

                case 'rename':
                    if (options?.newName) {
                        await this.renameBranch(nodeId, options.newName);
                    }
                    break;

                case 'delete':
                    await this.deleteBranch(nodeId);
                    break;

                case 'compare':
                    if (options?.compareWith) {
                        await this.compareBranches(nodeId, options.compareWith);
                    }
                    break;

                case 'select':
                    await this.selectBranch(nodeId);
                    break;
            }
        } catch (e: any) {
            console.error('[BranchManager] Branch action failed:', e);
            Toast.error(e.message || 'Branch operation failed');
        }
    }

    private async showBranchTree(): Promise<void> {
        const tree = await this.branchService.getBranchTree();
        this.historyView.showBranchTree(tree);
    }

    private async createBranch(sourceNodeId: string): Promise<void> {
        const branchName = await this.promptBranchName();

        if (branchName === null) {
            return;
        }

        await this.branchService.createBranch(sourceNodeId, {
            name: branchName || undefined,
            copyContent: true
        });

        Toast.success(`Branch "${branchName || 'Untitled'}" created`);

        const sessions = this.contentService.getSessions();
        this.historyView.renderFull(sessions);
    }

    private async promptBranchName(): Promise<string | null> {
        return new Promise((resolve) => {
            const dialog = document.createElement('div');
            dialog.className = 'llm-branch-name-dialog';
            dialog.innerHTML = `
                <div class="llm-branch-name-dialog__overlay"></div>
                <div class="llm-branch-name-dialog__content">
                    <h4>Create New Branch</h4>
                    <p>Enter a name for this branch (optional):</p>
                    <input type="text" class="llm-input" placeholder="Branch name">
                    <div class="llm-branch-name-dialog__actions">
                        <button class="llm-btn" data-action="cancel">Cancel</button>
                        <button class="llm-btn llm-btn--primary" data-action="create">Create</button>
                    </div>
                </div>
            `;

            document.body.appendChild(dialog);

            const input = dialog.querySelector('input') as HTMLInputElement;
            input.focus();

            const cleanup = () => {
                dialog.remove();
            };

            dialog.querySelector('[data-action="create"]')?.addEventListener('click', () => {
                cleanup();
                resolve(input.value.trim());
            });

            dialog.querySelector('[data-action="cancel"]')?.addEventListener('click', () => {
                cleanup();
                resolve(null);
            });

            dialog.querySelector('.llm-branch-name-dialog__overlay')?.addEventListener('click', () => {
                cleanup();
                resolve(null);
            });

            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    cleanup();
                    resolve(input.value.trim());
                } else if (e.key === 'Escape') {
                    cleanup();
                    resolve(null);
                }
            });
        });
    }

    private async navigateToBranch(nodeId: string): Promise<void> {
        const sessions = this.contentService.getSessions();
        const targetSession = sessions.find(s =>
            s.id === nodeId ||
            s.persistedNodeId === nodeId ||
            s.executionRoot?.id === nodeId
        );

        if (targetSession) {
            this.scrollToSession(targetSession.id);
        }
    }

    private async renameBranch(nodeId: string, newName: string): Promise<void> {
        await this.branchService.renameBranch(nodeId, newName);
        Toast.success('Branch renamed');
    }

    private async deleteBranch(nodeId: string): Promise<void> {
        const confirmed = await showConfirmDialog(
            'Delete this branch and all its children?'
        );

        if (!confirmed) return;

        await this.branchService.deleteBranch(nodeId, true);

        const sessions = this.contentService.getSessions();
        this.historyView.renderFull(sessions);

        Toast.success('Branch deleted');
    }

    private async compareBranches(nodeId1: string, nodeId2: string): Promise<void> {
        const sessions = this.contentService.getSessions();

        const branch1 = sessions.find(s =>
            s.id === nodeId1 || s.persistedNodeId === nodeId1
        );
        const branch2 = sessions.find(s =>
            s.id === nodeId2 || s.persistedNodeId === nodeId2
        );

        if (branch1 && branch2) {
            this.historyView.showBranchCompare(branch1, branch2);
        } else {
            Toast.error('Could not find branches to compare');
        }
    }

    private async selectBranch(branchId: string): Promise<void> {
        const sessions = this.contentService.getSessions();
        const targetSession = sessions.find(s =>
            s.id === branchId || s.persistedNodeId === branchId
        );

        if (targetSession && targetSession.siblingIndex !== undefined) {
            await this.branchService.switchBranch(
                targetSession.id,
                targetSession.siblingIndex
            );

            const updatedSessions = this.contentService.getSessions();
            this.historyView.renderFull(updatedSessions);
        }
    }
}
