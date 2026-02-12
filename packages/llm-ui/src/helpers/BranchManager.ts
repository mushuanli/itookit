
// @file: llm-ui/helpers/BranchManager.ts

import { SessionManager } from '@itookit/llm-engine';
import { HistoryView } from '../components/HistoryView';
import { Toast, showConfirmDialog } from '@itookit/common';
import { BranchAction } from '../core/types';

export class BranchManager {
    constructor(
        private sessionManager: SessionManager,
        private historyView: HistoryView,
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
                    return await this.showBranchTree();
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
                case 'compare':
                    if (options?.compareWith) {
                        return await this.compareBranches(nodeId, options.compareWith);
                    }
                    return;
                case 'select':
                    return await this.selectBranch(nodeId);
            }
        } catch (e: any) {
            console.error('[BranchManager] Branch action failed:', e);
            Toast.error(e.message || 'Branch operation failed');
        }
    }

    async showBranchTree(): Promise<void> {
        const tree = await this.sessionManager.getBranchTree();
        this.historyView.showBranchTree(tree);
    }

    private async createBranch(sourceNodeId: string): Promise<void> {
        const branchName = await this.promptBranchName();
        if (branchName === null) return;

        // ✅ SessionManager.createBranch 内部自动：
        //   1. 持久化创建分支
        //   2. reloadSessionData
        //   3. 发送 branch_created 事件
        await this.sessionManager.createBranch(sourceNodeId, {
            name: branchName || undefined,
            copyContent: true
        });

        Toast.success(`Branch "${branchName || 'Untitled'}" created`);

        // 刷新视图（事件驱动已处理部分，但全量刷新保证一致性）
        const sessions = this.sessionManager.getSessions();
        this.historyView.renderFull(sessions);
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

        // ✅ SessionManager.deleteBranch 内部自动：
        //   1. 校验不能删除当前 head
        //   2. 持久化删除
        //   3. 内存清理
        //   4. 发送 messages_deleted 事件
        await this.sessionManager.deleteBranch(nodeId, true);

        const sessions = this.sessionManager.getSessions();
        this.historyView.renderFull(sessions);
        Toast.success('Branch deleted');
    }

    /**
     * ✅ 使用 SessionManager.compareBranches 替代手动查找
     */
    private async compareBranches(nodeId1: string, nodeId2: string): Promise<void> {
        // ✅ compareBranches 返回两个分支的完整消息链 + 共同祖先
        const result = await this.sessionManager.compareBranches(nodeId1, nodeId2);

        if (result.branchA.length === 0 || result.branchB.length === 0) {
            Toast.error('Could not find branches to compare');
            return;
        }

        // 取每个分支的最后一条消息作为对比入口
        const lastA = result.branchA[result.branchA.length - 1];
        const lastB = result.branchB[result.branchB.length - 1];
        this.historyView.showBranchCompare(lastA, lastB);
    }

    /**
     * ✅ 使用 navigateToBranch 替代 switchToSibling
     */
    private async selectBranch(branchId: string): Promise<void> {
        // ✅ navigateToBranch 内部自动：
        //   1. updateManifestHead 切换当前活跃头节点
        //   2. reloadSessionData 重新加载消息
        //   3. 发送 session_cleared + session_start 事件序列
        //   4. 发送 branch_switched 事件
        await this.sessionManager.navigateToBranch(branchId);

        // 重新渲染（事件驱动覆盖大部分场景，全量刷新作为兜底）
        const updated = this.sessionManager.getSessions();
        this.historyView.renderFull(updated);
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
