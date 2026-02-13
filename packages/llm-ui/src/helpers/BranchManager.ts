
// @file: llm-ui/helpers/BranchManager.ts

import { SessionManager } from '@itookit/llm-engine';
import { HistoryView } from '../components/HistoryView';
import { Toast, showConfirmDialog } from '@itookit/common';
import { BranchAction } from '../core/types';

export class BranchManager {
    constructor(
        private sessionManager: SessionManager,
        _historyView: HistoryView,
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
        console.log('[BranchManager] Branch action:', action, nodeId, options);
        try {
            switch (action) {
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
        if (branchName === null) return; // 用户取消

        // ✅ 找到分叉点：如果 sourceNodeId 是 user message，
        //    则从它之前的最后一条消息分叉（这样新分支不包含这条 user message）
        const branchPointId = this.findBranchPoint(sourceNodeId);

        const newNodeId = await this.sessionManager.createBranch(branchPointId, {
            name: branchName || undefined,
            copyContent: true,
        });

        // ✅ 创建后自动切换到新分支
        await this.sessionManager.navigateToBranch(newNodeId);

        Toast.success(`Branch "${branchName || 'Untitled'}" created`);
    }

    /**
     * ✅ 新增：确定分叉点
     * 
     * 如果用户在 user message 上点击 "Create Branch"：
     *   → 分叉点 = 该 user message 之前的最后一条 assistant message
     *   → 这样新分支停在上一轮对话结束处，等待用户输入新问题
     * 
     * 如果用户在 assistant message 上点击 "Create Branch"：
     *   → 分叉点 = 该 assistant message 本身
     *   → 新分支包含这条 assistant 回复
     * 
     * 如果是第一条 user message（没有前驱）：
     *   → 使用该 user message 自身作为分叉点（回退到 root）
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
        Toast.success('Branch deleted');
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
