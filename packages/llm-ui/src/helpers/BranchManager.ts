// @file: llm-ui/helpers/BranchManager.ts

import { SessionManager } from '@itookit/llm-engine';
import { HistoryView } from '../components/HistoryView';
import { Toast, showConfirmDialog } from '@itookit/common';
import { BranchAction } from '../core/types';
import { ErrorHandler } from '../utils/errorHandler';

export class BranchManager {
    // ✅ 改动：统一错误处理器
    private errorHandler: ErrorHandler;

    constructor(
        private sessionManager: SessionManager,
        _historyView: HistoryView,
        _scrollToSession: (sessionId: string) => void
    ) {
        this.errorHandler = new ErrorHandler({
            module: 'BranchManager',
            defaultSeverity: 'toast',
        });
    }

    // ✅ 改动：使用 errorHandler.wrap
    async handleBranchAction(
        action: BranchAction,
        nodeId: string,
        options?: { newName?: string; compareWith?: string }
    ): Promise<void> {
        console.log('[BranchManager] Branch action:', action, nodeId, options);
        await this.errorHandler.wrap(
            () => this.executeBranchAction(action, nodeId, options),
            `Branch ${action}`
        );
    }

    private async executeBranchAction(
        action: BranchAction,
        nodeId: string,
        options?: { newName?: string; compareWith?: string }
    ): Promise<void> {
        switch (action) {
            case 'create':
                return this.createBranch(nodeId);
            case 'rename':
                return this.renameBranch(nodeId, options?.newName);
            case 'delete':
                return this.deleteBranch(nodeId);
            case 'select':
                return this.selectBranch(nodeId);
        }
    }

    /**
     * headNodeId → branchName 查找
     */
    private async resolveBranchName(headNodeId: string): Promise<string> {
        const branches = await this.sessionManager.listBranches();
        const branch = branches.find(b => b.headNodeId === headNodeId);
        if (!branch) {
            throw new Error(`No branch found for head node: ${headNodeId}`);
        }
        return branch.name;
    }

    private async createBranch(sourceNodeId: string): Promise<void> {
        const branchName = await this.promptBranchName();
        if (branchName === null) return;

        const branchPointId = this.findBranchPoint(sourceNodeId);

        const newNodeId = await this.sessionManager.createBranch(branchPointId, {
            name: branchName || undefined,
            copyContent: true,
        });

        // 创建后自动切换到新分支
        const newBranchName = await this.resolveBranchName(newNodeId);
        await this.sessionManager.switchBranch(newBranchName);

        Toast.success(`Branch "${branchName || 'Untitled'}" created`);
    }

    // ✅ 改动：使用 errorHandler.wrap
    async renameBranchByName(oldName: string, newName: string): Promise<void> {
        if (!newName.trim()) return;
        await this.errorHandler.wrap(
            async () => {
                await this.sessionManager.renameBranch(oldName, newName);
                Toast.success('Branch renamed');
            },
            'Rename branch'
        );
    }

    // ✅ 改动：使用 errorHandler.wrap
    async deleteBranchByName(branchName: string): Promise<void> {
        const confirmed = await showConfirmDialog(
            `Delete branch "${branchName}" and all its unique children?`
        );
        if (!confirmed) return;
        await this.errorHandler.wrap(
            async () => {
                await this.sessionManager.deleteBranch(branchName, true);
                Toast.success('Branch deleted');
            },
            'Delete branch'
        );
    }

    /**
     * 确定分叉点
     */
    private findBranchPoint(sourceNodeId: string): string {
        const sessions = this.sessionManager.getSessions();
        const sourceIndex = sessions.findIndex(s => s.id === sourceNodeId);

        if (sourceIndex === -1) return sourceNodeId;

        const sourceSession = sessions[sourceIndex];

        // assistant message → 直接用它自己
        if (sourceSession.role !== 'user') {
            return sourceNodeId;
        }

        // user message → 找前一条消息
        if (sourceIndex > 0) {
            return sessions[sourceIndex - 1].id;
        }

        // 第一条 user message，没有前驱 → 用自身
        return sourceNodeId;
    }

    /**
     * 切换到指定分支（传入 headNodeId，内部转为 branchName）
     */
    private async selectBranch(headNodeId: string): Promise<void> {
        const branchName = await this.resolveBranchName(headNodeId);
        await this.sessionManager.switchBranch(branchName);
    }

    /**
     * 重命名分支（传入 headNodeId，内部转为 branchName）
     */
    private async renameBranch(headNodeId: string, newName?: string): Promise<void> {
        if (!newName) return;
        const oldName = await this.resolveBranchName(headNodeId);
        await this.sessionManager.renameBranch(oldName, newName);
        Toast.success('Branch renamed');
    }

    /**
     * 删除分支（传入 headNodeId，内部转为 branchName）
     */
    private async deleteBranch(headNodeId: string): Promise<void> {
        const confirmed = await showConfirmDialog(
            'Delete this branch and all its children?'
        );
        if (!confirmed) return;

        const branchName = await this.resolveBranchName(headNodeId);
        await this.sessionManager.deleteBranch(branchName, true);
        Toast.success('Branch deleted');
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
