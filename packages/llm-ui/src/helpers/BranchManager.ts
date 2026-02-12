
// @file: llm-ui/helpers/BranchManager.ts

import { SessionManager } from '@itookit/llm-engine';
import { Toast, showConfirmDialog } from '@itookit/common';
import { BranchAction } from '../core/types';

export class BranchManager {
    constructor(
        private sessionManager: SessionManager,
        private openNavigator: () => void,
        private scrollToSession: (sessionId: string) => void
    ) { }

    /**
     * 分支操作统一入口
     */
    async handleBranchAction(
        action: BranchAction,
        nodeId: string,
        options?: { newName?: string; compareWith?: string }
    ): Promise<void> {
        try {
            switch (action) {
                case 'show-tree':
                    // ✅ 改为打开 Navigator
                    this.openNavigator();
                    return;

                case 'create':
                    return await this.createBranch(nodeId);
                case 'navigate':
                    return this.navigateToBranch(nodeId);
                case 'rename':
                    if (options?.newName) {
                        await this.sessionManager.renameBranch(nodeId, options.newName);
                        Toast.success('Branch renamed');
                    }
                    return;
                case 'delete':
                    return await this.deleteBranch(nodeId);

                case 'select':
                    return await this.selectBranch(nodeId);
            }
        } catch (e: any) {
            console.error('[BranchManager] Branch action failed:', e);
            Toast.error(e.message || 'Branch operation failed');
        }
    }

    private async createBranch(sourceNodeId: string): Promise<void> {
        const branchName = await this.promptBranchName();
        if (branchName === null) return;

        await this.sessionManager.createBranch(sourceNodeId, {
            name: branchName || undefined,
            copyContent: true
        });

        Toast.success(`Branch "${branchName || 'Untitled'}" created`);
    }

    private navigateToBranch(nodeId: string): void {
        const sessions = this.sessionManager.getSessions();
        const target = sessions.find(s =>
            s.id === nodeId ||
            s.persistedNodeId === nodeId ||
            s.executionRoot?.id === nodeId
        );

        if (target) {
            this.scrollToSession(target.id);
        }
    }

    private async deleteBranch(nodeId: string): Promise<void> {
        const confirmed = await showConfirmDialog(
            'Delete this branch and all its children?'
        );
        if (!confirmed) return;

        await this.sessionManager.deleteBranch(nodeId, true);
        Toast.success('Branch deleted');
    }

    private async selectBranch(branchId: string): Promise<void> {
        await this.sessionManager.navigateToBranch(branchId);
    }

    private promptBranchName(): Promise<string | null> {
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

            const cleanup = () => dialog.remove();
            const submit = () => { cleanup(); resolve(input.value.trim()); };
            const cancel = () => { cleanup(); resolve(null); };

            dialog.querySelector('[data-action="create"]')?.addEventListener('click', submit);
            dialog.querySelector('[data-action="cancel"]')?.addEventListener('click', cancel);
            dialog.querySelector('.llm-branch-name-dialog__overlay')?.addEventListener('click', cancel);

            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') submit();
                else if (e.key === 'Escape') cancel();
            });
        });
    }
}
